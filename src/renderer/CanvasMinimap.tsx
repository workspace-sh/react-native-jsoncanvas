import React, {useEffect, useMemo, useState} from 'react';
import {View, StyleSheet, type ViewStyle} from 'react-native';
import {Canvas, Rect, RoundedRect, Group, Picture, processTransform3d, type SkPicture} from 'react-native-skia';
import {useDerivedValue, type SharedValue} from 'react-native-reanimated';
import type {CanvasNode, CanvasEdge} from '../core';
import {getCanvasBackground, getMinimapColors, type ColorScheme} from './theme';
import {hasCssClasses, enrichNodes, type EnrichedNode} from './extensions/cssclasses';
import {recordShapesPicture} from './useCanvasPicture';

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
  /** The screen's safe area: the minimap keeps inside it, on every side. */
  safeArea?: Insets;
  /**
   * The host's material to sit on (its glass, say), in place of the drawn
   * background and border: how the minimap looks is the host's.
   */
  background?: (size: {width: number; height: number}) => React.ReactNode;
  /** Its corners' radius, in points: the drawn background's, and what clips the host's. */
  cornerRadius?: number;
  /** Its size for a canvas wider than it's tall (160×120 by default); turned upright for a taller one. */
  size?: {width: number; height: number};
}

const EDGE_PADDING = 12;
const INNER_PADDING = 8;
const BORDER_RADIUS = 6;
const DEFAULT_SIZE = {width: 160, height: 120};
const VIEWPORT_STROKE_WIDTH = 1.5;
const WORLD_PADDING = 50;

/**
 * The minimap's box: landscape for a canvas wider than it's tall, portrait
 * for a taller one, so the canvas fills as much of it as it can.
 */
function getMinimapSize(contentAspect: number, base: {width: number; height: number}) {
  return contentAspect < 1 ? {width: base.height, height: base.width} : base;
}

/** The nodes' bounds, with a margin, in world units. */
function contentBounds(nodes: CanvasNode[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return {
    minX: minX - WORLD_PADDING,
    minY: minY - WORLD_PADDING,
    width: Math.max(1, maxX - minX + WORLD_PADDING * 2),
    height: Math.max(1, maxY - minY + WORLD_PADDING * 2),
  };
}

export type Insets = {top: number; right: number; bottom: number; left: number};
export const NO_INSETS: Insets = {top: 0, right: 0, bottom: 0, left: 0};

function getPositionStyle(position: MinimapPosition, bottomInset: number, safe: Insets): ViewStyle {
  const top = EDGE_PADDING + safe.top;
  const left = EDGE_PADDING + safe.left;
  const right = EDGE_PADDING + safe.right;
  const bottom = EDGE_PADDING + safe.bottom + bottomInset;
  switch (position) {
    case 'top-left':     return {top, left};
    case 'top-right':    return {top, right};
    case 'bottom-left':  return {bottom, left};
    case 'bottom-right': return {bottom, right};
  }
}

/**
 * Minimap overlay. Draws the canvas's cards and edges with the main
 * Picture's own drawing code (`recordShapesPicture`), recorded once, inside a
 * scaled `<Group>`, so the minimap has the same rounded corners, dashed group
 * borders, shape variants, gradients and edge curves as the canvas.
 *
 * Read-only (`pointerEvents="none"` on the container). Text content isn't
 * drawn: illegible at minimap scale.
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
  safeArea = NO_INSETS,
  background,
  cornerRadius = BORDER_RADIUS,
  size: baseSize = DEFAULT_SIZE,
}: Props) {
  const bounds = useMemo(() => (nodes.length > 0 ? contentBounds(nodes) : null), [nodes]);
  const size = useMemo(
    () => getMinimapSize(bounds ? bounds.width / bounds.height : 1, baseSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bounds, baseSize.width, baseSize.height],
  );
  // Typed rather than inline so a mistyped key fails the build instead of
  // being dropped silently at runtime.
  const canvasStyle = useMemo<ViewStyle>(
    () => ({width: size.width, height: size.height}),
    [size],
  );

  // Enrich nodes so the drawing picks up cssclasses renderProps (shape
  // variants, pill, drop shadow, etc.). No-op when no frontmatter.
  const enriched = useMemo<EnrichedNode[]>(
    () => hasCssClasses(nodes) ? enrichNodes(nodes) : (nodes as EnrichedNode[]),
    [nodes],
  );

  // The cards and edges recorded once as a Picture. As live shapes, every
  // frame of camera movement redrew each of them (tens of thousands of draws
  // on a large canvas) just to move the viewport marker.
  // Recorded just after the canvas first shows, not while it opens.
  const [shapes, setShapes] = useState<SkPicture | null>(null);
  useEffect(() => {
    if (enriched.length === 0) {
      setShapes(null);
      return;
    }
    const frame = requestAnimationFrame(() => setShapes(recordShapesPicture(enriched as CanvasNode[], edges, colorScheme)));
    return () => cancelAnimationFrame(frame);
  }, [enriched, edges, colorScheme]);

  // What the minimap shows: the canvas and, when the screen reaches past
  // it, the screen too, fitted straight into the box, worked out each frame
  // on the UI thread. It used to pad the canvas out to the screen's shape
  // (portrait on a phone) and fit that into the landscape box: letterboxed
  // twice, a large canvas filled a small patch of the minimap and its
  // viewport marker was a speck.
  const frame = useDerivedValue(() => {
    'worklet';
    if (!bounds) return {fitScale: 1, offsetX: 0, offsetY: 0, view: {x: 0, y: 0, width: 0, height: 0}};
    const overlayLeft = leftOverlayWidth ? leftOverlayWidth.value : 0;
    const vx0 = (overlayLeft - translateX.value) / scale.value;
    const vy0 = (0 - translateY.value) / scale.value;
    const vx1 = (viewportWidth - translateX.value) / scale.value;
    const vy1 = (viewportHeight - translateY.value) / scale.value;
    const minX = Math.min(bounds.minX, vx0);
    const minY = Math.min(bounds.minY, vy0);
    const width = Math.max(bounds.minX + bounds.width, vx1) - minX;
    const height = Math.max(bounds.minY + bounds.height, vy1) - minY;
    const innerW = size.width - INNER_PADDING * 2;
    const innerH = size.height - INNER_PADDING * 2;
    const fitScale = Math.min(innerW / width, innerH / height);
    const offsetX = INNER_PADDING + (innerW - width * fitScale) / 2 - minX * fitScale;
    const offsetY = INNER_PADDING + (innerH - height * fitScale) / 2 - minY * fitScale;
    return {
      fitScale,
      offsetX,
      offsetY,
      view: {
        x: vx0 * fitScale + offsetX,
        y: vy0 * fitScale + offsetY,
        width: (vx1 - vx0) * fitScale,
        height: (vy1 - vy0) * fitScale,
      },
    };
  });

  // Viewport rectangle in minimap-local coords.
  const viewportRect = useDerivedValue(() => {
    'worklet';
    return frame.value.view;
  });

  // World → minimap, as CanvasView's camera matrix: out = world * scale + translate.
  const worldToMinimap = useDerivedValue(() => {
    'worklet';
    const f = frame.value;
    return processTransform3d([{translateX: f.offsetX}, {translateY: f.offsetY}, {scale: f.fitScale}]);
  });

  if (!bounds) return null;

  const bgColor = getCanvasBackground(colorScheme);
  const {border: borderColor, viewportStroke} = getMinimapColors(colorScheme);

  return (
    <View
      pointerEvents="none"
      style={[styles.container, getPositionStyle(position, bottomInset, safeArea), {width: size.width, height: size.height}]}
    >
      {background ? <View style={[StyleSheet.absoluteFill, styles.background, {borderRadius: cornerRadius}]}>{background(size)}</View> : null}
      <Canvas style={canvasStyle}>
        {background ? null : (
          <>
            <RoundedRect x={0} y={0} width={size.width} height={size.height} r={cornerRadius} color={bgColor} />
            <RoundedRect
              x={0.5} y={0.5}
              width={size.width - 1} height={size.height - 1}
              r={Math.max(0, cornerRadius - 0.5)}
              color={borderColor}
              style="stroke" strokeWidth={1}
            />
          </>
        )}

        {/* All canvas content, scaled into minimap space. Reuses the main
            canvas renderers — visual fidelity inherited for free. */}
        <Group matrix={worldToMinimap}>
          {shapes ? <Picture picture={shapes} /> : null}
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
  background: {
    borderRadius: BORDER_RADIUS,
    overflow: 'hidden',
  },
});
