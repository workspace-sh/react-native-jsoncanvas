import {NativeModules, NativeEventEmitter, Platform} from 'react-native';

export interface ScrollWheelEvent {
  deltaX: number;
  deltaY: number;
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
