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

  const nodeRect = rect(node.x, node.y, node.width, node.height);
  const clip = rrect(nodeRect, 12, 12);

  // Default to cover fit
  const style = node.backgroundStyle ?? 'cover';

  return (
    <Image
      image={image}
      rect={nodeRect}
      fit={style === 'ratio' ? 'contain' : 'cover'}
      clip={clip}
    />
  );
}
