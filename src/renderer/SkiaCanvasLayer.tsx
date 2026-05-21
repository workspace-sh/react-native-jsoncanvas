import React, {useMemo} from 'react';
import {Canvas, Group, Picture, processTransform3d} from '@shopify/react-native-skia';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import type {CanvasEdge, CanvasNode, TextNode, LinkNode, FileNode, GroupNode} from '../core';
import {hasCssClasses, enrichNodes, type EnrichedNode} from './extensions/cssclasses';
import {EdgeRenderer} from './edges/EdgeRenderer';
import {SkiaCardRenderer} from './nodes/SkiaCardRenderer';
import {SkiaGroupBackgroundRenderer} from './nodes/SkiaGroupBackgroundRenderer';
import {SkiaTextRenderer} from './nodes/SkiaTextRenderer';
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

interface CameraValues {
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  scale: SharedValue<number>;
}

interface SkiaCanvasLayerProps {
  allNodes: CanvasNode[];
  edges: CanvasEdge[];
  nodes: Map<string, CanvasNode>;
  colorScheme: ColorScheme;
  camera: CameraValues;
  viewportWidth: number;
  viewportHeight: number;
  basePath?: string;
  isPinching: SharedValue<boolean>;
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
  nodes,
  colorScheme,
  camera,
  viewportWidth,
  viewportHeight,
  basePath,
  isPinching,
}: SkiaCanvasLayerProps) {
  const matrix = useCameraMatrix(camera);

  // Enrich nodes with cssclasses render props (lazy — no-op if no frontmatter detected).
  // Must run before useCanvasPicture so the Picture recording gets displayText.
  const enrichedNodes = useMemo(
    () => hasCssClasses(allNodes) ? enrichNodes(allNodes) : allNodes as EnrichedNode[],
    [allNodes],
  );

  const picture = useCanvasPicture({allNodes: enrichedNodes as CanvasNode[], edges, nodeMap: nodes, colorScheme, basePath});

  // Picture overlay opacity driven by shared value — no runOnJS, no React
  // reconciliation. Skia picks up the change on the next frame.
  const pictureOpacity = useDerivedValue(() => {
    'worklet';
    return isPinching.value ? 1 : 0;
  });
  const showPicture = devFlags.enablePictureRecording && picture != null;

  const resolvedEdges = useMemo(() => {
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
  }, [edges, nodes]);

  // Z-ordered node lists
  const groupNodes = useMemo(
    () => enrichedNodes.filter((n): n is GroupNode => n.type === 'group'),
    [enrichedNodes],
  );
  const nonGroupNodes = useMemo(
    () => enrichedNodes.filter(n => n.type !== 'group'),
    [enrichedNodes],
  );
  const textNodes = useMemo(
    () => enrichedNodes.filter((n): n is TextNode => n.type === 'text'),
    [enrichedNodes],
  );
  const linkNodes = useMemo(
    () => enrichedNodes.filter((n): n is LinkNode => n.type === 'link'),
    [enrichedNodes],
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
    () => fileNodes.filter(n => !SVG_RE.test(n.file)),
    [fileNodes],
  );

  return (
    <Canvas
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: viewportWidth,
        height: viewportHeight,
      }}
      pointerEvents="none"
    >
      <Group matrix={matrix}>
        {/* --- Live non-SVG content (obscured by Picture overlay during pinch) --- */}
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
        {linkNodes.map(node => (
          <SkiaLinkRenderer
            key={node.id}
            node={node}
            colorScheme={colorScheme}
            offsetX={0}
            offsetY={0}
          />
        ))}
        {fileNodes.map(node => (
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
        {/* --- Picture overlay (fades in during pinch) --- */}
        {showPicture && (
          <Group opacity={pictureOpacity}>
            <Picture picture={picture!} />
          </Group>
        )}
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
      </Group>
    </Canvas>
  );
}
