import type {SegmentStyle, TextSegment} from './types';

/** A piece of a text node's paragraph: text in one style, or a line break. */
export type ParagraphRun = {text: string; style: SegmentStyle} | {lineBreak: true};

/**
 * What a text node's paragraph is made of, in order: each segment's text in
 * its style, with a line break before each block. A run inside a sentence
 * (the segment before it is `inline`: bold, code or a link mid-line)
 * continues its line. A blank segment is a line of its own, with nothing on it.
 */
export function paragraphRuns(segments: TextSegment[]): ParagraphRun[] {
  const runs: ParagraphRun[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i > 0 && !segments[i - 1].inline) runs.push({lineBreak: true});
    if (seg.style.isBlank) continue;
    runs.push({text: seg.text, style: seg.style});
  }
  return runs;
}
