import type {TextNode} from '../../core';
import type {ColorScheme} from '../theme';

interface Props {
  node: TextNode;
  colorScheme: ColorScheme;
}

/**
 * Text node content is rendered via Skia (SkiaTextRenderer) to bypass a
 * react-native-macos limitation where native Text stops rendering beyond
 * ~1500px from the parent View's origin. This component intentionally
 * returns null — the card background is still handled by CanvasNodeView.
 */
export function TextNodeContent(_props: Props) {
  return null;
}
