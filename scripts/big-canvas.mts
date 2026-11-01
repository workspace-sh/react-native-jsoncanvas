// Writes the large test canvases for workspace-fixtures (Fixtures/canvas/):
// the benchmark's canvases (example/shared/generateCanvas.ts), with images
// from beside them in place of the web ones.
//
//   npm run fixtures:canvas -- <Fixtures/canvas folder>
//
// Each is `big-<nodes>.canvas`. The same nodes, seed and layout as the
// benchmark, so a canvas opened in an app is the one that was measured.

import {readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {generateCanvas} from '../example/shared/generateCanvas.ts';

const SIZES = [500, 2000, 5000, 10000];

const out = process.argv[2];
if (!out) {
  console.error('Usage: big-canvas.mts <Fixtures/canvas folder>');
  process.exit(1);
}
const rasters = readdirSync(join(out, 'portraits'))
  .filter((name) => /\.(jpe?g|png)$/i.test(name))
  .sort()
  .map((name) => `portraits/${name}`);
if (rasters.length === 0) throw new Error(`No images in ${join(out, 'portraits')}`);
const images = {rasters, svg: 'drawings/shapes.svg'};

for (const nodes of SIZES) {
  const file = join(out, `big-${nodes}.canvas`);
  writeFileSync(file, generateCanvas(nodes, 1, images) + '\n');
  console.log(`${file}: ${nodes} nodes`);
}
