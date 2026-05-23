import type {CanvasNode, CanvasEdge, CanvasColor} from './types';

/** Background fit modes for group-node images. Mirrors GroupNode.backgroundStyle. */
export type GroupBackgroundStyle = 'cover' | 'ratio' | 'repeat';

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
  // Per-field update variants. Each carries the new value and the prev value
  // for invertOperation. Replaces the old `updateNodeContent` / `Partial<T>`
  // shape that didn't translate cleanly to a Rust enum over JSI/wasm-bindgen.
  // x / y / width / height live in moveNode / resizeNode above and are
  // intentionally not included here.
  | {
      type: 'updateNodeColor';
      nodeId: string;
      color: CanvasColor | undefined;
      prevColor: CanvasColor | undefined;
    }
  | {
      type: 'updateTextNodeText';
      nodeId: string;
      text: string;
      prevText: string;
    }
  | {
      type: 'updateLinkNodeUrl';
      nodeId: string;
      url: string;
      prevUrl: string;
    }
  | {
      type: 'updateFileNode';
      nodeId: string;
      file: string;
      subpath: string | undefined;
      prevFile: string;
      prevSubpath: string | undefined;
    }
  | {
      type: 'updateGroupNodeLabel';
      nodeId: string;
      label: string | undefined;
      prevLabel: string | undefined;
    }
  | {
      type: 'updateGroupNodeBackground';
      nodeId: string;
      background: string | undefined;
      backgroundStyle: GroupBackgroundStyle | undefined;
      prevBackground: string | undefined;
      prevBackgroundStyle: GroupBackgroundStyle | undefined;
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
    case 'updateNodeColor':
      return {
        type: 'updateNodeColor',
        nodeId: op.nodeId,
        color: op.prevColor,
        prevColor: op.color,
      };
    case 'updateTextNodeText':
      return {
        type: 'updateTextNodeText',
        nodeId: op.nodeId,
        text: op.prevText,
        prevText: op.text,
      };
    case 'updateLinkNodeUrl':
      return {
        type: 'updateLinkNodeUrl',
        nodeId: op.nodeId,
        url: op.prevUrl,
        prevUrl: op.url,
      };
    case 'updateFileNode':
      return {
        type: 'updateFileNode',
        nodeId: op.nodeId,
        file: op.prevFile,
        subpath: op.prevSubpath,
        prevFile: op.file,
        prevSubpath: op.subpath,
      };
    case 'updateGroupNodeLabel':
      return {
        type: 'updateGroupNodeLabel',
        nodeId: op.nodeId,
        label: op.prevLabel,
        prevLabel: op.label,
      };
    case 'updateGroupNodeBackground':
      return {
        type: 'updateGroupNodeBackground',
        nodeId: op.nodeId,
        background: op.prevBackground,
        backgroundStyle: op.prevBackgroundStyle,
        prevBackground: op.background,
        prevBackgroundStyle: op.backgroundStyle,
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
