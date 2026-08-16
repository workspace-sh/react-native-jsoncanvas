import {Platform} from 'react-native';
import type {FileNode} from '../../core';

/**
 * File types whose content is the image itself, so the filename adds nothing
 * a viewer can't already see.
 */
const IMAGE_RE = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i;

export function isImageFile(file: string): boolean {
  return IMAGE_RE.test(file);
}

/**
 * Platforms with a pointer, and therefore with hover as a reveal affordance.
 *
 * Touch platforms get theirs from the long-press context menu instead
 * (workspace-sh/react-native-jsoncanvas#74); until that lands they keep
 * always-on labels, because hiding content on a platform with no way to
 * reveal it is just losing it.
 */
const CAN_HOVER = Platform.OS === 'macos';

/**
 * Whether this file node draws its filename **inline** — inside its own
 * bounds, as part of the card.
 *
 * Two consequences, and both callers must agree or the layout desynchronises:
 *
 *   1. Whether the label is drawn at all (`SkiaFileRenderer`, `drawFileLabel`).
 *   2. Whether the image's destination box reserves vertical space for it
 *      (`SkiaImageRenderer`'s `destBox`, `drawFileImage`). Reserving room for
 *      a label that never draws leaves a hole under the image; not reserving
 *      room for one that does makes them collide.
 *
 * Non-image file nodes always answer true: the filename is their only content.
 */
export function hasInlineLabel(node: FileNode): boolean {
  if (!isImageFile(node.file)) return true;
  return !CAN_HOVER;
}
