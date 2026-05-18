import {useEffect, useState} from 'react';
import {Skia, type SkSVG} from '@shopify/react-native-skia';
import {
  BROKEN_IMAGE_SVG,
  BROKEN_IMAGE_INTRINSIC_HEIGHT,
  BROKEN_IMAGE_INTRINSIC_WIDTH,
} from '../assets/brokenImageSvg';

/**
 * Result of `useValidatedSvg`.
 *
 * `valid: true` — the SVG was fetched, parsed, and constructed by Skia. The
 * caller can render `svg` and use `intrinsicWidth`/`intrinsicHeight` for
 * aspect-ratio fitting without ever calling `svg.width()`/`svg.height()`.
 *
 * `valid: false` — loading or parsing failed. The caller should render a
 * fallback (the bundled broken-image placeholder is exposed via
 * `getBrokenImageSvg()`).
 *
 * `null` — still loading; render nothing.
 */
export type ValidatedSvg =
  | {valid: true; svg: SkSVG; intrinsicWidth: number; intrinsicHeight: number}
  | {valid: false};

const SVG_ROOT_RE = /<svg\b[^>]*>/i;
const VIEWBOX_RE = /\bviewBox\s*=\s*"([^"]+)"/i;
const WIDTH_ATTR_RE = /\bwidth\s*=\s*"([^"]+)"/i;
const HEIGHT_ATTR_RE = /\bheight\s*=\s*"([^"]+)"/i;
const NUMBER_RE = /^-?(\d+(?:\.\d+)?|\.\d+)/;
// DOCTYPE declaration, optionally with an internal subset (the `[ ... ]`
// block where Adobe Illustrator and similar tools stash `<!ENTITY ...>`
// definitions). Skia's SVG parser doesn't expand entities; an unresolved
// `&ns_extend;` reference inside an `xmlns:` attribute prevents the root
// `<svg>` element from registering and the whole document silently
// renders empty.
const DOCTYPE_WITH_SUBSET_RE = /<!DOCTYPE\b[^[>]*\[[\s\S]*?\][^>]*>/g;
const DOCTYPE_SIMPLE_RE = /<!DOCTYPE\b[^>]*>/g;
// Catch any leftover entity references inside attributes
// (`xmlns:x="&ns_extend;"`) — replace with empty string.
const ENTITY_REF_IN_ATTR_RE = /&[A-Za-z_][\w.-]*;/g;
// Match the root `<svg ...>` opening tag so we can strip its `width` /
// `height` attributes. We always pass explicit width/height to
// `<ImageSVG>` from the parsed viewBox; leaving the document's own
// width/height in place lets values like `100%` (which resolve against
// an undefined parent box) win and render the SVG to nothing.
const SVG_ROOT_TAG_RE = /<svg\b[^>]*>/i;
const ROOT_WIDTH_ATTR_RE = /\s+width\s*=\s*"[^"]*"/i;
const ROOT_HEIGHT_ATTR_RE = /\s+height\s*=\s*"[^"]*"/i;

/**
 * Parse a length value from an SVG attribute. Accepts a leading number with
 * optional unit suffix (`px`, `pt`, etc.) — units are ignored. Percent and
 * non-numeric values return `null`, signalling "no usable intrinsic size".
 */
function parseSvgLength(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.endsWith('%')) return null;
  const m = NUMBER_RE.exec(trimmed);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Extract intrinsic width/height from an SVG document's text. Tries
 * `viewBox` first (always usable), then falls back to `width`/`height`
 * attributes. Returns `null` if no usable intrinsic size can be derived —
 * such SVGs render stretched into the destination box, since no caller
 * can compute a `fitbox('contain', ...)` transform without a source size.
 */
export function extractSvgIntrinsicSize(
  svgText: string,
): {width: number; height: number} | null {
  const rootMatch = SVG_ROOT_RE.exec(svgText);
  if (!rootMatch) return null;
  const root = rootMatch[0];

  const vb = VIEWBOX_RE.exec(root);
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
      const [, , w, h] = parts;
      if (w > 0 && h > 0) return {width: w, height: h};
    }
  }

  const w = parseSvgLength(WIDTH_ATTR_RE.exec(root)?.[1]);
  const h = parseSvgLength(HEIGHT_ATTR_RE.exec(root)?.[1]);
  if (w != null && h != null) return {width: w, height: h};

  return null;
}

/**
 * Strip XML constructs that Skia's SVG parser chokes on but a browser would
 * silently expand or ignore. Without this, files exported by Adobe Illustrator
 * (DOCTYPE-with-`<!ENTITY>` definitions referenced from `xmlns:` attributes)
 * parse to a non-null but visually empty SVG.
 */
export function preprocessSvgForSkia(svgText: string): string {
  const stripped = svgText
    .replace(DOCTYPE_WITH_SUBSET_RE, '')
    .replace(DOCTYPE_SIMPLE_RE, '')
    .replace(ENTITY_REF_IN_ATTR_RE, '');
  // Strip width/height from the root <svg> tag only — see SVG_ROOT_TAG_RE
  // for the rationale.
  return stripped.replace(SVG_ROOT_TAG_RE, (rootTag) =>
    rootTag.replace(ROOT_WIDTH_ATTR_RE, '').replace(ROOT_HEIGHT_ATTR_RE, ''),
  );
}

let _brokenImageSvg: SkSVG | null = null;

/**
 * Lazily-constructed Skia SVG instance for the broken-image placeholder.
 * Cached at module scope so all renderers share one instance and we don't
 * re-parse the (always-valid) inline XML on every render.
 */
export function getBrokenImageSvg(): {
  svg: SkSVG;
  intrinsicWidth: number;
  intrinsicHeight: number;
} | null {
  if (!_brokenImageSvg) {
    _brokenImageSvg = Skia.SVG.MakeFromString(BROKEN_IMAGE_SVG);
  }
  if (!_brokenImageSvg) return null;
  return {
    svg: _brokenImageSvg,
    intrinsicWidth: BROKEN_IMAGE_INTRINSIC_WIDTH,
    intrinsicHeight: BROKEN_IMAGE_INTRINSIC_HEIGHT,
  };
}

/**
 * Load and validate an SVG without ever calling `svg.width()` / `svg.height()`.
 *
 * `useSVG()` from `@shopify/react-native-skia` returns a non-null host object
 * even when the underlying `SkSVGDOM` is null (failed fetch, malformed XML,
 * Skia parser couldn't fully construct). Calling `.width()` on that object
 * dereferences a null pointer and segfaults the app — see #122.
 *
 * This hook owns the loader: fetch the file as text, validate it has an
 * `<svg ...>` root, derive intrinsic size from `viewBox` / `width` / `height`
 * attributes in JS, then construct via `Skia.SVG.MakeFromString`. Any failure
 * resolves to `{valid: false}` so the caller can render a placeholder. We
 * never read intrinsic size from the JSI side.
 *
 * Returns `null` while loading. Once resolved, returns `ValidatedSvg`.
 */
export function useValidatedSvg(uri: string | null): ValidatedSvg | null {
  const [result, setResult] = useState<ValidatedSvg | null>(null);

  useEffect(() => {
    if (!uri) {
      setResult({valid: false});
      return;
    }

    let cancelled = false;
    setResult(null);

    (async () => {
      try {
        const response = await fetch(uri);
        if (!response.ok) {
          if (!cancelled) setResult({valid: false});
          return;
        }
        const rawText = await response.text();
        if (!SVG_ROOT_RE.test(rawText)) {
          if (!cancelled) setResult({valid: false});
          return;
        }
        const text = preprocessSvgForSkia(rawText);
        const intrinsic = extractSvgIntrinsicSize(text);
        const svg = Skia.SVG.MakeFromString(text);
        if (!svg || !intrinsic) {
          if (!cancelled) setResult({valid: false});
          return;
        }
        if (!cancelled) {
          setResult({
            valid: true,
            svg,
            intrinsicWidth: intrinsic.width,
            intrinsicHeight: intrinsic.height,
          });
        }
      } catch {
        if (!cancelled) setResult({valid: false});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uri]);

  return result;
}
