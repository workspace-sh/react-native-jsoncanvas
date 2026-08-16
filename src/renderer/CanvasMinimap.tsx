import React, {useMemo} from 'react';
import {View, Platform, StyleSheet, type ViewStyle} from 'react-native';
import {Canvas, Rect, RoundedRect, Group} from '@shopify/react-native-skia';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import type {CanvasNode, CanvasEdge} from '../core';
import {getCanvasBackground, getMinimapColors, type ColorScheme} from './theme';
import {hasCssClasses, enrichNodes, type EnrichedNode} from './extensions/cssclasses';
import {SkiaCardRenderer} from './nodes/SkiaCardRenderer';
import {EdgeRenderer} from './edges/EdgeRenderer';

export type MinimapPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface Props {
  position: MinimapPosition;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  colorScheme: ColorScheme;
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  scale: SharedValue<number>;
  viewportWidth: number;
  viewportHeight: number;
  leftOverlayWidth?: SharedValue<number>;
  /** Additional bottom inset (in pt) applied when the minimap is at a
   *  `bottom-*` corner. Consumer-supplied; combines with platform defaults. */
  bottomInset?: number;
}

const EDGE_PADDING = 12;
const INNER_PADDING = 8;
const BORDER_RADIUS = 6;
const DESKTOP_SIZE = {width: 200, height: 150};
const MOBILE_SIZE = {width: 120, height: 90};
const VIEWPORT_STROKE_WIDTH = 1.5;
const WORLD_PADDING = 50;
const MACOS_CONTROLS_INSET = 56;

function getMinimapSize() {
  if (Platform.OS === 'macos' || Platform.OS === 'web') return DESKTOP_SIZE;
  return MOBILE_SIZE;
}

function getPositionStyle(position: MinimapPosition, bottomInset: number): ViewStyle {
  const platformBottom = Platform.OS === 'macos' ? MACOS_CONTROLS_INSET : 0;
  const totalBottom = EDGE_PADDING + platformBottom + bottomInset;
  switch (position) {
    case 'top-left':     return {top: EDGE_PADDING, left: EDGE_PADDING};
    case 'top-right':    return {top: EDGE_PADDING, right: EDGE_PADDING};
    case 'bottom-left':  return {bottom: totalBottom, left: EDGE_PADDING};
    case 'bottom-right': return {bottom: totalBottom, right: EDGE_PADDING};
  }
}

/**
 * Minimap overlay. Reuses the main canvas renderers (`SkiaCardRenderer`,
 * `EdgeRenderer`) inside a scaled `<Group>`, so the minimap inherits all
 * visual treatments — rounded corners, dashed group borders, shape
 * variants, gradients, drop shadows, edge bezier curves with arrows —
 * automatically. Anything the main render gets, the minimap gets.
 *
 * Read-only (`pointerEvents="none"` on the container). Text content isn't
 * rendered (markdown rasterization happens elsewhere in `SkiaCanvasLayer`,
 * not in `SkiaCardRenderer`) — which is intentional: illegible at minimap
 * scale and saves the per-node rasterization cost.
 */
export function CanvasMinimap({
  position,
  nodes,
  edges,
  colorScheme,
  translateX,
  translateY,
  scale,
  viewportWidth,
  viewportHeight,
  leftOverlayWidth,
  bottomInset = 0,
}: Props) {
  const size = useMemo(() => getMinimapSize(), []);
  // Typed rather than inline so a mistyped key fails the build instead of
  // being dropped silently at runtime.
  const canvasStyle = useMemo<ViewStyle>(
    () => ({width: size.width, height: size.height}),
    [size],
  );

  // Enrich nodes so SkiaCardRenderer picks up cssclasses renderProps
  // (shape variants, pill, drop shadow, etc.). No-op when no frontmatter.
  const enriched = useMemo<EnrichedNode[]>(
    () => hasCssClasses(nodes) ? enrichNodes(nodes) : (nodes as EnrichedNode[]),
    [nodes],
  );

  const nodeById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of enriched) m.set(n.id, n);
    return m;
  }, [enriched]);

  // Group nodes drawn first (z-order: groups behind, others in front) —
  // matches SkiaCanvasLayer's render order.
  const {groupNodes, otherNodes} = useMemo(() => {
    const groups: EnrichedNode[] = [];
    const others: EnrichedNode[] = [];
    for (const n of enriched) (n.type === 'group' ? groups : others).push(n);
    return {groupNodes: groups, otherNodes: others};
  }, [enriched]);

  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    minX -= WORLD_PADDING;
    minY -= WORLD_PADDING;
    maxX += WORLD_PADDING;
    maxY += WORLD_PADDING;
    const boundsW = Math.max(1, maxX - minX);
    const boundsH = Math.max(1, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Aspect-match world to viewport so fit aligns viewport rect to minimap.
    const viewportAspect = viewportWidth / viewportHeight;
    const boundsAspect = boundsW / boundsH;
    let worldW: number, worldH: number;
    if (boundsAspect < viewportAspect) {
      worldH = boundsH;
      worldW = boundsH * viewportAspect;
    } else {
      worldW = boundsW;
      worldH = boundsW / viewportAspect;
    }
    const worldMinX = cx - worldW / 2;
    const worldMinY = cy - worldH / 2;

    const innerW = size.width - INNER_PADDING * 2;
    const innerH = size.height - INNER_PADDING * 2;
    const fitScale = Math.min(innerW / worldW, innerH / worldH);
    const offsetX = INNER_PADDING + (innerW - worldW * fitScale) / 2 - worldMinX * fitScale;
    const offsetY = INNER_PADDING + (innerH - worldH * fitScale) / 2 - worldMinY * fitScale;
    return {fitScale, offsetX, offsetY};
  }, [nodes, size.width, size.height, viewportWidth, viewportHeight]);

  // Viewport rectangle in minimap-local coords, derived per frame from camera.
  const viewportRect = useDerivedValue(() => {
    'worklet';
    if (!layout) return {x: 0, y: 0, width: 0, height: 0};
    const overlayLeft = leftOverlayWidth ? leftOverlayWidth.value : 0;
    const wx0 = (overlayLeft - translateX.value) / scale.value;
    const wy0 = (0 - translateY.value) / scale.value;
    const wx1 = (viewportWidth - translateX.value) / scale.value;
    const wy1 = (viewportHeight - translateY.value) / scale.value;
    return {
      x: wx0 * layout.fitScale + layout.offsetX,
      y: wy0 * layout.fitScale + layout.offsetY,
      width: (wx1 - wx0) * layout.fitScale,
      height: (wy1 - wy0) * layout.fitScale,
    };
  });

  if (!layout) return null;

  const bgColor = getCanvasBackground(colorScheme);
  const {border: borderColor, viewportStroke} = getMinimapColors(colorScheme);

  // World → minimap transform. Matches the matrix pattern CanvasView uses
  // for the main camera: `[translate, scale]` produces
  // `out = world * scale + translate`.
  const worldToMinimap = [
    {translateX: layout.offsetX},
    {translateY: layout.offsetY},
    {scale: layout.fitScale},
  ];

  return (
    <View
      pointerEvents="none"
      style={[styles.container, getPositionStyle(position, bottomInset), {width: size.width, height: size.height}]}
    >
      <Canvas style={canvasStyle}>
        <RoundedRect x={0} y={0} width={size.width} height={size.height} r={BORDER_RADIUS} color={bgColor} />
        <RoundedRect
          x={0.5} y={0.5}
          width={size.width - 1} height={size.height - 1}
          r={BORDER_RADIUS - 0.5}
          color={borderColor}
          style="stroke" strokeWidth={1}
        />

        {/* All canvas content, scaled into minimap space. Reuses the main
            canvas renderers — visual fidelity inherited for free. */}
        <Group transform={worldToMinimap}>
          {groupNodes.map(node => (
            <SkiaCardRenderer key={`g-${node.id}`} node={node} colorScheme={colorScheme} />
          ))}
          {edges.map(edge => {
            const fromNode = nodeById.get(edge.fromNode);
            const toNode = nodeById.get(edge.toNode);
            if (!fromNode || !toNode) return null;
            return (
              <EdgeRenderer
                key={edge.id}
                edge={edge}
                fromNode={fromNode}
                toNode={toNode}
              />
            );
          })}
          {otherNodes.map(node => (
            <SkiaCardRenderer key={`n-${node.id}`} node={node} colorScheme={colorScheme} />
          ))}
        </Group>

        {/* Viewport indicator on top — in minimap coords, outside the transform. */}
        <Rect rect={viewportRect} color={viewportStroke} style="stroke" strokeWidth={VIEWPORT_STROKE_WIDTH} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
});
