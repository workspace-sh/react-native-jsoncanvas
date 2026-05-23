# Canvas Candy — full class catalogue

Decomposing
[#19](https://github.com/workspace-sh/react-native-jsoncanvas/issues/19)
("extend support to the full class catalogue") into a concrete gap
analysis. Output: an enumeration of every class the upstream plugin
defines, marked as **already supported** / **gap** / **deliberately
skipped**, with feasibility notes so each gap can be picked up
independently.

This catalogue is **research output**, not an implementation plan. Each
"gap" row maps to at most one sub-issue's worth of work — sub-issues
get filed once you've signed off on which gaps are worth closing and
which to leave skipped.

## 1. Source

- Upstream plugin: [`TfTHacker/obsidian-canvas-candy`](https://github.com/TfTHacker/obsidian-canvas-candy)
- Canonical class list: [`04 List of Decorations.md`](https://github.com/TfTHacker/obsidian-canvas-candy/blob/main/04%20List%20of%20Decorations.md)
- Our baseline implementation: [`src/renderer/extensions/cssclasses.ts`](../src/renderer/extensions/cssclasses.ts)
- Baseline conformance tests: [`src/renderer/extensions/__tests__/cssclasses.test.ts`](../src/renderer/extensions/__tests__/cssclasses.test.ts) (added in #29)

Methodology: enumerate every class upstream documents, mark match
status against our `mapClasses` switch + parametric regex. A class is
"already supported" if our enrichment produces a `RenderProps` field
for it. "Gap" means upstream defines it; we don't recognise it. "Skip"
means upstream defines it but we deliberately don't intend to port.

## 2. Status overview

| Category | Upstream | Baseline (us) | Gap |
|---|---|---|---|
| Shapes | 3 + `cc-border-squared` overload | 3 + overload | 1 (alias) |
| Card fill | 4 | 4 | 0 |
| Card gradient | 8 (every 45°) | regex: any integer | 0 (we're more permissive) |
| Borders | 11 | 11 | 0 |
| Card rotation | 1 (`cc-rotate-card-45`) | regex: any integer | 0 (we're more permissive) |
| Text rotation | 8 (multiples of 45°) + trailing `l` undocumented | regex: any integer + trailing `l` | 0 (we're more permissive) |
| Text alignment | 1 (`cc-card-center`) | 2 (`cc-card-center` + `cc-callout-center`) | 0 |
| Image handling | 2 | 0 | 2 |
| Callout zone CSS classes | 9 | 0 (we expose zones via block syntax in `callouts.ts`) | 9 — deliberate skip candidates |

## 3. Already supported (no work needed)

### Shapes
- `cc-shape-circle` ✓
- `cc-shape-parallelogram-right` ✓
- `cc-border-squared` ✓ (mapped to `shape: 'rectangle'` — promotes the default rounded-rect to square)

### Card fill
- `cc-card-fill` ✓
- `cc-card-transparent` ✓
- `cc-card-opaque` ✓
- `cc-card-nocolor` ✓

### Borders
- `cc-border-none` / `-dashed` / `-dotted` / `-double` ✓
- `cc-border-rounded` ✓ (mapped to `pill: true`)
- `cc-border-dropshadow` ✓
- `cc-border-top` / `-bottom` / `-left` / `-right` ✓ (additive)

### Parametric (regex-matched, more permissive than upstream)
- `cc-card-gradient-{N}deg` ✓ — upstream documents only multiples of 45° (0, 45, …, 315); our regex accepts any integer
- `cc-rotate-card-{N}` ✓ — upstream documents only `cc-rotate-card-45`; our regex accepts any integer
- `cc-rotate-text-{N}` ✓ — upstream documents 45 through 360 in 45° steps; our regex accepts any integer
- `cc-rotate-text-{N}l` ✓ — trailing-`l` variant, NOT in upstream's documented list. Either ported from Workspace canvas-ui or an experimental variant. **Recommendation:** keep until someone documents it; harmless either way.

### Text alignment
- `cc-card-center` ✓
- `cc-callout-center` ✓ (we treat the same as `cc-card-center`)

## 4. Gaps — net new classes upstream has that we don't

### 4a. `cc-shape-parallelogram` — alias, direct port (XS)

Upstream lists `cc-shape-parallelogram` alongside `cc-shape-parallelogram-right`, without a `-left` companion. Upstream's CSS likely defaults the un-suffixed form to one direction (probably left, matching our `cc-shape-parallelogram-left`).

**Feasibility:** direct port. One additional `case` in `mapClasses`:

```ts
case 'cc-shape-parallelogram':
case 'cc-shape-parallelogram-left':
  props.shape = 'parallelogram-left';
  break;
```

**Open question:** verify upstream's default direction matches our `-left`. If it doesn't, this is `parallelogram-right` and we should alias accordingly.

### 4b. `cc-image-cover` — direct port via existing primitive (S)

Upstream effect: card / image fills its container area, cropping if needed.

We already implement this for **group node backgrounds** via `GroupNode.backgroundStyle: 'cover'` (rendered by `SkiaGroupBackgroundRenderer`). The gap is **exposing the same behaviour through a CSS class on text / file nodes**.

**Feasibility:** direct port. Add to `RenderProps`:

```ts
interface RenderProps {
  …
  imageCover?: boolean;
}
```

Then in `mapClasses`: `case 'cc-image-cover': props.imageCover = true; break;`.

Renderer consumes `renderProps.imageCover` when rendering file-node thumbnails or text-node embedded images — passes through to Skia's `<Image fit="cover">`.

**Effort:** ~10 lines in `cssclasses.ts`, ~10 lines in the file-node renderer, conformance tests in #29's `cssclasses.test.ts`.

### 4c. `cc-image-clip` — new render primitive (M)

Upstream effect: image clipped to the card's boundary (vs. overflowing). For a non-rectangular card (`cc-shape-circle`, parallelogram), the image follows the card's outline rather than spilling into a bounding rectangle.

**Feasibility:** new render primitive. The current `SkiaImageRenderer` doesn't apply a card-shape clip path; it renders within a rect. To honour `cc-image-clip`, the renderer needs to:

1. Compute the card's clip path from `props.shape` (using the same path-derivation logic as `SkiaCardRenderer`)
2. Wrap the image in a Skia `<Group clip={path}>` matching the card shape

The path computation already exists in `SkiaCardRenderer`; this is mostly plumbing.

**Effort:** ~50 lines across `cssclasses.ts`, `SkiaImageRenderer.tsx`, and shared path-derivation helpers. Conformance test for the prop in `cssclasses.test.ts`; visual verification (manual, no automated test).

## 5. Deliberate-skip candidates — callout zone CSS classes

Upstream defines a parallel mechanism to our block-syntax callouts: CSS classes that style "zones" of a card.

| Upstream class | Effect | Our equivalent |
|---|---|---|
| `cc-header` | Card header zone with border | `>[!header]` block syntax (in `extensions/callouts.ts`) |
| `cc-header-noborder` | Same, no border | (not supported) |
| `cc-footer` | Card footer zone with border | `>[!footer]` block syntax |
| `cc-footer-noborder` | Same, no border | (not supported) |
| `cc-label-left` | Left-side label with border | `>[!label-left]` block syntax |
| `cc-label-left-noborder` | Same, no border | (not supported) |
| `cc-label-right` | Right-side label with border | `>[!label-right]` block syntax |
| `cc-label-right-noborder` | Same, no border | (not supported) |
| `cc-callout-center` | Centred callout | We map this to `textAlign: 'center'` — partial overlap |

**Recommendation: skip.** Two reasons:

1. **Redundant with our block-syntax callouts.** Supporting two parallel mechanisms (CSS class via frontmatter AND block syntax in body) for the same visual effect doubles the maintenance surface and confuses consumers ("which one do I use?"). Our block-syntax approach was the chosen path for Workspace's canvas-ui and is the better long-term shape (zones are content concerns, not class concerns).
2. **The `-noborder` variants would also need block-syntax equivalents**, expanding both surfaces.

**Counter-argument:** if a user is importing a canvas authored against the upstream Candy CSS path, our renderer will silently ignore these classes. Their card looks "naked" relative to the original Obsidian view. **Mitigation:** document the mismatch in the README's "What's supported" section, or do a one-time conversion pass (`cc-header` → `>[!header]`) at import time.

**Open question:** confirm skip, or do you want to support both mechanisms for compatibility-import use cases?

## 6. Where we're more permissive than upstream (no work needed)

- Gradient degrees: upstream documents 8 discrete values (every 45°). We accept any integer degree via regex. **No action.**
- Card rotation: upstream documents only `cc-rotate-card-45`. We accept any integer. **No action.**
- Text rotation: upstream documents 8 values (45° through 360° in 45° steps) plus an undocumented trailing `l` variant. We accept any integer + the trailing `l`. **No action.**

These over-supports cost nothing — they're regex matches that would have failed silently anyway under upstream's strict list. If a consumer authors `cc-rotate-text-37`, we'll render it; the upstream plugin would skip it.

## 7. Recommended sub-issue split

Once you've signed off on this catalogue, file:

1. **feat(candy): add `cc-shape-parallelogram` alias** — XS, ~5 lines
2. **feat(candy): support `cc-image-cover` class for text / file nodes** — S, plumbing through to existing Skia image fit
3. **feat(candy): support `cc-image-clip` (card-shape image clipping)** — M, new render primitive
4. **docs(candy): document skipped callout-zone classes + recommend block-syntax migration** — XS, README addition

Total: 3 feature issues + 1 docs issue. Not a single L issue's worth of work — closer to S total once split. Most of #19's original L sizing was the *research* this catalogue resolves.

## 8. Open questions for you

1. Do you confirm the **skip** decision on the 9 callout-zone CSS classes (`cc-header`, `cc-footer`, `cc-label-*` and their `-noborder` variants), or do you want both mechanisms supported for import compatibility?
2. For `cc-shape-parallelogram` — verify the upstream default direction matches our `-left`, or do we need to alias to `-right`?
3. Priority order for the three feature gaps — image-cover first (lowest effort, highest utility) or image-clip first (most visually impactful)?
4. Should we file the four sub-issues now, or wait until at least one consumer asks for these classes?

## 9. What this catalogue is NOT

- **A migration guide for upstream Candy users.** That'd be a separate doc covering naming differences, what to expect, etc. Not in scope here.
- **A spec.** We don't own Canvas Candy — it's an Obsidian plugin convention. If upstream evolves, we re-catalogue.
- **Implementation.** No code in this PR. Sub-issues — if you sign off — produce code; this doc produces the plan.
