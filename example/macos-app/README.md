# macOS playground

Minimal bare-RN + `react-native-macos` harness for smoke-testing
`@workspace.sh/react-native-jsoncanvas` on macOS. Sibling to
`../expo-app/`, which covers iOS / Android / web through Expo CNG.

Mirrors the App shape of the Expo playground — a single `CanvasView`
with Fit / Recenter buttons and a "last action" status pill. Renders
the same `hesprs-demo` fixture.

## Setup

The native `macos/` scaffold ships with this repo, lifted from
[`enriched-markdown-macos-harness`](https://github.com/workspace-sh/enriched-markdown-macos-harness)
(another workspace-sh repo that solved the same `react-native-macos-init`
upstream incompatibilities — workspaces `ENOWORKSPACES`, peer-dep
`ERESOLVE`, Node-version `styleText` brittleness — and produced a
known-good template). Only display name (`CFBundleName`) and bundle
identifier (`PRODUCT_BUNDLE_IDENTIFIER`) were customised. AppDelegate
still registers `@"workspace"` as the module name, and our `app.json`
matches.

From the **repo root**:

```sh
npm run desktop:install   # install workspace deps (--legacy-peer-deps)
npm run desktop:pods      # pod install inside macos/
npm run desktop:macos     # Metro on 8083 + xcodebuild + launch
```

That's it. No `react-native-macos-init` required.

## Day-to-day

```sh
npm run desktop:start     # Metro only (after the app is already built)
npm run desktop:clear     # watchman watch-del-all + Metro --reset-cache
npm run desktop:clean     # rm macos/build + macos/Pods (cold rebuild)
npm run desktop:dev       # concurrently: clear + macos
```

Port `8083` matches Workspace's `desktop:*` convention and leaves
`8082` free for the Expo playground when both run.

## React version isolation

`react-native-macos@0.81` requires `react@19.1.4` *exactly*. The Expo
playground is on `react@19.2.0`. `metro.config.js` here uses
`extraNodeModules` + an anchored `blockList` regex to force this app's
local `react@19.1.4` to win every resolution, no matter where the Expo
playground sits in the monorepo's node_modules tree.

## What this harness is, deliberately

- **Vanilla bare RN window.** Default `RCTRootView`, default
  `AppDelegate`, default `Info.plist`. No custom title bar or sidebar.
- **One screen.** `App.tsx` renders `CanvasView` against the same
  `hesprs-demo` fixture the Expo playground uses, with Fit / Recenter
  buttons that drive the `onReady` controls.
- **Shared library via `file:../..`.** Metro symlinks back to the
  library root; edits in `src/` hot-reload here.

## What this harness is NOT

If you find yourself reaching for any of the below, that's a sign
you're building a product, not a smoke test:

- ❌ NSSplitViewController / sidebar
- ❌ Custom title bar / unified toolbar
- ❌ Native bridges (`SidebarBridge`, `ScrollWheelBridge`,
  `CanvasControlsBridge`, file pickers)
- ❌ Zustand store / persistence
- ❌ Anything that touches the canvas's `leftInsetSV` prop or the
  macOS scroll-wheel pipeline

Those are app-specific concerns. They live in `apps/desktop` in
Workspace, not here.

## macOS double-tap-to-zoom

PR [#34](https://github.com/workspace-sh/react-native-jsoncanvas/pull/34)
adds JS-side support for Safari's Smart Zoom (two-finger trackpad
double-tap) via a native `onSmartMagnify` event on `ScrollWheelBridge`.
This harness does **not** wire up the Swift side of that bridge —
you'd need to add a `CanvasScrollInterceptor.swift` that overrides
`smartMagnify(with:)` and posts an `onSmartMagnify` event. Reference
implementation: Workspace's
[`apps/desktop/macos/desktop-macOS/NativeModules/CanvasScrollInterceptor.swift`](https://github.com/workspace-sh/workspace/blob/develop/apps/desktop/macos/desktop-macOS/NativeModules/CanvasScrollInterceptor.swift).

Without the Swift bridge, you'll see single-finger taps doing nothing
on macOS (intentional per PR #34) and two-finger taps not zooming
either (the JS listener is there but nothing fires it). The renderer
itself works fine — pan, pinch, fit / recenter all do.
