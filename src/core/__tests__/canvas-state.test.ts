import * as fs from 'fs';
import * as path from 'path';
import {parseCanvas} from '../serialization';
import {createCanvasState} from '../canvas-state';
import type {TextNode, CanvasEdge} from '../types';

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
});
