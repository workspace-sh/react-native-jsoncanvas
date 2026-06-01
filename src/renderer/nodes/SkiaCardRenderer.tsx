import React, {useMemo} from 'react';
import {
  RoundedRect, DashPathEffect, Path, Oval, Group,
  LinearGradient, vec, Skia, Shadow,
} from '@shopify/react-native-skia';
import type {CanvasNode} from '../../core';
import type {EnrichedTextNode} from '../extensions/cssclasses';
import {getNodeColors, type ColorScheme} from '../theme';
import {devFlags} from '../devFlags';
import {parallelogramPath} from './shapes';

interface Props {
  node: CanvasNode;
  colorScheme: ColorScheme;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Build a stroke-only path tracing one side of a rounded rect, including
 * **half** of each adjacent corner. The path starts and ends at the 45° peak
 * of each adjacent corner — so each corner is split between the two sides
 * that meet there. Closer to how CSS renders `border-{side}` + `border-radius`
 * (the corner colour ramps between adjacent sides; we approximate that by
 * giving each side just its half).
 *
 * "top" runs:
 *   TL_peak → arc to (x+r, y) → straight to (x+w-r, y) → arc to TR_peak
 *
 * Where the peak is the point at 45° on the corner arc — visually the
 * "outermost" point of the corner. Inset from the bounding box by
 * `r * (1 - √2/2)` ≈ `0.293r` on both axes.
 *
 * Each side traversed in clockwise order around the rectangle so all four
 * arcs use the same SVG sweep flag (1 = positive angle direction in y-down
 * coords).
 *
 * Other geometries we considered (kept here for the next time someone
 * questions the visual):
 *   1. Full quarter-arcs at each corner (path goes from edge-meeting-point
 *      to edge-meeting-point, e.g. `(x, y+r) → arc → (x+r, y) → ... → arc
 *      → (x+w, y+r)`). Visually produced bracket / L-shape stubs because
 *      the arc dipped back along the perpendicular edge by `r` pixels.
 *      Distinctive but unusual.
 *   2. **Half-corners (current).** Each side gets the outer half of each
 *      adjacent corner; corners are split at the 45° peak.
 *   3. Straight only — line runs from `(x+r, y)` to `(x+w-r, y)` with no
 *      corners at all. Cleanest minimal look but corners stay bare and the
 *      line ends abruptly.
 *
 * Switch to (1) or (3) by adjusting the start/end positions and arc params
 * below; the surrounding renderer code doesn't need to change.
 */
function makeSideBorderPath(x: number, y: number, w: number, h: number, r: number, side: 'top' | 'bottom' | 'left' | 'right') {
  // Clamp radius to half the shorter axis so a 60×60 card with r=30 still
  // produces a valid arc; anything larger would invert.
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const right = x + w;
  const bottom = y + h;
  // Peak inset from the bounding box on each axis. Peak is the 45° point on
  // the corner arc, distance `r·(1-cos45°)` inside each edge.
  const inset = radius * (1 - Math.SQRT1_2);
  const ix = x + inset;
  const iy = y + inset;
  const ixr = right - inset;
  const iyb = bottom - inset;
  let d = '';
  switch (side) {
    case 'top':
      d = `M ${ix} ${iy} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} L ${right - radius} ${y} A ${radius} ${radius} 0 0 1 ${ixr} ${iy}`;
      break;
    case 'right':
      d = `M ${ixr} ${iy} A ${radius} ${radius} 0 0 1 ${right} ${y + radius} L ${right} ${bottom - radius} A ${radius} ${radius} 0 0 1 ${ixr} ${iyb}`;
      break;
    case 'bottom':
      // Right-to-left so the sweep direction stays clockwise around the rect.
      d = `M ${ixr} ${iyb} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom} L ${x + radius} ${bottom} A ${radius} ${radius} 0 0 1 ${ix} ${iyb}`;
      break;
    case 'left':
      // Bottom-to-top, same reason.
      d = `M ${ix} ${iyb} A ${radius} ${radius} 0 0 1 ${x} ${bottom - radius} L ${x} ${y + radius} A ${radius} ${radius} 0 0 1 ${ix} ${iy}`;
      break;
  }
  return Skia.Path.MakeFromSVGString(d);
}

function makeParallelogramPath(x: number, y: number, w: number, h: number, direction: 'left' | 'right') {
  return Skia.Path.MakeFromSVGString(parallelogramPath(x, y, w, h, direction));
}

/** Compute gradient start/end points for a given angle within a rect. */
function gradientPoints(x: number, y: number, w: number, h: number, deg: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = deg * DEG_TO_RAD;
  const dx = Math.cos(rad) * w / 2;
  const dy = Math.sin(rad) * h / 2;
  return {start: vec(cx - dx, cy - dy), end: vec(cx + dx, cy + dy)};
}

export function SkiaCardRenderer({node, colorScheme}: Props) {
  const isGroup = node.type === 'group';
  const colors = getNodeColors(node.color, colorScheme);

  const renderProps = (node as CanvasNode & Partial<EnrichedTextNode>).renderProps;
  const shape = renderProps?.shape;
  const isFill = renderProps?.fill;
  const isTransparent = renderProps?.transparent;
  const isOpaque = renderProps?.opaque;
  const isNocolor = renderProps?.nocolor;
  const hideBorder = renderProps?.borderStyle === 'none';
  const borderStyle = renderProps?.borderStyle;
  const borderSides = renderProps?.borderSides;
  const gradientDeg = renderProps?.gradientDeg;
  const rotateCard = renderProps?.rotateCard;
  const dropShadow = renderProps?.dropShadow;
  const hasPerSideBorders = borderSides && borderSides.length > 0;

  const fillColor = isTransparent || isNocolor
    ? 'transparent'
    : isFill
      ? colors.active
      : isGroup
        ? colors.background
        : colors.card;

  const fillOpacity = isOpaque ? 0.85 : 1;
  const isPill = renderProps?.pill;
  const borderRadius = isPill
    ? Math.min(node.width, node.height) / 2
    : shape === 'rectangle' ? 0 : (isGroup ? 12 : 8);
  const isDefault = shape !== 'circle' && shape !== 'parallelogram-left' && shape !== 'parallelogram-right';
  const showFill = !isTransparent && !isNocolor;

  // cc-shape-circle fills the full card bounds — true circle when the card is
  // square, stretched ellipse otherwise. Matches Canvas Candy's CSS-driven
  // origin (`border-radius: 50%` on a sized box behaves the same way) and
  // the fixture's own intent: candy-feature-cards.canvas has both a "Circle"
  // (162×140) and an "Ellipse" (341×130) card using the *same*
  // `cc-shape-circle` class, with the latter described as "stretched circle
  // with no border" — confirming dimensions, not class, drive the shape.
  // A slightly-off-square card (e.g. the fixture's 162×140 "Circle") will
  // render as a slight ellipse: that's correct per convention, not a bug.
  const ovalRect = {x: node.x, y: node.y, width: node.width, height: node.height};

  const paraPath = useMemo(() => {
    if (shape !== 'parallelogram-left' && shape !== 'parallelogram-right') return null;
    const dir = shape === 'parallelogram-left' ? 'left' : 'right';
    return makeParallelogramPath(node.x, node.y, node.width, node.height, dir);
  }, [shape, node.x, node.y, node.width, node.height]);

  // Gradient colours: from active colour to transparent
  const hasGradient = gradientDeg != null && showFill;
  const gradPts = hasGradient
    ? gradientPoints(node.x, node.y, node.width, node.height, gradientDeg!)
    : null;

  // Card rotation: wrap entire output in a Group rotated around card centre
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const rotationTransform = rotateCard != null
    ? [{translateX: cx}, {translateY: cy}, {rotate: rotateCard * DEG_TO_RAD}, {translateX: -cx}, {translateY: -cy}]
    : undefined;

  const content = (
    <>
      {/* Fill — drawn in two passes when a gradient is present: a solid
          base fill underneath, then a separate shape with the LinearGradient
          shader on top. Splitting the gradient into its own shape avoids the
          react-native-skia ambiguity where a `color` prop and a `<LinearGradient>`
          child on the same shape compete to drive the paint — on Fabric/macOS
          the colour was winning and the gradient was never drawn. The Picture
          recording in `useCanvasPicture.drawCard` mirrors this same two-pass
          structure per the two-paths-in-sync rule. */}
      {showFill && shape === 'circle' && (
        <>
          <Oval rect={ovalRect} color={fillColor} opacity={fillOpacity} />
          {hasGradient && gradPts && (
            <Oval rect={ovalRect} opacity={fillOpacity}>
              <LinearGradient start={gradPts.start} end={gradPts.end} colors={[colors.active, colors.activeTransparent]} />
            </Oval>
          )}
        </>
      )}
      {showFill && (shape === 'parallelogram-left' || shape === 'parallelogram-right') && paraPath && (
        <>
          <Path path={paraPath} color={fillColor} opacity={fillOpacity} />
          {hasGradient && gradPts && (
            <Path path={paraPath} opacity={fillOpacity}>
              <LinearGradient start={gradPts.start} end={gradPts.end} colors={[colors.active, colors.activeTransparent]} />
            </Path>
          )}
        </>
      )}
      {showFill && isDefault && (
        <>
          <RoundedRect
            x={node.x} y={node.y} width={node.width} height={node.height}
            r={borderRadius} color={fillColor} opacity={fillOpacity}
          >
            {dropShadow && <Shadow dx={3} dy={3} blur={6} color="rgba(0,0,0,0.4)" />}
          </RoundedRect>
          {hasGradient && gradPts && (
            <RoundedRect
              x={node.x} y={node.y} width={node.width} height={node.height}
              r={borderRadius} opacity={fillOpacity}
            >
              <LinearGradient start={gradPts.start} end={gradPts.end} colors={[colors.active, colors.activeTransparent]} />
            </RoundedRect>
          )}
        </>
      )}

      {/* Stroke */}
      {!hideBorder && shape === 'circle' && (
        <Oval rect={ovalRect} color={colors.border} style="stroke" strokeWidth={1}>
          {borderStyle === 'dashed' && <DashPathEffect intervals={[6, 4]} />}
          {borderStyle === 'dotted' && <DashPathEffect intervals={[2, 3]} />}
        </Oval>
      )}
      {!hideBorder && (shape === 'parallelogram-left' || shape === 'parallelogram-right') && paraPath && (
        <Path path={paraPath} color={colors.border} style="stroke" strokeWidth={1}>
          {borderStyle === 'dashed' && <DashPathEffect intervals={[6, 4]} />}
          {borderStyle === 'dotted' && <DashPathEffect intervals={[2, 3]} />}
        </Path>
      )}
      {/* Default rect stroke: full border, per-side, or double */}
      {!hideBorder && isDefault && !hasPerSideBorders && (
        <>
          <RoundedRect
            x={node.x} y={node.y} width={node.width} height={node.height}
            r={borderRadius} color={colors.border} style="stroke" strokeWidth={1}
          >
            {(isGroup && !devFlags.skipDashPathEffect || borderStyle === 'dashed') && <DashPathEffect intervals={[6, 4]} />}
            {borderStyle === 'dotted' && <DashPathEffect intervals={[2, 3]} />}
          </RoundedRect>
          {borderStyle === 'double' && (
            <RoundedRect
              x={node.x + 3} y={node.y + 3}
              width={node.width - 6} height={node.height - 6}
              r={Math.max(0, borderRadius - 3)} color={colors.border}
              style="stroke" strokeWidth={1}
            />
          )}
        </>
      )}
      {/* Per-side borders — trace the rounded card outline so the line hugs
          the corners instead of overshooting at the bounding-box edges. The
          path is: quarter-arc, straight edge, quarter-arc, ending at the
          adjacent side's start. Matches CSS `border-{side}` + `border-radius`
          behaviour. r is clamped to half the shorter axis so degenerate
          (extra-small / extra-rounded) cards still produce valid paths. */}
      {!hideBorder && isDefault && hasPerSideBorders && (
        <>
          {borderSides!.map(side => {
            const path = makeSideBorderPath(node.x, node.y, node.width, node.height, borderRadius, side);
            return path ? (
              <Path key={side} path={path} color={colors.border} style="stroke" strokeWidth={1} />
            ) : null;
          })}
        </>
      )}
    </>
  );

  if (rotationTransform) {
    return <Group transform={rotationTransform}>{content}</Group>;
  }
  return content;
}
