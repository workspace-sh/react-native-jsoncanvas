import {useState, useMemo, useCallback} from 'react';
import {Platform} from 'react-native';
import {useAnimatedReaction, useSharedValue, type SharedValue} from 'react-native-reanimated';
import {scheduleOnRN} from 'react-native-worklets';
import type {CanvasNode, CanvasEdge, Rect} from '../core';

interface CameraValues {
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  scale: SharedValue<number>;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
         a.y < b.y + b.height && a.y + a.height > b.y;
}

// Padding multiplier around the viewport. Mobile uses 3× (1 viewport on
// each side); desktop uses 5× (2 viewports on each side) because pointer-
// driven pan + trackpad pan + camera animations cover ground faster than
// touch flicks on phones, and the JS-thread cull recompute happens less
// often (dead-zone gated below) — so the cushion needs to absorb more
// camera movement between recomputes. Tracked in #35 — start at 5×, tune
// if profiling shows we're paying for nodes well off-screen.
const PADDING_MULTIPLIER = Platform.OS === 'macos' ? 5 : 3;

function computePaddedViewport(
  tx: number,
  ty: number,
  s: number,
  sw: number,
  sh: number,
  multiplier: number,
): Rect {
  const worldW = sw / s;
  const worldH = sh / s;
  // (multiplier - 1) / 2 worldW of padding on each side, viewport
  // centred. For multiplier = 3, that's 1 worldW each side (3× total);
  // for multiplier = 5, 2 worldW each side (5× total).
  const padFactor = (multiplier - 1) / 2;
  return {
    x: -tx / s - worldW * padFactor,
    y: -ty / s - worldH * padFactor,
    width: worldW * multiplier,
    height: worldH * multiplier,
  };
}

/**
 * Filters nodes and edges to only those intersecting a padded viewport.
 *
 * Camera position is bridged from the UI thread via useAnimatedReaction
 * with dead-zone gating — scheduleOnRN only fires when the camera moves
 * significantly, avoiding excessive JS-thread work during gestures.
 *
 * Returns all nodes/edges unfiltered when viewport bounds are unknown
 * (initial render, before the first camera-move past the dead zone).
 * Once bounds are known, culling is active on all platforms — desktop
 * uses a more generous padding multiplier (see `PADDING_MULTIPLIER`).
 */
export function useViewportCulling(
  camera: CameraValues,
  screenWidth: number,
  screenHeight: number,
  allNodes: CanvasNode[],
  allEdges: CanvasEdge[],
) {
  const [viewportBounds, setViewportBounds] = useState<Rect | null>(null);

  const updateBounds = useCallback((tx: number, ty: number, s: number) => {
    setViewportBounds(
      computePaddedViewport(tx, ty, s, screenWidth, screenHeight, PADDING_MULTIPLIER),
    );
  }, [screenWidth, screenHeight]);

  // Dead-zone gated bridge from UI thread to JS thread
  const lastTx = useSharedValue(0);
  const lastTy = useSharedValue(0);
  const lastScale = useSharedValue(1);

  useAnimatedReaction(
    () => ({
      tx: camera.translateX.value,
      ty: camera.translateY.value,
      s: camera.scale.value,
    }),
    (current) => {
      'worklet';
      const threshold = 0.25 * Math.min(screenWidth, screenHeight);
      const dTx = Math.abs(current.tx - lastTx.value);
      const dTy = Math.abs(current.ty - lastTy.value);
      const dScale = Math.abs(current.s - lastScale.value);
      if (dTx > threshold || dTy > threshold || dScale > lastScale.value * 0.2) {
        lastTx.value = current.tx;
        lastTy.value = current.ty;
        lastScale.value = current.s;
        scheduleOnRN(updateBounds, current.tx, current.ty, current.s);
      }
    },
  );

  const visibleNodes = useMemo(() => {
    if (!viewportBounds) return allNodes;
    return allNodes.filter(n => rectsIntersect(
      {x: n.x, y: n.y, width: n.width, height: n.height},
      viewportBounds,
    ));
  }, [allNodes, viewportBounds]);

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(n => n.id)),
    [visibleNodes],
  );

  const visibleEdges = useMemo(() => {
    if (!viewportBounds) return allEdges;
    return allEdges.filter(e => visibleNodeIds.has(e.fromNode) || visibleNodeIds.has(e.toNode));
  }, [allEdges, visibleNodeIds, viewportBounds]);

  return {visibleNodes, visibleEdges, updateBounds};
}
