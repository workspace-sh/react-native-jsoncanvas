import type {CanvasEdge, CanvasNode, CanvasState} from '../core';

/** A node and, for a group, every node inside it, with the edges between them: what its preview draws. */
export function nodeContents(node: CanvasNode, state: CanvasState): {nodes: CanvasNode[]; edges: CanvasEdge[]} {
  if (node.type !== 'group') return {nodes: [node], edges: []};
  const inside = state
    .getNodesInViewport({x: node.x, y: node.y, width: node.width, height: node.height})
    .filter(n => n.id !== node.id && n.x >= node.x && n.y >= node.y && n.x + n.width <= node.x + node.width && n.y + n.height <= node.y + node.height);
  const nodes = [node, ...inside];
  const ids = new Set(nodes.map(n => n.id));
  const edges = (state.document.edges ?? []).filter(e => ids.has(e.fromNode) && ids.has(e.toNode));
  return {nodes, edges};
}
