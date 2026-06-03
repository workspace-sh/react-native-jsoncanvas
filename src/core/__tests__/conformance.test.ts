import * as fs from 'fs';
import * as path from 'path';
import {parseCanvas, serializeCanvas} from '../serialization';
import type {EdgeSide, EdgeEnd} from '../types';

// JSON Canvas spec conformance — https://jsoncanvas.org/spec/1.0/
//
// Complements serialization.test.ts (which covers the bundled sample). This
// suite targets the spec contract directly: every node type, the full
// edge side×end matrix, colour-value preservation, minimal/edge documents,
// the malformed-input rejection matrix, and the round-trip property
// `parse(serialize(parse(x))) ≡ parse(x)`.
//
// Precondition for the Rust port (#6): these same fixtures will validate that
// the Rust parser accepts/rejects exactly what the TS one does.

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'spec-fixtures', name), 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// All four node types in one document

describe('node types', () => {
  const doc = parseCanvas(fixture('all-node-types.canvas'));

  it('parses all four node types in a single document', () => {
    const types = (doc.nodes ?? []).map(n => n.type).sort();
    expect(types).toEqual(['file', 'group', 'link', 'text']);
  });

  it('parses type-specific required fields', () => {
    const byId = new Map((doc.nodes ?? []).map(n => [n.id, n]));
    const text = byId.get('text-1')!;
    const file = byId.get('file-1')!;
    const link = byId.get('link-1')!;
    if (text.type === 'text') expect(text.text).toBe('A text node');
    if (file.type === 'file') expect(file.file).toBe('Assets/diagram.png');
    if (link.type === 'link') expect(link.url).toBe('https://jsoncanvas.org');
  });

  it('preserves the group label', () => {
    const group = (doc.nodes ?? []).find(n => n.id === 'group-1')!;
    if (group.type === 'group') expect(group.label).toBe('Everything');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge side × end matrix

describe('edge side/end combinations', () => {
  const SIDES: EdgeSide[] = ['top', 'right', 'bottom', 'left'];
  const ENDS: EdgeEnd[] = ['none', 'arrow'];

  // Build a doc exercising every fromSide×toSide×fromEnd×toEnd combination.
  function matrixDoc(): string {
    const nodes = [
      {id: 'a', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'a'},
      {id: 'b', type: 'text', x: 50, y: 0, width: 10, height: 10, text: 'b'},
    ];
    const edges: Record<string, unknown>[] = [];
    let i = 0;
    for (const fromSide of SIDES)
      for (const toSide of SIDES)
        for (const fromEnd of ENDS)
          for (const toEnd of ENDS)
            edges.push({
              id: `e${i++}`,
              fromNode: 'a', toNode: 'b',
              fromSide, toSide, fromEnd, toEnd,
            });
    return JSON.stringify({nodes, edges});
  }

  it('accepts every side×end combination (4×4×2×2 = 64 edges)', () => {
    const doc = parseCanvas(matrixDoc());
    expect(doc.edges).toHaveLength(64);
  });

  it('preserves each edge\'s sides and ends through a round-trip', () => {
    const reparsed = parseCanvas(serializeCanvas(parseCanvas(matrixDoc())));
    for (const edge of reparsed.edges ?? []) {
      expect(SIDES).toContain(edge.fromSide);
      expect(SIDES).toContain(edge.toSide);
      expect(ENDS).toContain(edge.fromEnd);
      expect(ENDS).toContain(edge.toEnd);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Colour preservation

describe('colour values', () => {
  it('preserves preset colour codes 1–6 verbatim', () => {
    for (const code of ['1', '2', '3', '4', '5', '6']) {
      const json = JSON.stringify({
        nodes: [{id: 'n', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 't', color: code}],
      });
      const node = parseCanvas(serializeCanvas(parseCanvas(json))).nodes![0];
      expect(node.color).toBe(code);
    }
  });

  it('preserves hex colours verbatim (case + length)', () => {
    for (const hex of ['#FF0000', '#0a84ff', '#abc']) {
      const json = JSON.stringify({
        nodes: [{id: 'n', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 't', color: hex}],
      });
      const node = parseCanvas(serializeCanvas(parseCanvas(json))).nodes![0];
      expect(node.color).toBe(hex);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Minimal & edge documents

describe('minimal documents', () => {
  it('accepts an empty object {}', () => {
    const doc = parseCanvas('{}');
    expect(doc.nodes).toBeUndefined();
    expect(doc.edges).toBeUndefined();
  });

  it('accepts {"nodes": []}', () => {
    const doc = parseCanvas('{"nodes": []}');
    expect(doc.nodes).toEqual([]);
  });

  it('accepts {"nodes": [], "edges": []}', () => {
    const doc = parseCanvas('{"nodes": [], "edges": []}');
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });

  it('round-trips an empty object to itself', () => {
    expect(parseCanvas(serializeCanvas(parseCanvas('{}')))).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Malformed inputs — must throw

describe('malformed inputs', () => {
  const cases: Array<[string, string]> = [
    ['invalid JSON', '{not json'],
    ['non-object root (array)', '[]'],
    ['non-object root (number)', '42'],
    ['non-object root (string)', '"hi"'],
    ['nodes not an array', '{"nodes": {}}'],
    ['edges not an array', '{"edges": {}}'],
    ['node missing id', '{"nodes":[{"type":"text","x":0,"y":0,"width":1,"height":1,"text":"t"}]}'],
    ['node empty id', '{"nodes":[{"id":"","type":"text","x":0,"y":0,"width":1,"height":1,"text":"t"}]}'],
    ['node bad type', '{"nodes":[{"id":"n","type":"sticker","x":0,"y":0,"width":1,"height":1}]}'],
    ['node non-numeric coord', '{"nodes":[{"id":"n","type":"text","x":"0","y":0,"width":1,"height":1,"text":"t"}]}'],
    ['text node missing text', '{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":1,"height":1}]}'],
    ['file node missing file', '{"nodes":[{"id":"n","type":"file","x":0,"y":0,"width":1,"height":1}]}'],
    ['link node missing url', '{"nodes":[{"id":"n","type":"link","x":0,"y":0,"width":1,"height":1}]}'],
    ['edge missing id', '{"edges":[{"fromNode":"a","toNode":"b"}]}'],
    ['edge missing fromNode', '{"edges":[{"id":"e","toNode":"b"}]}'],
    ['edge missing toNode', '{"edges":[{"id":"e","fromNode":"a"}]}'],
    ['edge bad fromSide', '{"edges":[{"id":"e","fromNode":"a","toNode":"b","fromSide":"middle"}]}'],
    ['edge bad toEnd', '{"edges":[{"id":"e","fromNode":"a","toNode":"b","toEnd":"diamond"}]}'],
  ];

  for (const [name, json] of cases) {
    it(`throws on ${name}`, () => {
      expect(() => parseCanvas(json)).toThrow();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip property + unknown-field preservation

describe('round-trip', () => {
  it('parse(serialize(parse(x))) deep-equals parse(x) for the full fixture', () => {
    const once = parseCanvas(fixture('all-node-types.canvas'));
    const twice = parseCanvas(serializeCanvas(once));
    expect(twice).toEqual(once);
  });

  it('preserves unknown top-level fields', () => {
    const json = JSON.stringify({
      nodes: [], edges: [],
      version: '1.0', metadata: {author: 'x', tags: ['a', 'b']},
    });
    const doc = parseCanvas(json) as Record<string, unknown>;
    expect(doc.version).toBe('1.0');
    expect(doc.metadata).toEqual({author: 'x', tags: ['a', 'b']});
    // ...and through a round-trip
    const round = parseCanvas(serializeCanvas(parseCanvas(json))) as Record<string, unknown>;
    expect(round.metadata).toEqual({author: 'x', tags: ['a', 'b']});
  });

  it('preserves unknown per-node and per-edge fields', () => {
    const json = JSON.stringify({
      nodes: [{id: 'n', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 't', styleAttributes: {k: 'v'}}],
      edges: [{id: 'e', fromNode: 'n', toNode: 'n', styleAttributes: {path: 'short-dashed'}}],
    });
    const doc = parseCanvas(serializeCanvas(parseCanvas(json)));
    expect((doc.nodes![0] as Record<string, unknown>).styleAttributes).toEqual({k: 'v'});
    expect((doc.edges![0] as Record<string, unknown>).styleAttributes).toEqual({path: 'short-dashed'});
  });

  it('serializes with tab indentation (spec convention)', () => {
    const out = serializeCanvas(parseCanvas('{"nodes":[]}'));
    expect(out).toContain('\t');
  });
});
