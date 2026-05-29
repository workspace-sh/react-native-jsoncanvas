import {getNodeColors, getCanvasBackground, getMutedTextColor, resolveScheme} from '../theme';

// Regex helpers
const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX8 = /^#[0-9a-f]{8}$/i;
const HEX6_OR_TRANSPARENT = /^(#[0-9a-f]{6}|#[0-9a-f]{8}|transparent)$/i;

function isValidHex6(s: string) {
  return HEX6.test(s);
}
function isValidHex8(s: string) {
  return HEX8.test(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Output shape

describe('getNodeColors — output shape', () => {
  const schemes = ['dark', 'light'] as const;
  const codes = ['0', '1', '2', '3', '4', '5', '6', undefined];

  for (const scheme of schemes) {
    for (const code of codes) {
      it(`returns valid hex for code=${code ?? 'undefined'}, scheme=${scheme}`, () => {
        const c = getNodeColors(code, scheme);
        expect(HEX6_OR_TRANSPARENT.test(c.card)).toBe(true);
        expect(HEX6_OR_TRANSPARENT.test(c.border) || HEX8.test(c.border)).toBe(true);
        expect(HEX6_OR_TRANSPARENT.test(c.background) || HEX8.test(c.background)).toBe(true);
        expect(isValidHex6(c.active)).toBe(true);
        expect(isValidHex8(c.activeTransparent)).toBe(true);
        expect(isValidHex6(c.text)).toBe(true);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// activeTransparent contract

describe('activeTransparent', () => {
  it('shares the same RGB as active with 00 alpha', () => {
    for (const code of ['1', '2', '3', '4', '5', '6']) {
      const {active, activeTransparent} = getNodeColors(code, 'dark');
      // toHex8 appends alpha after the 6 RGB digits
      expect(activeTransparent.slice(0, 7).toLowerCase()).toBe(active.toLowerCase());
      expect(activeTransparent.slice(-2).toLowerCase()).toBe('00');
    }
  });

  it('is the same in dark and light modes', () => {
    for (const code of ['1', '3', '5']) {
      const dark = getNodeColors(code, 'dark');
      const light = getNodeColors(code, 'light');
      expect(dark.activeTransparent).toBe(light.activeTransparent);
      expect(dark.active).toBe(light.active);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No-colour defaults (code=undefined and code='0')

describe('no-colour defaults', () => {
  it('returns identical results for undefined and "0"', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const fromUndef = getNodeColors(undefined, scheme);
      const from0 = getNodeColors('0', scheme);
      expect(fromUndef).toEqual(from0);
    }
  });

  it('uses hardcoded card/border/background in dark mode', () => {
    const c = getNodeColors(undefined, 'dark');
    expect(c.card).toBe('#323238');
    expect(c.border).toBe('#505058');
    expect(c.background).toBe('transparent');
  });

  it('uses hardcoded card/border/background in light mode', () => {
    const c = getNodeColors(undefined, 'light');
    expect(c.card).toBe('#FFFFFF');
    expect(c.border).toBe('#C8C8CC');
    expect(c.background).toBe('transparent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preset distinctness — each code should produce a unique active colour

describe('preset distinctness', () => {
  it('produces unique active hex for codes 1–6', () => {
    const actives = ['1', '2', '3', '4', '5', '6'].map(
      code => getNodeColors(code, 'dark').active,
    );
    const unique = new Set(actives);
    expect(unique.size).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dark vs light card contrast

describe('dark vs light card', () => {
  it('dark card is darker than light card (lower R+G+B sum)', () => {
    for (const code of ['1', '3', '5']) {
      const dark = getNodeColors(code, 'dark');
      const light = getNodeColors(code, 'light');

      const hexToSum = (hex: string) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return r + g + b;
      };
      expect(hexToSum(dark.card)).toBeLessThan(hexToSum(light.card));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hex colour input (user-provided #rrggbb)

describe('hex colour input', () => {
  it('accepts a valid 6-digit hex and returns valid palette', () => {
    const c = getNodeColors('#FF5733', 'dark');
    expect(isValidHex6(c.active)).toBe(true);
    expect(isValidHex8(c.activeTransparent)).toBe(true);
    expect(c.activeTransparent.slice(0, 7).toLowerCase()).toBe(c.active.toLowerCase());
    expect(c.activeTransparent.slice(-2).toLowerCase()).toBe('00');
  });

  it('accepts a hex and produces chromatic (non-default) card', () => {
    const cHex = getNodeColors('#0000FF', 'dark');
    const cNone = getNodeColors(undefined, 'dark');
    expect(cHex.card).not.toBe(cNone.card);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown code fallback

describe('unknown preset code', () => {
  it('uses neutral-gray OKLCH for unknown codes (active colour is a gray hex)', () => {
    const unknown = getNodeColors('99', 'dark');
    // Active resolves to the neutral-gray preset → achromatic hex
    // (R === G === B in the active colour)
    const hex = unknown.active.slice(1); // strip #
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('still produces valid hex palette for unknown codes', () => {
    const unknown = getNodeColors('99', 'dark');
    expect(HEX6_OR_TRANSPARENT.test(unknown.card) || HEX8.test(unknown.card)).toBe(true);
    expect(isValidHex6(unknown.active)).toBe(true);
    expect(isValidHex8(unknown.activeTransparent)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility functions

describe('getCanvasBackground', () => {
  it('returns dark hex in dark mode', () => {
    expect(isValidHex6(getCanvasBackground('dark'))).toBe(true);
  });
  it('returns light hex in light mode', () => {
    expect(isValidHex6(getCanvasBackground('light'))).toBe(true);
  });
  it('dark is darker than light', () => {
    const dark = parseInt(getCanvasBackground('dark').slice(1), 16);
    const light = parseInt(getCanvasBackground('light').slice(1), 16);
    expect(dark).toBeLessThan(light);
  });
});

describe('getMutedTextColor', () => {
  it('returns valid hex for both schemes', () => {
    expect(isValidHex6(getMutedTextColor('dark'))).toBe(true);
    expect(isValidHex6(getMutedTextColor('light'))).toBe(true);
  });
});

describe('resolveScheme', () => {
  it('maps light → light', () => expect(resolveScheme('light')).toBe('light'));
  it('maps dark → dark', () => expect(resolveScheme('dark')).toBe('dark'));
  it('maps null → dark', () => expect(resolveScheme(null)).toBe('dark'));
});
