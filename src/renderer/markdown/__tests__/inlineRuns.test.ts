// hast-util-from-html is ESM-only, which ts-jest can't load; these cases have no HTML.
jest.mock('hast-util-from-html', () => ({fromHtml: () => ({type: 'root', children: []})}));

import {parseToSegments} from '../parseToSegments';
import {wrapSegments} from '../wrapSegments';

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
