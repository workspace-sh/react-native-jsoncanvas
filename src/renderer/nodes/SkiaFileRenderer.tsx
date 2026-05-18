import React from 'react';
import {Text, matchFont} from '@shopify/react-native-skia';
import type {FileNode} from '../../core';
import type {ColorScheme} from '../theme';

interface Props {
  node: FileNode;
  colorScheme: ColorScheme;
  offsetX: number;
  offsetY: number;
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

export function SkiaFileRenderer({node, colorScheme, offsetX, offsetY}: Props) {
  const nameFont = getNameFont();
  const subpathFont = getSubpathFont();
  if (!nameFont) return null;

  const isDark = colorScheme === 'dark';
  const textColor = isDark ? '#E5E7EB' : '#1F2937';
  const mutedColor = isDark ? '#9CA3AF' : '#6B7280';
  const fileName = node.file.split('/').pop() ?? node.file;
  const isImage = IMAGE_RE.test(node.file);

  // For images, place filename label below the image area
  const labelY = isImage
    ? node.y + offsetY + node.height - 20
    : node.y + offsetY + node.height / 2 + 4;
  const labelX = node.x + offsetX + node.width / 2;

  // Centre the text by measuring and offsetting
  const nameWidth = nameFont.measureText(fileName).width;
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
