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

function computePaddedViewport(tx: number, ty: number, s: number, sw: number, sh: number): Rect {
  const worldW = sw / s;
  const worldH = sh / s;
  return {
    x: -tx / s - worldW,
    y: -ty / s - worldH,
    width: worldW * 3,
    height: worldH * 3,
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
 * (initial render, desktop) or when Platform.OS is 'macos'.
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
    setViewportBounds(computePaddedViewport(tx, ty, s, screenWidth, screenHeight));
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
      if (Platform.OS === 'macos') return;
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
