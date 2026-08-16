/**
 * Layout metrics, in **world units**.
 *
 * Everything here is expressed in the canvas's own coordinate space, the same
 * space node `x` / `y` / `width` / `height` live in, so values scale with the
 * camera like any other node-space measurement. Nothing in this file is
 * screen-space — a chip's padding stays proportional to the artwork it labels
 * as you zoom, rather than ballooning at high zoom.
 *
 * **What belongs here:** any value the two rendering paths must agree on. The
 * live Skia tree and the Picture recording draw the same scene independently,
 * so a measurement duplicated between them is a measurement that can silently
 * drift — and the failure shows up only as content shifting when a pinch
 * starts. Every constant below was previously two literals in two files.
 *
 * **What doesn't:** genuinely local values, which are clearer next to the code
 * that reads them. The minimap's own padding, and the camera / gesture tuning
 * in `CanvasView` (`MIN_SCALE`, `PINCH_DRIFT_DEADZONE`, …), stay where they
 * are — each has a single reader, and the gesture constants are documented in
 * place by the behaviour they tune. Hoisting them here would cost locality and
 * buy nothing, since there's no second copy to keep in step.
 *
 * Type sizes live in `typography.ts` for the same reason.
 */

/** A uniform inset from a node's bounds. */
export interface NodeMetrics {
  readonly padding: number;
}

/** Content inset from a node's bounds — text nodes and link nodes alike. */
export const NODE: NodeMetrics = {
  padding: 12,
};

/**
 * Header / footer / side-label zones on a text card (the `cc-header`,
 * `cc-footer`, `cc-label-left` / `-right` conventions).
 */
export interface ZoneMetrics {
  /** Band thickness — also the width of a rotated side-label's column. */
  readonly height: number;
  /** Inset of the text within its band. */
  readonly padding: number;
}

export const ZONE: ZoneMetrics = {
  height: 28,
  padding: 6,
};

/** Horizontal and vertical padding around a piece of text. */
export interface Insets {
  readonly paddingX: number;
  readonly paddingY: number;
}

/** The pill holding a group node's label, at its top-left corner. */
export const GROUP_LABEL: Insets = {
  paddingX: 10,
  paddingY: 4,
};

/** A rounded pill: padded text with a corner radius. */
export interface PillMetrics extends Insets {
  readonly radius: number;
}

/** The pill holding an edge's label, at the midpoint of its curve. */
export const EDGE_LABEL: PillMetrics = {
  paddingX: 8,
  paddingY: 4,
  radius: 6,
};

export interface LinkMetrics {
  /** Baseline of the URL strip that sits above the hostname. */
  readonly urlBarOffset: number;
  /** Baseline of the hostname, the line that reads as the title. */
  readonly hostnameOffset: number;
}

/** Link node internals, measured down from the node's top padding. */
export const LINK: LinkMetrics = {
  urlBarOffset: 11,
  hostnameOffset: 40,
};

export interface LabelMetrics {
  /**
   * Baseline distance up from an image node's bottom edge. Pairs with
   * {@link FileImageMetrics.labelSpace}, which reserves the room this sits in.
   */
  readonly imageBaselineFromBottom: number;
  /**
   * Baseline offset from the vertical centre for a node whose label is its
   * only content — half a cap-height, so the text reads as centred rather
   * than hanging below the middle.
   */
  readonly centredBaselineNudge: number;
}

/** File-node inline labels — the filename drawn inside the node's bounds. */
export const LABEL: LabelMetrics = {
  imageBaselineFromBottom: 20,
  centredBaselineNudge: 4,
};

export interface FileImageMetrics {
  /** Inset on every side, between the node's bounds and the image. */
  readonly margin: number;
  /**
   * Vertical room reserved at the bottom for an inline filename label.
   * Only subtracted when one will actually be drawn — see `hasInlineLabel`.
   */
  readonly labelSpace: number;
}

/** Image content inside a file node. */
export const FILE_IMAGE: FileImageMetrics = {
  margin: 8,
  labelSpace: 28,
};

/**
 * The file-node hover chip — the filename revealed when the pointer rests
 * over an image file node.
 */
export interface ChipMetrics extends PillMetrics {
  /** Gap between the node's bottom edge and the top of the chip. */
  readonly gap: number;
  /** Baseline-to-baseline distance for the optional subpath second line. */
  readonly subpathLineHeight: number;
}

export const CHIP: ChipMetrics = {
  paddingX: 6,
  paddingY: 4,
  radius: 4,
  gap: 6,
  subpathLineHeight: 14,
};
