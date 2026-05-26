import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {View, Text, Platform, useColorScheme, useWindowDimensions, type LayoutChangeEvent} from 'react-native';
import {GestureDetector, Gesture} from 'react-native-gesture-handler';
import {useSharedValue, withDecay, cancelAnimation, type SharedValue} from 'react-native-reanimated';
import {scheduleOnRN} from 'react-native-worklets';
import {
  parseCanvas,
  createCanvasState,
  type CanvasNode,
  type CanvasEdge,
} from '../core';
import {SkiaCanvasLayer} from './SkiaCanvasLayer';
import {CanvasMinimap, type MinimapPosition} from './CanvasMinimap';
import {
  jsonCanvasGestureEvents,
  scrollWheelEvents,
  type ScrollWheelEvent,
  type SmartMagnifyEvent,
} from './NativeScrollWheelView';
import {resolveScheme, getMutedTextColor, type ColorScheme} from './theme';
import {CanvasProvider} from './CanvasContext';
import {useViewportCulling} from './useViewportCulling';

interface ViewState {
  translateX: number;
  translateY: number;
  scale: number;
}

interface Props {
  /** Raw JSON string of a .canvas file. */
  content: string;
  /** Directory containing the canvas file, used to resolve relative paths. */
  basePath?: string;
  /** Optional markdown renderer injected by the app. */
  renderMarkdown?: (text: string, colorScheme: ColorScheme) => React.ReactElement;
  /** Saved view state to restore (pan/zoom position). */
  initialViewState?: ViewState;
  /** Called when the view state changes (for persistence). */
  onViewStateChange?: (state: ViewState) => void;
  /**
   * Called once with control functions the consuming app can use to build
   * its own UI.
   *
   * `leftInset` (optional, defaults to 0) compensates for an opaque overlay
   * along the left of the viewport — currently the macOS NSSplitView sidebar.
   * The desktop app reads the live sidebar width on the native side at click
   * time and passes it here per call. CanvasView itself holds NO sidebar
   * state — keeps the gesture pipeline (especially double-tap) immune from
   * sidebar bookkeeping. Mobile / web pass nothing.
   */
  onReady?: (controls: {
    fitToViewport: (leftInset?: number) => void;
    recenter: (leftInset?: number) => void;
    /**
     * Returns the user's most recent explicit camera intent. Used by the
     * sidebar-toggle handler to decide whether to re-apply a fit/recenter
     * against the new visible pane, or leave the camera alone (when the
     * user has since panned, pinched, or double-tap-zoomed).
     */
    getLastAction: () => 'fit' | 'recenter' | 'manual';
  }) => void;
  /**
   * Maximum gap between taps in the double-tap-to-zoom gesture (ms).
   * On macOS the desktop app reads `NSEvent.doubleClickInterval` (user's
   * Mouse / Trackpad slider) and passes it here so the gesture honours the
   * accessibility setting. On iOS, leave undefined — Touch Accommodations
   * are applied by the OS at the input layer; the library default (500ms)
   * is the right value for the JS-side recogniser.
   */
  doubleTapMaxDelayMs?: number;
  /**
   * Minimap overlay. Either a corner to place it in, or `'hidden'` to omit.
   * Defaults to `'bottom-right'`. The minimap is read-only — touches pass
   * through to the canvas underneath. Sizing is platform-aware (~200×150
   * desktop, ~120×90 touch).
   */
  minimap?: MinimapPosition | 'hidden';
  /**
   * Extra inset (in pt) applied to the minimap when it sits at a
   * `bottom-*` corner. Used by the consumer to clear overlays it has
   * positioned in the same corner (e.g. floating fit/recenter buttons in
   * the mobile app, safe-area insets, etc.). Added *on top* of any
   * platform-default inset (macOS adds 56pt by default for the floating
   * canvas-controls panel).
   */
  minimapBottomInset?: number;
  /**
   * Live width of a left-edge opaque overlay (e.g. macOS NSSplitView
   * sidebar) as a Reanimated SharedValue. Read by the minimap's derived
   * viewport rectangle so it represents the *visible* canvas pane rather
   * than the full canvas surface (which extends behind the sidebar on
   * macOS). SharedValue rather than a numeric prop so consumers can mutate
   * it without triggering React re-renders. Optional — minimap falls back
   * to 0 (full viewport) when not provided.
   */
  leftInsetSV?: SharedValue<number>;
}

const MIN_SCALE = 0.1; // 0.1 default
const MAX_SCALE = 6.0; // 3.0 default
const PINCH_DRIFT_DEADZONE = 10; // screen pixels
const PINCH_NOOP_THRESHOLD = 0.02; // 2% scale change
const PINCH_FOCAL_DELTA_CAP = 30; // max per-frame focal point shift (screen pixels)

// Double-tap zoom-to-node tuning.
// Soft cap on scale so tiny stencils (100×100) don't shoot to MAX_SCALE = 6×
// and feel disorienting. 3× is enough to dominate the viewport without warp.
const NODE_FIT_SOFT_MAX_SCALE = 3.0;
const NODE_FIT_PADDING = 32; // screen-space px around the fitted node
const DOUBLE_TAP_MAX_DISTANCE = 10; // px movement before tap is rejected
// Camera-tween duration (fit / recenter / zoom-to-node). Driven by a manual
// rAF interpolator (#141, #146) — withTiming and withSpring both corrupt
// shared values to ~10^16 on Fabric + react-native-macos, so we sidestep the
// reanimated animation queue entirely by writing tx/ty/scale per frame on
// the UI thread. Same pattern that pinch uses (direct shared-value writes
// from a worklet) — proven safe.
//
// Duration is scale-ratio aware (#36 item 5). At fixed 300ms, big zoom
// jumps felt rushed (a 10× scale change crammed into the same window as a
// 1.1× nudge) and small jumps felt sluggish. log2(ratio) interpolates
// smoothly between them; clamped at 500ms so the longest tween is still
// snappy.
const CAMERA_ANIM_MIN_MS = 250;
const CAMERA_ANIM_MAX_MS = 500;
const CAMERA_ANIM_RATIO_MS = 50;

function computeAnimDuration(startScale: number, endScale: number): number {
  const ratio = Math.max(startScale / endScale, endScale / startScale);
  return Math.min(
    CAMERA_ANIM_MAX_MS,
    CAMERA_ANIM_MIN_MS + Math.log2(ratio) * CAMERA_ANIM_RATIO_MS,
  );
}
// Per-tap hold and inter-tap gap are NOT tightened from RNGH defaults
// (500ms / 500ms). On macOS the inter-tap gap is overridden via the
// `doubleTapMaxDelayMs` prop, which the desktop app sources from
// `NSEvent.doubleClickInterval` so it tracks the user's accessibility
// setting. On iOS the library default is correct — the OS pre-filters input
// for Touch Accommodations before events reach the recogniser.

/**
 * Main infinite canvas component.
 *
 * A single Skia Canvas renders all content (cards, edges, text, images) inside
 * a Group with a camera matrix driven by Reanimated shared values. Gestures
 * update the shared values on the UI thread — zero React re-renders during
 * pan/zoom. Content re-renders as vectors at every zoom level.
 *
 * The Canvas must NOT be remounted on file switch (react-native-macos has a
 * Metal surface lifecycle bug where repeated unmount/mount cycles eventually
 * break rendering). Content changes flow through React reconciliation via
 * useMemo/useLayoutEffect on the content prop.
 */
export function CanvasView({content, basePath, renderMarkdown, initialViewState, onViewStateChange, onReady, doubleTapMaxDelayMs, minimap = 'bottom-right', minimapBottomInset = 0, leftInsetSV}: Props) {
  // `useWindowDimensions` returns the whole application window — on desktop
  // that includes the sidebar pane that sits to the left of the canvas
  // viewport. Computing "centre" against full-window dimensions lands the
  // camera off by half the sidebar width, which is the user-visible "the
  // canvas got lost when I clicked recenter" symptom (#135).
  //
  // Capture the canvas viewport's actual rendered size via onLayout
  // instead. Fall back to window dimensions until the first layout pass
  // settles so initial render isn't NaN-shaped.
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();
  const [layoutSize, setLayoutSize] = useState<{width: number; height: number} | null>(null);
  const viewportWidth = layoutSize?.width ?? windowWidth;
  const viewportHeight = layoutSize?.height ?? windowHeight;
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setLayoutSize(prev =>
      prev && prev.width === width && prev.height === height ? prev : {width, height},
    );
  }, []);

  const colorScheme = resolveScheme(useColorScheme());
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);

  const prevTranslateX = useSharedValue(0);
  const prevTranslateY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const pinchStartTx = useSharedValue(0);
  const pinchStartTy = useSharedValue(0);
  const pinchStartFocalX = useSharedValue(0);
  const pinchStartFocalY = useSharedValue(0);
  const prevFocalX = useSharedValue(0);
  const prevFocalY = useSharedValue(0);
  const isPinching = useSharedValue(false);

  // Camera-animation interrupt flag (#141, #146). Pinch / pan worklets set
  // this to true on onStart so the JS-thread animation tick bails — gestures
  // take over from wherever the camera currently is, no fighting writes.
  // The animation tick clears it back to false on next start.
  const animCancelled = useSharedValue(false);

  // True for the duration of a fit / recenter / zoom-to-node tween. Read by
  // SkiaCanvasLayer to reveal the Picture overlay during the animation
  // (#35) — the live Skia tree under it stops being the rendering source
  // of truth for those ~300ms, so per-frame node re-paint at the
  // interpolated scale stops dominating the GPU. Mirror of `isPinching`'s
  // role for the pinch gesture; OR'd together in SkiaCanvasLayer.
  const isCameraAnimating = useSharedValue(false);

  // Tracks the user's last explicit camera intent so the desktop sidebar
  // toggle can preserve it (e.g. "I just clicked fit; toggling the sidebar
  // should keep me fit"). 'manual' covers pan, pinch, scroll-wheel, and
  // double-tap — toggle leaves the camera alone in those cases.
  const lastActionRef = useRef<'fit' | 'recenter' | 'manual'>('manual');
  // Stable setter exposed to worklets via scheduleOnRN.
  const setLastAction = useCallback((action: 'fit' | 'recenter' | 'manual') => {
    lastActionRef.current = action;
  }, []);

  const canvasState = useMemo(() => {
    try {
      const doc = parseCanvas(content);
      return createCanvasState(doc);
    } catch {
      return null;
    }
  }, [content]);

  // Z-ordered: groups first (behind), then non-groups, preserving document order
  const allNodes = useMemo<CanvasNode[]>(() => {
    const nodes = canvasState?.document.nodes ?? [];
    const groups = nodes.filter(n => n.type === 'group');
    const others = nodes.filter(n => n.type !== 'group');
    return [...groups, ...others];
  }, [canvasState]);

  const allEdges = useMemo<CanvasEdge[]>(
    () => canvasState?.document.edges ?? [],
    [canvasState],
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const node of allNodes) {
      map.set(node.id, node);
    }
    return map;
  }, [allNodes]);

  // Calculate world-space bounds for initial fit-to-viewport positioning.
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return {x: 0, y: 0, width: 0, height: 0};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of allNodes) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }
    const padding = 50;
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }, [allNodes]);

  // Capture screen dimensions at file-open time so sidebar toggle doesn't reset camera.
  const initialScreenRef = useRef({w: viewportWidth, h: viewportHeight});
  // Track which `content` we've already fitted so re-renders triggered by
  // layoutSize updates (e.g. sidebar toggle) don't reset the camera.
  const fittedContentRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (allNodes.length === 0) return;
    // Defer until the canvas viewport has been measured. On first file open
    // layoutSize is null until onLayout fires, and falling back to window
    // dimensions here would centre against the wrong rectangle.
    if (!layoutSize) return;
    // Already fitted for this content — a layoutSize change (sidebar toggle,
    // window resize) shouldn't re-snap the camera.
    if (fittedContentRef.current === content) return;

    // Snapshot current viewport dimensions for this file open
    initialScreenRef.current = {w: layoutSize.width, h: layoutSize.height};

    let tx: number;
    let ty: number;
    let s: number;

    if (initialViewState) {
      // Restore saved view state
      tx = initialViewState.translateX;
      ty = initialViewState.translateY;
      s = initialViewState.scale;
    } else {
      // Fit content to viewport, never zooming beyond 1:1
      const sw = initialScreenRef.current.w;
      const sh = initialScreenRef.current.h;
      // Same fit-to-bounds maths as fitToViewport — see that comment.
      s = Math.max(
        MIN_SCALE,
        Math.min(MAX_SCALE, Math.min(sw / bounds.width, sh / bounds.height)),
      );
      tx = sw / 2 - (bounds.x + bounds.width / 2) * s;
      ty = sh / 2 - (bounds.y + bounds.height / 2) * s;
    }

    scale.value = s;
    translateX.value = tx;
    translateY.value = ty;
    prevTranslateX.value = tx;
    prevTranslateY.value = ty;
    pinchStartScale.value = s;
    pinchStartTx.value = tx;
    pinchStartTy.value = ty;

    // Sync culling bounds so first render has correct visible set
    updateBounds(tx, ty, s);
    fittedContentRef.current = content;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, layoutSize]);

  // Debounced persistence of view state
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveViewState = useCallback(() => {
    if (!onViewStateChange) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onViewStateChange({
        translateX: translateX.value,
        translateY: translateY.value,
        scale: scale.value,
      });
    }, 300);
  }, [onViewStateChange, translateX, translateY, scale]);

  // Camera animation interpolator (#141, #146).
  //
  // Drives interpolation from the JS thread via requestAnimationFrame and
  // writes shared values from JS — exactly the same write pattern that
  // fit/recenter used pre-animation (proven stable across the entire prior
  // session). Avoids reanimated's animation queue entirely; that queue
  // corrupts shared values to ~10^16 on Fabric + react-native-macos for both
  // withTiming and withSpring (#140, #142). useFrameCallback was the obvious
  // alternative but exhibits the same fingerprint on this stack — first call
  // doesn't render, subsequent calls land at target instantly. JS-RAF is the
  // dumb-and-reliable path: ~18 bridge crossings over a 300ms animation,
  // perf-irrelevant for one-shot button-press animations.
  const animFrameRef = useRef<number | null>(null);

  const cancelCameraAnim = useCallback(() => {
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    // Clear here too so any external teardown (unmount, or a hypothetical
    // future caller) leaves no dangling animation state. animateCamera
    // re-sets to true immediately after calling this, so the in-flight
    // re-click flow is unaffected.
    isCameraAnimating.value = false;
  }, [isCameraAnimating]);

  const animateCamera = useCallback((toTx: number, toTy: number, toScale: number, durationMs?: number) => {
    cancelCameraAnim();
    animCancelled.value = false;
    // Reveal the Picture overlay for the duration of this tween (#35).
    // Cleared in every exit path below: cancel (gesture takeover) AND
    // natural completion (t >= 1). Mid-animation re-click also clears
    // briefly through cancelCameraAnim → re-set here, but since both
    // transitions happen in the same frame Skia sees a continuous true.
    isCameraAnimating.value = true;
    // Capture current rendered values as start so a re-click mid-animation
    // eases from wherever the camera actually is, not from the previous start.
    const startTx = translateX.value;
    const startTy = translateY.value;
    const startScale = scale.value;
    // Scale-aware duration (#36 item 5) — derived from the start/end scale
    // ratio. Callers can still override explicitly via the param.
    const effectiveDuration = durationMs ?? computeAnimDuration(startScale, toScale);
    const startTime = Date.now();

    const tick = () => {
      // Worklet-set cancel flag from pinch / pan onStart. Interrupts the
      // animation so the gesture takes over from the visible position.
      if (animCancelled.value) {
        animFrameRef.current = null;
        isCameraAnimating.value = false;
        return;
      }
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / effectiveDuration);
      // easeOutCubic: starts fast, decelerates to a soft landing.
      const eased = 1 - Math.pow(1 - t, 3);
      translateX.value = startTx + (toTx - startTx) * eased;
      translateY.value = startTy + (toTy - startTy) * eased;
      scale.value = startScale + (toScale - startScale) * eased;
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        animFrameRef.current = null;
        isCameraAnimating.value = false;
        // Refresh the culled visible set against the final camera state.
        // `useViewportCulling`'s dead-zone reaction is suppressed for the
        // duration of the tween (`isCameraAnimating` short-circuits it),
        // so without this call the visible set would still reflect the
        // pre-animation viewport until the next gesture nudge crosses
        // the dead-zone threshold.
        updateBounds(toTx, toTy, toScale);
        saveViewState();
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
    // `updateBounds` declared in render order below; captured lazily by
    // the rAF closure, same trick as the initial-fit useLayoutEffect (#300).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translateX, translateY, scale, animCancelled, isCameraAnimating, cancelCameraAnim, saveViewState]);

  useEffect(() => () => cancelCameraAnim(), [cancelCameraAnim]);

  // Fit all content to the visible canvas pane.
  //
  // `leftInset` (defaults to 0) carves out an opaque-overlay area along the
  // left edge — desktop passes the live macOS sidebar width here. Centring
  // targets the visible-pane centre `(leftInset + visibleW / 2)`, not the
  // full-pane centre. Take the smaller of the two axis ratios so neither
  // dimension overflows. Clamp only to [MIN_SCALE, MAX_SCALE]; no artificial
  // floor or 1.0 ceiling — fit means fit.
  //
  // `leftInset` is a *parameter*, not a closure value: deps stay identical
  // to the original (`[viewportWidth, viewportHeight, bounds, animateCamera]`)
  // so callback identity is stable. Anything that depends on this callback
  // (handleDoubleTap, tapGesture) does NOT recompose when the sidebar
  // changes. That's load-bearing for #154 — earlier attempts that put
  // sidebar state in deps regressed double-tap.
  const fitToViewport = useCallback((leftInset: number = 0) => {
    lastActionRef.current = 'fit';
    const sw = viewportWidth;
    const sh = viewportHeight;
    const visibleW = Math.max(1, sw - leftInset);
    const centreX = leftInset + visibleW / 2;

    // Empty / degenerate bounds (e.g. a canvas with no nodes) — centre the
    // world origin in the viewport at 1:1 rather than dividing by zero
    // and hoping Infinity propagates through Math.min cleanly.
    if (bounds.width <= 0 || bounds.height <= 0) {
      animateCamera(centreX, sh / 2, 1);
      return;
    }

    const s = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, Math.min(visibleW / bounds.width, sh / bounds.height)),
    );
    const tx = centreX - (bounds.x + bounds.width / 2) * s;
    const ty = sh / 2 - (bounds.y + bounds.height / 2) * s;
    animateCamera(tx, ty, s);
  }, [viewportWidth, viewportHeight, bounds, animateCamera]);

  // Zoom to fit a single node in the viewport with a small screen-space
  // padding. Soft-capped at NODE_FIT_SOFT_MAX_SCALE so tiny stencils don't
  // overshoot to MAX_SCALE.
  //
  // `leftInset` mirrors `fitToViewport`: on macOS the desktop sidebar overlays
  // the canvas, so centring the node against the full viewport leaves it
  // under the sidebar. Caller (handleDoubleTap) reads the live sidebar width
  // from `leftInsetSV` and passes it here per call. Kept as a parameter, not
  // a closure dep, to preserve callback identity — see the matching
  // discussion above `fitToViewport`.
  //
  // `focalX` / `focalY` (optional, screen coords) opt into Safari-Smart-Zoom
  // semantics (#36 item 3): the world point currently under the tap stays
  // under the same screen pixel after the tween. Without them, the node
  // centres in the visible pane (legacy behaviour) — kept as the fallback
  // for non-tap callers (e.g. programmatic zoom-to-node from a Find UI).
  const zoomToNode = useCallback((
    node: CanvasNode,
    leftInset: number = 0,
    focalX?: number,
    focalY?: number,
  ) => {
    const sw = viewportWidth;
    const sh = viewportHeight;
    const visibleW = Math.max(1, sw - leftInset);
    const centreX = leftInset + visibleW / 2;
    const fitW = Math.max(1, visibleW - NODE_FIT_PADDING * 2);
    const fitH = Math.max(1, sh - NODE_FIT_PADDING * 2);
    const s = Math.max(
      MIN_SCALE,
      Math.min(NODE_FIT_SOFT_MAX_SCALE, Math.min(fitW / node.width, fitH / node.height)),
    );

    let tx: number;
    let ty: number;
    if (focalX != null && focalY != null) {
      // Focal-preserving end frame: solve for tx/ty such that the world
      // point currently under (focalX, focalY) lands under the same screen
      // point at the new scale `s`. Identical maths to pinch's focal-point
      // anchoring, applied once at the end state — the rAF interpolator
      // handles the in-between frames.
      const wx = (focalX - translateX.value) / scale.value;
      const wy = (focalY - translateY.value) / scale.value;
      tx = focalX - wx * s;
      ty = focalY - wy * s;
    } else {
      tx = centreX - (node.x + node.width / 2) * s;
      ty = sh / 2 - (node.y + node.height / 2) * s;
    }
    animateCamera(tx, ty, s);
  }, [viewportWidth, viewportHeight, animateCamera, translateX, translateY, scale]);

  // Zoom to an arbitrary scale anchored at a screen-space focal point.
  // Used for the "empty-space double-tap → 1× at tap" Safari behaviour
  // (#36 item 10) — previously fell through to fit-all, which felt like a
  // teleport when the user just wanted a small de-zoom. The same focal-
  // preserving maths as `zoomToNode`, factored so handleDoubleTap doesn't
  // need to know about it.
  const zoomAtFocalPoint = useCallback((focalX: number, focalY: number, toScale: number) => {
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, toScale));
    const wx = (focalX - translateX.value) / scale.value;
    const wy = (focalY - translateY.value) / scale.value;
    const tx = focalX - wx * s;
    const ty = focalY - wy * s;
    animateCamera(tx, ty, s);
  }, [animateCamera, translateX, translateY, scale]);

  // Toggle state: which node we last zoomed into. Re-tapping the same node
  // returns to fit-all; tapping a different node zooms there.
  const lastZoomedNodeId = useRef<string | null>(null);

  // Takes screen-space coords now (not world) — the callers (smartMagnify
  // bridge + iOS RNGH tap) hand off the raw event location and this function
  // owns the world-coord conversion for hit-testing. Screen coords are also
  // needed downstream for focal-point preservation (#36 item 3).
  const handleDoubleTap = useCallback((tapX: number, tapY: number) => {
    // Don't fight an in-flight pinch
    if (isPinching.value) return;

    const wx = (tapX - translateX.value) / scale.value;
    const wy = (tapY - translateY.value) / scale.value;
    const hits = canvasState?.hitTest(wx, wy) ?? [];
    // Smallest-area-wins: prefer the inner node when stacked inside a group.
    // Known weakness documented in #128 (zoomed-out group fills viewport ⇒
    // double-tap picks tiny child). Accepted; revisit if it bites in practice.
    const hit = hits.length > 0
      ? hits.reduce((a, b) => (a.width * a.height < b.width * b.height ? a : b))
      : null;

    // Read the live sidebar width once per tap so both the zoom-in and the
    // toggle-back-to-fit branches centre against the visible pane (#165).
    // `leftInsetSV` is a stable SharedValue ref — adding it to deps doesn't
    // recompose this callback.
    const inset = leftInsetSV?.value ?? 0;

    // Re-tap on the same node toggles back to fit-all — explicit "I'm done
    // looking at this; show me everything again". Predates Safari parity.
    if (hit && lastZoomedNodeId.current === hit.id) {
      fitToViewport(inset);
      lastZoomedNodeId.current = null;
      // Double-tap is a manual / focal interaction — sidebar toggle should
      // leave the camera alone afterwards. fitToViewport set lastAction to
      // 'fit' inside its body; override here.
      lastActionRef.current = 'manual';
      return;
    }

    // Empty-space tap (#36 item 10) — Safari Smart Zoom semantics: scale to
    // 1× anchored at the tap point. Previously fell through to fit-all,
    // which felt like a teleport when the user just wanted a small de-zoom.
    if (!hit) {
      zoomAtFocalPoint(tapX, tapY, 1.0);
      lastZoomedNodeId.current = null;
      lastActionRef.current = 'manual';
      return;
    }

    // Node-targeted tap — focal-preserving zoom-in. The tap location stays
    // under the same screen pixel through the tween (#36 item 3).
    zoomToNode(hit, inset, tapX, tapY);
    lastZoomedNodeId.current = hit.id;
    lastActionRef.current = 'manual';
  }, [canvasState, fitToViewport, zoomToNode, zoomAtFocalPoint, isPinching, leftInsetSV, translateX, translateY, scale]);

  // Recenter content at current zoom level, against the visible canvas pane.
  // See `fitToViewport` for the leftInset rationale.
  const recenter = useCallback((leftInset: number = 0) => {
    lastActionRef.current = 'recenter';
    const sw = viewportWidth;
    const sh = viewportHeight;
    const s = scale.value;
    const visibleW = Math.max(1, sw - leftInset);
    const centreX = leftInset + visibleW / 2;

    if (bounds.width <= 0 || bounds.height <= 0) {
      animateCamera(centreX, sh / 2, s);
      return;
    }

    const tx = centreX - (bounds.x + bounds.width / 2) * s;
    const ty = sh / 2 - (bounds.y + bounds.height / 2) * s;
    animateCamera(tx, ty, s);
  }, [viewportWidth, viewportHeight, bounds, scale, animateCamera]);

  // Expose controls to consuming app via stable refs
  const fitRef = useRef(fitToViewport);
  const recenterRef = useRef(recenter);
  fitRef.current = fitToViewport;
  recenterRef.current = recenter;

  useEffect(() => {
    onReady?.({
      fitToViewport: (leftInset?: number) => fitRef.current(leftInset),
      recenter: (leftInset?: number) => recenterRef.current(leftInset),
      getLastAction: () => lastActionRef.current,
    });
    // Only call onReady once per mount — callbacks update via refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Two-finger trackpad scroll to pan (macOS).
  //
  // Prefer a consumer-supplied `ScrollWheelBridge` (Workspace ships one
  // scoped to its canvas NSView) when present; otherwise fall back to the
  // library's own gesture bridge which monitors `NSEvent.scrollWheel`
  // window-globally. See `NativeScrollWheelView.tsx`.
  useEffect(() => {
    const source = scrollWheelEvents ?? jsonCanvasGestureEvents;
    if (!source) return;
    const sub = source.addListener(
      'onScrollWheel',
      (event: ScrollWheelEvent) => {
        translateX.value += event.deltaX;
        translateY.value += event.deltaY;
        // Trackpad scroll is a manual gesture — sidebar toggle should not
        // snap the camera back after the user has navigated.
        lastActionRef.current = 'manual';
        saveViewState();
      },
    );
    return () => sub.remove();
  }, [translateX, translateY, saveViewState]);

  // macOS trackpad two-finger double-tap — Safari's "Smart Zoom".
  //
  // RNGH's Gesture.Tap can't see trackpad multi-finger taps on
  // RNGH-macos — diagnostics in workspace-sh/workspace#183 confirmed
  // every trackpad tap arrives as a single-pointer event, so
  // `minPointers(2)` would silently never fire. We bypass RNGH via the
  // library's WorkspaceJsonCanvasGesture native module (ios/) which
  // hooks NSEvent.smartMagnify and emits `onSmartMagnify` here.
  //
  // iOS keeps the RNGH single-finger double-tap below.
  useEffect(() => {
    if (!jsonCanvasGestureEvents) return;
    const sub = jsonCanvasGestureEvents.addListener(
      'onSmartMagnify',
      (event: SmartMagnifyEvent) => {
        // Screen coords — handleDoubleTap owns the world-coord conversion
        // and also uses screen coords for focal-point preservation (#36).
        handleDoubleTap(event.x, event.y);
      },
    );
    return () => sub.remove();
  }, [handleDoubleTap]);

  // Click-and-drag to pan
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(3)
        .maxPointers(1)
        .onStart(() => {
          'worklet';
          // Halt any in-flight camera animation so the user's pan takes over
          // from the currently rendered position.
          animCancelled.value = true;
          // Manual gesture — invalidate any sticky fit/recenter intent so
          // sidebar toggle won't snap the camera back.
          scheduleOnRN(setLastAction, 'manual');
          prevTranslateX.value = translateX.value;
          prevTranslateY.value = translateY.value;
        })
        .onUpdate(event => {
          'worklet';
          translateX.value = prevTranslateX.value + event.translationX;
          translateY.value = prevTranslateY.value + event.translationY;
        })
        .onEnd(event => {
          'worklet';
          if (Platform.OS !== 'macos') {
            // Inertial panning: carry forward flick velocity with natural deceleration
            const deceleration = 0.997;
            translateX.value = withDecay({
              velocity: event.velocityX,
              deceleration,
            });
            translateY.value = withDecay(
              { velocity: event.velocityY, deceleration },
              (finished) => {
                'worklet';
                if (finished) {
                  scheduleOnRN(saveViewState);
                }
              },
            );
          } else {
            scheduleOnRN(saveViewState);
          }
        }),
    [translateX, translateY, prevTranslateX, prevTranslateY, animCancelled, setLastAction, saveViewState],
  );

  // Trackpad pinch to zoom
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(event => {
          'worklet';
          // Freeze any in-flight animations (pan decay, camera interpolator)
          // so the captured baseline matches the currently rendered position.
          cancelAnimation(translateX);
          cancelAnimation(translateY);
          cancelAnimation(scale);
          animCancelled.value = true; // halt camera interpolator
          // Manual gesture — invalidate any sticky fit/recenter intent so
          // sidebar toggle won't snap the camera back.
          scheduleOnRN(setLastAction, 'manual');
          isPinching.value = true;
          pinchStartScale.value = scale.value;
          pinchStartTx.value = translateX.value;
          pinchStartTy.value = translateY.value;
          pinchStartFocalX.value = event.focalX;
          pinchStartFocalY.value = event.focalY;
          prevFocalX.value = event.focalX;
          prevFocalY.value = event.focalY;
        })
        .onUpdate(event => {
          'worklet';
          // Guard 1: pointer-count — when a finger lifts, the focal point
          // snaps from the two-finger midpoint to the remaining finger.
          // Freeze translate and only update scale.
          if (event.numberOfPointers < 2) {
            const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScale.value * event.scale));
            scale.value = newScale;
            return;
          }

          // Guard 2: per-frame delta cap — reject single-frame focal point
          // jumps that exceed the threshold (defensive backstop).
          let focalX = event.focalX;
          let focalY = event.focalY;
          const frameDx = focalX - prevFocalX.value;
          const frameDy = focalY - prevFocalY.value;
          if (Math.abs(frameDx) > PINCH_FOCAL_DELTA_CAP || Math.abs(frameDy) > PINCH_FOCAL_DELTA_CAP) {
            focalX = prevFocalX.value;
            focalY = prevFocalY.value;
          }
          prevFocalX.value = focalX;
          prevFocalY.value = focalY;

          const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartScale.value * event.scale));
          const ratio = newScale / pinchStartScale.value;

          // Deadzone on focal point drift from gesture start.
          const rawDx = focalX - pinchStartFocalX.value;
          const rawDy = focalY - pinchStartFocalY.value;
          const dx = Math.abs(rawDx) < PINCH_DRIFT_DEADZONE
            ? 0
            : rawDx - Math.sign(rawDx) * PINCH_DRIFT_DEADZONE;
          const dy = Math.abs(rawDy) < PINCH_DRIFT_DEADZONE
            ? 0
            : rawDy - Math.sign(rawDy) * PINCH_DRIFT_DEADZONE;

          const effectiveFocalX = pinchStartFocalX.value + dx;
          const effectiveFocalY = pinchStartFocalY.value + dy;

          translateX.value = effectiveFocalX - (pinchStartFocalX.value - pinchStartTx.value) * ratio;
          translateY.value = effectiveFocalY - (pinchStartFocalY.value - pinchStartTy.value) * ratio;
          scale.value = newScale;
        })
        .onEnd(() => {
          'worklet';

          // No-op guard: if scale barely changed, restore pre-pinch state.
          // Prevents tiny accidental pinches from committing drift as a pan.
          const scaleDelta = Math.abs(scale.value - pinchStartScale.value) / pinchStartScale.value;
          if (scaleDelta < PINCH_NOOP_THRESHOLD) {
            translateX.value = pinchStartTx.value;
            translateY.value = pinchStartTy.value;
            scale.value = pinchStartScale.value;
          }

          isPinching.value = false;
          scheduleOnRN(saveViewState);
        }),
    [scale, translateX, translateY, pinchStartScale, pinchStartTx, pinchStartTy, pinchStartFocalX, pinchStartFocalY, prevFocalX, prevFocalY, isPinching, animCancelled, setLastAction, saveViewState],
  );

  // Double-tap to zoom-to-node (#145). Composed via Gesture.Race(tap, pan) so
  // any movement past DOUBLE_TAP_MAX_DISTANCE wins the race and treats the
  // input as a pan, preserving pan responsiveness. Pinch runs simultaneous to
  // both — pinching never blocks tap detection at gesture-handler level
  // (handleDoubleTap also gates on isPinching for in-flight pinch frames).
  const tapGesture = useMemo(() => {
    let g = Gesture.Tap()
      .numberOfTaps(2)
      .maxDistance(DOUBLE_TAP_MAX_DISTANCE);
    if (doubleTapMaxDelayMs != null) {
      g = g.maxDelay(doubleTapMaxDelayMs);
    }
    return g.onEnd((event, success) => {
      'worklet';
      if (!success) return;
      // macOS uses Safari's native two-finger Smart Zoom gesture, handled
      // by the `onSmartMagnify` listener above. The RNGH tap still races
      // with pan here so single-finger double-clicks don't accidentally
      // trigger pan logic, but the click itself is a no-op. iOS keeps
      // single-finger double-tap zoom (touchscreen convention).
      if (Platform.OS === 'macos') return;
      // Screen coords (event.x / event.y are touch-relative to the
      // GestureDetector). handleDoubleTap handles world conversion and
      // also uses these for focal-point preservation (#36).
      scheduleOnRN(handleDoubleTap, event.x, event.y);
    });
  }, [handleDoubleTap, doubleTapMaxDelayMs]);

  const gesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, Gesture.Race(tapGesture, panGesture)),
    [panGesture, pinchGesture, tapGesture],
  );

  const camera = useMemo(
    () => ({translateX, translateY, scale}),
    [translateX, translateY, scale],
  );

  // Viewport culling: filter nodes/edges to those near the visible area.
  // `isCameraAnimating` is forwarded so the hook can suppress its dead-zone-
  // gated React-thread recompute during fit/recenter/zoom-to-node tweens
  // (otherwise the recompute fires mid-animation and reseeds the live tree
  // at an interpolated scale, which reads as chop). The explicit recompute
  // for the post-animation visible set runs from `animateCamera`'s
  // completion branch below.
  const {visibleNodes, visibleEdges, updateBounds} = useViewportCulling(
    camera, viewportWidth, viewportHeight, allNodes, allEdges,
    {isCameraAnimating},
  );

  const contextValue = useMemo(
    () => ({colorScheme, renderMarkdown}),
    [colorScheme, renderMarkdown],
  );

  if (!canvasState) {
    return (
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
        <Text style={{color: getMutedTextColor(colorScheme), fontSize: 14}}>
          Unable to load canvas
        </Text>
      </View>
    );
  }

  return (
    <CanvasProvider value={contextValue}>
      <GestureDetector gesture={gesture}>
        <View style={{flex: 1, overflow: 'hidden'}} onLayout={onLayout} collapsable={false}>
          <SkiaCanvasLayer
            allNodes={visibleNodes}
            edges={visibleEdges}
            nodes={nodeMap}
            colorScheme={colorScheme}
            camera={camera}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
            basePath={basePath}
            isPinching={isPinching}
            isCameraAnimating={isCameraAnimating}
          />
          {minimap !== 'hidden' && allNodes.length > 0 && (
            <CanvasMinimap
              position={minimap}
              nodes={allNodes}
              edges={allEdges}
              colorScheme={colorScheme}
              translateX={translateX}
              translateY={translateY}
              scale={scale}
              viewportWidth={viewportWidth}
              viewportHeight={viewportHeight}
              leftInsetSV={leftInsetSV}
              bottomInset={minimapBottomInset}
            />
          )}
        </View>
      </GestureDetector>
    </CanvasProvider>
  );
}
