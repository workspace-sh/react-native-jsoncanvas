/** Where a canvas's camera goes to show all of it: its scale and translation. */
export interface FitCamera {
  tx: number;
  ty: number;
  s: number;
}

export interface FitArea {
  /** The canvas view's size, in points. */
  width: number;
  height: number;
  /** A strip along the left edge that something covers (a sidebar): centred in what's left. */
  left?: number;
  /** Kept clear above and below the content: it's centred in the view, and no nearer either edge than this. */
  margin?: number;
}

/**
 * The content's bounds at the largest scale that shows all of it, centred:
 * across what the left strip leaves, and down the whole view with `margin`
 * kept clear at the top and the bottom. What opening a canvas shows, and
 * what Fit does.
 */
export function fitCamera(
  area: FitArea,
  bounds: {x: number; y: number; width: number; height: number},
  scaleLimits: {min: number; max: number},
): FitCamera {
  const left = area.left ?? 0;
  const margin = area.margin ?? 0;
  const visibleW = Math.max(1, area.width - left);
  const visibleH = Math.max(1, area.height - margin * 2);
  const centreX = left + visibleW / 2;
  const centreY = area.height / 2;
  // Nothing to fit (no nodes): the world's origin at the centre, at 1:1.
  if (bounds.width <= 0 || bounds.height <= 0) return {tx: centreX, ty: centreY, s: 1};
  const s = Math.max(
    scaleLimits.min,
    Math.min(scaleLimits.max, Math.min(visibleW / bounds.width, visibleH / bounds.height)),
  );
  return {
    tx: centreX - (bounds.x + bounds.width / 2) * s,
    ty: centreY - (bounds.y + bounds.height / 2) * s,
    s,
  };
}
