# @workspace.sh/react-native-jsoncanvas

A React Native renderer for [JSON Canvas](https://jsoncanvas.org/) — the open file format for infinite-canvas notes, originally from Obsidian.

Drop a `.canvas` file in and you get a panning, pinch-zooming canvas with text nodes, file nodes (markdown, images, PDFs), grouped nodes, and connecting edges. Gestures are tuned with Skia and Reanimated for 60fps on iOS, macOS, and Android. The library exposes imperative controls for fit-to-viewport and recentre, plus an extension surface for community conventions like Obsidian cssclasses and callouts.

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

## Platforms & gestures

The same `<CanvasView />` works across iOS, Android, and macOS. **You don't
need to wire up any platform-specific gesture handling** — the library
ships every gesture it supports as a default.

| Gesture                       | iOS | Android | macOS |
|-------------------------------|-----|---------|-------|
| Pinch to zoom                 | ✓   | ✓       | ✓ (trackpad pinch) |
| Pan / drag                    | ✓   | ✓       | ✓ (click-and-drag) |
| Two-finger trackpad pan       | —   | —       | ✓ |
| Double-tap to zoom-to-node    | ✓   | ✓       | ✓ (trackpad two-finger double-tap, a.k.a. Smart Zoom) |
| Inertial fling                | ✓   | ✓       | — (macOS pan is direct, no inertia) |

### iOS / Android (Expo or bare RN)

Install the library and its peer deps; that's it. All gestures run
through `react-native-gesture-handler` + `react-native-reanimated`. No
native module setup, no Xcode / Android Studio edits.

```sh
npm install @workspace.sh/react-native-jsoncanvas \
  @shopify/react-native-skia \
  react-native-gesture-handler \
  react-native-reanimated \
  react-native-worklets
```

Expo: works in any SDK that supports the peer-dep range. Use
`expo install` if you prefer Expo's version-pinning. No native config
needed in `app.json`.

### macOS (`react-native-macos`)

RNGH on macOS can't see trackpad multi-finger gestures
([RNGH-macos limitation](https://github.com/software-mansion/react-native-gesture-handler)),
so the library ships a small Swift `RCTEventEmitter` module
(`WorkspaceJsonCanvasGesture`) that hooks the raw AppKit event stream
(`NSEvent.smartMagnify`, `NSEvent.scrollWheel`) and forwards events to
the renderer. **It's autolinked via `react-native-jsoncanvas.podspec` —
the only thing you do as a consumer is run `pod install`.**

```sh
cd macos && pod install
```

After that, the canvas gets two-finger pan and Smart Zoom for free.
There is no JS-side opt-in, no `<GestureHandlerRootView>` requirement
beyond what RNGH already needs, and no platform flag to flip.

#### Escape hatch: bring-your-own scroll bridge

If your app already ships its own scroll-wheel native module (Workspace
does — its bridge is scoped to a specific `NSView` so the sidebar
doesn't double-trigger), `CanvasView` will prefer it. The convention is:

- Register a `RCTEventEmitter` named `ScrollWheelBridge`.
- Emit `onScrollWheel` events with `{ deltaX: number, deltaY: number }`.

When present, the library's own scroll-wheel monitor stays installed but
the renderer listens to your bridge instead. You don't need to disable
anything; it's a runtime preference.

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

### Example apps

Example harnesses live under `example/` and follow the org's standard layout
(mirrors `react-native-source-editor/example/*`):

- **`example/expo-app/`** — Expo SDK 55 host serving iOS + Android. Uses Expo
  CNG, owned by `expo prebuild` — never run `pod install` (iOS) or hand-edit
  `android/` here manually.
- **`example/macos-app/`** — `react-native-macos` 0.81 host. Tracked in #21.

Each example imports the library through Metro's `extraNodeModules` mapping
back to repo root. Edits to `src/` hot-reload via Metro's watcher.

All commands run from the repo root. Scripts follow
`<form-factor>:<platform>:<mode>` — Metro and dep-install are
platform-agnostic (Metro is just a JS bundler), so they collapse to
the form-factor level; build/run is platform-specific.

```sh
# Shared across iOS and Android (one expo-app, one Metro bundle)
npm run mobile:install                  # npm install for example/expo-app
npm run mobile:start                    # Metro only (after a build exists)
npm run mobile:clear                    # watchman + Metro --reset-cache

# iOS
npm run mobile:ios:dev                  # concurrently: mobile:clear + mobile:ios:run
npm run mobile:ios:run                  # Xcode build + sim launch
npm run mobile:ios:run:device           # tethered iOS device
npm run mobile:ios:run:device:release   # release on tethered device
npm run mobile:ios:prebuild             # regenerate ios/ from app.json (CNG)
npm run mobile:ios:clean                # delete ios/ — pair with :prebuild

# Android (same surface)
npm run mobile:android:dev
npm run mobile:android:run
npm run mobile:android:run:device
npm run mobile:android:prebuild
npm run mobile:android:clean
```

### Playground app (macOS)

A bare-RN + `react-native-macos` harness lives at `example/macos-app/`.
Sibling to the Expo playground; same `CanvasView` + Fit / Recenter shape
and same `hesprs-demo` fixture, but in a vanilla macOS window rather
than Expo.

The native `macos/` scaffold ships with the repo (lifted from the
known-good [`enriched-markdown-macos-harness`](https://github.com/workspace-sh/enriched-markdown-macos-harness)
template — see `example/macos-app/README.md` for the why). No
`react-native-macos-init` step required.

From the repo root:

```sh
# Shared across all desktop platforms (only macos today)
npm run desktop:install         # npm install for example/macos-app (--legacy-peer-deps)
npm run desktop:start           # Metro only on port 8083
npm run desktop:clear           # watchman + Metro --reset-cache

# macOS
npm run desktop:macos:dev       # concurrently: desktop:clear + desktop:macos:run
npm run desktop:macos:run       # xcodebuild + launch (Metro must be running)
npm run desktop:macos:pods      # pod install inside macos/
npm run desktop:macos:clean     # rm macos/build + macos/Pods (cold rebuild)
```

The full first-time setup, in order:

```sh
npm run desktop:install         # postinstall: symlink react-native into example/macos-app
npm run desktop:macos:pods      # generate Pods/ from the Podfile
npm run desktop:macos:dev       # Metro + xcodebuild + launch
```

Port `8083` matches Workspace's `desktop:*` convention, leaving `8082`
free for the Expo playground when both are running. React-version
isolation is handled in `example/macos-app/metro.config.js` —
`react-native-macos@0.81` pins `react@19.1.4` exact, the Expo playground
uses `react@19.2.0`, and Metro forces this app's local copy to win every
resolution.

