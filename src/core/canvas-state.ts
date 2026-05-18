import type {CanvasDocument, CanvasNode, CanvasEdge, Rect} from './types';
import {createSpatialIndex, type SpatialIndex} from './spatial-index';
import {
  createCommandHistory,
  invertOperation,
  type CanvasCommandHistory,
  type Operation,
} from './operations';

export interface CanvasState {
  readonly document: CanvasDocument;
  readonly history: CanvasCommandHistory;

  getNode(id: string): CanvasNode | undefined;
  getEdge(id: string): CanvasEdge | undefined;
  getEdgesForNode(nodeId: string): CanvasEdge[];
  getNodesInViewport(viewport: Rect): CanvasNode[];
  hitTest(x: number, y: number): CanvasNode[];

  addNode(node: CanvasNode): void;
  removeNode(nodeId: string): void;
  moveNode(nodeId: string, x: number, y: number): void;
  resizeNode(nodeId: string, width: number, height: number): void;
  addEdge(edge: CanvasEdge): void;
  removeEdge(edgeId: string): void;
  updateNodeContent(nodeId: string, changes: Partial<CanvasNode>): void;

  undo(): void;
  redo(): void;
}

export function createCanvasState(doc: CanvasDocument): CanvasState {
  const nodes = new Map<string, CanvasNode>();
  const edges = new Map<string, CanvasEdge>();
  const spatialIndex: SpatialIndex = createSpatialIndex();
  const history: CanvasCommandHistory = createCommandHistory();

  // Nodes array is ordered by z-index — preserve insertion order via the Map
  for (const node of doc.nodes ?? []) {
    nodes.set(node.id, node);
    spatialIndex.insert(node);
  }
  for (const edge of doc.edges ?? []) {
    edges.set(edge.id, edge);
  }

  function applyOperation(op: Operation): void {
    switch (op.type) {
      case 'addNode': {
        nodes.set(op.node.id, op.node);
        spatialIndex.insert(op.node);
        break;
      }
      case 'removeNode': {
        nodes.delete(op.nodeId);
        spatialIndex.remove(op.nodeId);
        // Also remove connected edges
        for (const [edgeId, edge] of edges) {
          if (edge.fromNode === op.nodeId || edge.toNode === op.nodeId) {
            edges.delete(edgeId);
          }
        }
        break;
      }
      case 'moveNode': {
        const node = nodes.get(op.nodeId);
        if (!node) return;
        const moved = {...node, x: op.x, y: op.y};
        nodes.set(op.nodeId, moved);
        spatialIndex.update(moved);
        break;
      }
      case 'resizeNode': {
        const node = nodes.get(op.nodeId);
        if (!node) return;
        const resized = {...node, width: op.width, height: op.height};
        nodes.set(op.nodeId, resized);
        spatialIndex.update(resized);
        break;
      }
      case 'addEdge': {
        edges.set(op.edge.id, op.edge);
        break;
      }
      case 'removeEdge': {
        edges.delete(op.edgeId);
        break;
      }
      case 'updateNodeContent': {
        const node = nodes.get(op.nodeId);
        if (!node) return;
        const updated = {...node, ...op.changes} as CanvasNode;
        nodes.set(op.nodeId, updated);
        spatialIndex.update(updated);
        break;
      }
    }
  }

  function getDocument(): CanvasDocument {
    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }

  return {
    get document(): CanvasDocument {
      return getDocument();
    },

    history,

    getNode(id: string): CanvasNode | undefined {
      return nodes.get(id);
    },

    getEdge(id: string): CanvasEdge | undefined {
      return edges.get(id);
    },

    getEdgesForNode(nodeId: string): CanvasEdge[] {
      const result: CanvasEdge[] = [];
      for (const edge of edges.values()) {
        if (edge.fromNode === nodeId || edge.toNode === nodeId) {
          result.push(edge);
        }
      }
      return result;
    },

    getNodesInViewport(viewport: Rect): CanvasNode[] {
      return spatialIndex.query(viewport);
    },

    hitTest(x: number, y: number): CanvasNode[] {
      return spatialIndex.queryPoint(x, y);
    },

    addNode(node: CanvasNode): void {
      const op: Operation = {type: 'addNode', node};
      applyOperation(op);
      history.record(op);
    },

    removeNode(nodeId: string): void {
      const node = nodes.get(nodeId);
      if (!node) return;
      const op: Operation = {type: 'removeNode', nodeId, node};
      applyOperation(op);
      history.record(op);
    },

    moveNode(nodeId: string, x: number, y: number): void {
      const node = nodes.get(nodeId);
      if (!node) return;
      const op: Operation = {
        type: 'moveNode',
        nodeId,
        x,
        y,
        prevX: node.x,
        prevY: node.y,
      };
      applyOperation(op);
      history.record(op);
    },

    resizeNode(nodeId: string, width: number, height: number): void {
      const node = nodes.get(nodeId);
      if (!node) return;
      const op: Operation = {
        type: 'resizeNode',
        nodeId,
        width,
        height,
        prevWidth: node.width,
        prevHeight: node.height,
      };
      applyOperation(op);
      history.record(op);
    },

    addEdge(edge: CanvasEdge): void {
      const op: Operation = {type: 'addEdge', edge};
      applyOperation(op);
      history.record(op);
    },

    removeEdge(edgeId: string): void {
      const edge = edges.get(edgeId);
      if (!edge) return;
      const op: Operation = {type: 'removeEdge', edgeId, edge};
      applyOperation(op);
      history.record(op);
    },

    updateNodeContent(nodeId: string, changes: Partial<CanvasNode>): void {
      const node = nodes.get(nodeId);
      if (!node) return;
      const prevValues: Partial<CanvasNode> = {};
      for (const key of Object.keys(changes) as Array<keyof CanvasNode>) {
        (prevValues as Record<string, unknown>)[key] = node[key];
      }
      const op: Operation = {type: 'updateNodeContent', nodeId, changes, prevValues};
      applyOperation(op);
      history.record(op);
    },

    undo(): void {
      const op = history.undo();
      if (!op) return;
      applyOperation(invertOperation(op));
    },

    redo(): void {
      const op = history.redo();
      if (!op) return;
      applyOperation(op);
    },
  };
}
