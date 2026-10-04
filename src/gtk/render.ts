/**
 * JSON Canvas → pixels, drawn with Cairo.
 *
 * The document model is the library's own core — `parseCanvas` and its types,
 * unmodified — because only *drawing* is platform-bound. What changes per
 * platform is the rasteriser in front of that model: Skia in `renderer/` for
 * iOS, Android and macOS, Cairo here for GTK.
 *
 * Cairo rather than Skia is a constraint of the host, not a preference. GTKX
 * builds a strictly self-contained bundle and refuses both an inlined native
 * addon and any runtime module resolution, which rules out `@napi-rs/canvas`
 * (real Skia, which does work on Linux). Cairo ships with GTK, needs no addon,
 * and covers everything this renderer draws: rounded rects, cubic edges, and
 * text.
 */

import * as cairo from '@gtkx/cairo';
import { COLOR_PRESETS as PRESETS } from '../core/colors.js';
import { parseCanvas } from '../core/serialization.js';
import type { CanvasDocument, CanvasNode, CanvasEdge } from '../core/types.js';

type Rgb = [number, number, number];

/** HSL (degrees, %, %) → RGB in Cairo's 0–1 range. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    return ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** A node's colour: an explicit hex wins, otherwise the preset for its code. */
function colorOf(color: string | undefined): Rgb {
  if (color && color.startsWith('#') && color.length >= 7)
    return hexToRgb(color);
  const [h, s, l] = PRESETS[color ?? '0'] ?? PRESETS['0']!;
  return hslToRgb(h, s, l);
}

/**
 * The same hue, moved away from the background, for a card's fill.
 *
 * Lightened on a light canvas and darkened on a dark one. Always lightening
 * puts a pale wash on a dark ground, which is the one combination that reads
 * as a bug rather than a theme.
 */
function fillOf(color: string | undefined, dark: boolean): Rgb {
  if (color && color.startsWith('#') && color.length >= 7)
    return hexToRgb(color);
  const [h, s, l] = PRESETS[color ?? '0'] ?? PRESETS['0']!;
  return hslToRgb(h, s, dark ? Math.max(l - 26, 12) : Math.min(l + 28, 92));
}

/** A parsed canvas, kept between frames so panning does not re-parse. */
function roundedRect(
  ctx: cairo.Context,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  const HALF_PI = Math.PI / 2;
  ctx.newPath();
  ctx.arc(x + w - radius, y + radius, radius, -HALF_PI, 0);
  ctx.arc(x + w - radius, y + h - radius, radius, 0, HALF_PI);
  ctx.arc(x + radius, y + h - radius, radius, HALF_PI, Math.PI);
  ctx.arc(x + radius, y + radius, radius, Math.PI, Math.PI + HALF_PI);
  ctx.closePath();
}

/**
 * Anchor point for an edge end, with the outward normal of the side it leaves.
 *
 * The normal is what makes an edge leave a card perpendicular to the face it
 * is attached to — a `bottom` anchor must head downwards before bending.
 */
function anchor(
  node: CanvasNode,
  side: string | undefined,
): { x: number; y: number; nx: number; ny: number } {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y, nx: 0, ny: -1 };
    case 'bottom':
      return {
        x: node.x + node.width / 2,
        y: node.y + node.height,
        nx: 0,
        ny: 1,
      };
    case 'left':
      return { x: node.x, y: node.y + node.height / 2, nx: -1, ny: 0 };
    case 'right':
      return {
        x: node.x + node.width,
        y: node.y + node.height / 2,
        nx: 1,
        ny: 0,
      };
    default:
      return {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
        nx: 0,
        ny: 0,
      };
  }
}

function drawEdge(
  ctx: cairo.Context,
  edge: CanvasEdge,
  byId: Map<string, CanvasNode>,
): void {
  const from = byId.get(edge.fromNode);
  const to = byId.get(edge.toNode);
  if (!from || !to) return;

  const a = anchor(from, edge.fromSide);
  const b2 = anchor(to, edge.toSide);
  const span = Math.hypot(b2.x - a.x, b2.y - a.y);
  const bend = Math.max(span * 0.4, 40);
  const c1x = a.x + a.nx * bend;
  const c1y = a.y + a.ny * bend;
  const c2x = b2.x + b2.nx * bend;
  const c2y = b2.y + b2.ny * bend;
  const [r, g, b] = colorOf(edge.color);

  ctx.setSourceRgba(r, g, b, 0.8);
  ctx.setLineWidth(2);
  ctx.newPath();
  ctx.moveTo(a.x, a.y);
  ctx.curveTo(c1x, c1y, c2x, c2y, b2.x, b2.y);
  ctx.stroke();

  // Arrowhead along the curve's true end tangent: the direction from the
  // last control point into the endpoint.
  const angle = Math.atan2(b2.y - c2y, b2.x - c2x);
  const size = 9;
  ctx.newPath();
  ctx.moveTo(b2.x, b2.y);
  ctx.lineTo(
    b2.x - size * Math.cos(angle - 0.45),
    b2.y - size * Math.sin(angle - 0.45),
  );
  ctx.lineTo(
    b2.x - size * Math.cos(angle + 0.45),
    b2.y - size * Math.sin(angle + 0.45),
  );
  ctx.closePath();
  ctx.fill();
}

function label(node: CanvasNode): string {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'file':
      return node.file.split('/').pop() ?? node.file;
    case 'link':
      return node.url;
    case 'group':
      return node.label ?? '';
    default:
      return '';
  }
}

/**
 * Greedy wrap using Cairo's text measurement.
 *
 * The Skia renderer lays text out with a paragraph builder; this is a first
 * pass. Proper layout here means Pango, not a better loop — `textExtents`
 * measures a run, it does not shape a paragraph.
 */
function wrap(
  ctx: cairo.Context,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.textExtents(candidate).width > maxWidth && line) {
        lines.push(line);
        if (lines.length >= maxLines) return lines;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    if (lines.length >= maxLines) return lines.slice(0, maxLines);
  }
  return lines;
}

export interface CanvasModel {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly byId: Map<string, CanvasNode>;
}

/** The camera: world → screen, as a uniform scale plus a translation. */
export interface Camera {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export function parseCanvasDocument(source: string): CanvasModel {
  const doc: CanvasDocument = parseCanvas(source);
  // Both are optional in the JSON Canvas spec, and the library models that
  // faithfully rather than defaulting them — so normalise once, here.
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];
  return { nodes, edges, byId: new Map(nodes.map(n => [n.id, n])) };
}

/** The smallest box containing every node, or `null` when there are none. */
function contentBounds(
  nodes: readonly CanvasNode[],
): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null;
  const minX = Math.min(...nodes.map(n => n.x));
  const minY = Math.min(...nodes.map(n => n.y));
  const maxX = Math.max(...nodes.map(n => n.x + n.width));
  const maxY = Math.max(...nodes.map(n => n.y + n.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Fit every node in view with a margin, capped so a lone node isn't blown up. */
export function fitCamera(
  nodes: readonly CanvasNode[],
  width: number,
  height: number,
): Camera {
  const bounds = contentBounds(nodes);
  if (bounds === null) return { scale: 1, tx: 0, ty: 0 };
  const margin = 48;
  const scale = Math.min(
    (width - margin * 2) / Math.max(bounds.width, 1),
    (height - margin * 2) / Math.max(bounds.height, 1),
    1.5,
  );
  return {
    scale,
    tx: (width - bounds.width * scale) / 2 - bounds.x * scale,
    ty: (height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

/**
 * Put the content back in the middle of the viewport at the scale it is
 * already at.
 *
 * The scale is an input rather than something recomputed, and that is the
 * whole difference from `fitCamera`: someone who has zoomed in to read one
 * card and then lost their place wants to be brought back to the middle at
 * the zoom they chose, not zoomed back out to the whole board. The macOS
 * `recenter` makes the same distinction.
 */
export function recenterCamera(
  nodes: readonly CanvasNode[],
  width: number,
  height: number,
  scale: number,
): Camera {
  const bounds = contentBounds(nodes);
  // Nothing to centre on: put the world origin in the middle rather than
  // centring a box of zero size and dividing by it.
  if (bounds === null) return { scale, tx: width / 2, ty: height / 2 };
  return {
    scale,
    tx: width / 2 - (bounds.x + bounds.width / 2) * scale,
    ty: height / 2 - (bounds.y + bounds.height / 2) * scale,
  };
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

/**
 * Zoom about a fixed screen point.
 *
 * The point under the cursor must stay under the cursor — that is what makes
 * scroll-zoom feel attached to the artwork rather than to the window. Solve
 * for the translation that keeps the world point mapped to the same screen
 * point at the new scale.
 */
export function zoomAt(
  camera: Camera,
  factor: number,
  screenX: number,
  screenY: number,
): Camera {
  const scale = Math.min(Math.max(camera.scale * factor, MIN_SCALE), MAX_SCALE);
  const applied = scale / camera.scale;
  return {
    scale,
    tx: screenX - (screenX - camera.tx) * applied,
    ty: screenY - (screenY - camera.ty) * applied,
  };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { scale: camera.scale, tx: camera.tx + dx, ty: camera.ty + dy };
}

/**
 * Draws the canvas onto a Cairo context at the given size and camera.
 *
 * Takes a context rather than making one: the drawing area hands us the
 * context it is already compositing into, so panning redraws in place instead
 * of allocating a surface and a texture per frame.
 */
export function drawCanvas(
  ctx: cairo.Context,
  model: CanvasModel,
  width: number,
  height: number,
  camera: Camera,
  scheme: 'light' | 'dark' = 'light',
): void {
  const dark = scheme === 'dark';
  ctx.setSourceRgba(
    ...(dark ? ([0.11, 0.11, 0.12] as Rgb) : ([0.98, 0.98, 0.98] as Rgb)),
    1,
  );
  ctx.paint();

  ctx.save();
  ctx.translate(camera.tx, camera.ty);
  ctx.scale(camera.scale, camera.scale);
  ctx.selectFontFace('sans-serif', 0, 0);

  // Groups sit behind everything, as they do in the Skia tree.
  const groups = model.nodes.filter(n => n.type === 'group');
  const rest = model.nodes.filter(n => n.type !== 'group');

  for (const group of groups) {
    const [fr, fg, fb] = fillOf(group.color, dark);
    const [sr, sg, sb] = colorOf(group.color);
    roundedRect(ctx, group.x, group.y, group.width, group.height, 12);
    ctx.setSourceRgba(fr, fg, fb, dark ? 0.45 : 0.18);
    ctx.fill();
    roundedRect(ctx, group.x, group.y, group.width, group.height, 12);
    ctx.setSourceRgba(sr, sg, sb, 0.9);
    ctx.setLineWidth(2);
    ctx.setDash([8, 6], 0);
    ctx.stroke();
    ctx.setDash([], 0);

    const text = label(group);
    if (text) {
      ctx.setFontSize(15);
      ctx.setSourceRgba(sr, sg, sb, 1);
      ctx.moveTo(group.x + 10, group.y - 8);
      ctx.showText(text);
    }
  }

  for (const edge of model.edges) drawEdge(ctx, edge, model.byId);

  ctx.setFontSize(14);
  for (const node of rest) {
    const [fr, fg, fb] = fillOf(node.color, dark);
    const [sr, sg, sb] = colorOf(node.color);

    roundedRect(ctx, node.x, node.y, node.width, node.height, 8);
    ctx.setSourceRgba(fr, fg, fb, dark ? 0.55 : 0.25);
    ctx.fill();
    roundedRect(ctx, node.x, node.y, node.width, node.height, 8);
    ctx.setSourceRgba(sr, sg, sb, 1);
    ctx.setLineWidth(2);
    ctx.stroke();

    const text = label(node);
    if (!text) continue;
    const padding = 12;
    const lineHeight = 19;
    ctx.setSourceRgba(
      ...(dark ? ([0.9, 0.9, 0.91] as Rgb) : ([0.11, 0.11, 0.12] as Rgb)),
      1,
    );
    const maxLines = Math.max(
      1,
      Math.floor((node.height - padding) / lineHeight),
    );
    wrap(ctx, text, node.width - padding * 2, maxLines).forEach((line, i) => {
      ctx.moveTo(node.x + padding, node.y + padding + 12 + i * lineHeight);
      ctx.showText(line);
    });
  }

  ctx.restore();
}
