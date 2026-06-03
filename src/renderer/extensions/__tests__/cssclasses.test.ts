import {
  hasCssClasses,
  enrichTextNode,
  enrichNodes,
  type EnrichedTextNode,
} from '../cssclasses';
import type {TextNode, CanvasNode} from '../../../core';

// Canvas Candy `cssclasses` enrichment conformance (#16, slice 2).
//
// Pure-TS path (js-yaml only — no unified/remark), so it runs under the
// existing ts-jest config with no mocking. Covers: fast-path detection,
// frontmatter forms, displayText stripping, the full class→renderProp map
// (static cases + parametric regexes), and the zero-overhead guarantee.
//
// Callout-zone conformance (parseCallouts) is deferred — it pulls in the
// unified/remark ESM chain that needs a one-time jest-ESM fix.

// ── helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function textNode(text: string): TextNode {
  return {id: `t${_id++}`, type: 'text', x: 0, y: 0, width: 100, height: 100, text};
}

/** Build a frontmatter block with the given cssclasses YAML body line(s). */
function fm(body: string, after = 'Body text'): string {
  return `---\n${body}\n---\n${after}`;
}

/** Enrich and return renderProps (throws-safe: fails the test if not enriched). */
function propsOf(text: string) {
  const enriched = enrichTextNode(textNode(text));
  expect(enriched).not.toBeNull();
  return enriched!.renderProps;
}

// ── hasCssClasses (fast path) ─────────────────────────────────────────────────

describe('hasCssClasses', () => {
  it('returns true when a text node has cssclasses frontmatter', () => {
    expect(hasCssClasses([textNode(fm('cssclasses: [cc-card-fill]'))])).toBe(true);
  });

  it('accepts the singular `cssclass` alias', () => {
    expect(hasCssClasses([textNode(fm('cssclass: cc-card-fill'))])).toBe(true);
  });

  it('returns false for plain text nodes (zero-overhead path)', () => {
    expect(hasCssClasses([textNode('# Just a heading\n\nNo frontmatter here.')])).toBe(false);
  });

  it('returns false for non-text nodes', () => {
    const fileNode: CanvasNode = {id: 'f', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a.png'};
    expect(hasCssClasses([fileNode])).toBe(false);
  });

  it('returns true if ANY node in the list qualifies', () => {
    expect(hasCssClasses([
      textNode('plain'),
      textNode(fm('cssclasses: [cc-card-fill]')),
    ])).toBe(true);
  });
});

// ── frontmatter forms ─────────────────────────────────────────────────────────

describe('frontmatter forms', () => {
  it('accepts array form', () => {
    const e = enrichTextNode(textNode(fm('cssclasses:\n  - cc-card-fill\n  - cc-shape-circle')))!;
    expect(e.cssClasses).toEqual(['cc-card-fill', 'cc-shape-circle']);
  });

  it('accepts comma-separated string form', () => {
    const e = enrichTextNode(textNode(fm('cssclasses: cc-card-fill, cc-shape-circle')))!;
    expect(e.cssClasses).toEqual(['cc-card-fill', 'cc-shape-circle']);
  });

  it('accepts single-string form', () => {
    const e = enrichTextNode(textNode(fm('cssclasses: cc-card-fill')))!;
    expect(e.cssClasses).toEqual(['cc-card-fill']);
  });

  it('accepts the `cssclass` alias', () => {
    const e = enrichTextNode(textNode(fm('cssclass: cc-card-fill')))!;
    expect(e.cssClasses).toEqual(['cc-card-fill']);
  });

  it('trims whitespace and drops empty entries', () => {
    const e = enrichTextNode(textNode(fm('cssclasses:  cc-card-fill ,, cc-shape-circle ,')))!;
    expect(e.cssClasses).toEqual(['cc-card-fill', 'cc-shape-circle']);
  });

  it('returns null when there is no frontmatter at all', () => {
    expect(enrichTextNode(textNode('no frontmatter'))).toBeNull();
  });

  it('returns null when frontmatter has no cssclasses key', () => {
    expect(enrichTextNode(textNode(fm('title: Hello')))).toBeNull();
  });

  it('treats a bare scalar as a single class (FAILSAFE_SCHEMA loads scalars as strings)', () => {
    // Note: js-yaml FAILSAFE_SCHEMA parses every scalar as a string, so
    // `cssclasses: 42` yields the string "42" → a single (unknown) class,
    // not a rejected number. It enriches but maps to no render props.
    const e = enrichTextNode(textNode(fm('cssclasses: 42')))!;
    expect(e.cssClasses).toEqual(['42']);
    expect(e.renderProps).toEqual({});
  });

  it('returns null when cssclasses is a non-scalar (nested mapping)', () => {
    // A YAML mapping value coerces to no usable classes → null.
    expect(enrichTextNode(textNode(fm('cssclasses:\n  nested:\n    key: val')))).toBeNull();
  });

  it('drops non-string entries within an array form', () => {
    // FAILSAFE makes `- 42` a string "42"; a genuine nested seq/map entry is
    // dropped by coerceClasses' string filter. Mixed list keeps only strings.
    const e = enrichTextNode(textNode(fm('cssclasses:\n  - cc-card-fill\n  - 42')))!;
    expect(e.cssClasses).toEqual(['cc-card-fill', '42']);
  });
});

// ── displayText stripping ─────────────────────────────────────────────────────

describe('displayText', () => {
  it('strips the frontmatter block and leading newlines', () => {
    const e = enrichTextNode(textNode(fm('cssclasses: cc-card-fill', 'Hello body')))!;
    expect(e.displayText).toBe('Hello body');
  });

  it('preserves body markdown verbatim after the block', () => {
    const e = enrichTextNode(textNode(fm('cssclasses: cc-card-fill', '# Heading\n\n- a\n- b')))!;
    expect(e.displayText).toBe('# Heading\n\n- a\n- b');
  });
});

// ── class → renderProp mapping: static cases ──────────────────────────────────

describe('class mapping — shapes', () => {
  it('maps cc-shape-circle', () => {
    expect(propsOf(fm('cssclasses: cc-shape-circle')).shape).toBe('circle');
  });
  it('maps parallelogram-left / -right', () => {
    expect(propsOf(fm('cssclasses: cc-shape-parallelogram-left')).shape).toBe('parallelogram-left');
    expect(propsOf(fm('cssclasses: cc-shape-parallelogram-right')).shape).toBe('parallelogram-right');
  });
  it('cc-border-squared forces rectangle shape', () => {
    expect(propsOf(fm('cssclasses: cc-border-squared')).shape).toBe('rectangle');
  });
});

describe('class mapping — card fill', () => {
  it('maps fill / transparent / opaque / nocolor', () => {
    expect(propsOf(fm('cssclasses: cc-card-fill')).fill).toBe(true);
    expect(propsOf(fm('cssclasses: cc-card-transparent')).transparent).toBe(true);
    expect(propsOf(fm('cssclasses: cc-card-opaque')).opaque).toBe(true);
    expect(propsOf(fm('cssclasses: cc-card-nocolor')).nocolor).toBe(true);
  });
});

describe('class mapping — borders', () => {
  it('maps border styles', () => {
    expect(propsOf(fm('cssclasses: cc-border-none')).borderStyle).toBe('none');
    expect(propsOf(fm('cssclasses: cc-border-dashed')).borderStyle).toBe('dashed');
    expect(propsOf(fm('cssclasses: cc-border-dotted')).borderStyle).toBe('dotted');
    expect(propsOf(fm('cssclasses: cc-border-double')).borderStyle).toBe('double');
  });
  it('cc-border-rounded sets pill (not shape)', () => {
    const p = propsOf(fm('cssclasses: cc-border-rounded'));
    expect(p.pill).toBe(true);
    expect(p.shape).toBeUndefined();
  });
  it('cc-border-dropshadow sets dropShadow', () => {
    expect(propsOf(fm('cssclasses: cc-border-dropshadow')).dropShadow).toBe(true);
  });
  it('selective border sides accumulate additively', () => {
    const p = propsOf(fm('cssclasses: cc-border-top, cc-border-left'));
    expect(p.borderSides).toEqual(['top', 'left']);
  });
  it('all four sides accumulate in order', () => {
    const p = propsOf(fm('cssclasses: cc-border-top, cc-border-bottom, cc-border-left, cc-border-right'));
    expect(p.borderSides).toEqual(['top', 'bottom', 'left', 'right']);
  });
});

describe('class mapping — text alignment', () => {
  it('cc-card-center and cc-callout-center both map to center', () => {
    expect(propsOf(fm('cssclasses: cc-card-center')).textAlign).toBe('center');
    expect(propsOf(fm('cssclasses: cc-callout-center')).textAlign).toBe('center');
  });
});

// ── class → renderProp mapping: parametric (regex) ────────────────────────────

describe('class mapping — parametric', () => {
  it('parses gradient degrees', () => {
    expect(propsOf(fm('cssclasses: cc-card-gradient-45deg')).gradientDeg).toBe(45);
    expect(propsOf(fm('cssclasses: cc-card-gradient-270deg')).gradientDeg).toBe(270);
  });
  it('parses card rotation', () => {
    expect(propsOf(fm('cssclasses: cc-rotate-card-90')).rotateCard).toBe(90);
  });
  it('parses text rotation, ignoring the trailing `l` variant', () => {
    expect(propsOf(fm('cssclasses: cc-rotate-text-90')).rotateText).toBe(90);
    expect(propsOf(fm('cssclasses: cc-rotate-text-45l')).rotateText).toBe(45);
  });
  it('ignores unknown classes silently (no props, still enriches)', () => {
    const e = enrichTextNode(textNode(fm('cssclasses: cc-card-fill, cc-totally-made-up')))!;
    expect(e.cssClasses).toContain('cc-totally-made-up');
    expect(e.renderProps.fill).toBe(true);
    // made-up class contributes nothing
    expect(Object.keys(e.renderProps)).toEqual(['fill']);
  });
});

// ── combinations / last-wins ──────────────────────────────────────────────────

describe('class mapping — combinations', () => {
  it('merges independent props from multiple classes', () => {
    const p = propsOf(fm('cssclasses: cc-card-fill, cc-shape-circle, cc-border-dashed'));
    expect(p).toMatchObject({fill: true, shape: 'circle', borderStyle: 'dashed'});
  });
  it('later shape class wins (squared after circle → rectangle)', () => {
    expect(propsOf(fm('cssclasses: cc-shape-circle, cc-border-squared')).shape).toBe('rectangle');
  });
});

// ── enrichNodes (batch) ───────────────────────────────────────────────────────

describe('enrichNodes', () => {
  it('enriches text nodes with frontmatter and passes others through', () => {
    const file: CanvasNode = {id: 'f', type: 'file', x: 0, y: 0, width: 1, height: 1, file: 'a.png'};
    const plain = textNode('plain text');
    const fancy = textNode(fm('cssclasses: cc-card-fill'));

    const out = enrichNodes([file, plain, fancy]);

    expect(out[0]).toBe(file); // untouched reference
    expect((out[1] as EnrichedTextNode).renderProps).toBeUndefined(); // plain → no enrichment
    expect((out[2] as EnrichedTextNode).renderProps).toEqual({fill: true});
  });

  it('leaves a text node unenriched when its frontmatter has no cssclasses', () => {
    const node = textNode(fm('title: Hello'));
    const out = enrichNodes([node]);
    expect(out[0]).toBe(node); // enrichTextNode returned null → original passthrough
  });
});
