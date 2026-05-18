/**
 * Word-wraps styled text segments into positioned lines for rendering.
 *
 * Pure function — no Skia imports. Font measurement is injected via callback.
 */

import type {TextSegment, SegmentStyle, PositionedSegment, WrappedLine} from './types';

type MeasureText = (text: string, style: SegmentStyle) => number;

/**
 * Wrap segments into lines that fit within maxWidth/maxHeight.
 *
 * Each segment is split at word boundaries. Lines accumulate segments
 * until adding the next word would exceed maxWidth. Height is tracked
 * and lines beyond maxHeight are truncated.
 */
export function wrapSegments(
  segments: TextSegment[],
  maxWidth: number,
  maxHeight: number,
  measureText: MeasureText,
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let currentLineSegments: PositionedSegment[] = [];
  let lineX = 0;
  let usedHeight = 0;

  function flushLine(lineHeight: number) {
    if (currentLineSegments.length > 0) {
      if (usedHeight + lineHeight > maxHeight) return false;
      lines.push({segments: currentLineSegments, y: usedHeight});
      usedHeight += lineHeight;
      currentLineSegments = [];
      lineX = 0;
    }
    return true;
  }

  for (const segment of segments) {
    const {text, style} = segment;
    const indent = style.indent ?? 0;

    // Blank line spacer
    if (style.isBlank || !text) {
      flushLine(style.lineHeight);
      if (usedHeight + style.lineHeight > maxHeight) break;
      lines.push({segments: [], y: usedHeight});
      usedHeight += style.lineHeight;
      continue;
    }

    // Start new line with indent if needed
    if (currentLineSegments.length === 0) {
      lineX = indent;
    }

    const availWidth = maxWidth - indent;
    const words = text.split(' ');
    let currentText = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testText = currentText ? `${currentText} ${word}` : word;
      const testWidth = measureText(testText, style);

      if (testWidth > availWidth && currentText) {
        // Current text doesn't fit with new word — flush this segment to line
        currentLineSegments.push({text: currentText, style, x: lineX});
        lineX += measureText(currentText, style);

        // Flush line
        if (!flushLine(style.lineHeight)) break;
        lineX = indent;

        // Start new segment with the overflow word
        // If single word is wider than available, force it on its own line
        const wordWidth = measureText(word, style);
        if (wordWidth > availWidth) {
          // Break mid-word
          let partial = '';
          for (const char of word) {
            const pw = measureText(partial + char, style);
            if (pw > availWidth && partial) {
              currentLineSegments.push({text: partial, style, x: lineX});
              if (!flushLine(style.lineHeight)) break;
              lineX = indent;
              partial = char;
            } else {
              partial += char;
            }
          }
          currentText = partial;
        } else {
          currentText = word;
        }
      } else {
        currentText = testText;
      }
    }

    // Push remaining text as a segment
    if (currentText) {
      currentLineSegments.push({text: currentText, style, x: lineX});
      lineX += measureText(currentText, style);
    }

    // Flush at segment boundary (each TextSegment is a block-level line)
    if (!flushLine(style.lineHeight)) break;
  }

  // Flush any remaining segments
  if (currentLineSegments.length > 0) {
    const lastStyle = currentLineSegments[currentLineSegments.length - 1].style;
    flushLine(lastStyle.lineHeight);
  }

  return lines;
}
