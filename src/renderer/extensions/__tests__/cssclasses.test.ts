import type {CanvasNode, TextNode} from '../../../core';
import {
  enrichNodes,
  enrichTextNode,
  hasCssClasses,
  type RenderProps,
} from '../cssclasses';

// Canvas Candy conformance — frontmatter parsing variants and the full
// baseline class → RenderProps mapping. Pinning current behaviour so the
// renderer can refactor freely (or eventually port to Rust) without silent
// regressions. The Candy classes are an Obsidian community convention; see
// https://github.com/TfTHacker/obsidian-canvas-candy for the visual reference.

function textNode(text: string, overrides: Partial<TextNode> = {}): TextNode {
  return {id: 'n', type: 'text', x: 0, y: 0, width: 100, height: 100, text, ...overrides};
}

function withFrontmatter(classes: string | string[], body = ''): TextNode {
  const yaml = Array.isArray(classes)
    ? `cssclasses:\n${classes.map(c => `  - ${c}`).join('\n')}`
    : `cssclasses: ${classes}`;
  return textNode(`---\n${yaml}\n---\n${body}`);
}

function enrich(classes: string | string[], body = ''): RenderProps {
  const result = enrichTextNode(withFrontmatter(classes, body));
  if (!result) throw new Error('expected enrichment, got null');
  return result.renderProps;
}

describe('hasCssClasses', () => {
  it('returns true when any text node carries cssclasses', () => {
    const nodes: CanvasNode[] = [
      textNode('plain text'),
      withFrontmatter('cc-card-fill'),
    ];
    expect(hasCssClasses(nodes)).toBe(true);
  });

  it('returns false for a canvas of plain text nodes', () => {
    const nodes: CanvasNode[] = [textNode('# title'), textNode('paragraph')];
    expect(hasCssClasses(nodes)).toBe(false);
  });

  it('accepts the `cssclass` (singular) alias for detection', () => {
    const node = textNode('---\ncssclass: cc-card-fill\n---\nbody');
    expect(hasCssClasses([node])).toBe(true);
  });

  it('ignores non-text nodes', () => {
    const nodes: CanvasNode[] = [
      {id: 'l', type: 'link', x: 0, y: 0, width: 1, height: 1, url: 'https://x.com'},
      {id: 'g', type: 'group', x: 0, y: 0, width: 1, height: 1},
    ];
    expect(hasCssClasses(nodes)).toBe(false);
  });
});

describe('frontmatter parsing variants', () => {
  it('accepts array form', () => {
    const result = enrichTextNode(withFrontmatter(['cc-card-fill', 'cc-shape-circle']));
    expect(result!.cssClasses).toEqual(['cc-card-fill', 'cc-shape-circle']);
  });

  it('accepts comma-separated string form', () => {
    const result = enrichTextNode(withFrontmatter('cc-card-fill, cc-shape-circle'));
    expect(result!.cssClasses).toEqual(['cc-card-fill', 'cc-shape-circle']);
  });

  it('accepts single string form', () => {
    const result = enrichTextNode(withFrontmatter('cc-card-fill'));
    expect(result!.cssClasses).toEqual(['cc-card-fill']);
  });

  it('accepts the `cssclass` (singular) alias', () => {
    const node = textNode('---\ncssclass: cc-card-fill\n---\nbody');
    const result = enrichTextNode(node);
    expect(result!.cssClasses).toEqual(['cc-card-fill']);
  });

  it('trims entries and drops empties', () => {
    const result = enrichTextNode(withFrontmatter('  cc-card-fill  ,, , cc-shape-circle '));
    expect(result!.cssClasses).toEqual(['cc-card-fill', 'cc-shape-circle']);
  });

  it('returns null when frontmatter is absent', () => {
    expect(enrichTextNode(textNode('no frontmatter here'))).toBeNull();
  });

  it('returns null when cssclasses key is missing from frontmatter', () => {
    expect(enrichTextNode(textNode('---\ntitle: Hello\n---\nbody'))).toBeNull();
  });

  it('returns null when cssclasses is empty array', () => {
    expect(enrichTextNode(withFrontmatter([]))).toBeNull();
  });

  it('strips the frontmatter block from displayText', () => {
    const result = enrichTextNode(withFrontmatter('cc-card-fill', 'Hello body'));
    expect(result!.displayText).toBe('Hello body');
  });

  it('preserves text after the frontmatter intact (no trailing newline)', () => {
    const result = enrichTextNode(withFrontmatter('cc-card-fill', 'Line one\n\nLine two'));
    expect(result!.displayText).toBe('Line one\n\nLine two');
  });
});

describe('class → RenderProps mapping', () => {
  describe('shapes', () => {
    it('cc-shape-circle → shape: circle', () => {
      expect(enrich('cc-shape-circle')).toEqual({shape: 'circle'});
    });

    it('cc-shape-parallelogram-left → shape: parallelogram-left', () => {
      expect(enrich('cc-shape-parallelogram-left')).toEqual({shape: 'parallelogram-left'});
    });

    it('cc-shape-parallelogram-right → shape: parallelogram-right', () => {
      expect(enrich('cc-shape-parallelogram-right')).toEqual({shape: 'parallelogram-right'});
    });

    it('cc-border-squared → shape: rectangle (promotes default rounded-rect to a square)', () => {
      expect(enrich('cc-border-squared')).toEqual({shape: 'rectangle'});
    });
  });

  describe('card fill', () => {
    it.each([
      ['cc-card-fill', {fill: true}],
      ['cc-card-transparent', {transparent: true}],
      ['cc-card-opaque', {opaque: true}],
      ['cc-card-nocolor', {nocolor: true}],
    ])('%s → %j', (cls, expected) => {
      expect(enrich(cls)).toEqual(expected);
    });
  });

  describe('borders', () => {
    it.each([
      ['cc-border-none', {borderStyle: 'none'}],
      ['cc-border-dashed', {borderStyle: 'dashed'}],
      ['cc-border-dotted', {borderStyle: 'dotted'}],
      ['cc-border-double', {borderStyle: 'double'}],
    ])('%s → %j', (cls, expected) => {
      expect(enrich(cls)).toEqual(expected);
    });

    it('cc-border-rounded → pill: true (promotes default rounded-rect to a pill)', () => {
      expect(enrich('cc-border-rounded')).toEqual({pill: true});
    });

    it('cc-border-dropshadow → dropShadow: true', () => {
      expect(enrich('cc-border-dropshadow')).toEqual({dropShadow: true});
    });

    it('single-side border classes populate borderSides', () => {
      expect(enrich('cc-border-top')).toEqual({borderSides: ['top']});
      expect(enrich('cc-border-bottom')).toEqual({borderSides: ['bottom']});
      expect(enrich('cc-border-left')).toEqual({borderSides: ['left']});
      expect(enrich('cc-border-right')).toEqual({borderSides: ['right']});
    });

    it('multiple side classes are additive (insertion order preserved)', () => {
      expect(enrich(['cc-border-top', 'cc-border-bottom'])).toEqual({
        borderSides: ['top', 'bottom'],
      });
      expect(enrich(['cc-border-left', 'cc-border-right', 'cc-border-top'])).toEqual({
        borderSides: ['left', 'right', 'top'],
      });
    });
  });

  describe('text alignment', () => {
    it('cc-card-center → textAlign: center', () => {
      expect(enrich('cc-card-center')).toEqual({textAlign: 'center'});
    });

    it('cc-callout-center → textAlign: center', () => {
      expect(enrich('cc-callout-center')).toEqual({textAlign: 'center'});
    });
  });

  describe('parametric classes (regex-matched)', () => {
    it.each([0, 45, 90, 180, 270, 359])('cc-card-gradient-%ddeg → gradientDeg', deg => {
      expect(enrich(`cc-card-gradient-${deg}deg`)).toEqual({gradientDeg: deg});
    });

    it.each([0, 45, 90, 180, 359])('cc-rotate-card-%d → rotateCard', deg => {
      expect(enrich(`cc-rotate-card-${deg}`)).toEqual({rotateCard: deg});
    });

    it.each([0, 30, 90, 180])('cc-rotate-text-%d → rotateText', deg => {
      expect(enrich(`cc-rotate-text-${deg}`)).toEqual({rotateText: deg});
    });

    it('cc-rotate-text-{N}l (trailing `l` variant) → rotateText', () => {
      expect(enrich('cc-rotate-text-45l')).toEqual({rotateText: 45});
    });

    it('non-matching gradient pattern is silently ignored (no shape change)', () => {
      // `-deg` suffix is required; missing it should not enter the gradient branch.
      expect(enrich('cc-card-gradient-45')).toEqual({});
    });
  });

  describe('combinations', () => {
    it('multiple class kinds combine into a single RenderProps', () => {
      expect(enrich(['cc-shape-circle', 'cc-card-fill', 'cc-card-gradient-90deg'])).toEqual({
        shape: 'circle',
        fill: true,
        gradientDeg: 90,
      });
    });

    it('unknown classes are silently ignored', () => {
      expect(enrich(['cc-card-fill', 'cc-not-a-thing', 'rogue'])).toEqual({fill: true});
    });
  });
});

describe('enrichNodes — batch behaviour', () => {
  it('passes non-text nodes through unchanged', () => {
    const nodes: CanvasNode[] = [
      {id: 'l', type: 'link', x: 0, y: 0, width: 1, height: 1, url: 'https://x.com'},
      {id: 'f', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a.md'},
      {id: 'g', type: 'group', x: 0, y: 0, width: 1, height: 1},
    ];
    expect(enrichNodes(nodes)).toEqual(nodes);
  });

  it('enriches text nodes with cssclasses; leaves plain text nodes unchanged', () => {
    const plain = textNode('just a paragraph');
    const styled = withFrontmatter('cc-card-fill', 'styled body');
    const result = enrichNodes([plain, styled]);

    // Plain text node passes through reference-equal (no allocation).
    expect(result[0]).toBe(plain);

    // Styled text node gets enrichment fields.
    const enriched = result[1] as typeof styled & {
      displayText?: string;
      cssClasses?: string[];
      renderProps?: RenderProps;
    };
    expect(enriched.displayText).toBe('styled body');
    expect(enriched.cssClasses).toEqual(['cc-card-fill']);
    expect(enriched.renderProps).toEqual({fill: true});
  });

  it('returns text nodes with frontmatter-but-no-cssclasses unchanged', () => {
    const node = textNode('---\ntitle: Hello\n---\nbody');
    const result = enrichNodes([node]);
    expect(result[0]).toBe(node);
  });
});
