// A JSON Canvas of `count` mixed nodes, for the renderer's benchmark: groups
// holding text cards (markdown with headings, lists and inline styles), link
// cards, a few image files (a PNG and an SVG, loaded once and cached), and
// edges between neighbours, some labelled. Laid out on a grid, as real
// canvases tend to be, so a camera sweep crosses dense and sparse parts.

/** The images file nodes show: raster files taken in turn, and one SVG. */
export interface CanvasImages {
  rasters: string[];
  svg: string;
}

/** The benchmark's: one PNG and one SVG on the web. */
const WEB_IMAGES: CanvasImages = {
  rasters: ['https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png'],
  svg: 'https://github.com/hesprs/json-canvas-viewer/raw/main/assets/logo.svg',
};

const TEXTS = [
  '# Release plan\nShip the **canvas** renderer with *Graphite*, then measure.',
  '- Pinch and pan\n- Text with `code`\n- [A link](https://jsoncanvas.org)',
  '## Notes\nA longer paragraph that wraps across several lines, so the paragraph builder has real work to do when it lays the card out at this width.',
  '**Bold**, *italic*, ~~struck~~ and `inline code` in one sentence.',
  '1. First\n2. Second\n3. Third, with a longer line that wraps',
];

/** Deterministic, so every run and both renderers draw the same canvas. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function generateCanvas(count: number, seed = 1, images: CanvasImages = WEB_IMAGES): string {
  const next = random(seed);
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const columns = Math.ceil(Math.sqrt(count));
  const cellW = 320;
  const cellH = 220;
  const colours = ['1', '2', '3', '4', '5', '6'];
  // A group around each 5x5 block of cards.
  for (let gy = 0; gy < Math.ceil(columns / 5); gy++) {
    for (let gx = 0; gx < Math.ceil(columns / 5); gx++) {
      nodes.push({id: `g${gx}-${gy}`, type: 'group', label: `Area ${gx + 1}.${gy + 1}`, x: gx * 5 * cellW - 20, y: gy * 5 * cellH - 40, width: 5 * cellW, height: 5 * cellH, color: colours[(gx + gy) % colours.length]});
    }
  }
  for (let i = 0; i < count; i++) {
    const x = (i % columns) * cellW;
    const y = Math.floor(i / columns) * cellH;
    const kind = next();
    const id = `n${i}`;
    if (i % 97 === 0) nodes.push({id, type: 'file', file: i % 194 === 0 ? images.rasters[(i / 194) % images.rasters.length]! : images.svg, x, y, width: 260, height: 180});
    else if (kind < 0.12) nodes.push({id, type: 'link', url: 'https://jsoncanvas.org', x, y, width: 260, height: 120});
    else nodes.push({id, type: 'text', text: TEXTS[i % TEXTS.length], x, y, width: 260, height: 160, ...(kind > 0.8 ? {color: colours[i % colours.length]} : {})});
    // An edge to the right-hand and the lower neighbour, now and then.
    if (i % columns !== columns - 1 && next() < 0.35) edges.push({id: `e${i}r`, fromNode: id, fromSide: 'right', toNode: `n${i + 1}`, toSide: 'left', ...(next() < 0.3 ? {label: 'next'} : {})});
    if (i + columns < count && next() < 0.2) edges.push({id: `e${i}d`, fromNode: id, fromSide: 'bottom', toNode: `n${i + columns}`, toSide: 'top'});
  }
  return JSON.stringify({nodes, edges}, null, '\t');
}
