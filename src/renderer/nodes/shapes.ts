// Shared node-shape geometry, expressed as SVG path strings.
//
// Single source of truth for the parallelogram and circle/oval outlines used
// by `cc-shape-*` cards. Three call sites consume these:
//
//   1. SkiaCardRenderer  — draws the shape fill (live tree).
//   2. useCanvasPicture  — draws the same fill in the Picture overlay.
//   3. SkiaTextRenderer  — clips body/label text to the shape outline so text
//      doesn't bleed past a slanted parallelogram or curved circle edge (#53).
//
// Keeping the maths here means the clip outline can never silently drift from
// the fill outline. `<Group clip>` and the imperative `canvas.clipPath` both
// accept an SVG path string, so returning strings (rather than allocating an
// SkPath) keeps this dependency-free and works for every consumer.

/** Horizontal skew of a parallelogram, as a fraction of its width. The top
 *  edge is shifted right by `w * SKEW`; the bottom edge left by the same. */
export const PARALLELOGRAM_SKEW = 0.2;

/**
 * SVG path for a parallelogram filling the node's bounds.
 * `left` leans the top edge right (╱-leaning); `right` mirrors it.
 */
export function parallelogramPath(
  x: number,
  y: number,
  w: number,
  h: number,
  direction: 'left' | 'right',
): string {
  const skew = w * PARALLELOGRAM_SKEW;
  return direction === 'left'
    ? `M ${x + skew} ${y} L ${x + w} ${y} L ${x + w - skew} ${y + h} L ${x} ${y + h} Z`
    : `M ${x} ${y} L ${x + w - skew} ${y} L ${x + w} ${y + h} L ${x + skew} ${y + h} Z`;
}

/**
 * SVG path for an ellipse inscribed in the node's bounds — a true circle when
 * the box is square, a stretched ellipse otherwise (matches the `<Oval>` fill
 * and Canvas Candy's `border-radius: 50%` convention). Two half-arcs sweep the
 * full perimeter.
 */
export function ovalPath(x: number, y: number, w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  const cy = y + ry;
  const left = x;
  const right = x + w;
  // Start at the left edge, arc over the top to the right edge, then back
  // under the bottom. Sweep flag 1 = clockwise.
  return `M ${left} ${cy} A ${rx} ${ry} 0 1 1 ${right} ${cy} A ${rx} ${ry} 0 1 1 ${left} ${cy} Z`;
}

/** The `cc-shape-*` values that have a non-rectangular outline to clip to. */
export type ClippableShape = 'circle' | 'parallelogram-left' | 'parallelogram-right';

/**
 * SVG clip path for a node's shape, or `null` for rectangular / unset shapes
 * (callers fall back to a plain bounding-rect clip in that case).
 */
export function shapeClipPath(
  shape: string | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): string | null {
  switch (shape) {
    case 'circle':
      return ovalPath(x, y, w, h);
    case 'parallelogram-left':
      return parallelogramPath(x, y, w, h, 'left');
    case 'parallelogram-right':
      return parallelogramPath(x, y, w, h, 'right');
    default:
      return null;
  }
}
