import React from 'react';
import {Group, Line, Text, vec, rect, matchFont} from '@shopify/react-native-skia';
import type {TextNode} from '../../core';
import type {EnrichedTextNode} from '../extensions/cssclasses';
import {hasCallouts, parseCallouts, getLabels} from '../extensions/callouts';
import {toPlainText} from '../markdown';
import {getMutedTextColor, getTextColor, type ColorScheme} from '../theme';
import {ZONE} from '../metrics';
import {H4} from '../typography';
import {shapeClipPath} from './shapes';

const DEG_TO_RAD = Math.PI / 180;

let _labelFont: ReturnType<typeof matchFont> | null = null;
function getLabelFont() {
  if (!_labelFont) {
    _labelFont = matchFont({fontFamily: 'System', fontSize: H4.fontSize, fontWeight: 'bold'});
  }
  return _labelFont;
}

interface Props {
  node: TextNode;
  colorScheme: ColorScheme;
  offsetX: number;
  offsetY: number;
}

/**
 * Renders the rotated side-label of a card (`cc-label-left` / `cc-label-right`)
 * as its own top-level Skia element.
 *
 * Why a dedicated renderer: react-native-skia's `<Group transform>` is a no-op
 * when the Group is nested inside an element array (the parent's children
 * list) — it only applies at a component's top-level return (#96 / #64). By
 * rendering labels here — as a sibling in `SkiaCanvasLayer`, separate from the
 * card's body/header/footer text — the rotation Group is always top-level, so
 * labels rotate correctly even on *mixed-zone* cards (a label combined with
 * body / header / footer). `SkiaTextRenderer` no longer renders labels at all.
 *
 * Mirrors the imperative label drawing in `useCanvasPicture.drawTextNode`
 * (canvas.rotate) so the live tree and the pinch Picture overlay match.
 */
export function SkiaCardLabelRenderer({node, colorScheme, offsetX, offsetY}: Props) {
  const enriched = node as TextNode & Partial<EnrichedTextNode>;
  const rawContent = enriched.displayText ?? node.text;

  // Cheap gate: only text with callout syntax can carry a label.
  if (!hasCallouts(rawContent)) return null;
  const {callouts} = parseCallouts(rawContent);
  const labels = getLabels(callouts);
  if (labels.length === 0) return null;

  const textColor = getTextColor(colorScheme);
  const mutedColor = getMutedTextColor(colorScheme);
  const font = getLabelFont();
  if (!font) return null;

  const cx = node.x + offsetX + node.width / 2;
  const cy = node.y + offsetY + node.height / 2;

  // Clip to the card outline so a long label can't bleed past a curved /
  // slanted edge — same rule as the body text (#53). Shape path when present,
  // bounding rect otherwise.
  const shapeClip = shapeClipPath(
    enriched.renderProps?.shape, node.x + offsetX, node.y + offsetY, node.width, node.height,
  );
  const clipRegion = shapeClip ?? rect(node.x + offsetX, node.y + offsetY, node.width, node.height);

  const elements: React.ReactElement[] = [];
  labels.forEach((label, li) => {
    const labelText = toPlainText(label.text);
    if (!labelText) return;
    const labelTextWidth = font.measureText(labelText).width;
    const isLeft = label.zone === 'label-left';
    const rotation = isLeft ? -90 : 90;

    // Each label rotates around the card centre. Multiple labels (left + right)
    // each get their own rotation Group.
    const labelChildren: React.ReactElement[] = [
      <Text
        key="text"
        x={cx - labelTextWidth / 2}
        y={cy + H4.fontSize / 2}
        text={labelText}
        font={font}
        color={textColor}
      />,
    ];
    if (!label.noBorder) {
      const borderX = isLeft
        ? node.x + offsetX + ZONE.height
        : node.x + offsetX + node.width - ZONE.height;
      labelChildren.push(
        <Line
          key="border"
          p1={vec(borderX, node.y + offsetY + 1)}
          p2={vec(borderX, node.y + offsetY + node.height - 1)}
          color={mutedColor}
          strokeWidth={0.5}
        />,
      );
    }

    elements.push(
      <Group
        key={`label-${label.zone}-${li}`}
        transform={[
          {translateX: cx}, {translateY: cy},
          {rotate: rotation * DEG_TO_RAD},
          {translateX: -cx}, {translateY: -cy},
        ]}>
        {labelChildren}
      </Group>,
    );
  });

  if (elements.length === 0) return null;

  return <Group clip={clipRegion}>{elements}</Group>;
}
