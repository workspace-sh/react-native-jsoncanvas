import type {NodeLongPress} from '../renderer/CanvasView';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A card taller than this share of the view anchors its menu at the finger: there's no room above or below it. */
const TALL = 0.6;

/**
 * What a card's menu hangs from, in the view's coordinates: the part of the
 * card that's on screen, so the menu opens below it (or above, with no room
 * below) and lines up with its leading edge, as Material's menus do. A card
 * that fills most of the view has no room either side, so its menu opens at
 * the finger instead, still lined up with the card.
 */
export function menuAnchor({frame, at, viewport}: Pick<NodeLongPress, 'frame' | 'at' | 'viewport'>): Rect {
  const left = Math.max(0, frame.x);
  const top = Math.max(0, frame.y);
  const right = Math.min(viewport.width, frame.x + frame.width);
  const bottom = Math.min(viewport.height, frame.y + frame.height);
  const width = Math.max(1, right - left);
  const height = bottom - top;
  if (height > viewport.height * TALL) return {x: left, y: at.y, width, height: 1};
  return {x: left, y: top, width, height: Math.max(1, height)};
}
