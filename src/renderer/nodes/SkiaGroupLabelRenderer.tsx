import React from 'react';
import {Text, RoundedRect, matchFont} from '@shopify/react-native-skia';
import type {GroupNode} from '../../core';
import {getNodeColors, type ColorScheme} from '../theme';
import {GROUP_LABEL} from '../metrics';
import {FONT_SIZE} from '../typography';

interface Props {
  node: GroupNode;
  colorScheme: ColorScheme;
  offsetX: number;
  offsetY: number;
}


let _font: ReturnType<typeof matchFont> | null = null;
function getFont() {
  if (!_font) _font = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.groupLabel, fontWeight: 'bold'});
  return _font;
}

/**
 * Renders group node label pills via Skia, bypassing the
 * react-native-macos Text rendering limitation.
 */
export function SkiaGroupLabelRenderer({node, colorScheme, offsetX, offsetY}: Props) {
  const font = getFont();
  if (!font || !node.label) return null;

  const colors = getNodeColors(node.color, colorScheme);
  const textWidth = font.measureText(node.label).width;
  const pillWidth = textWidth + GROUP_LABEL.paddingX * 2;
  const pillHeight = FONT_SIZE.groupLabel + GROUP_LABEL.paddingY * 2;

  const x = node.x + offsetX;
  const y = node.y + offsetY - pillHeight - 8;

  return (
    <>
      <RoundedRect
        x={x}
        y={y}
        width={pillWidth}
        height={pillHeight}
        r={6}
        color={colors.active}
      />
      <Text
        x={x + GROUP_LABEL.paddingX}
        y={y + GROUP_LABEL.paddingY + FONT_SIZE.groupLabel}
        text={node.label}
        font={font}
        color={colors.text}
      />
    </>
  );
}
