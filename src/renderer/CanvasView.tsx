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
import {scrollWheelEvents, type ScrollWheelEvent} from './NativeScrollWheelView';
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
// Camera-button animation duration (fit / recenter / zoom-to-node). Driven by
// a manual useFrameCallback interpolator (#141, #146) — withTiming and
// withSpring both corrupt shared values to ~10^16 on Fabric +
// react-native-macos, so we sidestep the reanimated animation queue entirely
// by writing tx/ty/scale per frame on the UI thread. Same pattern that pinch
// uses (direct shared-value writes from a worklet) — proven safe.
const CAMERA_ANIM_DURATION_MS = 300;
// Per-tap hold and inter-tap gap are NOT tightened from RNGH defaults
// (500ms / 500ms). On macOS the inter-tap gap is overridden via the
// `doubleTapMaxDelayMs` prop, which the desktop app sources from
// `NSEvent.doubleClickInterval` so it tracks the user's accessibility
// setting. On iOS the library default is correct — the OS pre-filters input
// for Touch Accommodations before events reach the recogniser.

// macOS click-drag inverts Y (drag down → pan up, like grabbing the background).
// Mobile touch uses direct manipulation (drag down → content moves down).
const PAN_Y_SIGN = Platform.OS === 'macos' ? -1 : 1;

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
  }, []);

  const animateCamera = useCallback((toTx: number, toTy: number, toScale: number, durationMs: number = CAMERA_ANIM_DURATION_MS) => {
    cancelCameraAnim();
    animCancelled.value = false;
    // Capture current rendered values as start so a re-click mid-animation
    // eases from wherever the camera actually is, not from the previous start.
    const startTx = translateX.value;
    const startTy = translateY.value;
    const startScale = scale.value;
    const startTime = Date.now();

    const tick = () => {
      // Worklet-set cancel flag from pinch / pan onStart. Interrupts the
      // animation so the gesture takes over from the visible position.
      if (animCancelled.value) {
        animFrameRef.current = null;
        return;
      }
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic: starts fast, decelerates to a soft landing.
      const eased = 1 - Math.pow(1 - t, 3);
      translateX.value = startTx + (toTx - startTx) * eased;
      translateY.value = startTy + (toTy - startTy) * eased;
      scale.value = startScale + (toScale - startScale) * eased;
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        animFrameRef.current = null;
        saveViewState();
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, [translateX, translateY, scale, animCancelled, cancelCameraAnim, saveViewState]);

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
  const zoomToNode = useCallback((node: CanvasNode, leftInset: number = 0) => {
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
    const tx = centreX - (node.x + node.width / 2) * s;
    const ty = sh / 2 - (node.y + node.height / 2) * s;
    animateCamera(tx, ty, s);
  }, [viewportWidth, viewportHeight, animateCamera]);

  // Toggle state: which node we last zoomed into. Re-tapping the same node
  // returns to fit-all; tapping a different node zooms there.
  const lastZoomedNodeId = useRef<string | null>(null);

  const handleDoubleTap = useCallback((wx: number, wy: number) => {
    // Don't fight an in-flight pinch
    if (isPinching.value) return;

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

    if (!hit || lastZoomedNodeId.current === hit.id) {
      fitToViewport(inset);
      lastZoomedNodeId.current = null;
      // Double-tap is a manual / focal interaction — sidebar toggle should
      // leave the camera alone afterwards. fitToViewport set lastAction to
      // 'fit' inside its body; override here.
      lastActionRef.current = 'manual';
      return;
    }

    zoomToNode(hit, inset);
    lastZoomedNodeId.current = hit.id;
    lastActionRef.current = 'manual';
  }, [canvasState, fitToViewport, zoomToNode, isPinching, leftInsetSV]);

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

  // Two-finger trackpad scroll to pan
  useEffect(() => {
    if (!scrollWheelEvents) return;
    const sub = scrollWheelEvents.addListener(
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
          translateY.value = prevTranslateY.value + PAN_Y_SIGN * event.translationY;
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
              { velocity: PAN_Y_SIGN * event.velocityY, deceleration },
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
      const wx = (event.x - translateX.value) / scale.value;
      const wy = (event.y - translateY.value) / scale.value;
      scheduleOnRN(handleDoubleTap, wx, wy);
    });
  }, [translateX, translateY, scale, handleDoubleTap, doubleTapMaxDelayMs]);

  const gesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, Gesture.Race(tapGesture, panGesture)),
    [panGesture, pinchGesture, tapGesture],
  );

  const camera = useMemo(
    () => ({translateX, translateY, scale}),
    [translateX, translateY, scale],
  );

  // Viewport culling: filter nodes/edges to those near the visible area (mobile only)
  const {visibleNodes, visibleEdges, updateBounds} = useViewportCulling(
    camera, viewportWidth, viewportHeight, allNodes, allEdges,
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
