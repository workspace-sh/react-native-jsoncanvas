/**
 * Layout metrics, in **world units**.
 *
 * Everything here is expressed in the canvas's own coordinate space, the same
 * space node `x` / `y` / `width` / `height` live in, so values scale with the
 * camera like any other node-space measurement. Nothing in this file is
 * screen-space — a chip's padding stays proportional to the artwork it labels
 * as you zoom, rather than ballooning at high zoom.
 *
 * This file is the seed of a unit system the renderer doesn't otherwise have.
 * Geometry constants currently sit as file-local literals scattered across the
 * renderers (`GROUP_LABEL_PX` / `GROUP_LABEL_PY` in `useCanvasPicture`,
 * `NODE_FIT_PADDING` in `CanvasView`, `LABEL_PADDING_X` on edge labels, and
 * the shape insets in `nodes/shapes.ts`), which makes it impossible to see
 * whether two surfaces agree on spacing or have merely drifted to similar
 * numbers. Consolidating those is tracked separately; add new geometry here
 * rather than growing another island.
 */

/** File-node inline labels — the filename drawn inside the node's bounds. */
export const LABEL = {
  /**
   * Baseline distance up from an image node's bottom edge. Pairs with
   * {@link FILE_IMAGE.labelSpace}, which reserves the room this sits in.
   */
  imageBaselineFromBottom: 20,
  /**
   * Baseline offset from the vertical centre for a node whose label is its
   * only content — half a cap-height, so the text reads as centred rather
   * than hanging below the middle.
   */
  centredBaselineNudge: 4,
} as const;

/** Image content inside a file node. */
export const FILE_IMAGE = {
  /** Inset on every side, between the node's bounds and the image. */
  margin: 8,
  /**
   * Vertical room reserved at the bottom for an inline filename label.
   * Only subtracted when one will actually be drawn — see `hasInlineLabel`.
   */
  labelSpace: 28,
} as const;

/**
 * The file-node hover chip — the filename revealed when the pointer rests
 * over an image file node.
 */
export const CHIP = {
  /** Horizontal breathing room between the text and the chip's edge. */
  paddingX: 6,
  /** Vertical equivalent of {@link CHIP.paddingX}. */
  paddingY: 4,
  /** Corner radius. */
  radius: 4,
  /** Gap between the node's bottom edge and the top of the chip. */
  gap: 6,
  /** Baseline-to-baseline distance for the optional subpath second line. */
  subpathLineHeight: 14,
} as const;
