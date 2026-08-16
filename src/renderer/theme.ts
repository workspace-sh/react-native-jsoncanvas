import {type ColorSchemeName} from 'react-native';

export type ColorScheme = 'light' | 'dark';

interface NodeColors {
  card: string;
  border: string;
  background: string;
  active: string;
  /** Same hue as `active` at alpha 0. Used as the fade-to stop for
   *  `cc-card-gradient-Ndeg` so the midpoint of the gradient stays inside
   *  the active colour's family — `[active, 'transparent']` interpolates
   *  through grey/black in straight RGBA space and reads as muddy on a
   *  light canvas background. See #163. */
  activeTransparent: string;
  text: string;
}

// HSL presets for each canvas colour code.
// Values chosen to match the Obsidian/hesprs viewer aesthetic.
const PRESETS: Record<string, [number, number, number]> = {
  '0': [0, 0, 40],      // neutral gray (no colour set)
  '1': [2, 78, 55],     // red
  '2': [29, 90, 55],    // orange
  '3': [48, 90, 55],    // yellow
  '4': [142, 60, 45],   // green
  '5': [204, 80, 55],   // cyan/blue
  '6': [270, 60, 55],   // purple
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function hsl(h: number, s: number, l: number): string {
  return rgbToHex(...hslToRgb(h, s, l));
}

function hsla(h: number, s: number, l: number, a: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  const alpha = Math.round(a * 255).toString(16).padStart(2, '0');
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${alpha}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function resolveHsl(color?: string): [number, number, number] {
  if (!color) return PRESETS['0'];
  if (color.startsWith('#') && color.length >= 7) return hexToHsl(color);
  return PRESETS[color] ?? PRESETS['0'];
}

/**
 * Derive a full colour palette for a node or edge from a canvas colour value.
 * Mirrors the hesprs viewer's HSL processing approach.
 */
export function getNodeColors(color: string | undefined, scheme: ColorScheme): NodeColors {
  const [h, s, l] = resolveHsl(color);
  const hasColor = color !== undefined && color !== '0';

  if (scheme === 'dark') {
    return {
      card: hasColor ? hsl(h, Math.round(s * 0.35), 24) : '#323238',
      border: hasColor ? hsla(h, s, Math.min(l, 65), 0.75) : '#505058',
      background: hasColor ? hsla(h, s, l, 0.15) : 'transparent',
      active: hsl(h, s, l),
      activeTransparent: hsla(h, s, l, 0),
      text: '#E5E7EB',
    };
  }

  return {
    card: hasColor ? hsl(h, Math.round(s * 0.4), 90) : '#FFFFFF',
    border: hasColor ? hsla(h, s, l, 0.55) : '#C8C8CC',
    background: hasColor ? hsla(h, s, l, 0.08) : 'transparent',
    active: hsl(h, s, l),
    activeTransparent: hsla(h, s, l, 0),
    text: '#1F2937',
  };
}

/** Canvas background colour. */
export function getCanvasBackground(scheme: ColorScheme): string {
  return scheme === 'dark' ? '#1A1A1A' : '#F5F5F5';
}

/** Secondary/muted text colour for the given scheme. */
export function getMutedTextColor(scheme: ColorScheme): string {
  return scheme === 'dark' ? '#9CA3AF' : '#6B7280';
}

/**
 * Primary text colour for the given scheme.
 *
 * Same values as `getNodeColors().text`, exposed on its own for text drawn
 * outside a node's palette — labels and chips, which have no canvas colour
 * of their own to derive from.
 */
export function getTextColor(scheme: ColorScheme): string {
  return scheme === 'dark' ? '#E5E7EB' : '#1F2937';
}

/**
 * Backing for small floating surfaces drawn over canvas content — currently
 * the file-node hover chip.
 *
 * Near-opaque rather than flat: a filename has to stay legible over whatever
 * artwork sits behind it, but the surface should still read as sitting *above*
 * the canvas rather than punched out of it.
 */
export function getChipBackground(scheme: ColorScheme): string {
  return scheme === 'dark' ? '#1C1C1EEB' : '#FFFFFFF0';
}

/** Hyperlink text colour for the given scheme. */
export function getLinkColor(scheme: ColorScheme): string {
  return scheme === 'dark' ? '#60A5FA' : '#2563EB';
}

/**
 * Edge colours.
 *
 * Deliberately *not* the node presets above: edges are drawn as strokes on the
 * canvas background rather than as filled cards, so they use fully saturated
 * hues where `getNodeColors` desaturates and lightens for a card fill. Same
 * colour *codes* from the JSON Canvas spec, different rendering intent.
 */
export const EDGE_PRESET_COLORS: Record<string, string> = {
  '1': '#EF4444',
  '2': '#F97316',
  '3': '#EAB308',
  '4': '#22C55E',
  '5': '#3B82F6',
  '6': '#A855F7',
};

export const DEFAULT_EDGE_COLOR = '#6B7280';

/**
 * Resolve an edge's `color` field to a concrete colour.
 *
 * Per the JSON Canvas spec the field is either a preset code (`"1"`–`"6"`) or
 * a hex string; anything else falls back to the default.
 */
export function resolveEdgeColor(color?: string): string {
  if (!color) return DEFAULT_EDGE_COLOR;
  if (color.startsWith('#')) return color;
  return EDGE_PRESET_COLORS[color] ?? DEFAULT_EDGE_COLOR;
}

/**
 * Edge label text. Scheme-independent: labels sit on a pill filled with the
 * edge's own colour, so the contrast that matters is against that fill, not
 * against the canvas.
 */
export const EDGE_LABEL_TEXT_COLOR = '#FFFFFF';

/**
 * Drop shadow under cards that opt into one (`cc-card-shadow`).
 * Scheme-independent — a shadow is an absence of light in both schemes.
 */
export const CARD_SHADOW_COLOR = 'rgba(0,0,0,0.4)';

export interface MinimapColors {
  border: string;
  viewportStroke: string;
}

/** Minimap chrome: its border, and the stroke marking the current viewport. */
export function getMinimapColors(scheme: ColorScheme): MinimapColors {
  return scheme === 'dark'
    ? {border: '#3F3F46', viewportStroke: '#FBBF24'}
    : {border: '#D4D4D8', viewportStroke: '#F59E0B'};
}

/** Resolve a colorScheme from React Native's useColorScheme(). */
export function resolveScheme(scheme: ColorSchemeName): ColorScheme {
  return scheme === 'light' ? 'light' : 'dark';
}
