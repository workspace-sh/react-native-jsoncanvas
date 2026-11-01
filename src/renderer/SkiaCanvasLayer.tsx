import React, {useMemo} from 'react';
import {StyleSheet, type ViewStyle} from 'react-native';
import {Canvas, Group, Picture, processTransform3d, type SkPicture} from 'react-native-skia';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import type {CanvasEdge, CanvasNode, TextNode, LinkNode, FileNode, GroupNode} from '../core';
import {hasCssClasses, enrichNodes, type EnrichedNode} from './extensions/cssclasses';
import {EdgeRenderer} from './edges/EdgeRenderer';
import {SkiaCardRenderer} from './nodes/SkiaCardRenderer';
import {SkiaGroupBackgroundRenderer} from './nodes/SkiaGroupBackgroundRenderer';
import {SkiaTextRenderer} from './nodes/SkiaTextRenderer';
import {SkiaCardLabelRenderer} from './nodes/SkiaCardLabelRenderer';
import {SkiaLinkRenderer} from './nodes/SkiaLinkRenderer';
import {SkiaFileRenderer} from './nodes/SkiaFileRenderer';
import {SkiaImageRenderer} from './nodes/SkiaImageRenderer';
import {SkiaGroupLabelRenderer} from './nodes/SkiaGroupLabelRenderer';
import type {ColorScheme} from './theme';
import {useCanvasPicture} from './useCanvasPicture';
import {devFlags} from './devFlags';

// Module-level: matches any file ending in `.svg` (case-insensitive). Stable
// across renders, so it doesn't need to be in any useMemo dep array.
const SVG_RE = /\.svg$/i;

const NONE: never[] = [];

/**
 * Below this zoom the canvas is drawn from the overview recording, without
 * text: body text (about 14pt) would be under 1.5px high, unreadable, and
 * drawing thousands of such glyph runs was most of a zoomed-out frame.
 */
const OVERVIEW_SCALE = 0.1;

interface CameraValues {
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  scale: SharedValue<number>;
}

interface SkiaCanvasLayerProps {
  /** The nodes drawn live: those near the viewport (useViewportCulling). */
  allNodes: CanvasNode[];
  edges: CanvasEdge[];
  /**
   * Every node and edge, for the recorded Picture: a pinch or camera tween
   * draws from it while the live set is held still, so it must hold the
   * whole canvas, not whatever was near the viewport when it was recorded.
   */
  pictureNodes: CanvasNode[];
  pictureEdges: CanvasEdge[];
  nodes: Map<string, CanvasNode>;
  colorScheme: ColorScheme;
  camera: CameraValues;
  viewportWidth: number;
  viewportHeight: number;
  basePath?: string;
  /**
   * Image file node the pointer is currently over (macOS hover), or null.
   * Reveals that node's filename chip — see `SkiaFileRenderer`. Plain React
   * state rather than a SharedValue: it changes at node-crossing rate, not
   * frame rate, and the chip is Skia-declarative content that has to
   * reconcile anyway.
   */
  hoveredFileNodeId?: string | null;
}

function useCameraMatrix(camera: CameraValues) {
  return useDerivedValue(() => {
    'worklet';
    return processTransform3d([
      {translateX: camera.translateX.value},
      {translateY: camera.translateY.value},
      {scale: camera.scale.value},
    ]);
  });
}

/**
 * Single Skia surface rendering the entire canvas: cards, edges, text,
 * images, and labels. Viewport-sized with camera transform applied as
 * a Group — content is re-rendered as vectors at every zoom level.
 */
export function SkiaCanvasLayer({
  allNodes,
  edges,
  pictureNodes,
  pictureEdges,
  nodes,
  colorScheme,
  camera,
  viewportWidth,
  viewportHeight,
  basePath,
  hoveredFileNodeId = null,
}: SkiaCanvasLayerProps) {
  const matrix = useCameraMatrix(camera);

  // Enrich nodes with cssclasses render props (lazy — no-op if no frontmatter detected).
  // Must run before useCanvasPicture so the Picture recording gets displayText.
  const enrichedNodes = useMemo(
    () => hasCssClasses(allNodes) ? enrichNodes(allNodes) : allNodes as EnrichedNode[],
    [allNodes],
  );

  const enrichedPictureNodes = useMemo(
    () => hasCssClasses(pictureNodes) ? enrichNodes(pictureNodes) : pictureNodes as EnrichedNode[],
    [pictureNodes],
  );
  const picture = useCanvasPicture({allNodes: enrichedPictureNodes as CanvasNode[], edges: pictureEdges, nodeMap: nodes, colorScheme, basePath});

  // Once recorded, the canvas is drawn from the Picture (replayed on the UI
  // thread) at every zoom, and the live tree holds only what the Picture
  // leaves out: SVGs and the hover chip. Every change to a live Skia tree
  // (a culling update as the camera moves) has Skia re-record all of it on
  // the JavaScript thread: about 100 ms at 2,000 nodes, and still 6 to 13 ms
  // (over 25 ms on an iPhone) for the few dozen nodes in view close up. The
  // Picture draws the same thing, pixel for pixel. Until it's recorded, and
  // with `devFlags.enablePictureRecording` off, the live tree draws it all.
  const showPicture = devFlags.enablePictureRecording && picture != null;
  const shownPicture = useDerivedValue(() => {
    'worklet';
    if (!picture) return null;
    return camera.scale.value < OVERVIEW_SCALE ? picture.overview : picture.full;
  }, [picture]);

  const resolvedEdges = useMemo(() => {
    if (showPicture) return NONE;
    return edges
      .map(edge => {
        const fromNode = nodes.get(edge.fromNode);
        const toNode = nodes.get(edge.toNode);
        if (!fromNode || !toNode) return null;
        return {edge, fromNode, toNode};
      })
      .filter(Boolean) as Array<{
      edge: CanvasEdge;
      fromNode: CanvasNode;
      toNode: CanvasNode;
    }>;
  }, [edges, nodes, showPicture]);

  // Z-ordered node lists
  const liveNodes = showPicture ? NONE : enrichedNodes;
  const groupNodes = useMemo(
    () => liveNodes.filter((n): n is GroupNode => n.type === 'group'),
    [liveNodes],
  );
  const nonGroupNodes = useMemo(
    () => liveNodes.filter(n => n.type !== 'group'),
    [liveNodes],
  );
  const textNodes = useMemo(
    () => liveNodes.filter((n): n is TextNode => n.type === 'text'),
    [liveNodes],
  );
  const linkNodes = useMemo(
    () => liveNodes.filter((n): n is LinkNode => n.type === 'link'),
    [liveNodes],
  );
  const fileNodes = useMemo(
    () => enrichedNodes.filter((n): n is FileNode => n.type === 'file'),
    [enrichedNodes],
  );
  const labelledGroups = useMemo(
    () => groupNodes.filter(n => !!n.label),
    [groupNodes],
  );

  // Split file nodes: rasters go in the live tree below the Picture,
  // SVGs render above the Picture for vector fidelity at any zoom.
  const svgFileNodes = useMemo(
    () => fileNodes.filter(n => SVG_RE.test(n.file)),
    [fileNodes],
  );
  const nonSvgFileNodes = useMemo(
    () => (showPicture ? NONE : fileNodes.filter(n => !SVG_RE.test(n.file))),
    [fileNodes, showPicture],
  );
  const liveFileNodes = showPicture ? NONE : fileNodes;

  const hoveredFileNode = useMemo(
    () => (hoveredFileNodeId ? fileNodes.find(n => n.id === hoveredFileNodeId) ?? null : null),
    [fileNodes, hoveredFileNodeId],
  );

  // Only the size is dynamic; the positioning half is static and lives in
  // `styles`. Typed as ViewStyle so a bad key is a compile error rather than
  // a silently ignored property at runtime.
  const canvasStyle = useMemo<ViewStyle>(
    () => ({width: viewportWidth, height: viewportHeight}),
    [viewportWidth, viewportHeight],
  );

  return (
    <Canvas
      style={[styles.canvas, canvasStyle]}
      pointerEvents="none"
    >
      <Group matrix={matrix}>
        {/* --- Live non-SVG content (only until the Picture is recorded) --- */}
        {/* Layer 1: group cards (behind everything) */}
        {groupNodes.map(node => (
          <SkiaCardRenderer key={`card-${node.id}`} node={node} colorScheme={colorScheme} />
        ))}
        {/* Layer 2: group background images */}
        {groupNodes.map(node => (
          <SkiaGroupBackgroundRenderer key={`bg-${node.id}`} node={node} />
        ))}
        {/* Layer 3: edges */}
        {resolvedEdges.map(({edge, fromNode, toNode}) => (
          <EdgeRenderer
            key={edge.id}
            edge={edge}
            fromNode={fromNode}
            toNode={toNode}
            offsetX={0}
            offsetY={0}
          />
        ))}
        {/* Layer 4: non-group cards */}
        {nonGroupNodes.map(node => (
          <SkiaCardRenderer key={`card-${node.id}`} node={node} colorScheme={colorScheme} />
        ))}
        {/* Layer 5: text, links, files, raster images, group labels */}
        {textNodes.map(node => (
          <SkiaTextRenderer
            key={node.id}
            node={node}
            colorScheme={colorScheme}
            offsetX={0}
            offsetY={0}
          />
        ))}
        {/* Card side-labels rendered separately so their rotation Group sits
            at a component top-level (Group transform is a no-op inside an
            element array — #64). Renderer no-ops for label-less nodes. */}
        {textNodes.map(node => (
          <SkiaCardLabelRenderer
            key={`label-${node.id}`}
            node={node}
            colorScheme={colorScheme}
            offsetX={0}
            offsetY={0}
          />
        ))}
        {linkNodes.map(node => (
          <SkiaLinkRenderer
            key={node.id}
            node={node}
            colorScheme={colorScheme}
            offsetX={0}
            offsetY={0}
          />
        ))}
        {/* Always-on labels for non-image file nodes. Image file nodes
            no-op here and get their filename from the hover chip below,
            drawn above every other layer so a neighbouring node can't
            occlude it. */}
        {liveFileNodes.map(node => (
          <SkiaFileRenderer
            key={node.id}
            node={node}
            colorScheme={colorScheme}
            offsetX={0}
            offsetY={0}
          />
        ))}
        {nonSvgFileNodes.map(node => (
          <SkiaImageRenderer
            key={`img-${node.id}`}
            node={node}
            offsetX={0}
            offsetY={0}
            basePath={basePath}
          />
        ))}
        {labelledGroups.map(node => (
          <SkiaGroupLabelRenderer
            key={`label-${node.id}`}
            node={node}
            colorScheme={colorScheme}
            offsetX={0}
            offsetY={0}
          />
        ))}
        {/* --- The recorded Picture: everything but SVGs and the hover chip --- */}
        {showPicture && <Picture picture={shownPicture as SharedValue<SkPicture>} />}
        {/* --- Live SVG content (above Picture for vector fidelity at any zoom) --- */}
        {svgFileNodes.map(node => (
          <SkiaImageRenderer
            key={`img-${node.id}`}
            node={node}
            offsetX={0}
            offsetY={0}
            basePath={basePath}
          />
        ))}
        {/* --- Hover chip (topmost; live tree only, never recorded) --- */}
        {hoveredFileNode && (
          <SkiaFileRenderer
            key={`hover-${hoveredFileNode.id}`}
            node={hoveredFileNode}
            colorScheme={colorScheme}
            offsetX={0}
            offsetY={0}
            revealed
          />
        )}
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  /** Pinned to the viewport's top-left; the size half is applied inline
   *  because it tracks layout. */
  canvas: {position: 'absolute', left: 0, top: 0},
});
