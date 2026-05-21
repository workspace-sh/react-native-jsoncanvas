# @workspace.sh/react-native-jsoncanvas

React Native renderer for [JSON Canvas](https://jsoncanvas.org/) (`.canvas`) documents. Skia + Reanimated, with pan / pinch / double-tap zoom and an imperative fit / recenter API.

## Install

```sh
npm install @workspace.sh/react-native-jsoncanvas
```

Peer dependencies (you provide these in your app):

- `react`
- `react-native`
- `@shopify/react-native-skia`
- `react-native-gesture-handler`
- `react-native-reanimated`
- `react-native-worklets`

## Usage

```tsx
import {useRef} from 'react';
import {CanvasView} from '@workspace.sh/react-native-jsoncanvas';

type Controls = {
  fitToViewport: (leftInset?: number) => void;
  recenter: (leftInset?: number) => void;
  getLastAction: () => 'fit' | 'recenter' | 'manual';
};

export function MyCanvasScreen({canvasJson}: {canvasJson: string}) {
  const controls = useRef<Controls | null>(null);

  return (
    <CanvasView
      content={canvasJson}
      onReady={c => {
        controls.current = c;
      }}
    />
  );
}
```

Call `controls.current?.fitToViewport()` or `controls.current?.recenter()` from any button to drive the camera.

## What's inside

The library exposes two layers:

- **Core** — pure-TS JSON Canvas parser, serialiser, spatial index, and stateful document model. No React, no rendering.
- **Renderer** — Skia-based React Native components (`CanvasView`, `SkiaCanvasLayer`, node and edge renderers) with built-in pan / pinch / double-tap gestures.

The renderer is consumed through `CanvasView`. The core surface (`parseCanvas`, `createCanvasState`, etc.) is exported alongside if you need to inspect or mutate documents independently.

## Development

```sh
npm install
npm test          # jest — runs src/**/__tests__
npm run typecheck # tsc --noEmit
npm run lint      # eslint src
```

Tests use a separate `tsconfig.test.json` so the library's main `tsconfig.json` stays free of `jest` / `node` types.

### Playground app

A minimal Expo CNG harness lives at `examples/playground/`. Imports the
library via a workspace symlink, renders a sample fixture inside a
`CanvasView`, and exposes Fit / Recenter buttons that drive the `onReady`
controls. Edits to `src/` are picked up automatically by Metro's watcher.

All commands run from the repo root:

```sh
npm run playground:ios            # First-run iOS: builds dev client + runs in sim
npm run playground:android        # First-run Android: builds dev client + runs in emulator
npm run playground:start          # Metro bundler only (dev client already installed)
npm run playground:clear          # Reset watchman + Metro cache, then start
npm run playground:web            # Browser (CanvasKit WASM — see #17)
npm run playground:ios:device     # Tethered iOS device
npm run playground:android:device # Tethered Android device
```

Port `8082` matches Workspace's `mobile:*` scripts, leaving `8081` free for
the bare-RN macOS harness in #21.

macOS smoke-testing needs a separate `examples/desktop/` harness using
`react-native-macos` (Expo doesn't target macOS). Tracked in #21 — when it
lands, its scripts will be `desktop:*` at the same level.

