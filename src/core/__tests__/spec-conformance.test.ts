import {parseCanvas, serializeCanvas} from '../serialization';
import type {CanvasEdge, EdgeSide, EdgeEnd, CanvasPresetColor} from '../types';

// JSON Canvas spec conformance — focused on round-trip stability across the
// full matrix of side / end combinations on edges, and across every preset
// colour plus a representative hex colour. Adds breadth on top of the
// hand-written cases in serialization.test.ts.
//
// References:
//   https://jsoncanvas.org/spec/
//   https://github.com/obsidianmd/jsoncanvas

const SIDES: EdgeSide[] = ['top', 'right', 'bottom', 'left'];
const ENDS: EdgeEnd[] = ['none', 'arrow'];
const PRESET_COLORS: CanvasPresetColor[] = ['1', '2', '3', '4', '5', '6'];

function makeBaseEdge(overrides: Partial<CanvasEdge>): CanvasEdge {
  return {id: 'e', fromNode: 'a', toNode: 'b', ...overrides};
}

describe('JSON Canvas spec conformance', () => {
  describe('edges — side × end matrix round-trip', () => {
    // Cartesian product of all four EdgeSide values for fromSide and toSide
    // crossed with all two EdgeEnd values for fromEnd and toEnd. 4 × 4 × 2 × 2
    // = 64 combinations. Each one round-trips losslessly.
    for (const fromSide of SIDES) {
      for (const toSide of SIDES) {
        for (const fromEnd of ENDS) {
          for (const toEnd of ENDS) {
            const label = `fromSide=${fromSide} toSide=${toSide} fromEnd=${fromEnd} toEnd=${toEnd}`;
            it(`round-trips ${label}`, () => {
              const edge = makeBaseEdge({fromSide, toSide, fromEnd, toEnd});
              const json = serializeCanvas({edges: [edge]});
              const reparsed = parseCanvas(json);
              expect(reparsed.edges).toEqual([edge]);
            });
          }
        }
      }
    }

    it('round-trips edges with omitted optional side/end fields', () => {
      const edge = makeBaseEdge({});
      const json = serializeCanvas({edges: [edge]});
      const reparsed = parseCanvas(json);
      expect(reparsed.edges![0]).toEqual(edge);
      // Confirm we don't fabricate default values for omitted fields.
      expect(reparsed.edges![0].fromSide).toBeUndefined();
      expect(reparsed.edges![0].toEnd).toBeUndefined();
    });
  });

  describe('colors — preset + hex round-trip', () => {
    for (const color of PRESET_COLORS) {
      it(`preserves preset colour code "${color}" verbatim`, () => {
        const json = JSON.stringify({
          nodes: [{id: 'n', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color}],
        });
        const doc = parseCanvas(json);
        expect(doc.nodes![0].color).toBe(color);
        // Round-trip: serialize, re-parse, colour stays a string code (not coerced to number).
        const reparsed = parseCanvas(serializeCanvas(doc));
        expect(reparsed.nodes![0].color).toBe(color);
      });
    }

    it('preserves a hex colour verbatim through round-trip', () => {
      const json = JSON.stringify({
        nodes: [{id: 'n', type: 'text', x: 0, y: 0, width: 1, height: 1, text: '', color: '#FF5733'}],
      });
      const doc = parseCanvas(json);
      expect(doc.nodes![0].color).toBe('#FF5733');
      const reparsed = parseCanvas(serializeCanvas(doc));
      expect(reparsed.nodes![0].color).toBe('#FF5733');
    });

    it('preserves a hex colour on an edge', () => {
      const edge: CanvasEdge = {id: 'e', fromNode: 'a', toNode: 'b', color: '#00AAFF'};
      const doc = parseCanvas(serializeCanvas({edges: [edge]}));
      expect(doc.edges![0].color).toBe('#00AAFF');
    });
  });

  describe('round-trip property — full deep equality on representative shapes', () => {
    // The existing serialization.test.ts checks lengths and a few field-level
    // assertions on sample.canvas. These tests assert full structural equality
    // so any regression that silently mutates a field surfaces immediately.

    it('mixed-type document with edges round-trips deep-equal', () => {
      const original = {
        nodes: [
          {id: 't1', type: 'text', x: 0, y: 0, width: 100, height: 50, text: 'hi'},
          {id: 'f1', type: 'file', x: 0, y: 100, width: 100, height: 50, file: 'a.md'},
          {id: 'l1', type: 'link', x: 100, y: 0, width: 100, height: 50, url: 'https://x.com'},
          {id: 'g1', type: 'group', x: -50, y: -50, width: 300, height: 300, label: 'Block', color: '4'},
        ],
        edges: [
          {id: 'e1', fromNode: 't1', toNode: 'f1', fromSide: 'bottom', toSide: 'top', toEnd: 'arrow'},
          {id: 'e2', fromNode: 'l1', toNode: 'g1', color: '#123456', label: 'rel'},
        ],
      };
      const reparsed = parseCanvas(serializeCanvas(parseCanvas(JSON.stringify(original))));
      expect(reparsed).toEqual(original);
    });

    it('FileNode subpath survives round-trip', () => {
      const original = {
        nodes: [{
          id: 'f', type: 'file', x: 0, y: 0, width: 1, height: 1,
          file: 'doc.md', subpath: '#heading',
        }],
      };
      const reparsed = parseCanvas(serializeCanvas(parseCanvas(JSON.stringify(original))));
      expect(reparsed).toEqual(original);
    });

    it('GroupNode background fields survive round-trip', () => {
      const original = {
        nodes: [{
          id: 'g', type: 'group', x: 0, y: 0, width: 100, height: 100,
          background: 'bg.png', backgroundStyle: 'ratio',
        }],
      };
      const reparsed = parseCanvas(serializeCanvas(parseCanvas(JSON.stringify(original))));
      expect(reparsed).toEqual(original);
    });
  });
});
