import type {
  CanvasColor,
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  FileNode,
  GroupNode,
  LinkNode,
  Rect,
  TextNode,
} from './types';
import {createSpatialIndex, type SpatialIndex} from './spatial-index';
import {
  createCommandHistory,
  invertOperation,
  type CanvasCommandHistory,
  type GroupBackgroundStyle,
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

  // Per-field update methods. Each is a type-safe alternative to the prior
  // updateNodeContent(nodeId, Partial<CanvasNode>) signature, which was
  // FFI-hostile (Partial<T> has no clean Rust equivalent). Each method is a
  // no-op when the node is missing or of the wrong type. Pass `undefined` to
  // clear an optional field.
  updateNodeColor(nodeId: string, color: CanvasColor | undefined): void;
  updateTextNodeText(nodeId: string, text: string): void;
  updateLinkNodeUrl(nodeId: string, url: string): void;
  updateFileNode(nodeId: string, file: string, subpath: string | undefined): void;
  updateGroupNodeLabel(nodeId: string, label: string | undefined): void;
  updateGroupNodeBackground(
    nodeId: string,
    background: string | undefined,
    backgroundStyle: GroupBackgroundStyle | undefined,
  ): void;

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
      case 'updateNodeColor': {
        const node = nodes.get(op.nodeId);
        if (!node) return;
        const updated: CanvasNode = {...node, color: op.color};
        nodes.set(op.nodeId, updated);
        spatialIndex.update(updated);
        break;
      }
      case 'updateTextNodeText': {
        const node = nodes.get(op.nodeId);
        if (!node || node.type !== 'text') return;
        const updated: TextNode = {...node, text: op.text};
        nodes.set(op.nodeId, updated);
        spatialIndex.update(updated);
        break;
      }
      case 'updateLinkNodeUrl': {
        const node = nodes.get(op.nodeId);
        if (!node || node.type !== 'link') return;
        const updated: LinkNode = {...node, url: op.url};
        nodes.set(op.nodeId, updated);
        spatialIndex.update(updated);
        break;
      }
      case 'updateFileNode': {
        const node = nodes.get(op.nodeId);
        if (!node || node.type !== 'file') return;
        const updated: FileNode = {...node, file: op.file, subpath: op.subpath};
        nodes.set(op.nodeId, updated);
        spatialIndex.update(updated);
        break;
      }
      case 'updateGroupNodeLabel': {
        const node = nodes.get(op.nodeId);
        if (!node || node.type !== 'group') return;
        const updated: GroupNode = {...node, label: op.label};
        nodes.set(op.nodeId, updated);
        spatialIndex.update(updated);
        break;
      }
      case 'updateGroupNodeBackground': {
        const node = nodes.get(op.nodeId);
        if (!node || node.type !== 'group') return;
        const updated: GroupNode = {
          ...node,
          background: op.background,
          backgroundStyle: op.backgroundStyle,
        };
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

    updateNodeColor(nodeId: string, color: CanvasColor | undefined): void {
      const node = nodes.get(nodeId);
      if (!node) return;
      const op: Operation = {
        type: 'updateNodeColor',
        nodeId,
        color,
        prevColor: node.color,
      };
      applyOperation(op);
      history.record(op);
    },

    updateTextNodeText(nodeId: string, text: string): void {
      const node = nodes.get(nodeId);
      if (!node || node.type !== 'text') return;
      const op: Operation = {
        type: 'updateTextNodeText',
        nodeId,
        text,
        prevText: node.text,
      };
      applyOperation(op);
      history.record(op);
    },

    updateLinkNodeUrl(nodeId: string, url: string): void {
      const node = nodes.get(nodeId);
      if (!node || node.type !== 'link') return;
      const op: Operation = {
        type: 'updateLinkNodeUrl',
        nodeId,
        url,
        prevUrl: node.url,
      };
      applyOperation(op);
      history.record(op);
    },

    updateFileNode(nodeId: string, file: string, subpath: string | undefined): void {
      const node = nodes.get(nodeId);
      if (!node || node.type !== 'file') return;
      const op: Operation = {
        type: 'updateFileNode',
        nodeId,
        file,
        subpath,
        prevFile: node.file,
        prevSubpath: node.subpath,
      };
      applyOperation(op);
      history.record(op);
    },

    updateGroupNodeLabel(nodeId: string, label: string | undefined): void {
      const node = nodes.get(nodeId);
      if (!node || node.type !== 'group') return;
      const op: Operation = {
        type: 'updateGroupNodeLabel',
        nodeId,
        label,
        prevLabel: node.label,
      };
      applyOperation(op);
      history.record(op);
    },

    updateGroupNodeBackground(
      nodeId: string,
      background: string | undefined,
      backgroundStyle: GroupBackgroundStyle | undefined,
    ): void {
      const node = nodes.get(nodeId);
      if (!node || node.type !== 'group') return;
      const op: Operation = {
        type: 'updateGroupNodeBackground',
        nodeId,
        background,
        backgroundStyle,
        prevBackground: node.background,
        prevBackgroundStyle: node.backgroundStyle,
      };
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
