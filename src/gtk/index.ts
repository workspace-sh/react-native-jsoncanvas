// The JSON Canvas renderer for GTK4 and libadwaita, through GTKX: the same
// document model as the React Native renderer, drawn with Cairo on a
// GtkDrawingArea. Typechecked and tested by the GTKX app that consumes it,
// which has GTKX and the generated bindings; nothing here can check GTK code
// on its own.

export {
  CanvasView,
  useCanvasColorScheme,
  type ColorScheme,
} from './CanvasView.js';
export {
  drawCanvas,
  fitCamera,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  parseCanvasDocument,
  recenterCamera,
  zoomAt,
  type Camera,
  type CanvasModel,
} from './render.js';
