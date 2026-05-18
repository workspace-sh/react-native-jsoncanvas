export type {
  CanvasPresetColor,
  CanvasColor,
  NodeType,
  BaseNode,
  TextNode,
  FileNode,
  LinkNode,
  GroupNode,
  CanvasNode,
  EdgeSide,
  EdgeEnd,
  CanvasEdge,
  CanvasDocument,
  Rect,
} from './types';

export {parseCanvas, serializeCanvas} from './serialization';
export {createSpatialIndex, type SpatialIndex} from './spatial-index';
export {createCommandHistory, type CanvasCommandHistory, type Operation} from './operations';
export {createCanvasState, type CanvasState} from './canvas-state';
