import {NativeModules, NativeEventEmitter, Platform} from 'react-native';

export interface ScrollWheelEvent {
  deltaX: number;
  deltaY: number;
}

/**
 * macOS trackpad two-finger double-tap — Safari's "Smart Zoom" gesture.
 *
 * Native `NSResponder.smartMagnifyWithEvent:` translates to top-left-origin
 * view coordinates that match RNGH's `TapGesture` event shape, so the JS
 * consumer can reuse the same world-coordinate conversion path as a
 * single-finger tap on iOS.
 *
 * We bridge this natively (rather than via RNGH's `Tap().minPointers(2)`)
 * because RNGH-macos sees every trackpad tap as a single-pointer event —
 * the predicate fails and the gesture never starts. macOS routes two-finger
 * taps through `smartMagnifyWithEvent:` on the NSResponder chain, which
 * RNGH doesn't bridge.
 *
 * Consumer-side wiring required: a Swift module that listens for
 * `smartMagnify(with:)` and emits an `onSmartMagnify` event through
 * `ScrollWheelBridge`. See Workspace's `apps/desktop/macos/.../NativeModules/
 * CanvasScrollInterceptor.swift` for the reference implementation.
 */
export interface SmartMagnifyEvent {
  x: number;
  y: number;
}

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
