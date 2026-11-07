// Set true for a build that runs the benchmark as it opens (Bench.tsx), so it
// runs without anyone touching the app. Kept false in the repository.
export const BENCH_AUTORUN = false;

/** With BENCH_AUTORUN: mount and unmount the canvas this many times first, then show it (a remount must still draw). */
export const BENCH_REMOUNTS = 0;

/** The generated canvases measured, by node count (generateCanvas.ts). */
export const BENCH_SIZES = [500, 2000, 5000, 10000];

/**
 * A folder (a file:// URI ending in `/`) holding workspace-fixtures'
 * Fixtures/canvas images (`portraits/`, `drawings/shapes.svg`), to measure
 * big-10000.canvas as well: the 10,000-node canvas with those images in place
 * of the web ones, which is what that fixture is (scripts/big-canvas.mts).
 * null leaves it out.
 */
export const BENCH_FIXTURE_DIR: string | null = null;
