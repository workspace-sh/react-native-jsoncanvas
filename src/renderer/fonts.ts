import {FontEdging, FontHinting, matchFont, type SkFont} from 'react-native-skia';

/**
 * A font for single-line text on the canvas (labels, link and file names),
 * as `matchFont` makes one. It's drawn at one size and scaled by the camera,
 * so its glyphs are unhinted and placed to subpixels with unrounded
 * advances: hinted, Android rounds each advance to a whole pixel at the
 * small size, and zoomed in the letters drift apart ("Render er").
 */
export function canvasFont(spec: Parameters<typeof matchFont>[0]): SkFont {
  const font = matchFont(spec);
  font.setHinting(FontHinting.None);
  font.setSubpixel(true);
  font.setLinearMetrics(true);
  font.setEdging(FontEdging.AntiAlias);
  return font;
}
