// The renderer's benchmark (react-native-jsoncanvas#83): canvases of 500 to
// 10,000 mixed nodes (generateCanvas.ts, benchConfig.ts), each fitted, left to
// settle, then moved by a script while frame times are recorded:
//
// - pinch: 4 s of pinch-zoom about the centre, from the fitted scale;
// - pan: 4 s of pan at the fitted scale;
// - close: 4 s of pan zoomed in 8 times;
// - pinch in: 4 s of zooming in from the fitted scale to 4 times it and
//   back, as fingers spreading from a fitted canvas do (the text is drawn
//   from the first frame: a canvas of 2,000 nodes or more opens at the
//   smallest scale, 0.1, on a phone);
// - double-tap: zooming to the card in the middle and back again, as a
//   double-tap does (a 300 ms ease-out from the JavaScript thread, culling
//   held still until it ends, as CanvasView's own camera animation does).
//
// Frame times are recorded on the UI thread (each frame's time since the
// last) and on the JavaScript thread (requestAnimationFrame), and summed up
// as frames per second, the 95th percentile, and frames over 25 ms (a dropped
// frame at 60 Hz). Skia draws on threads of its own, so what reaches the
// screen is measured outside the app (on Android, `dumpsys gfxinfo`): each
// phase logs its window on the UI thread's clock, as `[BENCH-WIN]`.

import {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, ScrollView, StyleSheet, Text, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {useFrameCallback, useSharedValue, type SharedValue} from 'react-native-reanimated';
import {CanvasView, type CanvasCamera} from '@workspace.sh/react-native-jsoncanvas';
import {generateCanvas, type CanvasImages} from './generateCanvas';
import {SAMPLE_CANVAS} from './fixtures';
import {BENCH_FIXTURE_DIR, BENCH_REMOUNTS, BENCH_SIZES} from './benchConfig';

const SETTLE_MS = 2500;
const PHASE_MS = 4000;
const BUCKETS = 101; // 0–99 ms, and 100 ms or more

/** generateCanvas's grid: each node sits in a cell this size, and a text card is 260 × 160. */
const CELL_W = 320;
const CELL_H = 220;
const CARD_W = 260;
const CARD_H = 160;
/** CanvasView's zoom to a node: its padding, soft maximum scale and duration. */
const NODE_FIT_PADDING = 32;
const NODE_FIT_MAX_SCALE = 3;
const ZOOM_MS = 300;

/** big-10000.canvas's images, beside it in workspace-fixtures (Fixtures/canvas). */
const FIXTURE_IMAGES: CanvasImages = {
  rasters: ['amara-okafor', 'freya-lindqvist', 'hana-kim', 'isabela-costa', 'karim-haddad', 'lucia-moreno', 'marco-bianchi', 'nia-mensah', 'noor-rahman', 'rafael-santos', 'tama-faleolo'].map((name) => `portraits/portrait-${name}.jpg`),
  svg: 'drawings/shapes.svg',
};

interface BenchCase {
  label: string;
  nodes: number;
  images?: CanvasImages;
  basePath?: string;
}

const CASES: BenchCase[] = [
  ...BENCH_SIZES.map((nodes) => ({label: `${nodes}`, nodes})),
  ...(BENCH_FIXTURE_DIR ? [{label: 'big-10000.canvas', nodes: 10000, images: FIXTURE_IMAGES, basePath: BENCH_FIXTURE_DIR}] : []),
];

interface Stats {
  frames: number;
  fps: number;
  p95: number;
  over25: number;
}

type PhaseName = 'pinch' | 'pan' | 'close' | 'pinchIn' | 'doubleTap';
const PHASES: PhaseName[] = ['pinch', 'pan', 'close', 'pinchIn', 'doubleTap'];
/** The Driver's phase numbers: 0 is idle. */
const PHASE_NUMBER: Record<PhaseName, number> = {pinch: 1, pan: 2, close: 3, pinchIn: 4, doubleTap: 5};

export interface BenchRow {
  label: string;
  nodes: number;
  readyMs: number;
  /** From the fit until the JavaScript thread is free again (it records the Picture meanwhile), less the second of calm it waits for. */
  busyMs: number;
  phases: Record<PhaseName, {ui: Stats; js: Stats}>;
}

/** `histogram`: frames by their time in whole ms; `total`: their exact times added up. */
function statsOf(histogram: number[], total: number): Stats {
  const frames = histogram.reduce((a, b) => a + b, 0);
  if (frames === 0) return {frames: 0, fps: 0, p95: 0, over25: 0};
  let seen = 0;
  let p95 = 0;
  for (let ms = 0; ms < histogram.length; ms++) {
    seen += histogram[ms]!;
    if (seen >= frames * 0.95) {
      p95 = ms;
      break;
    }
  }
  const over25 = histogram.slice(26).reduce((a, b) => a + b, 0);
  return {frames, fps: Math.round((1000 * frames) / Math.max(1, total)), p95, over25};
}

/** A phase's first and last UI frames, on the UI thread's frame clock, and the wall clock at the first. */
interface PhaseWindow {
  first: number;
  last: number;
  wall: number;
}

interface DriverProps {
  camera: CanvasCamera;
  phase: SharedValue<number>;
  t0: SharedValue<number>;
  start: SharedValue<{tx: number; ty: number; s: number}>;
  viewport: SharedValue<{w: number; h: number}>;
  histogram: SharedValue<number[]>;
  total: SharedValue<number>;
  phaseWindow: SharedValue<PhaseWindow>;
}

/**
 * Moves the camera on the UI thread, every frame, while a phase runs, and
 * records each frame's time. Mounted once the canvas has handed over its
 * camera, so the frame callback has it from the start. The double-tap phase
 * moves the camera from the JavaScript thread instead, as CanvasView does.
 */
function Driver({camera, phase, t0, start, viewport, histogram, total, phaseWindow}: DriverProps) {
  const last = useSharedValue(-1);
  useFrameCallback((info) => {
    'worklet';
    const now = OWN_CLOCK ? performance.now() : info.timestamp;
    const dt = OWN_CLOCK ? (last.value < 0 ? null : now - last.value) : info.timeSincePreviousFrame;
    last.value = now;
    if (phase.value === 0) return;
    if (t0.value < 0) {
      t0.value = now;
      phaseWindow.value = {first: now, last: now, wall: Date.now()};
      return;
    }
    phaseWindow.value = {...phaseWindow.value, last: now};
    if (dt !== null && dt > 0) {
      const at = Math.min(BUCKETS - 1, Math.floor(dt));
      const h = histogram.value.slice();
      h[at] = (h[at] ?? 0) + 1;
      histogram.value = h;
      total.value += dt;
    }
    const t = (now - t0.value) / 1000;
    const st = start.value;
    const cx = viewport.value.w / 2;
    const cy = viewport.value.h / 2;
    const zoomTo = (s: number) => {
      camera.scale.value = s;
      camera.translateX.value = cx - (cx - st.tx) * (s / st.s);
      camera.translateY.value = cy - (cy - st.ty) * (s / st.s);
    };
    if (phase.value === 1) {
      zoomTo(st.s * (1 + 0.6 * Math.sin(t * Math.PI)));
    } else if (phase.value === 4) {
      zoomTo(st.s * (1 + 1.5 * (1 - Math.cos(t * Math.PI))));
    } else if (phase.value === 2 || phase.value === 3) {
      camera.translateX.value = st.tx + 600 * Math.sin(t * Math.PI);
      camera.translateY.value = st.ty + 300 * Math.sin((t * Math.PI) / 2);
    }
  });
  return null;
}

/**
 * On macOS, react-native-macos's display link reports a time of 0 (its
 * `timestamp` reads CVDisplayLinkGetCurrentTime, which comes back empty), so
 * every frame callback gets the same timestamp. There the benchmark keeps
 * its own clock.
 */
const OWN_CLOCK = Platform.OS === 'macos';

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Resolves once the JavaScript thread has run a second of frames with none
 * over 50 ms: a large canvas records its Picture after it opens, which holds
 * the thread for seconds at 10,000 nodes, and a phase measured then measures
 * that instead. Gives up after 20 s.
 */
function jsIdle(): Promise<void> {
  return new Promise((done) => {
    const began = Date.now();
    let calm = Date.now();
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      if (now - last > 50) calm = now;
      last = now;
      if (now - calm >= 1000 || now - began > 20000) done();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

interface Camera {
  tx: number;
  ty: number;
  s: number;
}

/**
 * Moves the camera to `to` over ZOOM_MS from the JavaScript thread, eased
 * out, as CanvasView's camera animation (a double-tap's zoom) does, with the
 * culling held still until the end, as that animation holds it.
 */
function tween(camera: CanvasCamera, to: Camera): Promise<void> {
  const from = {tx: camera.translateX.value, ty: camera.translateY.value, s: camera.scale.value};
  const began = Date.now();
  camera.isPinching.value = true;
  return new Promise((done) => {
    const tick = () => {
      const t = Math.min(1, (Date.now() - began) / ZOOM_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      camera.translateX.value = from.tx + (to.tx - from.tx) * eased;
      camera.translateY.value = from.ty + (to.ty - from.ty) * eased;
      camera.scale.value = from.s + (to.s - from.s) * eased;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        camera.isPinching.value = false;
        done();
      }
    };
    requestAnimationFrame(tick);
  });
}

/** Where a double-tap on the card nearest the middle of the view takes the camera. */
function zoomedToMiddleCard(nodes: number, fitted: Camera, w: number, h: number): Camera {
  const columns = Math.ceil(Math.sqrt(nodes));
  const rows = Math.ceil(nodes / columns);
  const col = Math.max(0, Math.min(columns - 1, Math.floor((w / 2 - fitted.tx) / fitted.s / CELL_W)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor((h / 2 - fitted.ty) / fitted.s / CELL_H)));
  const s = Math.min(NODE_FIT_MAX_SCALE, (w - NODE_FIT_PADDING * 2) / CARD_W, (h - NODE_FIT_PADDING * 2) / CARD_H);
  return {tx: w / 2 - (col * CELL_W + CARD_W / 2) * s, ty: h / 2 - (row * CELL_H + CARD_H / 2) * s, s};
}

export function Bench({autorun = true, label}: {autorun?: boolean; label: string}) {
  const [benchCase, setBenchCase] = useState<{key: number; basePath?: string} | null>(null);
  const [content, setContent] = useState('');
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [status, setStatus] = useState('Waiting');
  const [live, setLive] = useState('');
  const [camera, setCamera] = useState<CanvasCamera | null>(null);
  const ready = useRef<((c: {fitToViewport: () => void; camera: CanvasCamera}) => void) | null>(null);

  const phase = useSharedValue(0);
  const t0 = useSharedValue(-1);
  const start = useSharedValue({tx: 0, ty: 0, s: 1});
  const viewport = useSharedValue({w: 0, h: 0});
  const histogram = useSharedValue<number[]>(new Array(BUCKETS).fill(0));
  const total = useSharedValue(0);
  const phaseWindow = useSharedValue<PhaseWindow>({first: 0, last: 0, wall: 0});

  /**
   * One phase: the UI thread's frames from the frame callback, the JS
   * thread's from requestAnimationFrame. `drive` moves the camera from the
   * JavaScript thread, for a phase the Driver leaves alone.
   */
  const measure = useCallback(
    async (caseLabel: string, which: PhaseName, drive?: () => Promise<void>): Promise<{ui: Stats; js: Stats}> => {
      histogram.value = new Array(BUCKETS).fill(0);
      total.value = 0;
      const js = new Array(BUCKETS).fill(0);
      let jsTotal = 0;
      let last = -1;
      let running = true;
      const tick = (frameTime: number) => {
        if (!running) return;
        const now = OWN_CLOCK ? performance.now() : frameTime;
        if (last >= 0 && now > last) {
          js[Math.min(BUCKETS - 1, Math.floor(now - last))] += 1;
          jsTotal += now - last;
        }
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      t0.value = -1;
      phase.value = PHASE_NUMBER[which];
      const shown = setInterval(() => setLive(`${histogram.value.reduce((a, b) => a + b, 0)} UI frames, ${Math.round(total.value)} ms`), 500);
      const began = Date.now();
      if (drive) {
        while (Date.now() - began < PHASE_MS) await drive();
      } else {
        await wait(PHASE_MS);
      }
      clearInterval(shown);
      phase.value = 0;
      running = false;
      const w = phaseWindow.value;
      console.warn(`[BENCH-WIN] ${JSON.stringify({bench: label, case: caseLabel, phase: which, first: w.first, last: w.last, wall: w.wall})}`);
      return {ui: statsOf([...histogram.value], total.value), js: statsOf(js, jsTotal)};
    },
    [histogram, label, phase, t0, total, phaseWindow],
  );

  /** Mounts and unmounts the sample canvas `times` times, then leaves it shown: a remount must still draw. */
  const remount = useCallback(async (times: number) => {
    for (let i = 1; i <= times; i++) {
      setStatus(`remount ${i} of ${times}`);
      setContent(SAMPLE_CANVAS);
      setBenchCase({key: i});
      await wait(400);
      setBenchCase(null);
      await wait(150);
    }
    setContent(SAMPLE_CANVAS);
    setBenchCase({key: times + 1});
    setStatus(`remounted ${times} times, now shown`);
  }, []);

  const run = useCallback(async () => {
    if (BENCH_REMOUNTS > 0) return remount(BENCH_REMOUNTS);
    const out: BenchRow[] = [];
    for (const [index, c] of CASES.entries()) {
      setStatus(`${c.label}: opening`);
      const opened = new Promise<{fitToViewport: () => void; camera: CanvasCamera}>((done) => (ready.current = done));
      const began = performance.now();
      setCamera(null);
      setContent(generateCanvas(c.nodes, 1, c.images));
      setBenchCase({key: index + 1, basePath: c.basePath});
      const controls = await opened;
      const readyMs = Math.round(performance.now() - began);
      setCamera(controls.camera);
      controls.fitToViewport();
      const fittedAt = performance.now();
      await wait(SETTLE_MS);
      await jsIdle();
      const busyMs = Math.round(performance.now() - fittedAt - 1000);
      const cam = controls.camera;
      const here = (): Camera => ({tx: cam.translateX.value, ty: cam.translateY.value, s: cam.scale.value});
      const fitted = here();
      const {w, h} = viewport.value;
      const phases = {} as BenchRow['phases'];
      for (const which of PHASES) {
        cam.translateX.value = fitted.tx;
        cam.translateY.value = fitted.ty;
        cam.scale.value = fitted.s;
        if (which === 'close') {
          cam.scale.value = fitted.s * 8;
          cam.translateX.value = w / 2 - (w / 2 - fitted.tx) * 8;
          cam.translateY.value = h / 2 - (h / 2 - fitted.ty) * 8;
        }
        // Culling catches up with the camera before the phase starts.
        await wait(which === 'pinch' ? 0 : 1500);
        start.value = here();
        setStatus(`${c.label}: ${which}`);
        if (which === 'pinch') cam.isPinching.value = true;
        if (which === 'doubleTap') {
          const card = zoomedToMiddleCard(c.nodes, fitted, w, h);
          phases[which] = await measure(c.label, which, async () => {
            await tween(cam, card);
            await tween(cam, fitted);
          });
        } else {
          phases[which] = await measure(c.label, which);
        }
        if (which === 'pinch') cam.isPinching.value = false;
      }
      const row: BenchRow = {label: c.label, nodes: c.nodes, readyMs, busyMs, phases};
      out.push(row);
      setRows([...out]);
      console.warn(`[BENCH] ${label} ${JSON.stringify(row)}`);
    }
    setStatus('Done');
    console.warn('[BENCH-DONE]');
    setBenchCase(null);
  }, [label, measure, remount, start, viewport]);

  useEffect(() => {
    if (autorun) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cell = (s: Stats) => `${s.fps} fps · p95 ${s.p95} ms · ${s.over25} over 25 ms`;
  return (
    <View style={styles.root}>
      <View style={styles.canvas} onLayout={(e) => (viewport.value = {w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height})}>
        {benchCase !== null && camera !== null ? (
          <Driver key={`driver-${benchCase.key}`} camera={camera} phase={phase} t0={t0} start={start} viewport={viewport} histogram={histogram} total={total} phaseWindow={phaseWindow} />
        ) : null}
        {benchCase !== null ? (
          <CanvasView
            key={benchCase.key}
            content={content}
            basePath={benchCase.basePath}
            minimap="hidden"
            onReady={(c) => ready.current?.({fitToViewport: c.fitToViewport, camera: c.camera})}
          />
        ) : null}
      </View>
      <ScrollView style={styles.results} contentContainerStyle={styles.resultsBody}>
        <Text style={styles.title}>{`${label}: ${status}  ${live}`}</Text>
        {rows.map((r) => (
          <Text key={r.label} style={styles.row}>
            {`${r.label} nodes, ready in ${r.readyMs} ms, JS busy ${r.busyMs} ms` + (Object.keys(r.phases) as PhaseName[]).map((p) => `\n  ${p.padEnd(9)} UI ${cell(r.phases[p].ui)}\n            JS ${cell(r.phases[p].js)}`).join('')}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  canvas: {flex: 1},
  results: {maxHeight: 330, backgroundColor: '#111'},
  resultsBody: {padding: 10, gap: 6},
  title: {color: '#fff', fontWeight: '600'},
  row: {color: '#ddd', fontFamily: Platform.select({android: 'monospace', default: 'Menlo'}), fontSize: 11},
});

/** The benchmark as an app's whole screen, for an entry point to register instead of the app (benchConfig.ts). */
export function BenchApp() {
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <Bench label={Platform.OS} />
    </GestureHandlerRootView>
  );
}
