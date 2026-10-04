# Canvas Candy: class catalogue

A gap analysis for
[#19](https://github.com/workspace-sh/react-native-jsoncanvas/issues/19)
("extend support to the full class catalogue"): every decoration the
upstream plugin defines, marked **supported** or **gap**.

This is research output, not an implementation plan. It covers the React
Native renderer; the GTK renderer draws no Canvas Candy yet.

## 1. Sources

- Upstream plugin: [`TfTHacker/obsidian-canvas-candy`](https://github.com/TfTHacker/obsidian-canvas-candy)
- Its class list: [`04 List of Decorations.md`](https://github.com/TfTHacker/obsidian-canvas-candy/blob/main/04%20List%20of%20Decorations.md)
- Its behaviour: [`.obsidian/snippets/canvas-candy.css`](https://github.com/TfTHacker/obsidian-canvas-candy/blob/main/.obsidian/snippets/canvas-candy.css).
  Where the list and the CSS disagree, the CSS is what Obsidian does.
- Ours: [`extensions/cssclasses.ts`](../src/renderer/extensions/cssclasses.ts)
  and [`extensions/callouts.ts`](../src/renderer/extensions/callouts.ts),
  with conformance tests beside them in `extensions/__tests__/`.

Upstream has **two mechanisms**, and its list is split the same way:

- **cssclasses decorations** go in a card's YAML frontmatter
  (`cssclasses: cc-shape-circle`). Ours: `cssclasses.ts`.
- **callout decorations** are Obsidian callouts in the card's body
  (`>[!cc-header] Title`). Ours: `callouts.ts`.

## 2. Status overview

| Category | Mechanism | Upstream | Supported | Gap |
|---|---|---|---|---|
| Shapes | cssclasses | 3 | 3 | 0 |
| Card fill | cssclasses | 4 | 4 | 0 |
| Card gradient | cssclasses | 8 (every 45°) | any integer | 0 |
| Borders | cssclasses | 11 | 11 | 0 |
| Card rotation | cssclasses | 1 (`cc-rotate-card-45`) | any integer | 0 |
| Text rotation | cssclasses | 8 (every 45°) | any integer | 0 |
| Text alignment | cssclasses | 1 (`cc-card-center`) | 1 | 0 |
| Header, footer and label zones | callouts | 8 | 8 | 0 |
| Centred callout | callouts | 1 | 1 | 0 |
| Image callouts | callouts | 2 | 0 | **2** |
| Stickers | file name | 1 convention | 0 | **1** |

## 3. Supported

### cssclasses

- Shapes: `cc-shape-circle`, `cc-shape-parallelogram-left`,
  `cc-shape-parallelogram-right`
- Card fill: `cc-card-fill`, `cc-card-transparent`, `cc-card-opaque`,
  `cc-card-nocolor`
- Borders: `cc-border-none`, `-dashed`, `-dotted`, `-double`, `-rounded`,
  `-squared`, `-dropshadow`, and `-top`, `-bottom`, `-left`, `-right`
  (additive)
- Gradient: `cc-card-gradient-{N}deg`
- Rotation: `cc-rotate-card-{N}`, `cc-rotate-text-{N}`
- Alignment: `cc-card-center`

A note on `cc-shape-parallelogram`: upstream's list names it, without a
suffix, next to `cc-shape-parallelogram-right`. Its CSS defines only
`.cc-shape-parallelogram-left` and `.cc-shape-parallelogram-right`, so the
unsuffixed class does nothing in Obsidian either. The list entry is a typo
for `-left`. Nothing to port.

### callouts

- `>[!cc-header]`, `>[!cc-footer]`, `>[!cc-label-left]`,
  `>[!cc-label-right]`, each with its `-noborder` variant
- `>[!cc-callout-center]`

`callouts.ts` lifts each into a layout zone and removes the marker from the
card body. `callouts.test.ts` asserts this against the demo cards from
upstream's *Headers and Labels.canvas*.

### Where we accept more than upstream

- Gradient, card rotation and text rotation match by regex, so any integer
  works. Upstream's CSS defines only the angles its list names.
- `cc-rotate-text-{N}l`, with a trailing `l`, is ours. Upstream has no such
  class.
- `cc-callout-center` is also accepted as a cssclass, where it behaves as
  `cc-card-center`.

None of these needs work.

## 4. Gaps

### 4a. Image callouts: `cc-image-cover` and `cc-image-clip`

Upstream:

```md
>[!cc-image-cover] ![[photo.png]]
```

Upstream calls this "use an image background": the image in the callout's
title is laid behind the card's text, and the callout's own chrome is
removed. (Upstream's *Features/Cards.canvas* files these two under
cssclasses, but its CSS matches them only as callouts.) `cc-image-cover` sets
`object-fit: cover`: the image fills the card, cropped to keep its aspect
ratio. `cc-image-clip` sets `object-fit: clip`, which isn't a valid value,
so browsers fall back to the default (`fill`): the image is stretched to
the card.

Ours today: `callouts.ts` doesn't know either type, so the callout stays in
the body, and the card shows the raw text
`[!cc-image-cover] ![[photo.png]]`.

To close it, `callouts.ts` would recognise both types and carry the image
reference, and both rendering paths (the live Skia tree and the Picture
recording) would draw it as a card background. Group nodes already draw a
background image with `cover` (`SkiaGroupBackgroundRenderer`); that is the
nearest existing code.

### 4b. Stickers: file names containing `-cc-image`

Upstream removes the border, background and label from an image file node
whose file name contains `-cc-image`, so the image sits on the canvas as a
sticker. It isn't in upstream's class list because it isn't a class; see
*Features/Stickers.canvas*.

Ours today: no special case. The image draws as an ordinary file node.

## 5. Related, and separate

[#20](https://github.com/workspace-sh/react-native-jsoncanvas/issues/20)
tracks a different mechanism: cssclasses in the frontmatter of a markdown
*file* that a file node embeds. Nothing here covers it.

## 6. Open questions

1. Are the two gaps worth closing now, or only once a canvas that uses them
   turns up?
2. If both: image callouts first, or stickers first?
