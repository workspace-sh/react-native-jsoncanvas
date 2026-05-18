import React, {createContext, useContext} from 'react';
import type {ColorScheme} from './theme';

interface CanvasContextValue {
  colorScheme: ColorScheme;
  renderMarkdown?: (text: string, colorScheme: ColorScheme) => React.ReactElement;
}

const CanvasContext = createContext<CanvasContextValue>({colorScheme: 'dark'});

export const CanvasProvider = CanvasContext.Provider;
export const useCanvasContext = () => useContext(CanvasContext);
