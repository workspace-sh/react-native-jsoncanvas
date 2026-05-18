import type {FileNode} from '../../core';
import type {ColorScheme} from '../theme';

interface Props {
  node: FileNode;
  colorScheme: ColorScheme;
}

/**
 * File node content is rendered via Skia (SkiaImageRenderer for images,
 * SkiaFileRenderer for labels) to bypass the react-native-macos
 * rendering limitation. This component returns null.
 */
export function FileNodeContent(_props: Props) {
  return null;
}
