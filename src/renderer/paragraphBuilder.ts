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
import {paragraphRuns, type TextSegment, type SegmentStyle} from './markdown';
import {getLinkColor, getMutedTextColor, getTextColor, type ColorScheme} from './theme';

export interface ParagraphColours {
  text: SkColor;
  muted: SkColor;
  link: SkColor;
}

// `Skia.Color()` returns a fresh Float32Array on each call, so caching the
// resolved palette keeps it stable across renders (and across the two
// rendering paths). Bound at module init — Skia's host object is registered
// before user JS modules execute.
export const PARAGRAPH_COLOURS: Record<ColorScheme, ParagraphColours> = {
  light: {
    text: Skia.Color(getTextColor('light')),
    muted: Skia.Color(getMutedTextColor('light')),
    link: Skia.Color(getLinkColor('light')),
  },
  dark: {
    text: Skia.Color(getTextColor('dark')),
    muted: Skia.Color(getMutedTextColor('dark')),
    link: Skia.Color(getLinkColor('dark')),
  },
};

export function getParagraphColours(colorScheme: ColorScheme): ParagraphColours {
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
 * Build a laid-out SkParagraph from parsed markdown segments: a new line for
 * each block, and bold, code or a link inside a sentence on its line
 * (`paragraphRuns`). No trailing newline is emitted.
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

  for (const run of paragraphRuns(segments)) {
    if ('lineBreak' in run) {
      builder.addText('\n');
      continue;
    }
    builder.pushStyle(toSkTextStyle(run.style, colours));
    builder.addText(run.text);
    builder.pop();
  }

  const paragraph = builder.build();
  paragraph.layout(maxWidth);
  return paragraph;
}
