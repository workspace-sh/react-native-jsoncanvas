/**
 * Type scale, shared by both rendering paths.
 *
 * The live Skia tree and the Picture recording each build their own `SkFont`
 * objects — they cache differently, and a font handle isn't safely shared
 * across them — but the *sizes* must be identical or the same text lands at
 * different dimensions depending on whether a pinch is in progress. This file
 * holds the sizes; each path keeps its own cache.
 *
 * Sizes are in world units, like everything in `metrics.ts`.
 */

export interface FontConfig {
  fontSize: number;
  lineHeight: number;
  fontWeight?: 'bold' | 'normal';
  fontFamily?: string;
}

/**
 * Header / footer / side-label zones, rendered as single-line
 * `canvas.drawText` rather than through `buildParagraph` like body text.
 */
export const H4: FontConfig = {fontSize: 13, lineHeight: 18, fontWeight: 'bold'};

/**
 * Single-line labels that don't need a full {@link FontConfig} — each is
 * built with `matchFont` at the point of use.
 */
export interface FontSizes {
  readonly fileName: number;
  readonly fileSubpath: number;
  readonly edgeLabel: number;
  readonly groupLabel: number;
  readonly linkHostname: number;
  readonly linkUrl: number;
}

export const FONT_SIZE: FontSizes = {
  /** File node's filename. */
  fileName: 12,
  /** File node's `subpath` (the `#heading` fragment), under the filename. */
  fileSubpath: 10,
  /** Edge label, on its pill at the curve's midpoint. */
  edgeLabel: 12,
  /** Group node's label, in the pill at its top-left. */
  groupLabel: 13,
  /** Link node's hostname — the line that reads as the title. */
  linkHostname: 16,
  /** Link node's full URL, above and below the hostname. */
  linkUrl: 11,
};
