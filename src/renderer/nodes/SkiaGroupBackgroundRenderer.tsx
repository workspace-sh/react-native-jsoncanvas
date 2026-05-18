import React from 'react';
import {Image, useImage, rrect, rect} from '@shopify/react-native-skia';
import type {GroupNode} from '../../core';

interface Props {
  node: GroupNode;
}

export function SkiaGroupBackgroundRenderer({node}: Props) {
  if (!node.background) return null;

  const uri = node.background.startsWith('/')
    ? `file://${node.background}`
    : node.background;
  const image = useImage(uri);

  if (!image) return null;

  const imgWidth = image.width();
  const imgHeight = image.height();
  const nodeRect = rect(node.x, node.y, node.width, node.height);
  const clip = rrect(nodeRect, 12, 12);

  // Default to cover fit
  const style = node.backgroundStyle ?? 'cover';
  let srcRect: ReturnType<typeof rect>;

  if (style === 'cover') {
    const scale = Math.max(node.width / imgWidth, node.height / imgHeight);
    const sw = node.width / scale;
    const sh = node.height / scale;
    srcRect = rect((imgWidth - sw) / 2, (imgHeight - sh) / 2, sw, sh);
  } else {
    // 'ratio' (contain) or 'repeat' — use full image
    srcRect = rect(0, 0, imgWidth, imgHeight);
  }

  return (
    <Image
      image={image}
      rect={nodeRect}
      fit={style === 'ratio' ? 'contain' : 'cover'}
      clip={clip}
    />
  );
}
