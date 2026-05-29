import {color, Color, type OKLCH} from 'use-color/core';
import {type ColorSchemeName} from 'react-native';

export type ColorScheme = 'light' | 'dark';

interface NodeColors {
  card: string;
  border: string;
  background: string;
  active: string;
  /** Same hue as `active` at alpha 0. Used as the fade-to stop for
   *  `cc-card-gradient-Ndeg` so the midpoint of the gradient stays inside
   *  the active colour's family — interpolating toward a literal transparent
   *  black reads as muddy on a light canvas background. See #163. */
  activeTransparent: string;
  text: string;
}

// OKLCH presets for JSON Canvas colour codes 0–6.
//
// OKLCH gives perceptually uniform colour: a fixed L keeps perceived
// brightness consistent across hues, and C (chroma) controls vividness
// independently of hue. The old HSL presets all sat at L=55%, which read
// very differently across hues — yellow appeared far brighter than green.
//
// Yellow (code 3) intentionally carries a higher L (0.78 vs 0.62) because
// that is perceptually correct: yellow has inherently higher luminosity than
// red, green or blue at equivalent vividity. Matching L=0.62 would produce
// a muddy brown-gold.
//
// Values: [L (0–1), C (chroma), H° (0–360)]
const PRESETS: Record<string, [number, number, number]> = {
  '0': [0.50, 0.000,   0],  // neutral gray  (achromatic: H is ignored)
  '1': [0.62, 0.190,  25],  // red
  '2': [0.62, 0.190,  55],  // orange
  '3': [0.78, 0.155,  98],  // yellow
  '4': [0.62, 0.175, 145],  // green
  '5': [0.62, 0.175, 222],  // blue
  '6': [0.62, 0.175, 302],  // purple
};

/** Build a Color from raw OKLCH coordinates.
 *  Uses the object overload so TypeScript can check the shape statically,
 *  with no template-string formatting or AsValidColor brand requirement. */
function fromOklch(l: number, c: number, h: number): Color {
  return color({l, c, h, a: 1} as OKLCH);
}

/** Resolve canvas colour input to OKLCH [L, C, H°].
 *  Accepts preset codes ('1'–'6'), undefined, or a hex string (#rrggbb).
 *  Unknown codes fall back to the neutral gray preset. */
function resolveOklch(colorCode?: string): [number, number, number] {
  if (!colorCode) {
    return [...PRESETS['0']] as [number, number, number];
  }
  if (colorCode.startsWith('#') && colorCode.length >= 7) {
    // Color.from() accepts ColorInputValue which includes plain `string`,
    // avoiding the AsValidColor branded-string constraint of color().
    const {l, c, h} = Color.from(colorCode).toOklch();
    // Achromatic colours return h:0 — no NaN guard needed.
    return [l, c, h];
  }
  const preset = PRESETS[colorCode];
  return preset
    ? ([...preset] as [number, number, number])
    : ([...PRESETS['0']] as [number, number, number]);
}

/**
 * Derive a full colour palette for a node or edge from a canvas colour value.
 * All colour operations happen in OKLCH space — hue, lightness, and alpha
 * adjustments are perceptually uniform, and gamut mapping is automatic.
 */
export function getNodeColors(colorCode: string | undefined, scheme: ColorScheme): NodeColors {
  const [l, c, h] = resolveOklch(colorCode);
  const hasColor = colorCode !== undefined && colorCode !== '0';

  const active = fromOklch(l, c, h);
  const activeHex = active.toHex();
  // Same hue at full transparency — fading to `transparent` (#00000000)
  // would interpolate through black mid-gradient; same-hue zero-alpha stays
  // inside the colour family. See #163.
  const activeTransparent = active.alpha(0).toHex8();

  if (scheme === 'dark') {
    return {
      // Desaturated (C×0.35) and very dark — a deep hue-tinted background.
      card: hasColor ? fromOklch(0.20, c * 0.35, h).toHex() : '#323238',
      border: hasColor ? active.alpha(0.75).toHex8() : '#505058',
      background: hasColor ? active.alpha(0.15).toHex8() : 'transparent',
      active: activeHex,
      activeTransparent,
      text: '#E5E7EB',
    };
  }

  return {
    // Desaturated (C×0.40) and very light — a barely-tinted near-white.
    card: hasColor ? fromOklch(0.93, c * 0.40, h).toHex() : '#FFFFFF',
    border: hasColor ? active.alpha(0.55).toHex8() : '#C8C8CC',
    background: hasColor ? active.alpha(0.08).toHex8() : 'transparent',
    active: activeHex,
    activeTransparent,
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
