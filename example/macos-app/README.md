# macOS playground

Minimal bare-RN + `react-native-macos` harness for smoke-testing
`@workspace.sh/react-native-jsoncanvas` on macOS. Sibling to
`../expo-app/`, which covers iOS / Android / web through Expo CNG.

Mirrors the same App shape as the Expo playground — a single
`CanvasView` with Fit / Recenter buttons and a "last action" status
pill. No NSSplitView, no custom title bar, no Workspace-specific
native modules. The point is to prove the renderer mounts and runs
natively on macOS, not to recreate
[`apps/desktop`](https://github.com/workspace-sh/workspace/tree/develop/apps/desktop).

## First-time setup

This PR ships **only the JavaScript / TypeScript / Metro / Babel
configuration**. The native `macos/` directory (Xcode project,
Podfile, AppDelegate, NativeModules) needs to be generated once, on
a Mac with Xcode + CocoaPods installed:

```sh
cd example/macos-app
# Initialise the native macos/ scaffold via react-native-macos's CLI.
# Use the same major as our react-native dep (^0.81) so AppDelegate
# / Podfile templates match.
npx --package react-native-macos@^0.81 react-native-macos-init
cd macos && pod install
```

Once `macos/` exists, run from the **repo root**:

```sh
npm run desktop:macos
```

This starts Metro on port 8083 (avoids clashing with the Expo
playground's 8082) and launches the macOS app via Xcode.

## What this harness is, deliberately

- **Vanilla bare RN window.** Default `RCTRootView`, default
  AppDelegate, default everything from `react-native-macos init`.
- **One screen.** `App.tsx` renders `CanvasView` against the same
  `hesprs-demo` fixture the Expo playground uses, with Fit / Recenter
  buttons that drive the `onReady` controls.
- **Shared library via `file:../..`.** Metro symlinks back to the
  library root; edits in `src/` hot-reload here.
- **Pinned `react@19.1.4`.** `react-native-macos@0.81` requires this
  exact version. `metro.config.js`'s `extraNodeModules` + `blockList`
  enforce it so the Expo playground's `react@19.2.0` (which sits at
  the monorepo root) doesn't leak in.

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
