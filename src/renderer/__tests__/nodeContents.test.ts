import {createCanvasState} from '../../core';
import type {CanvasDocument} from '../../core';
import {nodeContents} from '../nodeContents';

const doc: CanvasDocument = {
  nodes: [
    {id: 'g', type: 'group', label: 'Team', x: 0, y: 0, width: 400, height: 300},
    {id: 'a', type: 'text', text: 'A', x: 20, y: 20, width: 100, height: 60},
    {id: 'b', type: 'text', text: 'B', x: 200, y: 20, width: 100, height: 60},
    {id: 'half', type: 'text', text: 'Half in', x: 350, y: 20, width: 100, height: 60},
    {id: 'out', type: 'text', text: 'Out', x: 600, y: 20, width: 100, height: 60},
  ],
  edges: [
    {id: 'ab', fromNode: 'a', toNode: 'b'},
    {id: 'a-out', fromNode: 'a', toNode: 'out'},
  ],
};

describe('nodeContents', () => {
  const state = createCanvasState(doc);

  it('is the node alone for a card', () => {
    expect(nodeContents(state.getNode('a')!, state)).toEqual({nodes: [state.getNode('a')], edges: []});
  });

  it("is a group with the nodes wholly inside it and the edges between them", () => {
    const {nodes, edges} = nodeContents(state.getNode('g')!, state);
    expect(nodes.map(n => n.id).sort()).toEqual(['a', 'b', 'g']);
    expect(edges.map(e => e.id)).toEqual(['ab']);
  });
});
