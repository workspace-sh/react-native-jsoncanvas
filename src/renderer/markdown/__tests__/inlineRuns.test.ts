// hast-util-from-html is ESM-only, which ts-jest can't load; these cases have no HTML.
jest.mock('hast-util-from-html', () => ({fromHtml: () => ({type: 'root', children: []})}));

import {parseToSegments} from '../parseToSegments';
import {wrapSegments} from '../wrapSegments';
import {paragraphRuns} from '../paragraphRuns';

// Every character is 6 points wide, whatever its style.
const measure = (text: string) => text.length * 6;
const lineTexts = (md: string, width = 1000) =>
  wrapSegments(parseToSegments(md), width, 10_000, measure).map(l => l.segments.map(s => s.text).join(''));

describe('formatting inside a sentence', () => {
  it('keeps bold, code and links on the sentence line', () => {
    expect(lineTexts('Has **this device** granted it?')).toEqual(['Has this device granted it?']);
    expect(lineTexts('only if it says `:open` here')).toEqual(['only if it says :open here']);
    expect(lineTexts('see [the spec](https://example.com) now')).toEqual(['see the spec now']);
  });

  it('places each run after the one before it', () => {
    const [line] = wrapSegments(parseToSegments('ab **cd** ef'), 1000, 10_000, measure);
    expect(line.segments.map(s => [s.text, s.x])).toEqual([
      ['ab ', 0],
      ['cd', 18],
      [' ef', 30],
    ]);
  });

  it('adds no blank line between runs of one paragraph', () => {
    expect(lineTexts('a **b** c')).toEqual(['a b c']);
    // Between blocks of different styles (a heading, then a paragraph), as before.
    expect(lineTexts('# Title\nbody **b** end')).toEqual(['Title', '', 'body b end']);
  });

  it('wraps a sentence with runs across lines by the whole line width', () => {
    // 10 characters a line.
    expect(lineTexts('aaaa **bbbb** cccc dddd', 60)).toEqual(['aaaa bbbb', 'cccc dddd']);
  });

  it('keeps a list item on one line', () => {
    expect(lineTexts('- opens if it says `:open`\n- a tap')).toEqual(['• opens if it says :open', '• a tap']);
  });
});

describe("a text node's paragraph (what's drawn)", () => {
  const drawn = (md: string) =>
    paragraphRuns(parseToSegments(md))
      .map(run => ('lineBreak' in run ? '\n' : run.text))
      .join('');

  it('keeps bold, code and links on their line, in paragraphs and list items', () => {
    expect(drawn('- Logo, **Workspace**, one line')).toBe('• Logo, Workspace, one line');
    expect(drawn('From the **+ New** button')).toBe('From the + New button');
    expect(drawn('- `.workspace` folders sit among the files')).toBe('• .workspace folders sit among the files');
  });

  it('starts each block on a line of its own, a blank line between blocks of different styles', () => {
    expect(drawn('**Show:** drawn live\n\n**Keep:** written')).toBe('Show: drawn live\nKeep: written');
    expect(drawn('## Heading\nbody **b** end')).toBe('Heading\n\nbody b end');
    expect(drawn('- one\n- two **2**')).toBe('• one\n• two 2');
  });

  it('keeps each run in its own style', () => {
    const styled = paragraphRuns(parseToSegments('a **b** c')).filter(run => !('lineBreak' in run));
    expect(styled.map(run => ('style' in run ? run.style.fontWeight ?? 'normal' : ''))).toEqual(['normal', 'bold', 'normal']);
  });
});
