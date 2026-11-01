import {hasInlineLabel} from '../utils/fileNodeLabel';
import type {FileNode} from '../../core';

const node = (file: string): FileNode => ({id: 'n', type: 'file', file, x: 0, y: 0, width: 100, height: 100});

describe('hasInlineLabel', () => {
  it('hides an image name in its card by default, on every platform', () => {
    expect(hasInlineLabel(node('pics/a.png'))).toBe(false);
    expect(hasInlineLabel(node('pics/a.svg'), 'onReveal')).toBe(false);
  });

  it("shows an image name in its card when the host asks for 'always'", () => {
    expect(hasInlineLabel(node('pics/a.jpg'), 'always')).toBe(true);
  });

  it('always shows a non-image file name: it is the card\'s only content', () => {
    expect(hasInlineLabel(node('notes/a.md'))).toBe(true);
    expect(hasInlineLabel(node('notes/a.md'), 'onReveal')).toBe(true);
  });
});
