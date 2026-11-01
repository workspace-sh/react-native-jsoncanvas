// Set true for a build that runs the benchmark as it opens (Bench.tsx), so it
// runs without anyone touching the app. Kept false in the repository.
export const BENCH_AUTORUN = false;

/** With BENCH_AUTORUN: mount and unmount the canvas this many times first, then show it (a remount must still draw). */
export const BENCH_REMOUNTS = 0;
