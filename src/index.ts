// Core — pure-TS JSON Canvas parser, types, spatial index, state.
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
} from './core/types';

export {parseCanvas, serializeCanvas} from './core/serialization';
export {createSpatialIndex, type SpatialIndex} from './core/spatial-index';
export {
  createCommandHistory,
  invertOperation,
  type CanvasCommandHistory,
  type GroupBackgroundStyle,
  type Operation,
} from './core/operations';
export {createCanvasState, type CanvasState} from './core/canvas-state';

// Renderer — Skia + Reanimated React Native components.
export {CanvasView} from './renderer/CanvasView';
export {CanvasMinimap, type MinimapPosition} from './renderer/CanvasMinimap';
export {getNodeColors, resolveScheme, type ColorScheme} from './renderer/theme';
export {useCanvasContext, CanvasProvider} from './renderer/CanvasContext';
export {activateScrollWheel, deactivateScrollWheel} from './renderer/NativeScrollWheelView';
export {CanvasNodeView} from './renderer/CanvasNodeView';
export {SkiaCanvasLayer} from './renderer/SkiaCanvasLayer';
export {EdgeRenderer} from './renderer/edges/EdgeRenderer';
export {TextNodeContent} from './renderer/nodes/TextNodeContent';
export {LinkNodeContent} from './renderer/nodes/LinkNodeContent';
export {FileNodeContent} from './renderer/nodes/FileNodeContent';
export {GroupNodeContent} from './renderer/nodes/GroupNodeContent';
