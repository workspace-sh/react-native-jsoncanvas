import {useState, useEffect, useRef} from 'react';
import {Skia, createPicture, matchFont, PaintStyle, TileMode} from '@shopify/react-native-skia';
import type {SkPicture, SkCanvas, SkFont, SkPaint, SkImage} from '@shopify/react-native-skia';
import type {CanvasNode, CanvasEdge, TextNode, LinkNode, FileNode, GroupNode, EdgeSide} from '../core';
import type {EnrichedTextNode} from './extensions/cssclasses';
import {hasCallouts, parseCallouts, getHeader, getFooter, getLabels, getCenteredCallout} from './extensions/callouts';
import {
  getNodeColors, getMutedTextColor, getTextColor, getLinkColor,
  resolveEdgeColor, EDGE_LABEL_TEXT_COLOR, type ColorScheme,
} from './theme';
import {CHIP, EDGE_LABEL, FILE_IMAGE, GROUP_LABEL, LABEL, LINK, NODE, ZONE} from './metrics';
import {FONT_SIZE, H4, type FontConfig} from './typography';
import {hasInlineLabel, isImageFile} from './utils/fileNodeLabel';
import {parseToSegments, toPlainText} from './markdown';
import {buildParagraph, getParagraphColours} from './paragraphBuilder';
import {resolveFileUri} from './utils/resolveFileUri';
import {shapeClipPath, parallelogramPath} from './nodes/shapes';

// ---------- Fonts ----------
//
// Sizes come from typography.ts, shared with the live tree. The SkFont
// objects themselves stay local: this path caches by FontConfig identity,
// the live tree by a string key, and a handle is not safely shared across.

const fontCache = new Map<FontConfig, SkFont>();
function getFont(config: FontConfig): SkFont {
  let f = fontCache.get(config);
  if (!f) {
    const spec: Parameters<typeof matchFont>[0] = {
      fontFamily: config.fontFamily ?? 'System',
      fontSize: config.fontSize,
    };
    if (config.fontWeight) spec.fontWeight = config.fontWeight;
    f = matchFont(spec);
    fontCache.set(config, f);
  }
  return f;
}

// Link/file/label fonts
let _hostnameFont: SkFont | null = null;
let _urlFont: SkFont | null = null;
let _fileNameFont: SkFont | null = null;
let _fileSubpathFont: SkFont | null = null;
let _labelFont: SkFont | null = null;

function getHostnameFont(): SkFont {
  if (!_hostnameFont) _hostnameFont = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.linkHostname, fontWeight: 'bold'});
  return _hostnameFont;
}
function getUrlFont(): SkFont {
  if (!_urlFont) _urlFont = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.linkUrl});
  return _urlFont;
}
function getFileNameFont(): SkFont {
  if (!_fileNameFont) _fileNameFont = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.fileName, fontWeight: 'bold'});
  return _fileNameFont;
}
function getFileSubpathFont(): SkFont {
  if (!_fileSubpathFont) _fileSubpathFont = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.fileSubpath});
  return _fileSubpathFont;
}
function getEdgeLabelFont(): SkFont {
  if (!_labelFont) _labelFont = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.edgeLabel});
  return _labelFont;
}

// ---------- Paint helpers ----------

// Pre-allocated paint pool — reused across all draw calls during recording.
// Each paint is configured via setColor/setStyle/setStrokeWidth before use.
const _fillPaint = Skia.Paint();
const _strokePaint = Skia.Paint();
_strokePaint.setStyle(PaintStyle.Stroke);
const _textPaint = Skia.Paint();
const _gradientPaint = Skia.Paint();

/**
 * Paint for `drawImageRect`. Opaque white is not a colour choice — the image
 * supplies its own pixels and the paint only has to avoid tinting or fading
 * them. Named so it doesn't read as a themeable value that someone should
 * later route through `theme.ts`.
 */
const IMAGE_PAINT_COLOR = '#FFFFFF';

function useFillPaint(color: string): SkPaint {
  _fillPaint.setColor(Skia.Color(color));
  _fillPaint.setStyle(PaintStyle.Fill);
  _fillPaint.setPathEffect(null);
  _fillPaint.setShader(null);
  return _fillPaint;
}

const DEG_TO_RAD = Math.PI / 180;

/** Compute gradient start/end points for a given angle within a rect. Must
 *  match `SkiaCardRenderer.gradientPoints` exactly so the two paths produce
 *  identical gradients. */
function gradientPoints(x: number, y: number, w: number, h: number, deg: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = deg * DEG_TO_RAD;
  const dx = Math.cos(rad) * w / 2;
  const dy = Math.sin(rad) * h / 2;
  return {start: {x: cx - dx, y: cy - dy}, end: {x: cx + dx, y: cy + dy}};
}

/** Build a fresh paint configured with a linear gradient shader fading from
 *  `activeColor` to `fadeColor`. Used in the Picture path to match the live
 *  tree's two-pass fill rendering. The caller passes `colors.activeTransparent`
 *  (same hue at alpha 0) as `fadeColor` so the midpoint interpolation stays
 *  inside the active colour's family — fading to a literal transparent black
 *  reads as muddy/brown on a light canvas background. See #163. */
function useGradientPaint(start: {x: number; y: number}, end: {x: number; y: number}, activeColor: string, fadeColor: string): SkPaint {
  const shader = Skia.Shader.MakeLinearGradient(
    start,
    end,
    [Skia.Color(activeColor), Skia.Color(fadeColor)],
    null,
    TileMode.Clamp,
  );
  _gradientPaint.setShader(shader);
  _gradientPaint.setStyle(PaintStyle.Fill);
  _gradientPaint.setPathEffect(null);
  return _gradientPaint;
}

function useStrokePaint(color: string, width: number): SkPaint {
  _strokePaint.setColor(Skia.Color(color));
  _strokePaint.setStrokeWidth(width);
  _strokePaint.setPathEffect(null);
  return _strokePaint;
}

function useTextPaint(color: string): SkPaint {
  _textPaint.setColor(Skia.Color(color));
  return _textPaint;
}

// ---------- Edge geometry ----------
//
// Colours and label metrics are shared with `EdgeRenderer` via `theme.ts` and
// `metrics.ts`; only the curve maths below is restated here, because the two
// paths express it differently (SkPath commands vs declarative components).

function getConnectionPoint(node: CanvasNode, side?: EdgeSide, ox = 0, oy = 0) {
  const cx = node.x + node.width / 2 + ox;
  const cy = node.y + node.height / 2 + oy;
  switch (side) {
    case 'top': return {x: cx, y: node.y + oy};
    case 'bottom': return {x: cx, y: node.y + node.height + oy};
    case 'left': return {x: node.x + ox, y: cy};
    case 'right': return {x: node.x + node.width + ox, y: cy};
    default: return {x: cx, y: cy};
  }
}

function computeControlPoints(
  from: {x: number; y: number},
  to: {x: number; y: number},
  fromSide?: EdgeSide,
  toSide?: EdgeSide,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(dist * 0.4, 120);
  const sideOffset = (side: EdgeSide | undefined, fallbackH: number, fallbackV: number) => {
    switch (side) {
      case 'left': return {x: -curvature, y: 0};
      case 'right': return {x: curvature, y: 0};
      case 'top': return {x: 0, y: -curvature};
      case 'bottom': return {x: 0, y: curvature};
      default: return {x: fallbackH, y: fallbackV};
    }
  };
  const o1 = sideOffset(fromSide, dx * 0.4, dy * 0.4);
  const o2 = sideOffset(toSide, -dx * 0.4, -dy * 0.4);
  return {
    cp1: {x: from.x + o1.x, y: from.y + o1.y},
    cp2: {x: to.x + o2.x, y: to.y + o2.y},
  };
}

function bezierEndAngle(p: {x: number; y: number}, cp: {x: number; y: number}): number {
  return Math.atan2(p.y - cp.y, p.x - cp.x);
}

// ---------- Draw functions ----------

const SVG_RE = /\.svg$/i;
const RASTER_RE = /\.(png|jpg|jpeg|gif|webp|bmp|ico)$/i;

// ---------- Image cache ----------

// SVGs are excluded from Picture recording — they render live during pinch
// to preserve vector fidelity at any zoom level.
type ImageCacheEntry = {type: 'raster'; image: SkImage};
type ImageCache = Map<string, ImageCacheEntry>;

/** Extract raster image URIs from nodes (group backgrounds + file node images).
 *  SVGs are excluded — they render live during pinch for vector fidelity. */
function collectImageUris(allNodes: CanvasNode[], basePath?: string): string[] {
  const uris: string[] = [];
  for (const node of allNodes) {
    if (node.type === 'group' && (node as GroupNode).background) {
      const bg = (node as GroupNode).background!;
      if (!SVG_RE.test(bg)) {
        const uri = resolveFileUri(bg, basePath);
        if (uri) uris.push(uri);
      }
    }
    if (node.type === 'file') {
      const file = (node as FileNode).file;
      if (RASTER_RE.test(file)) {
        const uri = resolveFileUri(file, basePath);
        if (uri) uris.push(uri);
      }
    }
  }
  return [...new Set(uris)];
}

/** Load raster image URIs into a cache via Skia's imperative Data/Image APIs. */
async function loadImageCache(uris: string[]): Promise<ImageCache> {
  const cache: ImageCache = new Map();
  const promises = uris.map(async (uri) => {
    try {
      const data = await Skia.Data.fromURI(uri);
      if (!data) return;
      const image = Skia.Image.MakeImageFromEncoded(data);
      if (image) cache.set(uri, {type: 'raster', image});
    } catch (err) {
      console.warn(`[useCanvasPicture] Failed to load image ${uri}:`, err);
    }
  });
  await Promise.all(promises);
  return cache;
}

// Mirrors `makeSideBorderPath` in SkiaCardRenderer.tsx — see that file for
// the per-side geometry rationale. The two paths must stay in sync (Picture
// recording vs live tree).
function makeSideBorderPath(x: number, y: number, w: number, h: number, r: number, side: 'top' | 'bottom' | 'left' | 'right') {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const right = x + w;
  const bottom = y + h;
  const inset = radius * (1 - Math.SQRT1_2);
  const ix = x + inset;
  const iy = y + inset;
  const ixr = right - inset;
  const iyb = bottom - inset;
  let d = '';
  switch (side) {
    case 'top':
      d = `M ${ix} ${iy} A ${radius} ${radius} 0 0 1 ${x + radius} ${y} L ${right - radius} ${y} A ${radius} ${radius} 0 0 1 ${ixr} ${iy}`;
      break;
    case 'right':
      d = `M ${ixr} ${iy} A ${radius} ${radius} 0 0 1 ${right} ${y + radius} L ${right} ${bottom - radius} A ${radius} ${radius} 0 0 1 ${ixr} ${iyb}`;
      break;
    case 'bottom':
      d = `M ${ixr} ${iyb} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom} L ${x + radius} ${bottom} A ${radius} ${radius} 0 0 1 ${ix} ${iyb}`;
      break;
    case 'left':
      d = `M ${ix} ${iyb} A ${radius} ${radius} 0 0 1 ${x} ${bottom - radius} L ${x} ${y + radius} A ${radius} ${radius} 0 0 1 ${ix} ${iy}`;
      break;
  }
  return Skia.Path.MakeFromSVGString(d);
}

function makeParaPath(x: number, y: number, w: number, h: number, dir: 'left' | 'right') {
  return Skia.Path.MakeFromSVGString(parallelogramPath(x, y, w, h, dir));
}

function drawCard(canvas: SkCanvas, node: CanvasNode, colorScheme: ColorScheme) {
  const isGroup = node.type === 'group';
  const colors = getNodeColors(node.color, colorScheme);

  const renderProps = (node as CanvasNode & Partial<EnrichedTextNode>).renderProps;
  const shape = renderProps?.shape;
  const isFill = renderProps?.fill;
  const isTransparent = renderProps?.transparent;
  const isNocolor = renderProps?.nocolor;
  const hideBorder = renderProps?.borderStyle === 'none';
  const borderStyle = renderProps?.borderStyle;
  const borderSides = renderProps?.borderSides;
  const isPill = renderProps?.pill;
  const rotation = renderProps?.rotateCard;
  const gradientDeg = renderProps?.gradientDeg;

  const fillColor = isTransparent || isNocolor
    ? 'transparent'
    : isFill
      ? colors.active
      : isGroup
        ? colors.background
        : colors.card;

  const borderRadius = isPill
    ? Math.min(node.width, node.height) / 2
    : shape === 'rectangle' ? 0 : (isGroup ? 12 : 8);
  const showFill = !isTransparent && !isNocolor;
  const hasGradient = gradientDeg != null && showFill;
  const gradPts = hasGradient
    ? gradientPoints(node.x, node.y, node.width, node.height, gradientDeg!)
    : null;

  // Card rotation — must match `SkiaCardRenderer.tsx` and `drawTextNode`
  // exactly so card outline + body text rotate around the same centre.
  if (rotation != null) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    canvas.save();
    canvas.rotate(rotation, cx, cy);
  }

  if (shape === 'circle') {
    // Fills the full card bounds — true circle when square, stretched ellipse
    // otherwise. Matches Canvas Candy's CSS-driven origin (`border-radius: 50%`
    // on a sized box) and the test fixtures' own intent: see the matching
    // comment + rationale in `SkiaCardRenderer.tsx`. Mirrors that renderer
    // exactly per the two-paths-in-sync rule.
    const oval = {x: node.x, y: node.y, width: node.width, height: node.height};
    if (showFill) canvas.drawOval(oval, useFillPaint(fillColor));
    if (hasGradient && gradPts) {
      canvas.drawOval(oval, useGradientPaint(gradPts.start, gradPts.end, colors.active, colors.activeTransparent));
    }
    if (!hideBorder) {
      const sp = useStrokePaint(colors.border, 1);
      if (borderStyle === 'dashed') sp.setPathEffect(Skia.PathEffect.MakeDash([6, 4]));
      if (borderStyle === 'dotted') sp.setPathEffect(Skia.PathEffect.MakeDash([2, 3]));
      canvas.drawOval(oval, sp);
    }
  } else if (shape === 'parallelogram-left' || shape === 'parallelogram-right') {
    const dir = shape === 'parallelogram-left' ? 'left' : 'right';
    const path = makeParaPath(node.x, node.y, node.width, node.height, dir);
    if (path) {
      if (showFill) canvas.drawPath(path, useFillPaint(fillColor));
      if (hasGradient && gradPts) {
        canvas.drawPath(path, useGradientPaint(gradPts.start, gradPts.end, colors.active, colors.activeTransparent));
      }
      if (!hideBorder) {
        const sp = useStrokePaint(colors.border, 1);
        if (borderStyle === 'dashed') sp.setPathEffect(Skia.PathEffect.MakeDash([6, 4]));
        if (borderStyle === 'dotted') sp.setPathEffect(Skia.PathEffect.MakeDash([2, 3]));
        canvas.drawPath(path, sp);
      }
    }
  } else {
    const rr = {
      rect: {x: node.x, y: node.y, width: node.width, height: node.height},
      rx: borderRadius, ry: borderRadius,
    };
    if (showFill) canvas.drawRRect(rr, useFillPaint(fillColor));
    if (hasGradient && gradPts) {
      canvas.drawRRect(rr, useGradientPaint(gradPts.start, gradPts.end, colors.active, colors.activeTransparent));
    }
    if (!hideBorder && borderSides && borderSides.length > 0) {
      // Per-side borders that hug the rounded corners — mirrors
      // SkiaCardRenderer.tsx exactly per the two-paths-in-sync rule.
      const sp = useStrokePaint(colors.border, 1);
      for (const side of borderSides) {
        const path = makeSideBorderPath(node.x, node.y, node.width, node.height, borderRadius, side);
        if (path) canvas.drawPath(path, sp);
      }
    } else if (!hideBorder) {
      const sp = useStrokePaint(colors.border, 1);
      if (isGroup || borderStyle === 'dashed') sp.setPathEffect(Skia.PathEffect.MakeDash([6, 4]));
      else if (borderStyle === 'dotted') sp.setPathEffect(Skia.PathEffect.MakeDash([2, 3]));
      canvas.drawRRect(rr, sp);
      // Double border: inset second stroke
      if (borderStyle === 'double') {
        const innerRr = {
          rect: {x: node.x + 3, y: node.y + 3, width: node.width - 6, height: node.height - 6},
          rx: Math.max(0, borderRadius - 3), ry: Math.max(0, borderRadius - 3),
        };
        canvas.drawRRect(innerRr, useStrokePaint(colors.border, 1));
      }
    }
  }

  if (rotation != null) {
    canvas.restore();
  }
}

function drawGroupBackground(canvas: SkCanvas, node: GroupNode, imageCache: ImageCache, basePath?: string) {
  if (!node.background) return;
  const uri = resolveFileUri(node.background, basePath);
  if (!uri) return;
  const entry = imageCache.get(uri);
  if (!entry || entry.type !== 'raster') return;

  const image = entry.image;
  const imgWidth = image.width();
  const imgHeight = image.height();
  const style = node.backgroundStyle ?? 'cover';

  // Clip to rounded rect
  const rr = {
    rect: {x: node.x, y: node.y, width: node.width, height: node.height},
    rx: 12,
    ry: 12,
  };
  canvas.save();
  canvas.clipRRect(rr, 1 /* ClipOp.Intersect */, true);

  if (style === 'cover') {
    const scl = Math.max(node.width / imgWidth, node.height / imgHeight);
    const dw = imgWidth * scl;
    const dh = imgHeight * scl;
    const dx = node.x + (node.width - dw) / 2;
    const dy = node.y + (node.height - dh) / 2;
    const src = {x: 0, y: 0, width: imgWidth, height: imgHeight};
    const dst = {x: dx, y: dy, width: dw, height: dh};
    canvas.drawImageRect(image, src, dst, useFillPaint(IMAGE_PAINT_COLOR));
  } else {
    // contain
    const scl = Math.min(node.width / imgWidth, node.height / imgHeight);
    const dw = imgWidth * scl;
    const dh = imgHeight * scl;
    const dx = node.x + (node.width - dw) / 2;
    const dy = node.y + (node.height - dh) / 2;
    const src = {x: 0, y: 0, width: imgWidth, height: imgHeight};
    const dst = {x: dx, y: dy, width: dw, height: dh};
    canvas.drawImageRect(image, src, dst, useFillPaint(IMAGE_PAINT_COLOR));
  }
  canvas.restore();
}

function drawFileImage(canvas: SkCanvas, node: FileNode, imageCache: ImageCache, basePath?: string) {
  if (!RASTER_RE.test(node.file)) return; // SVGs render live for vector fidelity
  const uri = resolveFileUri(node.file, basePath);
  if (!uri) return;
  const entry = imageCache.get(uri);
  if (!entry) return;

  // Reserve label room only when a label will actually be drawn — otherwise
  // the image is pushed up the card to clear empty space. Must match
  // `destBox` in SkiaImageRenderer, or the recording and the live tree place
  // the same image differently.
  const labelSpace = hasInlineLabel(node) ? FILE_IMAGE.labelSpace : 0;
  const x = node.x + FILE_IMAGE.margin;
  const y = node.y + FILE_IMAGE.margin;
  const w = Math.max(0, node.width - FILE_IMAGE.margin * 2);
  const h = Math.max(0, node.height - FILE_IMAGE.margin * 2 - labelSpace);
  if (w === 0 || h === 0) return;

  // Raster images are drawn at source resolution. Zoom fidelity is bounded
  // by source pixel density — if images pixelate on zoom-in, the source
  // asset is too small, not the recording path.
  const image = entry.image;
  const imgW = image.width();
  const imgH = image.height();
  const scl = Math.min(w / imgW, h / imgH);
  const dw = imgW * scl;
  const dh = imgH * scl;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  const src = {x: 0, y: 0, width: imgW, height: imgH};
  const dst = {x: dx, y: dy, width: dw, height: dh};

  canvas.save();
  canvas.clipRect({x, y, width: w, height: h}, 1 /* ClipOp.Intersect */, true);
  canvas.drawImageRect(image, src, dst, useFillPaint(IMAGE_PAINT_COLOR));
  canvas.restore();
}

function drawTextNode(canvas: SkCanvas, node: TextNode, colorScheme: ColorScheme) {
  const enriched = node as TextNode & Partial<EnrichedTextNode>;
  const rawContent = enriched.displayText ?? node.text;
  if (!rawContent) return;

  // Process callouts (same as SkiaTextRenderer)
  const {bodyText, callouts} = hasCallouts(rawContent)
    ? parseCallouts(rawContent)
    : {bodyText: rawContent, callouts: []};
  const header = getHeader(callouts);
  const footer = getFooter(callouts);
  const labels = getLabels(callouts);
  const centered = getCenteredCallout(callouts);
  const headerSpace = header ? ZONE.height : 0;
  const footerSpace = footer ? ZONE.height : 0;

  // Clip the text-node output to the card outline — mirrors the
  // `<Group clip>` wrapper at the bottom of `SkiaTextRenderer` so the Picture
  // overlay produces the same clipped result during pinch (#167). For
  // circle / parallelogram cards, clip to the shape path so text respects the
  // curved / slanted edge (#53); otherwise the bounding rect. Every return
  // path below MUST be preceded by `canvas.restore()` to keep the save stack
  // balanced.
  const shape = enriched.renderProps?.shape;
  const shapeClip = shapeClipPath(shape, node.x, node.y, node.width, node.height);
  canvas.save();
  if (shapeClip) {
    const clipPath = Skia.Path.MakeFromSVGString(shapeClip);
    if (clipPath) {
      canvas.clipPath(clipPath, 1 /* ClipOp.Intersect */, true);
    } else {
      canvas.clipRect(
        {x: node.x, y: node.y, width: node.width, height: node.height},
        1 /* ClipOp.Intersect */,
        true,
      );
    }
  } else {
    canvas.clipRect(
      {x: node.x, y: node.y, width: node.width, height: node.height},
      1 /* ClipOp.Intersect */,
      true,
    );
  }

  // Side labels (cc-label-left / -right) — draw rotated, for BOTH label-only
  // and mixed-zone cards. Drawn here (before the body early-returns) so every
  // exit path includes labels; they occupy the card's edge columns and don't
  // overlap centred body text. Mirrors the dedicated SkiaCardLabelRenderer in
  // the live tree (#64). Inside the clip save() from above.
  if (labels.length > 0) {
    const lCx = node.x + node.width / 2;
    const lCy = node.y + node.height / 2;
    for (const label of labels) {
      const labelText = toPlainText(label.text);
      if (!labelText) continue;
      const labelFont = getFont(H4);
      const labelWidth = labelFont.measureText(labelText).width;
      const isLeft = label.zone === 'label-left';
      const angle = isLeft ? -90 : 90;

      canvas.save();
      canvas.rotate(angle, lCx, lCy);
      canvas.drawText(labelText, lCx - labelWidth / 2, lCy + H4.fontSize / 2,
        useTextPaint(getTextColor(colorScheme)), labelFont);
      canvas.restore();

      if (!label.noBorder) {
        const borderX = isLeft ? node.x + ZONE.height : node.x + node.width - ZONE.height;
        canvas.drawLine(borderX, node.y + 1, borderX, node.y + node.height - 1,
          useStrokePaint(getMutedTextColor(colorScheme), 0.5));
      }
    }
  }

  const textColor = getTextColor(colorScheme);
  const mutedColor = getMutedTextColor(colorScheme);

  const maxWidth = Math.max(1, node.width - NODE.padding * 2);
  const maxHeight = node.height - NODE.padding * 2 - headerSpace - footerSpace;
  if (maxHeight <= 0) {
    canvas.restore();
    return;
  }

  // Draw header zone
  if (header) {
    const hFont = getFont(H4);
    const hY = node.y + 6 + H4.fontSize;
    const hText = toPlainText(header.text);
    if (hText) {
      const hW = hFont.measureText(hText).width;
      const hX = node.x + NODE.padding + (maxWidth - hW) / 2;
      canvas.drawText(hText, hX, hY, useTextPaint(textColor), hFont);
    }
    if (!header.noBorder) {
      canvas.drawLine(node.x + 1, node.y + 28, node.x + node.width - 1, node.y + 28, useStrokePaint(mutedColor, 0.5));
    }
  }

  // Draw footer zone
  if (footer) {
    const fFont = getFont(H4);
    const fBaseY = node.y + node.height - footerSpace;
    const fY = fBaseY + 6 + H4.fontSize;
    const fText = toPlainText(footer.text);
    if (fText) {
      const fW = fFont.measureText(fText).width;
      const fX = node.x + NODE.padding + (maxWidth - fW) / 2;
      canvas.drawText(fText, fX, fY, useTextPaint(textColor), fFont);
    }
    if (!footer.noBorder) {
      canvas.drawLine(node.x + 1, fBaseY, node.x + node.width - 1, fBaseY, useStrokePaint(mutedColor, 0.5));
    }
  }

  // Body text — render via Skia Paragraph so the picture matches the live
  // tree (`SkiaTextRenderer`) exactly. Both paths share `buildParagraph`
  // from `paragraphBuilder.ts`, so HarfBuzz shaping, font fallback, and
  // line metrics are identical regardless of which path renders.
  const textContent = centered ? centered.text : bodyText;
  if (!textContent) {
    canvas.restore();
    return;
  }

  const segments = parseToSegments(textContent);
  const palette = getParagraphColours(colorScheme);
  const paragraph = buildParagraph(segments, maxWidth, palette);
  if (!paragraph) {
    canvas.restore();
    return;
  }

  const centerText = enriched.renderProps?.textAlign === 'center'
    || centered != null
    || shape === 'circle' || shape === 'parallelogram-left' || shape === 'parallelogram-right';

  const paragraphHeight = paragraph.getHeight();
  const baseX = node.x + NODE.padding;
  const bodyYStart = node.y + NODE.padding + headerSpace;
  const yOffset = centerText && paragraphHeight < maxHeight
    ? (maxHeight - paragraphHeight) / 2
    : 0;

  // Text/card rotation
  const rotateText = enriched.renderProps?.rotateText;
  const rotateCard = enriched.renderProps?.rotateCard;
  const rotation = rotateText ?? rotateCard;
  if (rotation != null) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    canvas.save();
    canvas.rotate(rotation, cx, cy);
  }

  paragraph.paint(canvas, baseX, bodyYStart + yOffset);

  if (rotation != null) {
    canvas.restore();
  }

  canvas.restore(); // matches the save() + clipRect() at function top (#167)
}

function drawLinkNode(canvas: SkCanvas, node: LinkNode, colorScheme: ColorScheme) {
  const linkColor = getLinkColor(colorScheme);
  const mutedColor = getMutedTextColor(colorScheme);

  const match = node.url.match(/^https?:\/\/([^/?#]+)/);
  const hostname = match ? match[1] : node.url;

  const x = node.x + NODE.padding;
  const urlBarY = node.y + NODE.padding + LINK.urlBarOffset;
  const hostnameY = node.y + NODE.padding + LINK.hostnameOffset;
  const urlY = hostnameY + 24;

  canvas.drawText(node.url, x, urlBarY, useTextPaint(mutedColor), getUrlFont());
  canvas.drawText(hostname, x, hostnameY, useTextPaint(linkColor), getHostnameFont());
  canvas.drawText(node.url, x, urlY, useTextPaint(mutedColor), getUrlFont());
}

function drawFileLabel(canvas: SkCanvas, node: FileNode, colorScheme: ColorScheme) {
  // Where the platform reveals filenames on demand, image nodes carry no
  // baked-in label (#49) — and the hover chip is never recorded here even
  // when one is showing. This snapshot stands in for the live tree during a
  // pinch, so a chip baked into it would freeze mid-gesture, still showing a
  // label the live tree beneath had already dismissed. Mirrors the early
  // return in `SkiaFileRenderer`; the two paths must agree.
  if (!hasInlineLabel(node)) return;

  const textColor = getTextColor(colorScheme);
  const mutedColor = getMutedTextColor(colorScheme);
  const fileName = node.file.split('/').pop() ?? node.file;

  const labelY = isImageFile(node.file)
    ? node.y + node.height - LABEL.imageBaselineFromBottom
    : node.y + node.height / 2 + LABEL.centredBaselineNudge;
  const labelX = node.x + node.width / 2;

  const nameFont = getFileNameFont();
  const nameWidth = nameFont.measureText(fileName).width;
  canvas.drawText(fileName, labelX - nameWidth / 2, labelY, useTextPaint(textColor), nameFont);

  if (node.subpath) {
    const subFont = getFileSubpathFont();
    const subWidth = subFont.measureText(node.subpath).width;
    canvas.drawText(
      node.subpath,
      labelX - subWidth / 2,
      labelY + CHIP.subpathLineHeight,
      useTextPaint(mutedColor),
      subFont,
    );
  }
}

function drawGroupLabel(canvas: SkCanvas, node: GroupNode, colorScheme: ColorScheme) {
  if (!node.label) return;
  const colors = getNodeColors(node.color, colorScheme);
  const font = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.groupLabel, fontWeight: 'bold'});

  const textWidth = font.measureText(node.label).width;
  const pillWidth = textWidth + GROUP_LABEL.paddingX * 2;
  const pillHeight = FONT_SIZE.groupLabel + GROUP_LABEL.paddingY * 2;
  const x = node.x;
  const y = node.y - pillHeight - 8;

  canvas.drawRRect(
    {rect: {x, y, width: pillWidth, height: pillHeight}, rx: EDGE_LABEL.radius, ry: EDGE_LABEL.radius},
    useFillPaint(colors.active),
  );
  canvas.drawText(node.label, x + GROUP_LABEL.paddingX, y + GROUP_LABEL.paddingY + FONT_SIZE.groupLabel, useTextPaint(colors.text), font);
}

function drawEdge(canvas: SkCanvas, edge: CanvasEdge, fromNode: CanvasNode, toNode: CanvasNode) {
  const from = getConnectionPoint(fromNode, edge.fromSide);
  const to = getConnectionPoint(toNode, edge.toSide);
  const color = resolveEdgeColor(edge.color);
  const {cp1, cp2} = computeControlPoints(from, to, edge.fromSide, edge.toSide);

  // Curve
  const curvePath = Skia.PathBuilder.Make()
    .moveTo(from.x, from.y)
    .cubicTo(cp1.x, cp1.y, cp2.x, cp2.y, to.x, to.y)
    .detach();
  canvas.drawPath(curvePath, useStrokePaint(color, 2));

  // Arrows
  const drawArrow = (x: number, y: number, angle: number) => {
    const size = 8;
    const a1 = angle + Math.PI * 0.8;
    const a2 = angle - Math.PI * 0.8;
    const path = Skia.PathBuilder.Make()
      .moveTo(x, y)
      .lineTo(x + size * Math.cos(a1), y + size * Math.sin(a1))
      .lineTo(x + size * Math.cos(a2), y + size * Math.sin(a2))
      .close()
      .detach();
    canvas.drawPath(path, useFillPaint(color));
  };

  if (edge.fromEnd === 'arrow') {
    drawArrow(from.x, from.y, bezierEndAngle(from, cp1));
  }
  if (edge.toEnd !== 'none') {
    drawArrow(to.x, to.y, bezierEndAngle(to, cp2));
  }

  // Label at bezier midpoint
  if (edge.label) {
    const midX = 0.125 * from.x + 0.375 * cp1.x + 0.375 * cp2.x + 0.125 * to.x;
    const midY = 0.125 * from.y + 0.375 * cp1.y + 0.375 * cp2.y + 0.125 * to.y;
    const font = getEdgeLabelFont();
    const labelWidth = font.measureText(edge.label).width + EDGE_LABEL.paddingX * 2;
    const labelHeight = FONT_SIZE.edgeLabel + EDGE_LABEL.paddingY * 2;

    canvas.drawRRect(
      {rect: {x: midX - labelWidth / 2, y: midY - labelHeight / 2, width: labelWidth, height: labelHeight}, rx: EDGE_LABEL.radius, ry: EDGE_LABEL.radius},
      useFillPaint(color),
    );
    canvas.drawText(edge.label, midX - labelWidth / 2 + EDGE_LABEL.paddingX, midY + 4, useTextPaint(EDGE_LABEL_TEXT_COLOR), font);
  }
}

// ---------- Recording ----------

interface RecordingInputs {
  allNodes: CanvasNode[];
  edges: CanvasEdge[];
  nodeMap: Map<string, CanvasNode>;
  colorScheme: ColorScheme;
  /** Directory containing the .canvas file — used to resolve relative `file` paths. */
  basePath?: string;
}

function recordCanvasPicture(inputs: RecordingInputs, imageCache: ImageCache): SkPicture {
  const {allNodes, edges, nodeMap, colorScheme, basePath} = inputs;

  const groupNodes = allNodes.filter((n): n is GroupNode => n.type === 'group');
  const nonGroupNodes = allNodes.filter(n => n.type !== 'group');
  const textNodes = allNodes.filter((n): n is TextNode => n.type === 'text');
  const linkNodes = allNodes.filter((n): n is LinkNode => n.type === 'link');
  const fileNodes = allNodes.filter((n): n is FileNode => n.type === 'file');
  const labelledGroups = groupNodes.filter(n => !!n.label);

  const resolvedEdges = edges
    .map(e => {
      const f = nodeMap.get(e.fromNode);
      const t = nodeMap.get(e.toNode);
      return f && t ? {edge: e, fromNode: f, toNode: t} : null;
    })
    .filter(Boolean) as Array<{edge: CanvasEdge; fromNode: CanvasNode; toNode: CanvasNode}>;

  // Tight bounds from actual content — Skia uses this as a culling hint during replay
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of allNodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  const pad = 100; // headroom for group labels above nodes and edge overshoot
  const bounds = allNodes.length > 0
    ? {x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2}
    : {x: 0, y: 0, width: 1, height: 1};

  return createPicture((canvas: SkCanvas) => {
    // Layer 1: group cards
    for (const node of groupNodes) drawCard(canvas, node, colorScheme);
    // Layer 2: group background images
    for (const node of groupNodes) drawGroupBackground(canvas, node, imageCache, basePath);
    // Layer 3: edges
    for (const {edge, fromNode, toNode} of resolvedEdges) drawEdge(canvas, edge, fromNode, toNode);
    // Layer 4: non-group cards
    for (const node of nonGroupNodes) drawCard(canvas, node, colorScheme);
    // Layer 5: text
    for (const node of textNodes) drawTextNode(canvas, node, colorScheme);
    // Layer 5: links
    for (const node of linkNodes) drawLinkNode(canvas, node, colorScheme);
    // Layer 5: file labels
    for (const node of fileNodes) drawFileLabel(canvas, node, colorScheme);
    // Layer 5: file images
    for (const node of fileNodes) drawFileImage(canvas, node, imageCache, basePath);
    // Layer 6: group labels
    for (const node of labelledGroups) drawGroupLabel(canvas, node, colorScheme);
  }, bounds);
}

// ---------- Hook ----------

/**
 * Records the canvas content as a Skia Picture for replay during pinch-zoom.
 *
 * Raster images are loaded imperatively via Skia.Data.fromURI() +
 * Skia.Image.MakeImageFromEncoded(), then drawn into the Picture alongside
 * all other non-SVG content (cards, text, edges, labels). SVGs are excluded
 * from recording and render live for vector fidelity at any zoom level.
 *
 * The Picture is recorded lazily after inputs change (double-RAF to avoid
 * recording during active layout). Returns null if no Picture is available yet.
 */
export function useCanvasPicture(inputs: RecordingInputs): SkPicture | null {
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const imageCacheRef = useRef<ImageCache>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const [cacheVersion, setCacheVersion] = useState(0);

  // Effect 1 — image loading. Depends only on allNodes (which on mobile is
  // the culled visible set). Loads are fire-and-forget: results always merge
  // into the persistent cache regardless of effect cancellation, and bump
  // cacheVersion to trigger a re-record in Effect 2.
  useEffect(() => {
    const uris = collectImageUris(inputs.allNodes, inputs.basePath);
    const missing = uris.filter(
      uri => !imageCacheRef.current.has(uri) && !inFlightRef.current.has(uri),
    );
    if (missing.length === 0) return;

    missing.forEach(uri => inFlightRef.current.add(uri));

    loadImageCache(missing)
      .then((newEntries) => {
        let added = 0;
        for (const [uri, entry] of newEntries) {
          imageCacheRef.current.set(uri, entry);
          added++;
        }
        if (added > 0) {
          setCacheVersion(v => v + 1);
        }
      })
      .finally(() => {
        missing.forEach(uri => inFlightRef.current.delete(uri));
      });
  }, [inputs.allNodes, inputs.basePath]);

  // Keep a ref to the latest inputs so the recording effect can read them
  // without depending on viewport-volatile array refs (visibleNodes/visibleEdges
  // change on every viewport update, which would cancel the double-RAF).
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  // Effect 2 — Picture recording. Depends on stable content identity
  // (nodeMap, colorScheme) and cacheVersion, NOT on the culled node/edge
  // arrays which change every viewport update during gestures.
  useEffect(() => {
    let cancelled = false;

    requestAnimationFrame(() => {
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        setPicture(recordCanvasPicture(inputsRef.current, imageCacheRef.current));
      });
    });

    return () => { cancelled = true; };
  }, [inputs.nodeMap, inputs.colorScheme, cacheVersion]);

  return picture;
}
