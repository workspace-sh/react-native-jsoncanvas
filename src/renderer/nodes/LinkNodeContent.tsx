import type {LinkNode} from '../../core';
import type {ColorScheme} from '../theme';

interface Props {
  node: LinkNode;
  colorScheme: ColorScheme;
}

/**
 * Link node content is rendered via Skia (SkiaLinkRenderer) to bypass
 * the react-native-macos Text rendering limitation. This component
 * returns null — the card background is handled by CanvasNodeView.
 */
export function LinkNodeContent(_props: Props) {
  return null;
}
