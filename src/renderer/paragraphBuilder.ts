/**
 * Shared Skia Paragraph builder used by both the live tree (`SkiaTextRenderer`)
 * and the imperative Picture recorder (`useCanvasPicture.drawTextNode`).
 *
 * Both rendering paths must produce pixel-identical output — see the
 * "two rendering paths — keep in sync" rule in `.claude/rules/canvas.md`.
 * Sharing the paragraph construction here removes the previous divergence
 * between Skia's HarfBuzz-shaped paragraph layout (live tree) and the raw
 * `font.measureText` advances used by the Picture's `canvas.drawText` loop.
 */

import {Skia, TextDecoration} from '@shopify/react-native-skia';
import type {SkParagraph, SkTextStyle, SkColor} from '@shopify/react-native-skia';
import type {TextSegment, SegmentStyle} from './markdown';

export interface ParagraphColours {
  text: SkColor;
  muted: SkColor;
  link: SkColor;
}

// `Skia.Color()` returns a fresh Float32Array on each call, so caching the
// resolved palette keeps it stable across renders (and across the two
// rendering paths). Bound at module init — Skia's host object is registered
// before user JS modules execute.
export const PARAGRAPH_COLOURS: {light: ParagraphColours; dark: ParagraphColours} = {
  light: {
    text: Skia.Color('#1F2937'),
    muted: Skia.Color('#6B7280'),
    link: Skia.Color('#2563EB'),
  },
  dark: {
    text: Skia.Color('#E5E7EB'),
    muted: Skia.Color('#9CA3AF'),
    link: Skia.Color('#60A5FA'),
  },
};

export function getParagraphColours(colorScheme: 'light' | 'dark'): ParagraphColours {
  return colorScheme === 'dark' ? PARAGRAPH_COLOURS.dark : PARAGRAPH_COLOURS.light;
}

function toSkTextStyle(style: SegmentStyle, c: ParagraphColours): SkTextStyle {
  const color = style.color === 'muted' ? c.muted
    : style.color === 'link' ? c.link
    : c.text;

  const result: SkTextStyle = {
    fontSize: style.fontSize,
    fontFamilies: [style.fontFamily ?? 'System'],
    color,
    heightMultiplier: style.lineHeight / style.fontSize,
  };

  if (style.fontWeight === 'bold') {
    result.fontStyle = {weight: 700};
  }
  if (style.italic) {
    result.fontStyle = {...(result.fontStyle ?? {}), slant: 1}; // FontSlant.Italic
  }
  if (style.isStrikethrough) {
    result.decoration = TextDecoration.LineThrough;
  }

  return result;
}

/**
 * Build a laid-out SkParagraph from parsed markdown segments. Block-level
 * segments are separated by newlines; no trailing newline is emitted.
 */
export function buildParagraph(
  segments: TextSegment[],
  maxWidth: number,
  colours: ParagraphColours,
): SkParagraph | null {
  if (segments.length === 0) return null;

  const builder = Skia.ParagraphBuilder.Make({
    textStyle: {fontSize: 13, color: colours.text, fontFamilies: ['System']},
  });

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0) builder.addText('\n');
    if (seg.style.isBlank) continue;
    builder.pushStyle(toSkTextStyle(seg.style, colours));
    builder.addText(seg.text);
    builder.pop();
  }

  const paragraph = builder.build();
  paragraph.layout(maxWidth);
  return paragraph;
}
