# Migrating from `@workspace.sh/canvas-{ui,core}`

This library is the successor to Workspace's internal `@workspace.sh/canvas-ui` + `@workspace.sh/canvas-core` packages. The renderer is the same architecture (Skia + Reanimated), the public surface is a strict superset, and migration is mechanical — package rename, import path consolidation, one prop name, and a peer-dep floor check.

## TL;DR

```diff
- "@workspace.sh/canvas-ui": "*",
- "@workspace.sh/canvas-core": "*",
+ "@workspace.sh/react-native-jsoncanvas": "*",
```

```diff
- import { CanvasView, type ColorScheme } from '@workspace.sh/canvas-ui';
- import { parseCanvas, type CanvasNode } from '@workspace.sh/canvas-core';
+ import {
+   CanvasView,
+   type ColorScheme,
+   parseCanvas,
+   type CanvasNode,
+ } from '@workspace.sh/react-native-jsoncanvas';
```

```diff
  <CanvasView
    content={file.contents}
-   leftInsetSV={sidebarWidthSV}
+   leftOverlayWidth={sidebarWidthSV}
  />
```

That's it. Read on for the full surface map and the why.

## Package consolidation

The old split — pure-TS `canvas-core` and React-Native `canvas-ui` — has collapsed into one package. The internal directory split is the same (`src/core/` vs `src/renderer/`); only the package boundary moved. There's no separate core package to install anymore.

Everything that was exported from `@workspace.sh/canvas-core` and `@workspace.sh/canvas-ui` is re-exported from `@workspace.sh/react-native-jsoncanvas`. The library's `src/index.ts` was written to mirror the union of the two old `index.ts` files exactly, so any consumer import lifts one-to-one.

## Renames

### `leftInsetSV` → `leftOverlayWidth` (prop + callback parameters)

The only public-facing rename. Same type, same semantics — width of an opaque overlay along the left edge of the canvas (Workspace's NSSplitView sidebar is the canonical case). Renamed because "inset" was vague (CSS-y) and the `SV` suffix duplicated information already in the type signature.

| Before | After |
|--------|-------|
| `<CanvasView leftInsetSV={sidebarWidthSV} />` | `<CanvasView leftOverlayWidth={sidebarWidthSV} />` |
| `controls.fitToViewport(leftInset)` | `controls.fitToViewport(leftOverlayWidth)` |
| `controls.recenter(leftInset)` | `controls.recenter(leftOverlayWidth)` |

The callback parameters are positional, so existing call sites like `canvasControlsRef.current?.fitToViewport(sidebarWidth)` keep working without source changes — the rename is only visible in TS intellisense + JSDoc.

## Peer dependency floors

The library targets a newer baseline than the old packages. Bumps:

| Peer | Old floor | New floor |
|------|-----------|-----------|
| `@shopify/react-native-skia` | `>=1.0.0` | `>=2.5.0` |
| `react` | `*` | `>=19.0.0` |
| `react-native` | `*` | `>=0.81.0` |
| `react-native-gesture-handler` | `>=2.0.0` | `>=2.30.0` |
| `react-native-reanimated` | `>=3.0.0` | `>=4.0.0` |
| `react-native-worklets` | (n/a) | `>=0.7.0` (new — split from reanimated in v4) |

Workspace's `apps/desktop` and `apps/mobile` lockfiles are already above these floors as of writing; no action needed beyond `npm install`.

## Native module compatibility

Workspace ships its own macOS native modules under `apps/desktop/macos/desktop-macOS/NativeModules/`:

- **`ScrollWheelBridge`** (RCTEventEmitter, emits `onScrollWheel`, `onSmartMagnify`, `onSidebarWidthChange`)
- **`CanvasScrollInterceptor`** (NSView subclass intercepting scroll + smart-magnify events)

These keep working. The library's runtime detects `NativeModules.ScrollWheelBridge` at startup and **prefers it** over the library's own autolinked bridge for both `onScrollWheel` and `onSmartMagnify` events. The `??` chain in `CanvasView`:

```ts
const source = scrollWheelEvents ?? jsonCanvasGestureEvents;
```

No double-firing, no opt-out flag needed.

`leftOverlayWidth.value` is read by the library when handling smartMagnify events to **drop taps that land inside the sidebar overlay zone** — even if the consumer's bridge would otherwise route them through. This means double-tapping the sidebar will no longer accidentally fire a canvas zoom-to-node against the node sitting underneath.

## Behavioural improvements over the old packages

While migrating, you'll also pick up these changes that don't have equivalents in the old `canvas-ui`:

- **Picture overlay during camera animations** (#35) — `fitToViewport` / `recenter` / `zoom-to-node` tweens now ride the pre-recorded SkPicture overlay, same machinery as pinch. Live tree underneath stops re-painting at every interpolated scale.
- **macOS viewport culling re-enabled** (#35) — the inherited `Platform.OS === 'macos'` early-return is gone. Padding multiplier is 5× on desktop (vs 3× mobile) to absorb pointer-driven movement between dead-zone-gated cull recomputes.
- **Cull suppression during tweens** — `useViewportCulling`'s dead-zone reaction short-circuits while a camera animation is in flight (driven by an `isCameraAnimating` SharedValue), with one explicit recompute at tween-end. Eliminates mid-animation React re-renders.
- **smartMagnify auto-localised via `measureInWindow`** — the library captures the canvas view's window-origin on every layout pass and subtracts before world-coord conversion. Consumers with chrome (sidebar, title-bar inset) get correct hit-testing without manual offset bookkeeping. Backward-compatible: full-window canvases see origin (0, 0) and behave unchanged.
- **Click-and-drag Y inversion removed on macOS** — direct-manipulation behaviour now matches mobile and every other macOS canvas app.

## What stays the same

- The renderer architecture: single Skia `<Canvas>`, camera matrix driven by Reanimated shared values, gesture pipeline on the UI thread.
- Skia + Reanimated peer-dep contract.
- The `<CanvasView />` prop surface (modulo the one rename above).
- The `onReady({ fitToViewport, recenter, getLastAction })` callback shape.
- The `activateScrollWheel` / `deactivateScrollWheel` exports.
- All node renderers (`TextNodeContent`, `LinkNodeContent`, `FileNodeContent`, `GroupNodeContent`), `EdgeRenderer`, `CanvasMinimap`, `CanvasNodeView`, `SkiaCanvasLayer`.
- All core types (`CanvasNode`, `CanvasEdge`, `CanvasDocument`, etc.) and functions (`parseCanvas`, `serializeCanvas`, `createCanvasState`, `createSpatialIndex`, `createCommandHistory`).

## Migration checklist

For Workspace's `apps/desktop` and `apps/mobile`:

- [ ] `package.json` — replace `@workspace.sh/canvas-{ui,core}` with `@workspace.sh/react-native-jsoncanvas`.
- [ ] `npm install` (or `yarn`).
- [ ] Find-replace imports: `from '@workspace.sh/canvas-ui'` → `from '@workspace.sh/react-native-jsoncanvas'`, same for `canvas-core`.
- [ ] Find-replace prop name: `leftInsetSV={` → `leftOverlayWidth={`.
- [ ] Build, run, verify gestures + sidebar avoidance.
- [ ] Remove the old `packages/canvas-ui` and `packages/canvas-core` directories from the monorepo.
- [ ] Drop the workspaces entries from the root `package.json`.

## What's NOT in this library

For clarity, things that lived in `apps/desktop` / `apps/mobile` (not `canvas-ui`) and stay where they are:

- `ScrollWheelBridge.swift` / `CanvasScrollInterceptor.swift` / other macOS native modules — host-app concern, app keeps them.
- `Sidebar.tsx`, `DocumentPane.tsx`, the rest of the desktop shell — app concern.
- File-opening UI / native picker (we have an Obj-C example of one in `example/macos-app/macos/jsoncanvas-macOS/FilePicker.m` if you want a template; it lives in the example app, not the library).
- Routing, persistence, the workspace data model.

The library is the renderer + the core; the host owns everything else.
