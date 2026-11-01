import React, {useMemo} from 'react';
import {StyleSheet, type ViewStyle} from 'react-native';
import {Canvas, Group, Picture, createPicture, processTransform3d, type SkPicture} from 'react-native-skia';
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

/**
 * Above this many nodes near the viewport, the canvas is drawn from the
 * recorded Picture rather than the live tree. Every change to the live tree
 * (a culling update as the camera moves) has Skia re-record all of it on the
 * JavaScript thread, which at thousands of nodes takes most of a frame or
 * more; the Picture is replayed on the UI thread at any count (the pinch
 * already draws from it). Below this, the live tree is cheap to update.
 */
export const LIVE_NODE_LIMIT = 250;
const NONE: never[] = [];

/** Drawn in the Picture's place while the live tree shows. */
let emptyPicture: SkPicture | null = null;
const getEmptyPicture = () => (emptyPicture ??= createPicture(() => {}));

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
  isPinching: SharedValue<boolean>;
  // True for the duration of a `fitToViewport` / `recenter` /
  // `zoomToNode` interpolation. Used together with `isPinching` to
  // reveal the pre-recorded Picture overlay so the live Skia tree
  // doesn't re-paint at every animated scale (#35).
  isCameraAnimating: SharedValue<boolean>;
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
  isPinching,
  isCameraAnimating,
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

  // The Picture overlay is switched by shared values — no runOnJS, no React
  // reconciliation. Skia picks up the change on the next frame. Shown
  // during pinch AND during camera-animation tweens (fit/recenter/
  // zoom-to-node), so the live Skia tree doesn't re-paint at every
  // animated scale step (#35), and at rest when many nodes are in view.
  const showPicture = devFlags.enablePictureRecording && picture != null;
  // Many nodes in view: the Picture alone, with an empty live tree (SVGs,
  // which the Picture leaves out, and the hover chip stay live).
  const pictureOnly = showPicture && allNodes.length > LIVE_NODE_LIMIT;
  // The Picture or nothing, switched on the UI thread as a pinch or tween
  // starts and ends. Not an opacity of 0: a Group at opacity 0 still drew the
  // Picture over the live tree, so every translucent fill (group
  // backgrounds) showed twice as strong at rest.
  const empty = getEmptyPicture();
  const shownPicture = useDerivedValue(() => {
    'worklet';
    return picture != null && (pictureOnly || isPinching.value || isCameraAnimating.value) ? picture : empty;
  }, [picture, pictureOnly, empty]);

  const resolvedEdges = useMemo(() => {
    if (pictureOnly) return NONE;
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
  }, [edges, nodes, pictureOnly]);

  // Z-ordered node lists
  const liveNodes = pictureOnly ? NONE : enrichedNodes;
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
    () => (pictureOnly ? NONE : fileNodes.filter(n => !SVG_RE.test(n.file))),
    [fileNodes, pictureOnly],
  );
  const liveFileNodes = pictureOnly ? NONE : fileNodes;

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
        {/* --- Live non-SVG content (covered by the Picture during pinch, or empty when it draws alone) --- */}
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
        {/* --- Picture overlay (shown during pinch, tweens, and when many nodes are in view) --- */}
        {showPicture && <Picture picture={shownPicture} />}
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
