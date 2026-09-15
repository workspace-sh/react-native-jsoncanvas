import React, {createContext, useContext} from 'react';
import type {ColorScheme} from './theme';

interface CanvasContextValue {
  colorScheme: ColorScheme;
  /**
   * @deprecated Vestigial. No renderer code consumes this — `TextNodeContent`
   * returns null intentionally (a react-native-macos limitation that capped
   * native Text rendering beyond ~1500px from the parent View's origin
   * forced text through the Skia path). All text-node bodies render via
   * `SkiaTextRenderer` and `paragraphBuilder`, regardless of whether this is
   * provided. Will be removed in a future major version. See #26.
   */
  renderMarkdown?: (text: string, colorScheme: ColorScheme) => React.ReactElement;
}

const CanvasContext = createContext<CanvasContextValue>({colorScheme: 'dark'});

export const CanvasProvider = CanvasContext.Provider;
export const useCanvasContext = () => useContext(CanvasContext);
