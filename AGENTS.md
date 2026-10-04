# react-native-jsoncanvas: agent notes

A JSON Canvas (`.canvas`) renderer with three layers on one document model:

- `src/core/`: spec-pure JSON Canvas (parser, serialiser, spatial index, state, colour presets). No React, no rendering, and no community conventions such as cssclasses or callouts.
- `src/renderer/`: the React Native renderer (Skia + Reanimated) for iOS, Android and macOS, consumed from the package root.
- `src/gtk/`: the GTK4 / libadwaita renderer (Cairo, through GTKX) for Linux, consumed as `./gtk`.

Workspace consumes all three. Issue numbers written `workspace#N` are in workspace-sh/workspace.

## Checks

```sh
npm test           # jest: src/**/__tests__
npm run typecheck  # tsc --noEmit (leaves src/gtk out)
npm run lint       # eslint src
```

Nothing here can typecheck or test `src/gtk`: GTKX generates its bindings (`@gtkx/gi/*`, `@gtkx/jsx/*`) inside the consuming app. Workspace's Linux client (`apps/linux`) does both: `yarn workspace linux run check`, plus `scripts/headless-shot.sh` (with `SCHEME=dark` for the other scheme) for a picture. A change to `src/gtk` isn't verified until that has run.

## GTK renderer (`src/gtk/`)

- `src/gtk/package.json` declares `"type": "module"`, because GTKX is ESM-only and the rest of this package is CommonJS-mode TypeScript. So relative imports there carry `.js` extensions.
- GTKX elements come from `@gtkx/jsx/<namespace>`, and classes and enums from `@gtkx/gi/<namespace>`. Signal callbacks omit `self` unless they need it. Never infer a prop from C, PyGObject or GJS; the consuming app's `.gtkx/reference/index.md` is the authority.
- Anything Cairo paints must be told the colour scheme. `CanvasView` takes `colorScheme` and otherwise follows `Adw.StyleManager` live (`useCanvasColorScheme`). Keep that fallback: a libadwaita app gets a matching canvas with no wiring.
- Icon names must exist in the Adwaita icon theme.
- `@gtkx/react` and `@gtkx/cairo` are optional peers, so React Native installs don't fetch them. A consumer that links a checkout of this repo must point its peers at its own copies: Vite `resolve.dedupe` (React and `@gtkx/*`) and matching tsconfig `paths`. Without them it gets this checkout's React (hooks fail) and no GTKX at all.
- It draws less than Skia: no markdown in text nodes, images, Canvas Candy, minimap, edge labels or end styles yet. The README says so; keep that list current.

## React Native renderer (`src/renderer/`)

### Enrichment

- `extensions/cssclasses.ts` and `extensions/callouts.ts` enrich nodes with rendering properties. They are lazy: `hasCssClasses()` and `hasCallouts()` check first, so a standard canvas pays nothing.
- Enrichment runs once, through `useMemo` in `SkiaCanvasLayer`, producing the `EnrichedNode[]` every renderer consumes.

### Two rendering paths: keep them in sync

Every rendering change goes into BOTH:
1. **The live Skia tree:** the declarative components in `SkiaCanvasLayer.tsx` and the node renderers.
2. **The imperative Picture recording:** `drawCard`, `drawTextNode` and the rest in `useCanvasPicture.ts`.

If they diverge, the Picture overlay shows something different from the live tree.

### Picture recording (pinch-zoom performance)

- During a pinch, a pre-recorded `SkPicture` overlays the live tree via `<Group opacity={pictureOpacity}>`.
- `isPinching` is a shared value set directly in the pinch worklet: no `runOnJS`, no React reconciliation.
- SVG file images render ABOVE the Picture overlay, for vector fidelity at any zoom.
- The live tree is always mounted, so hooks like `useImage` stay alive. Never unmount it to switch modes.
- Image loading is separate from recording: two separate effects in `useCanvasPicture`.

### Gestures

- The gesture system is stable. Don't touch pan, pinch or scroll-wheel handling without explicit approval.
- Pan has `.maxPointers(1)`, so it only starts with one finger. It is direct manipulation on every platform.
- Pinch `onStart` calls `cancelAnimation` on translateX, translateY and scale before capturing its baseline.
- Pinch `onUpdate` has three guards: the pointer count (fewer than 2 freezes translation), a 30px per-frame focal cap (`PINCH_FOCAL_DELTA_CAP`), and a 10px drift deadzone (`PINCH_DRIFT_DEADZONE`).
- Pinch `onEnd` treats a scale change under 2% as a no-op (`PINCH_NOOP_THRESHOLD`) and restores the pre-pinch state.
- Inertial panning (`withDecay`) is not used on macOS: click-and-drag there has no momentum.
- On macOS, trackpad pan and Smart Zoom come from the `WorkspaceJsonCanvasGesture` Swift module. A consumer's own `ScrollWheelBridge` is preferred when present.

### File-node images

- Resolve relative asset paths with `utils/resolveFileUri.ts` (`resolveFileUri(file, basePath)`). Both rendering paths, the live `SkiaImageRenderer` and `useCanvasPicture`'s raster cache, must call it, so the resolved URIs match exactly.
- `basePath` is passed all the way down: app → `CanvasView` → `SkiaCanvasLayer` → renderers and `useCanvasPicture`. Renderers that touch file content take it as a prop.
- SVGs go through `utils/useValidatedSvg.ts`, never `useSVG` from `@shopify/react-native-skia` directly. The hook fetches the text, checks the `<svg>` root, strips DOCTYPE entities and the document's `width`/`height`, then builds the SVG with `Skia.SVG.MakeFromString`. A failed load shows the "broken image" placeholder from `assets/brokenImageSvg.ts`.
- **Never call `svg.width()` / `svg.height()`** on a Skia SVG. They segfault when the underlying `SkSVGDOM` is null, which happens silently when parsing fails (workspace#122). Pass viewBox-derived dimensions to `<ImageSVG>` as explicit `width` and `height`.

### Markdown in text nodes

- Text-node markdown goes through `unified` + `remark-parse` + `remark-gfm` + `remark-frontmatter` (`markdown/parseToSegments.ts`). HTML inside markdown goes through `hast-util-from-html`, cssclasses frontmatter through `js-yaml`, and callouts come from walking remark blockquote nodes (`extensions/callouts.ts`).
- One preprocessing step on the source string remains: `normaliseEmphasis`, for Obsidian's newline-trailing-marker quirk (workspace#131).
- Inline content walks `PhrasingContent[]`, and block content walks `Content[]`. A new node type has to be handled in both `walkInline` and `walkTree`.
- A host can supply its own markdown component through the `renderMarkdown` prop; the renderer doesn't import one.

### Known limitations

- `<Group clip>` and `<Group transform>` don't apply to children when the Group is inside an element array (workspace#96). They do work at a component's top-level return. Label-only nodes use an early return as a workaround; labels on mixed-zone cards still fall back to horizontal.
- `canvas.drawSvg()` doesn't record into Picture command buffers, so SVGs are left out of the recording and render live above the Picture overlay during a pinch.
- Some valid SVGs (`<text>`, `<foreignObject>`, some filter combinations) parse without error but render empty, because Skia's SVG renderer is incomplete compared with a browser's (workspace#124). There's no reliable way to detect them from their content.

### Other rules

- `CanvasView` exposes `fitToViewport` and `recenter` through its `onReady` callback.
- Never remount the Skia Canvas on macOS: repeated unmount/mount cycles corrupt the Metal GPU context.
