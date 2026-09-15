# Rust core port — plan

Decomposing [#6](https://github.com/workspace-sh/react-native-jsoncanvas/issues/6)
from a single XL block into a sequence of executable chunks. Every section
below ends with a **Recommendation** (my call) and **Open question** (yours
to decide). Once decisions are locked, the proposed sub-issues at the end
of this doc get filed and #6 becomes an umbrella tracker.

This is **not** a commitment to start coding. It's a plan that says "if we
do this, here's the shape; here are the calls we'd need to make first."

## 1. Why

Today `src/core/` is TypeScript: `parseCanvas`, `serializeCanvas`,
`createSpatialIndex`, `createCanvasState`, `createCommandHistory`,
`invertOperation`. All run on the JS thread. For a canvas with 31 nodes /
30 edges (`hesprs-demo`) this is fine. For canvases an order of magnitude
larger — or for hit-testing during pan/pinch where every gesture frame
queries the spatial index — JS-thread cost dominates and a native impl
running off-thread becomes a category change in feel.

The renderer (`src/renderer/`) is staying in TypeScript: Skia + Reanimated
React Native components are the right shape for this layer, and there's no
perf to gain by rewriting them in Rust. The boundary is sharp: **logic
goes to Rust; React components stay in TS**.

Everything in `#2` / `#3` (port from monorepo), `#4` (drop apply-callback),
and `#5` (replace `Partial<CanvasNode>` with explicit variants) was prep:
shaping the TS API so it translates cleanly to a Rust+FFI shape without
losing fidelity. That work is done. The API is now FFI-friendly.

## 2. Scope

### In scope

- Rewrite the contents of `src/core/` in Rust:
  - Types (the `CanvasNode` discriminated union, edges, document)
  - Serialisation (parse + serialise)
  - Spatial index (quadtree)
  - State machine (apply / undo / redo, history, the 12 operation variants)
- Two FFI targets:
  - Native (iOS / Android / macOS) via a binding tool that emits Swift /
    Kotlin / C bindings consumable by React Native's native module system
  - Web via wasm-bindgen
- A thin TS facade in `src/core/` that consumers continue to import as today
  but which delegates to the Rust impl under the hood

### Out of scope

- The renderer (`src/renderer/*`). Stays TS.
- Markdown parsing / `paragraphBuilder`. Stays TS — runs once per text node
  on render, not on the gesture path; cost is acceptable; rewriting the
  unified/remark ecosystem in Rust is its own multi-month effort.
- Editor features (selection, drag, text edit). Not implemented in TS
  either. Comes later.
- The Canvas Candy extension. Stays TS. It's renderer-adjacent and only
  runs at parse time.

## 3. Rollout shape

Three plausible rollouts:

| Rollout | Description | Cost | Risk |
|---|---|---|---|
| **A. Big-bang replacement** | Rust impl ships; TS impl removed; major version bump. | Lowest code maintenance | High — consumers can't fall back if Rust impl regresses |
| **B. Parallel impls behind a flag** | Both impls coexist; consumer opts in via an env var or build flag; TS removed after N minor versions | Higher code maintenance for the overlap window | Low — TS is the safety net |
| **C. Per-function migration** | Migrate one function at a time (parse first, then spatial-index, then state) over multiple minors | Lowest individual change risk | Drags out the work; partial benefit until everything's migrated |

**Recommendation: B.** A 6-month overlap window where both impls coexist.
Default flips from TS to Rust in a minor release; TS removed in the next
major. Consumers always have an escape hatch. Cross-impl conformance tests
(see §6) guarantee they produce identical results.

**Open question 1:** Comfortable with the overlap window, or do you want
to push toward big-bang once the Rust impl passes conformance?

## 4. FFI tooling — native

Three viable options for native (iOS / Android / macOS):

| Option | What it is | Pro | Con |
|---|---|---|---|
| **UniFFI** | Mozilla's tool. Generates Swift / Kotlin / Python / Ruby bindings from a single Rust interface definition. | Mature, well-documented, single source of truth, low Rust expertise required | React Native integration is via [`uniffi-bindgen-react-native`](https://github.com/jhugman/uniffi-bindgen-react-native) — community tool, less mature than core UniFFI |
| **JSI direct** | Write C++ JSI host objects by hand, call Rust via cxx-rs or extern "C". | Maximum performance and flexibility, no codegen surprises | Significant C++ + JSI expertise required; lots of glue code; harder to maintain |
| **React Native Turbo Modules** | RN's modern bridge. Codegen from a TS spec. | First-class RN support; aligns with where RN is going | Doesn't directly target Rust — you write a C++ Turbo Module wrapper around the Rust crate. Same complexity as JSI direct but with codegen on top. |

**Recommendation: UniFFI + `uniffi-bindgen-react-native`.** It's the
lowest-friction path for a small, clearly-defined API surface. If the
RN binding tool hits a wall we drop to JSI direct as a fallback — but
the Rust crate itself stays unchanged, only the binding layer changes.

**Open question 2:** Comfortable with UniFFI as the default, JSI direct
as the escape valve?

## 5. FFI tooling — web

Standard: **`wasm-bindgen`**. No serious alternative. Generates JS bindings
from Rust for browsers. Bundlers (Metro, webpack, Vite) all consume the
output.

The integration question is **how Metro loads the WASM file**. Options:

- Bundle WASM inline as base64 → larger JS bundle, no separate fetch
- Bundle WASM as a separate file → smaller JS, one extra HTTP request at
  startup, needs Metro's asset pipeline tweaked

**Recommendation: separate file.** Standard pattern; works with Metro's
existing asset support; matches how `@shopify/react-native-skia`'s
CanvasKit WASM is loaded for web (which we'll also have to set up for #17
anyway).

## 6. Cross-impl conformance — the safety net

The Rust impl must be byte-equivalent to the TS impl for every input.
Strategy:

1. **Same conformance tests run against both impls.** The 168 tests in
   `src/core/__tests__/` and `src/renderer/extensions/__tests__/` are
   the contract. PR #29 added the spec + Candy baseline coverage; that's
   what the Rust impl has to satisfy.
2. **Test runner picks impl per test run.** Jest config flag chooses
   which impl is mounted at `parseCanvas` etc. CI matrix: `IMPL=ts` and
   `IMPL=rust` rows.
3. **Property-based round-trip tests.** For each `parseCanvas /
   serializeCanvas` impl, generate random valid `CanvasDocument`s and
   assert the round-trip is identity. Catches the long tail of subtle
   differences (e.g. preset-color vs hex-color serialisation).
4. **Differential tests on hesprs-demo + a curated fixture set.** Same
   input through both impls, structural diff on the output. Fast
   regression detector during impl development.

**Recommendation: all four, in that order.** Each tier costs more than the
previous; each catches a different class of regression.

## 7. Native build integration — Expo

The Rust crate needs to compile to per-platform binaries and end up in
the host app's link path. Expo CNG owns the prebuild step. Approach:

1. Write an **Expo config plugin** at
   `plugins/with-jsoncanvas-rust-core.ts` that:
   - Hooks into prebuild
   - Runs `cargo build --target <ios/android-abi>` for the required ABIs
   - Copies the resulting `.a` / `.so` into the right Pods / `jniLibs`
     locations
   - Adds the UniFFI-generated Swift / Kotlin bindings to the Xcode /
     Gradle build
2. Expose the plugin from `@workspace.sh/react-native-jsoncanvas`'s
   package, so consumers add one line to their `app.json` `plugins`
   array.

For the **macOS harness** (#21), the same pattern applies but with the
macOS target triple.

For **bare RN** consumers (Workspace's `apps/desktop`), they don't use
Expo. The plugin doesn't help. Provide a fallback: a `react-native.config.js`
entry that triggers Cargo via a build script in the Podfile / Gradle file.
More fragile but works.

## 8. Decomposition — proposed sub-issues

These get filed once you've signed off on the direction. Each is sized
independently. They're roughly in dependency order; many can run in
parallel.

1. **chore(rust): set up Cargo workspace + jsoncanvas-core crate skeleton** (S) —
   `crates/jsoncanvas-core/`, `Cargo.toml`, lint / fmt config, CI hook,
   empty types module
2. **feat(rust): port types.ts to Rust structs/enums with serde** (S) —
   The `CanvasNode` discriminated union, edges, document. Establishes the
   serde tag convention for the JSON Canvas spec discriminator
3. **feat(rust): port parseCanvas / serializeCanvas** (M) —
   Including the unknown-top-level-fields preservation behaviour (the
   `#[serde(flatten)] extra: HashMap` shape from the FFI audit)
4. **feat(rust): port spatial-index** (M) —
   Quadtree implementation; depth / capacity constants identical to TS
5. **feat(rust): port operations + canvas-state + history** (L) —
   All 12 op variants, `applyOperation`, `invertOperation`, the
   `CanvasCommandHistory` shape
6. **chore(rust): UniFFI interface definition + bindgen for iOS** (M) —
   First binding target. Validates the FFI shape end-to-end on the
   smallest possible surface
7. **chore(rust): UniFFI bindgen for Android + macOS** (S) —
   Same interface, different target triples. Should be mostly
   configuration after #6
8. **chore(rust): wasm-bindgen integration for web** (M) —
   Separate binding tool; same crate as input
9. **feat(rust): TS facade layer** (S) —
   `src/core/` becomes a thin TS shim that imports from the appropriate
   native / wasm binding at runtime. Preserves the existing JS API so
   the renderer doesn't change
10. **chore(rust): Expo config plugin for native builds** (M) —
    Hooks into prebuild, runs Cargo, places artifacts in Pods / jniLibs.
    Updates `example/expo-app` and the macOS harness to use it
11. **test(rust): cross-impl conformance test runner** (S) —
    Jest config that runs the existing 168 conformance tests against the
    Rust impl. CI matrix entry
12. **test(rust): property-based round-trip tests** (S) —
    Random canvas generation; round-trip identity property; runs in
    cargo test (Rust-side) and as part of the cross-impl matrix
13. **feat(rust): opt-in flag for Rust impl (default off)** (S) —
    The TS-vs-Rust selector in the facade layer. Env var or build flag.
    Both impls coexist
14. **docs: migration guide for consumers** (S) —
    What changes when you flip the flag, what to test, what could regress

Total: 14 sub-issues. Sizes: 2 L, 5 M, 7 S. Realistic delivery: 4-8
weeks elapsed with one developer working on it part-time, less with
focused effort.

## 9. Open questions — please answer these before sub-issues get filed

1. **Rollout shape** (§3): parallel-with-flag (B) or push toward
   big-bang (A)?
2. **FFI tooling for native** (§4): UniFFI as default + JSI direct
   fallback, or something else?
3. **Web WASM loading** (§5): separate `.wasm` file (recommended), or
   inline base64?
4. **Scope creep — markdown rendering**: explicitly out of scope per
   §2. Confirm? (If you ever want markdown parsed natively too, that's
   a much bigger commitment — a port of unified/remark or a switch to
   a Rust markdown crate like `comrak` or `pulldown-cmark`.)
5. **Timing**: this is a multi-week effort even with focused work. Is
   the strategic priority high enough to start soon, or does it sit
   while we prove out more of the renderer / harness story?
6. **Maintainer bandwidth for Rust**: do you have the Rust expertise
   on hand, or should this plan assume a contributor / external help?
   The answer changes the realistic timeline significantly.

## 10. What's NOT in this plan

Things that came up while drafting and were deliberately excluded:

- **A bytecode cache for parsed canvases.** Real perf win for large
  canvases — parsing isn't free even in Rust. Worth filing as a
  follow-up after the Rust impl ships.
- **Streaming parse.** For canvases the size of a typical Obsidian
  vault export, parsing the entire JSON before rendering anything
  causes a first-frame stall. A streaming parser is a real
  optimization. Deferred — needs design and is post-1.0.
- **Persistent / mmap'd storage.** SQLite-backed canvas store would
  scale to vault-size documents. Way out of scope; mentioning so it's
  on the record.
- **Multi-canvas state.** Today `CanvasState` is one document. A
  multi-document layer (open tabs, recent files) is a real product
  feature for any consumer building an editor. Stays TS, lives above
  the Rust core boundary.
