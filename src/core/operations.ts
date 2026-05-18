import type {CanvasNode, CanvasEdge} from './types';

export type Operation =
  | {type: 'addNode'; node: CanvasNode}
  | {type: 'removeNode'; nodeId: string; node: CanvasNode}
  | {type: 'moveNode'; nodeId: string; x: number; y: number; prevX: number; prevY: number}
  | {
      type: 'resizeNode';
      nodeId: string;
      width: number;
      height: number;
      prevWidth: number;
      prevHeight: number;
    }
  | {type: 'addEdge'; edge: CanvasEdge}
  | {type: 'removeEdge'; edgeId: string; edge: CanvasEdge}
  | {
      type: 'updateNodeContent';
      nodeId: string;
      changes: Partial<CanvasNode>;
      prevValues: Partial<CanvasNode>;
    };

export function invertOperation(op: Operation): Operation {
  switch (op.type) {
    case 'addNode':
      return {type: 'removeNode', nodeId: op.node.id, node: op.node};
    case 'removeNode':
      return {type: 'addNode', node: op.node};
    case 'moveNode':
      return {
        type: 'moveNode',
        nodeId: op.nodeId,
        x: op.prevX,
        y: op.prevY,
        prevX: op.x,
        prevY: op.y,
      };
    case 'resizeNode':
      return {
        type: 'resizeNode',
        nodeId: op.nodeId,
        width: op.prevWidth,
        height: op.prevHeight,
        prevWidth: op.width,
        prevHeight: op.height,
      };
    case 'addEdge':
      return {type: 'removeEdge', edgeId: op.edge.id, edge: op.edge};
    case 'removeEdge':
      return {type: 'addEdge', edge: op.edge};
    case 'updateNodeContent':
      return {
        type: 'updateNodeContent',
        nodeId: op.nodeId,
        changes: op.prevValues,
        prevValues: op.changes,
      };
  }
}

// Value-oriented history: stacks only, no callbacks crossing the boundary.
// Callers apply ops themselves; the history just tracks what can be un/redone.
// Shape chosen to translate cleanly to a future Rust core over JSI/wasm-bindgen.
export interface CanvasCommandHistory {
  /** Push a freshly-executed op onto the undo stack and clear redo. */
  record(op: Operation): void;
  /** Pop the most recent op from undo and move it to redo; caller inverts and applies it. */
  undo(): Operation | undefined;
  /** Pop the most recent op from redo and move it back to undo; caller applies it. */
  redo(): Operation | undefined;
  canUndo: boolean;
  canRedo: boolean;
}

export function createCommandHistory(): CanvasCommandHistory {
  const undoStack: Operation[] = [];
  const redoStack: Operation[] = [];

  return {
    record(op: Operation): void {
      undoStack.push(op);
      redoStack.length = 0;
    },

    undo(): Operation | undefined {
      const op = undoStack.pop();
      if (!op) return undefined;
      redoStack.push(op);
      return op;
    },

    redo(): Operation | undefined {
      const op = redoStack.pop();
      if (!op) return undefined;
      undoStack.push(op);
      return op;
    },

    get canUndo(): boolean {
      return undoStack.length > 0;
    },

    get canRedo(): boolean {
      return redoStack.length > 0;
    },
  };
}
