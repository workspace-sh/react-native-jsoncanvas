import {NativeModules, NativeEventEmitter, Platform} from 'react-native';

export interface ScrollWheelEvent {
  deltaX: number;
  deltaY: number;
}

/**
 * macOS trackpad two-finger double-tap — Safari's "Smart Zoom" gesture.
 *
 * `x` and `y` are top-left-origin coordinates in the application window's
 * coordinate space. The library ships a native module
 * (ios/WorkspaceJsonCanvasGesture.swift, autolinked via
 * react-native-jsoncanvas.podspec) that hooks `NSEvent.smartMagnify` and
 * forwards the event here.
 *
 * Note: coordinates are window-relative, NOT canvas-view-relative. The
 * library's `CanvasView` translates them to view-local coords internally
 * via `View.measureInWindow` so consumers with chrome (sidebar, title-bar
 * inset) get correct hit-testing without any extra wiring. Taps that land
 * outside the canvas pane (e.g. on a sidebar) are ignored by CanvasView.
 *
 * Direct consumers of `jsonCanvasGestureEvents` (subscribing without going
 * through CanvasView) still get raw window-relative coords here and own
 * any offset bookkeeping themselves.
 */
export interface SmartMagnifyEvent {
  x: number;
  y: number;
}

// Consumer-provided scroll-wheel bridge. Optional escape hatch for apps
// that already ship their own `ScrollWheelBridge` native module (Workspace
// does — it scopes scroll to a specific NSView rather than window-global).
// CanvasView prefers it over the library-shipped bridge below when present.
// Plain react-native-macos apps don't need to provide one — the library's
// own bridge covers the trackpad-pan / mouse-wheel case.
const ScrollWheelBridge =
  Platform.OS === 'macos' ? NativeModules.ScrollWheelBridge : null;

export function activateScrollWheel(): void {
  ScrollWheelBridge?.activate();
}

export function deactivateScrollWheel(): void {
  ScrollWheelBridge?.deactivate();
}

export const scrollWheelEvents = ScrollWheelBridge
  ? new NativeEventEmitter(ScrollWheelBridge)
  : null;

// Library-shipped gesture bridge. Emits two events:
//
//   - `onSmartMagnify` — trackpad two-finger double-tap (Safari Smart Zoom),
//     consumed by the canvas to drive zoom-to-node.
//   - `onScrollWheel` — trackpad two-finger pan + mouse wheel, consumed by
//     the canvas to translate the camera.
//
// Autolinked into any macOS consumer via react-native-jsoncanvas.podspec.
// On non-macOS platforms the native module isn't present and this stays
// null — JS-side listeners are guarded against null.
const JsonCanvasGestureModule =
  Platform.OS === 'macos' ? NativeModules.WorkspaceJsonCanvasGesture : null;

export const jsonCanvasGestureEvents = JsonCanvasGestureModule
  ? new NativeEventEmitter(JsonCanvasGestureModule)
  : null;
