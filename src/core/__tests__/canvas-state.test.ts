import * as fs from 'fs';
import * as path from 'path';
import {parseCanvas, serializeCanvas} from '../serialization';
import {createCanvasState} from '../canvas-state';
import {invertOperation, type Operation} from '../operations';
import type {CanvasDocument, TextNode, CanvasEdge} from '../types';

const samplePath = path.join(__dirname, 'fixtures', 'sample.canvas');
const sampleJson = fs.readFileSync(samplePath, 'utf-8');

describe('CanvasState', () => {
  it('creates state from a parsed document', () => {
    const doc = parseCanvas(sampleJson);
    const state = createCanvasState(doc);

    expect(state.getNode('node-1')).toBeDefined();
    expect(state.getNode('node-2')).toBeDefined();
    expect(state.getEdge('edge-1')).toBeDefined();
    expect(state.document.nodes).toHaveLength(4);
    expect(state.document.edges).toHaveLength(2);
  });

  it('returns edges for a given node', () => {
    const doc = parseCanvas(sampleJson);
    const state = createCanvasState(doc);

    const edges = state.getEdgesForNode('node-1');
    expect(edges).toHaveLength(2);
  });

  it('queries nodes in viewport', () => {
    const doc = parseCanvas(sampleJson);
    const state = createCanvasState(doc);

    // node-1 is at (100,100) 300x200, node-2 at (500,100) 300x200
    const visible = state.getNodesInViewport({x: 0, y: 0, width: 250, height: 250});
    expect(visible.some(n => n.id === 'node-1')).toBe(true);
  });

  it('hit tests nodes', () => {
    const doc = parseCanvas(sampleJson);
    const state = createCanvasState(doc);

    const hits = state.hitTest(150, 150);
    // Should hit node-1 (100,100,300,200) and node-4 (50,50,800,550) which overlaps
    expect(hits.some(n => n.id === 'node-1')).toBe(true);
    expect(hits.some(n => n.id === 'node-4')).toBe(true);
  });

  describe('mutations with undo/redo', () => {
    it('adds and removes a node', () => {
      const state = createCanvasState({nodes: [], edges: []});
      const node: TextNode = {
        id: 'new-1',
        type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        text: 'test',
      };

      state.addNode(node);
      expect(state.getNode('new-1')).toBeDefined();
      expect(state.document.nodes).toHaveLength(1);

      state.removeNode('new-1');
      expect(state.getNode('new-1')).toBeUndefined();
      expect(state.document.nodes).toHaveLength(0);
    });

    it('moves a node', () => {
      const doc = parseCanvas(sampleJson);
      const state = createCanvasState(doc);

      state.moveNode('node-1', 999, 888);
      expect(state.getNode('node-1')!.x).toBe(999);
      expect(state.getNode('node-1')!.y).toBe(888);
    });

    it('resizes a node', () => {
      const doc = parseCanvas(sampleJson);
      const state = createCanvasState(doc);

      state.resizeNode('node-1', 500, 400);
      expect(state.getNode('node-1')!.width).toBe(500);
      expect(state.getNode('node-1')!.height).toBe(400);
    });

    it('undoes a move', () => {
      const doc = parseCanvas(sampleJson);
      const state = createCanvasState(doc);

      const origX = state.getNode('node-1')!.x;
      const origY = state.getNode('node-1')!.y;

      state.moveNode('node-1', 999, 888);
      expect(state.getNode('node-1')!.x).toBe(999);

      state.undo();
      expect(state.getNode('node-1')!.x).toBe(origX);
      expect(state.getNode('node-1')!.y).toBe(origY);
    });

    it('redoes after undo', () => {
      const doc = parseCanvas(sampleJson);
      const state = createCanvasState(doc);

      state.moveNode('node-1', 999, 888);
      state.undo();
      state.redo();
      expect(state.getNode('node-1')!.x).toBe(999);
      expect(state.getNode('node-1')!.y).toBe(888);
    });

    it('undoes node addition', () => {
      const state = createCanvasState({nodes: [], edges: []});
      const node: TextNode = {
        id: 'new-1',
        type: 'text',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        text: 'test',
      };

      state.addNode(node);
      expect(state.document.nodes).toHaveLength(1);

      state.undo();
      expect(state.document.nodes).toHaveLength(0);
    });

    it('adds and removes edges', () => {
      const doc = parseCanvas(sampleJson);
      const state = createCanvasState(doc);

      const edge: CanvasEdge = {
        id: 'new-edge',
        fromNode: 'node-2',
        toNode: 'node-3',
      };

      state.addEdge(edge);
      expect(state.getEdge('new-edge')).toBeDefined();
      expect(state.document.edges).toHaveLength(3);

      state.undo();
      expect(state.getEdge('new-edge')).toBeUndefined();
      expect(state.document.edges).toHaveLength(2);
    });

    it('clears redo stack on new operation after undo', () => {
      const doc = parseCanvas(sampleJson);
      const state = createCanvasState(doc);

      state.moveNode('node-1', 999, 888);
      state.undo();
      expect(state.history.canRedo).toBe(true);

      state.moveNode('node-1', 111, 222);
      expect(state.history.canRedo).toBe(false);
    });
  });

  describe('per-field updates', () => {
    const doc = (): CanvasDocument => ({
      nodes: [
        {id: 't', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'old', color: '1'},
        {id: 'l', type: 'link', x: 20, y: 0, width: 10, height: 10, url: 'https://old.example'},
        {id: 'f', type: 'file', x: 40, y: 0, width: 10, height: 10, file: 'old.md', subpath: '#old'},
        {
          id: 'g',
          type: 'group',
          x: 60,
          y: 0,
          width: 10,
          height: 10,
          label: 'old',
          background: 'old.png',
          backgroundStyle: 'cover',
        },
      ],
      edges: [],
    });

    // Each case: apply, check the new value, undo back to the original node, redo.
    const cases: Array<{
      name: string;
      id: string;
      apply: (state: ReturnType<typeof createCanvasState>) => void;
      expected: Record<string, unknown>;
    }> = [
      {
        name: 'updateNodeColor',
        id: 't',
        apply: s => s.updateNodeColor('t', '#ff0000'),
        expected: {color: '#ff0000'},
      },
      {
        name: 'updateNodeColor clearing the colour',
        id: 't',
        apply: s => s.updateNodeColor('t', undefined),
        expected: {color: undefined},
      },
      {
        name: 'updateTextNodeText',
        id: 't',
        apply: s => s.updateTextNodeText('t', 'new'),
        expected: {text: 'new'},
      },
      {
        name: 'updateLinkNodeUrl',
        id: 'l',
        apply: s => s.updateLinkNodeUrl('l', 'https://new.example'),
        expected: {url: 'https://new.example'},
      },
      {
        name: 'updateFileNode',
        id: 'f',
        apply: s => s.updateFileNode('f', 'new.md', undefined),
        expected: {file: 'new.md', subpath: undefined},
      },
      {
        name: 'updateGroupNodeLabel',
        id: 'g',
        apply: s => s.updateGroupNodeLabel('g', 'new'),
        expected: {label: 'new'},
      },
      {
        name: 'updateGroupNodeBackground',
        id: 'g',
        apply: s => s.updateGroupNodeBackground('g', 'new.png', 'repeat'),
        expected: {background: 'new.png', backgroundStyle: 'repeat'},
      },
    ];

    it.each(cases)('$name applies, undoes and redoes', ({id, apply, expected}) => {
      const state = createCanvasState(doc());
      const original = {...state.getNode(id)!};

      apply(state);
      expect(state.getNode(id)).toEqual({...original, ...expected});

      state.undo();
      expect(state.getNode(id)).toEqual(original);

      state.redo();
      expect(state.getNode(id)).toEqual({...original, ...expected});
    });

    it('leaves the other fields and the geometry alone', () => {
      const state = createCanvasState(doc());
      state.updateTextNodeText('t', 'new');
      expect(state.getNode('t')).toEqual({
        id: 't',
        type: 'text',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        text: 'new',
        color: '1',
      });
      expect(state.hitTest(5, 5).map(n => n.id)).toEqual(['t']);
    });

    it('a cleared field is absent from the serialised document', () => {
      const state = createCanvasState(doc());
      state.updateNodeColor('t', undefined);
      state.updateFileNode('f', 'new.md', undefined);
      const out = JSON.parse(serializeCanvas(state.document));
      expect('color' in out.nodes.find((n: {id: string}) => n.id === 't')).toBe(false);
      expect('subpath' in out.nodes.find((n: {id: string}) => n.id === 'f')).toBe(false);
    });

    it('is a no-op, with nothing to undo, on a missing node or the wrong node type', () => {
      const state = createCanvasState(doc());
      const before = JSON.stringify(state.document);

      state.updateNodeColor('missing', '2');
      state.updateTextNodeText('l', 'x');
      state.updateLinkNodeUrl('t', 'x');
      state.updateFileNode('g', 'x', undefined);
      state.updateGroupNodeLabel('f', 'x');
      state.updateGroupNodeBackground('t', 'x', 'cover');

      expect(JSON.stringify(state.document)).toBe(before);
      expect(state.history.canUndo).toBe(false);
    });

    it('invertOperation swaps the new and previous values, and inverts back', () => {
      const ops: Operation[] = [
        {type: 'updateNodeColor', nodeId: 't', color: '2', prevColor: undefined},
        {type: 'updateTextNodeText', nodeId: 't', text: 'b', prevText: 'a'},
        {type: 'updateLinkNodeUrl', nodeId: 'l', url: 'b', prevUrl: 'a'},
        {
          type: 'updateFileNode',
          nodeId: 'f',
          file: 'b',
          subpath: '#b',
          prevFile: 'a',
          prevSubpath: undefined,
        },
        {type: 'updateGroupNodeLabel', nodeId: 'g', label: undefined, prevLabel: 'a'},
        {
          type: 'updateGroupNodeBackground',
          nodeId: 'g',
          background: 'b',
          backgroundStyle: 'ratio',
          prevBackground: undefined,
          prevBackgroundStyle: undefined,
        },
      ];
      for (const op of ops) {
        expect(invertOperation(op)).not.toEqual(op);
        expect(invertOperation(invertOperation(op))).toEqual(op);
      }
      expect(invertOperation(ops[1])).toEqual({
        type: 'updateTextNodeText',
        nodeId: 't',
        text: 'a',
        prevText: 'b',
      });
    });
  });
});
