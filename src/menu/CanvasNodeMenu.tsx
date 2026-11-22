import type {ReactElement} from 'react';
import type {CanvasNodeMenuProps} from './types';

/**
 * A card's menu, on Android (`CanvasNodeMenu.android.tsx`). Elsewhere it
 * draws nothing: on iOS a host shows the system's context menu, with
 * `CanvasNodePreview` lifted from `press.frame`; on the Mac, its own.
 */
export function CanvasNodeMenu(_props: CanvasNodeMenuProps): ReactElement | null {
  return null;
}
