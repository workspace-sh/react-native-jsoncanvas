/**
 * Whether a resize should re-apply the last camera action, and which.
 *
 * The camera is computed against the viewport, so a canvas that was fitted
 * stops being fitted the moment the viewport changes: full screen, a window
 * resize, a rotation, a split view. Whatever the reader last asked for is the
 * state to keep — and after a pan, pinch, scroll or double-tap the camera is
 * theirs, so it is left exactly where they put it.
 *
 * Pure, so the rule can be tested without a renderer.
 */
export type CameraAction = 'fit' | 'recenter' | 'manual';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The action to re-apply after the viewport changed from `previous` to `next`,
 * or `null` to leave the camera alone.
 *
 * `previous` is null before anything has been measured: the first layout is
 * the initial view state's to own, not a resize.
 */
export function cameraActionForResize(
  previous: Size | null,
  next: Size,
  lastAction: CameraAction,
): 'fit' | 'recenter' | null {
  if (previous === null) return null;
  if (lastAction === 'manual') return null;
  if (!(next.width > 0) || !(next.height > 0)) return null;
  if (previous.width === next.width && previous.height === next.height) return null;
  return lastAction;
}
