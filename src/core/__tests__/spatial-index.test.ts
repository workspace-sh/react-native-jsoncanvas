import {createSpatialIndex} from '../spatial-index';
import type {CanvasNode, TextNode} from '../types';

function textNode(id: string, x: number, y: number, w: number, h: number): TextNode {
  return {id, type: 'text', x, y, width: w, height: h, text: ''};
}

describe('SpatialIndex', () => {
  it('returns nodes within viewport', () => {
    const index = createSpatialIndex();
    const n1 = textNode('n1', 0, 0, 100, 100);
    const n2 = textNode('n2', 500, 500, 100, 100);
    index.insert(n1);
    index.insert(n2);

    const visible = index.query({x: -50, y: -50, width: 200, height: 200});
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('n1');
  });

  it('returns nodes that partially overlap the viewport', () => {
    const index = createSpatialIndex();
    const n1 = textNode('n1', 0, 0, 100, 100);
    index.insert(n1);

    const visible = index.query({x: 50, y: 50, width: 200, height: 200});
    expect(visible).toHaveLength(1);
  });

  it('excludes nodes outside viewport', () => {
    const index = createSpatialIndex();
    const n1 = textNode('n1', 0, 0, 100, 100);
    index.insert(n1);

    const visible = index.query({x: 200, y: 200, width: 100, height: 100});
    expect(visible).toHaveLength(0);
  });

  it('handles point queries', () => {
    const index = createSpatialIndex();
    const n1 = textNode('n1', 0, 0, 100, 100);
    const n2 = textNode('n2', 200, 200, 100, 100);
    index.insert(n1);
    index.insert(n2);

    expect(index.queryPoint(50, 50)).toHaveLength(1);
    expect(index.queryPoint(50, 50)[0].id).toBe('n1');
    expect(index.queryPoint(150, 150)).toHaveLength(0);
    expect(index.queryPoint(250, 250)).toHaveLength(1);
  });

  it('removes nodes', () => {
    const index = createSpatialIndex();
    const n1 = textNode('n1', 0, 0, 100, 100);
    index.insert(n1);
    expect(index.query({x: -50, y: -50, width: 200, height: 200})).toHaveLength(1);

    index.remove('n1');
    expect(index.query({x: -50, y: -50, width: 200, height: 200})).toHaveLength(0);
  });

  it('updates node position', () => {
    const index = createSpatialIndex();
    const n1 = textNode('n1', 0, 0, 100, 100);
    index.insert(n1);

    const moved = {...n1, x: 500, y: 500};
    index.update(moved);

    expect(index.query({x: -50, y: -50, width: 200, height: 200})).toHaveLength(0);
    expect(index.query({x: 450, y: 450, width: 200, height: 200})).toHaveLength(1);
  });

  it('handles many nodes (triggers quadtree splits)', () => {
    const index = createSpatialIndex();
    const nodes: CanvasNode[] = [];
    for (let i = 0; i < 100; i++) {
      const node = textNode(`n${i}`, i * 50, i * 50, 40, 40);
      nodes.push(node);
      index.insert(node);
    }

    // Query a region that should contain the first few nodes
    const visible = index.query({x: -10, y: -10, width: 200, height: 200});
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(100);

    // All nodes should be findable
    for (const node of nodes) {
      const found = index.queryPoint(node.x + 20, node.y + 20);
      expect(found.some(n => n.id === node.id)).toBe(true);
    }
  });
});
