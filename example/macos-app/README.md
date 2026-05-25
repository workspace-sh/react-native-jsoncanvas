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
Podfile, AppDelegate, NativeModules) has to be generated once. The
recommended upstream tool (`react-native-macos-init`) currently has
three compatibility issues we hit when validating from inside this
workspace:

1. **`react-native-macos-init` doesn't run inside npm workspaces**.
   It internally calls `npm install` which errors with `ENOWORKSPACES`.
   `--no-workspaces` doesn't get propagated into the tool's own
   subprocess.
2. **Peer-dep resolution conflict**. The community RN 0.81 template
   installs `react@19.1.0`, but `react-native-macos@0.81.7` peers
   `react@^19.1.4`. Without `--legacy-peer-deps` on the init's npm
   call (also not pluggable through the tool), the install fails
   with `ERESOLVE`.
3. **Node version sensitivity**. The init's template generator calls
   `util.styleText`, which only exists on Node ≥ 20.12. If `npx`
   resolves a Node binary older than that (which it can, depending on
   your `nvm` / system Node setup), generation fails partway through
   with empty output directories.

Until upstream fixes these (Microsoft RN-macOS team is aware of #1
and #3 per their issue tracker), the manual procedure is:

```sh
# 1. Bootstrap a fresh RN project OUTSIDE this monorepo so npm
#    workspaces doesn't interfere.
mkdir -p /tmp/rnm-bootstrap && cd /tmp/rnm-bootstrap
npx @react-native-community/cli@latest init macosapp \
  --template @react-native-community/template@0.81.0 \
  --skip-install --skip-git-init --pm npm
cd macosapp

# 2. Install with --legacy-peer-deps to dodge the react@19.1.0 vs
#    19.1.4 peer-dep conflict; ensure Node ≥ 20.12 is active.
node --version  # must be >= 20.12
npm install --legacy-peer-deps

# 3. Run init. The `styleText` errors are noisy but file generation
#    completes on Node 20.12+.
npx react-native-macos-init

# 4. Copy the generated macos/ back into this repo's example/macos-app/.
cp -R macos /path/to/react-native-jsoncanvas/example/macos-app/macos

# 5. Find-and-replace any references to `macosapp` in the copied files
#    with this app's actual name (the bundle id, Xcode scheme, etc.).
#    grep -r macosapp /path/to/example/macos-app/macos
```

Once `macos/` exists in `example/macos-app/`, run from the **repo
root**:

```sh
cd /path/to/react-native-jsoncanvas
npm run desktop:pods   # pod install inside example/macos-app/macos/
npm run desktop:macos  # Metro on 8083 + xcodebuild + launch
```

The `desktop:install` script at root uses `--legacy-peer-deps` to
match the conditions the bootstrap step assumes.

This whole dance is upstream-tooling friction, not anything we can
fix in this repo. If you don't need a macOS harness right now, the
Expo playground (`example/expo-app/`) covers iOS / Android / web
without any of this pain.

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
