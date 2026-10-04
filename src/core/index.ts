export type {
  CanvasPresetColor,
  CanvasColor,
  NodeType,
  BaseNode,
  TextNode,
  FileNode,
  LinkNode,
  GroupNode,
  GroupBackgroundStyle,
  CanvasNode,
  EdgeSide,
  EdgeEnd,
  CanvasEdge,
  CanvasDocument,
  Rect,
} from './types';

export {parseCanvas, serializeCanvas} from './serialization';
export {createSpatialIndex, type SpatialIndex} from './spatial-index';
export {
  createCommandHistory,
  invertOperation,
  type CanvasCommandHistory,
  type Operation,
} from './operations';
export {createCanvasState, type CanvasState} from './canvas-state';
