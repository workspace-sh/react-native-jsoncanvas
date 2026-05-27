import {NativeModules, NativeEventEmitter, Platform} from 'react-native';

export interface ScrollWheelEvent {
  deltaX: number;
  deltaY: number;
}

/**
 * macOS trackpad two-finger double-tap — Safari's "Smart Zoom" gesture.
 *
 * Two possible event sources, with different coordinate-space contracts:
 *
 * 1. **Library bridge** — `jsonCanvasGestureEvents` /
 *    `WorkspaceJsonCanvasGesture` (autolinked via
 *    `react-native-jsoncanvas.podspec`). Hooks
 *    `NSEvent.addLocalMonitorForEvents(.smartMagnify)`, which is a
 *    *window-global* monitor — `x` / `y` are top-left-origin coordinates
 *    in the application window's coordinate space.
 *
 * 2. **Consumer bridge** — `scrollWheelEvents` /
 *    `NativeModules.ScrollWheelBridge` (optional; Workspace's
 *    `apps/desktop` ships one). Typically NSView-scoped, so `x` / `y`
 *    are view-local with sidebar-overlay handling done at the AppKit
 *    layer.
 *
 * `CanvasView` prefers the consumer bridge if present and normalises
 * each source's coord-space internally — direct consumers of this
 * emitter who subscribe outside `CanvasView` must know which bridge
 * is wired and handle coords accordingly.
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
