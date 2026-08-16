import React from 'react';
import {Text, RoundedRect, matchFont} from '@shopify/react-native-skia';
import type {FileNode} from '../../core';
import {getChipBackground, getMutedTextColor, getTextColor, type ColorScheme} from '../theme';
import {CHIP, LABEL} from '../metrics';
import {hasInlineLabel, isImageFile} from '../utils/fileNodeLabel';

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

  const textColor = getTextColor(colorScheme);
  const mutedColor = getMutedTextColor(colorScheme);
  const fileName = node.file.split('/').pop() ?? node.file;
  const isImage = isImageFile(node.file);
  const inline = hasInlineLabel(node);

  const labelX = node.x + offsetX + node.width / 2;
  const nameWidth = nameFont.measureText(fileName).width;

  // Image node on a platform that can reveal on demand: nothing inline, and
  // the chip only once the pointer is actually over it.
  if (isImage && !inline) {
    if (!revealed) return null;

    // Below the node rather than over it — the image is the content, and a
    // chip laid across it would obscure the very thing being identified.
    const chipTextY = node.y + offsetY + node.height + CHIP.gap + nameFont.getSize();
    const subWidth = node.subpath ? subpathFont?.measureText(node.subpath).width ?? 0 : 0;
    const chipWidth = Math.max(nameWidth, subWidth) + CHIP.paddingX * 2;
    const chipHeight =
      nameFont.getSize() + (node.subpath ? CHIP.subpathLineHeight : 0) + CHIP.paddingY * 2;

    return (
      <>
        <RoundedRect
          x={labelX - chipWidth / 2}
          y={chipTextY - nameFont.getSize() - CHIP.paddingY}
          width={chipWidth}
          height={chipHeight}
          r={CHIP.radius}
          color={getChipBackground(colorScheme)}
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
            y={chipTextY + CHIP.subpathLineHeight}
            text={node.subpath}
            font={subpathFont}
            color={mutedColor}
          />
        )}
      </>
    );
  }

  // Inline label: under the image on an image node (whose destination box
  // reserves room for it), vertically centred on a node with no other content.
  const labelY = isImage
    ? node.y + offsetY + node.height - LABEL.imageBaselineFromBottom
    : node.y + offsetY + node.height / 2 + LABEL.centredBaselineNudge;
  const nameX = labelX - nameWidth / 2;

  return (
    <>
      <Text x={nameX} y={labelY} text={fileName} font={nameFont} color={textColor} />
      {node.subpath && subpathFont && (
        <Text
          x={labelX - subpathFont.measureText(node.subpath).width / 2}
          y={labelY + CHIP.subpathLineHeight}
          text={node.subpath}
          font={subpathFont}
          color={mutedColor}
        />
      )}
    </>
  );
}
