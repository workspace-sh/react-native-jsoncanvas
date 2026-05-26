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
 * LIMITATION (v1): coordinates are window-relative, not canvas-view-relative.
 * For a full-window canvas (e.g. the playground harness) they match. For an
 * app with chrome (sidebar, title bar inset), the consumer needs to
 * subtract their own offsets before calling into world-coord conversion.
 * A future view-component variant of the native module will provide
 * view-local coords per-instance.
 */
export interface SmartMagnifyEvent {
  x: number;
  y: number;
}

// Consumer-provided scroll-wheel bridge. Optional. Apps that need
// trackpad-pan support on macOS provide a `ScrollWheelBridge` native module
// emitting `onScrollWheel` events. The library doesn't ship one — pan via
// scroll-wheel is an app-level concern (it interacts with sidebar offsets,
// scroll inertia, etc., which differ per consumer).
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

// Library-shipped gesture bridge. Currently emits `onSmartMagnify` only;
// autolinked into any macOS consumer via react-native-jsoncanvas.podspec.
// On non-macOS platforms the native module isn't present and this stays
// null — JS-side listeners are guarded against null.
const JsonCanvasGestureModule =
  Platform.OS === 'macos' ? NativeModules.WorkspaceJsonCanvasGesture : null;

export const jsonCanvasGestureEvents = JsonCanvasGestureModule
  ? new NativeEventEmitter(JsonCanvasGestureModule)
  : null;
