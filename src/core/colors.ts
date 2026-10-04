/**
 * HSL presets (degrees, %, %) for each JSON Canvas colour code, "0" being no
 * colour set. Values chosen to match the Obsidian/hesprs viewer aesthetic.
 *
 * Here rather than in a renderer so every rasteriser draws the same colours:
 * Skia (`renderer/theme.ts`) and Cairo (`gtk/render.ts`).
 */
export const COLOR_PRESETS: Record<string, [number, number, number]> = {
  '0': [0, 0, 40], // neutral gray (no colour set)
  '1': [2, 78, 55], // red
  '2': [29, 90, 55], // orange
  '3': [48, 90, 55], // yellow
  '4': [142, 60, 45], // green
  '5': [204, 80, 55], // cyan/blue
  '6': [270, 60, 55], // purple
};
