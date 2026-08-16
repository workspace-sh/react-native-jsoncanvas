import React from 'react';
import {Text, RoundedRect, matchFont} from '@shopify/react-native-skia';
import type {FileNode} from '../../core';
import type {ColorScheme} from '../theme';

interface Props {
  node: FileNode;
  colorScheme: ColorScheme;
  offsetX: number;
  offsetY: number;
  /**
   * Pointer is over this node (macOS hover). Only meaningful for image file
   * nodes, whose label is otherwise hidden — see the module comment.
   */
  revealed?: boolean;
}

let _nameFont: ReturnType<typeof matchFont> | null = null;
let _subpathFont: ReturnType<typeof matchFont> | null = null;

function getNameFont() {
  if (!_nameFont) _nameFont = matchFont({fontFamily: 'System', fontSize: 12, fontWeight: 'bold'});
  return _nameFont;
}

function getSubpathFont() {
  if (!_subpathFont) _subpathFont = matchFont({fontFamily: 'System', fontSize: 10});
  return _subpathFont;
}

const IMAGE_RE = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i;

// Chip geometry, in world units (scaled with the camera like every other
// node-space measurement).
const CHIP_PAD_X = 6;
const CHIP_PAD_Y = 4;
const CHIP_RADIUS = 4;
const CHIP_GAP = 6; // between the node's bottom edge and the chip

/**
 * File-node labels.
 *
 * Non-image file nodes (`.md`, `.pdf`, …) have no visual content of their
 * own, so the filename *is* the card — always drawn, unchanged.
 *
 * Image file nodes render the image as their content, and there the filename
 * was pure noise: on stencil grids it overflowed into neighbouring cards and
 * dominated the layout (#49). It's now hidden until asked for — hover on
 * macOS — and drawn as a chip rather than bare text, so it stays legible
 * over whatever artwork sits behind it.
 *
 * The chip is deliberately absent from the Picture recording path
 * (`useCanvasPicture`'s `drawFileLabel`): that snapshot exists to stand in
 * for the live tree during a pinch, and a hover chip baked into it would
 * freeze mid-gesture. Hover is a live-tree-only affordance.
 */
export function SkiaFileRenderer({node, colorScheme, offsetX, offsetY, revealed = false}: Props) {
  const nameFont = getNameFont();
  const subpathFont = getSubpathFont();
  if (!nameFont) return null;

  const isDark = colorScheme === 'dark';
  const textColor = isDark ? '#E5E7EB' : '#1F2937';
  const mutedColor = isDark ? '#9CA3AF' : '#6B7280';
  const fileName = node.file.split('/').pop() ?? node.file;
  const isImage = IMAGE_RE.test(node.file);

  const labelX = node.x + offsetX + node.width / 2;
  const nameWidth = nameFont.measureText(fileName).width;

  if (isImage) {
    if (!revealed) return null;

    // Below the node rather than over it — the image is the content, and a
    // chip laid across it would obscure the very thing being identified.
    const chipTextY = node.y + offsetY + node.height + CHIP_GAP + nameFont.getSize();
    const subWidth = node.subpath ? subpathFont?.measureText(node.subpath).width ?? 0 : 0;
    const chipWidth = Math.max(nameWidth, subWidth) + CHIP_PAD_X * 2;
    const chipHeight =
      nameFont.getSize() + (node.subpath ? 14 : 0) + CHIP_PAD_Y * 2;

    return (
      <>
        <RoundedRect
          x={labelX - chipWidth / 2}
          y={chipTextY - nameFont.getSize() - CHIP_PAD_Y}
          width={chipWidth}
          height={chipHeight}
          r={CHIP_RADIUS}
          color={isDark ? 'rgba(28, 28, 30, 0.92)' : 'rgba(255, 255, 255, 0.94)'}
        />
        <Text
          x={labelX - nameWidth / 2}
          y={chipTextY}
          text={fileName}
          font={nameFont}
          color={textColor}
        />
        {node.subpath && subpathFont && (
          <Text
            x={labelX - subWidth / 2}
            y={chipTextY + 14}
            text={node.subpath}
            font={subpathFont}
            color={mutedColor}
          />
        )}
      </>
    );
  }

  const labelY = node.y + offsetY + node.height / 2 + 4;
  const nameX = labelX - nameWidth / 2;

  return (
    <>
      <Text x={nameX} y={labelY} text={fileName} font={nameFont} color={textColor} />
      {node.subpath && subpathFont && (
        <Text
          x={labelX - subpathFont.measureText(node.subpath).width / 2}
          y={labelY + 14}
          text={node.subpath}
          font={subpathFont}
          color={mutedColor}
        />
      )}
    </>
  );
}
