import {type ColorSchemeName} from 'react-native';

export type ColorScheme = 'light' | 'dark';

interface NodeColors {
  card: string;
  border: string;
  background: string;
  active: string;
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
      text: '#E5E7EB',
    };
  }

  return {
    card: hasColor ? hsl(h, Math.round(s * 0.4), 90) : '#FFFFFF',
    border: hasColor ? hsla(h, s, l, 0.55) : '#C8C8CC',
    background: hasColor ? hsla(h, s, l, 0.08) : 'transparent',
    active: hsl(h, s, l),
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

/** Resolve a colorScheme from React Native's useColorScheme(). */
export function resolveScheme(scheme: ColorSchemeName): ColorScheme {
  return scheme === 'light' ? 'light' : 'dark';
}
