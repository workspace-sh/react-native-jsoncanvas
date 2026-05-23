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

### Strategic direction

The library is structured to allow `src/core/` to be replaced by a Rust
crate exposed via JSI (native) and `wasm-bindgen` (web) in a future major
version. The renderer (`src/renderer/`) stays in TypeScript. See
[`docs/rust-core-port-plan.md`](docs/rust-core-port-plan.md) for the
sub-issue decomposition and open architectural questions tracked under
[#6](https://github.com/workspace-sh/react-native-jsoncanvas/issues/6).

### Example apps

Example harnesses live under `example/` and follow the org's standard layout
(mirrors `react-native-source-editor/example/*`):

- **`example/expo-app/`** — Expo SDK 55 host serving iOS + Android. Uses Expo
  CNG, owned by `expo prebuild` — never run `pod install` (iOS) or hand-edit
  `android/` here manually.
- **`example/macos-app/`** — `react-native-macos` 0.81 host. Tracked in #21.

Each example imports the library through Metro's `extraNodeModules` mapping
back to repo root. Edits to `src/` hot-reload via Metro's watcher.

All commands run from the repo root:

```sh
# iOS
npm run ios:run              # First run: full Xcode build + sim launch
npm run ios:start            # Metro only (build already exists)
npm run ios:clear            # watchman watch-del-all + reset Metro cache
npm run ios:dev              # concurrently: clear + run
npm run ios:run:device       # tethered iOS device
npm run ios:prebuild         # regenerate ios/ from app.json (CNG)
npm run ios:clean            # delete ios/ — pair with :prebuild

# Android (same surface)
npm run android:run
npm run android:start
npm run android:dev
# … etc.
```

(macOS scripts arrive with #21.)

