// The renderer's benchmark (react-native-jsoncanvas#83): canvases of 500,
// 2,000 and 5,000 mixed nodes (generateCanvas.ts), each fitted, left to
// settle, then moved by a script on the UI thread as a pinch and then a pan
// move it: 4 s of pinch-zoom about the centre (drawn from the recorded
// picture, as a pinch is), 4 s of pan (drawn live). Frame times are recorded
// on the UI thread (each frame's time since the last) and on the JavaScript
// thread (requestAnimationFrame), and summed up as frames per second, the
// 95th percentile, and frames over 25 ms (a dropped frame at 60 Hz).

import {useCallback, useEffect, useRef, useState} from 'react';
import {Platform, ScrollView, StyleSheet, Text, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {useFrameCallback, useSharedValue, type SharedValue} from 'react-native-reanimated';
import {CanvasView, type CanvasCamera} from '@workspace.sh/react-native-jsoncanvas';
import {generateCanvas} from './generateCanvas';

const SIZES = [500, 2000, 5000];
const SETTLE_MS = 2500;
const PHASE_MS = 4000;
const BUCKETS = 101; // 0–99 ms, and 100 ms or more

interface Stats {
  frames: number;
  fps: number;
  p95: number;
  over25: number;
}

export interface BenchRow {
  nodes: number;
  readyMs: number;
  pinchUi: Stats;
  pinchJs: Stats;
  panUi: Stats;
  panJs: Stats;
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

interface DriverProps {
  camera: CanvasCamera;
  phase: SharedValue<number>;
  t0: SharedValue<number>;
  start: SharedValue<{tx: number; ty: number; s: number}>;
  viewport: SharedValue<{w: number; h: number}>;
  histogram: SharedValue<number[]>;
  total: SharedValue<number>;
}

/**
 * Moves the camera on the UI thread, every frame, while a phase runs, and
 * records each frame's time. Mounted once the canvas has handed over its
 * camera, so the frame callback has it from the start.
 */
function Driver({camera, phase, t0, start, viewport, histogram, total}: DriverProps) {
  useFrameCallback((info) => {
    'worklet';
    if (phase.value === 0) return;
    if (t0.value < 0) {
      t0.value = info.timestamp;
      return;
    }
    const dt = info.timeSincePreviousFrame;
    if (dt !== null && dt > 0) {
      const at = Math.min(BUCKETS - 1, Math.floor(dt));
      const h = histogram.value.slice();
      h[at] = (h[at] ?? 0) + 1;
      histogram.value = h;
      total.value += dt;
    }
    const t = (info.timestamp - t0.value) / 1000;
    const st = start.value;
    if (phase.value === 1) {
      const s = st.s * (1 + 0.6 * Math.sin(t * Math.PI));
      const cx = viewport.value.w / 2;
      const cy = viewport.value.h / 2;
      camera.scale.value = s;
      camera.translateX.value = cx - (cx - st.tx) * (s / st.s);
      camera.translateY.value = cy - (cy - st.ty) * (s / st.s);
    } else {
      camera.translateX.value = st.tx + 600 * Math.sin(t * Math.PI);
      camera.translateY.value = st.ty + 300 * Math.sin((t * Math.PI) / 2);
    }
  });
  return null;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function Bench({autorun = true, label}: {autorun?: boolean; label: string}) {
  const [size, setSize] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [status, setStatus] = useState('Waiting');
  const [live, setLive] = useState('');
  const [camera, setCamera] = useState<CanvasCamera | null>(null);
  const ready = useRef<((c: {fitToViewport: () => void; camera: CanvasCamera}) => void) | null>(null);

  const phase = useSharedValue(0); // 0 idle, 1 pinch, 2 pan
  const t0 = useSharedValue(-1);
  const start = useSharedValue({tx: 0, ty: 0, s: 1});
  const viewport = useSharedValue({w: 0, h: 0});
  const histogram = useSharedValue<number[]>(new Array(BUCKETS).fill(0));

  const total = useSharedValue(0);

  /** One phase: the UI thread's frames from the frame callback, the JS thread's from requestAnimationFrame. */
  const measure = useCallback(
    async (which: 1 | 2): Promise<{ui: Stats; js: Stats}> => {
      histogram.value = new Array(BUCKETS).fill(0);
      total.value = 0;
      const js = new Array(BUCKETS).fill(0);
      let jsTotal = 0;
      let last = -1;
      let running = true;
      const tick = (now: number) => {
        if (!running) return;
        if (last >= 0 && now > last) {
          js[Math.min(BUCKETS - 1, Math.floor(now - last))] += 1;
          jsTotal += now - last;
        }
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      t0.value = -1;
      phase.value = which;
      const shown = setInterval(() => setLive(`${histogram.value.reduce((a, b) => a + b, 0)} UI frames, ${Math.round(total.value)} ms`), 500);
      await wait(PHASE_MS);
      clearInterval(shown);
      phase.value = 0;
      running = false;
      return {ui: statsOf([...histogram.value], total.value), js: statsOf(js, jsTotal)};
    },
    [histogram, phase, t0, total],
  );

  const run = useCallback(async () => {
    const out: BenchRow[] = [];
    for (const nodes of SIZES) {
      setStatus(`${nodes} nodes: opening`);
      const opened = new Promise<{fitToViewport: () => void; camera: CanvasCamera}>((done) => (ready.current = done));
      const began = performance.now();
      setCamera(null);
      setContent(generateCanvas(nodes));
      setSize(nodes);
      const controls = await opened;
      const readyMs = Math.round(performance.now() - began);
      setCamera(controls.camera);
      controls.fitToViewport();
      await wait(SETTLE_MS);
      const cam = controls.camera;
      phase.value = 0;
      start.value = {tx: cam.translateX.value, ty: cam.translateY.value, s: cam.scale.value};
      setStatus(`${nodes} nodes: pinch`);
      cam.isPinching.value = true;
      const pinch = await measure(1);
      cam.isPinching.value = false;
      start.value = {tx: cam.translateX.value, ty: cam.translateY.value, s: cam.scale.value};
      setStatus(`${nodes} nodes: pan`);
      const pan = await measure(2);
      const row = {nodes, readyMs, pinchUi: pinch.ui, pinchJs: pinch.js, panUi: pan.ui, panJs: pan.js};
      out.push(row);
      setRows([...out]);
      console.warn(`[BENCH] ${label} ${JSON.stringify(row)}`);
    }
    setStatus('Done');
    setSize(null);
  }, [label, measure, start]);

  useEffect(() => {
    if (autorun) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cell = (s: Stats) => `${s.fps} fps · p95 ${s.p95} ms · ${s.over25} over 25 ms`;
  return (
    <View style={styles.root}>
      <View style={styles.canvas} onLayout={(e) => (viewport.value = {w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height})}>
        {size !== null && camera !== null ? (
          <Driver key={`driver-${size}`} camera={camera} phase={phase} t0={t0} start={start} viewport={viewport} histogram={histogram} total={total} />
        ) : null}
        {size !== null ? (
          <CanvasView
            key={size}
            content={content}
            minimap="hidden"
            onReady={(c) => ready.current?.({fitToViewport: c.fitToViewport, camera: c.camera})}
          />
        ) : null}
      </View>
      <ScrollView style={styles.results} contentContainerStyle={styles.resultsBody}>
        <Text style={styles.title}>{`${label}: ${status}  ${live}`}</Text>
        {rows.map((r) => (
          <Text key={r.nodes} style={styles.row}>
            {`${r.nodes} nodes, ready in ${r.readyMs} ms\n  pinch  UI ${cell(r.pinchUi)}\n         JS ${cell(r.pinchJs)}\n  pan    UI ${cell(r.panUi)}\n         JS ${cell(r.panJs)}`}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  canvas: {flex: 1},
  results: {maxHeight: 260, backgroundColor: '#111'},
  resultsBody: {padding: 10, gap: 6},
  title: {color: '#fff', fontWeight: '600'},
  row: {color: '#ddd', fontFamily: 'Menlo', fontSize: 11},
});

/** The benchmark as an app's whole screen, for an entry point to register instead of the app (benchConfig.ts). */
export function BenchApp() {
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <Bench label={Platform.OS} />
    </GestureHandlerRootView>
  );
}
