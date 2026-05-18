import React from 'react';
import {Image, StyleSheet} from 'react-native';
import type {GroupNode} from '../../core';
import type {ColorScheme} from '../theme';

interface Props {
  node: GroupNode;
  colorScheme: ColorScheme;
}

const RESIZE_MODES: Record<string, 'cover' | 'contain' | 'repeat'> = {
  cover: 'cover',
  ratio: 'contain',
  repeat: 'repeat',
};

/**
 * Renders a group node's background image (if set).
 * The label pill is rendered via Skia (SkiaGroupLabelRenderer) to bypass
 * the react-native-macos Text rendering limitation.
 * The group border/fill is handled by CanvasNodeView.
 */
export function GroupNodeContent({node}: Props) {
  if (!node.background) return null;

  return (
    <Image
      source={{uri: `file://${node.background}`}}
      style={StyleSheet.absoluteFill}
      resizeMode={RESIZE_MODES[node.backgroundStyle ?? 'cover'] ?? 'cover'}
    />
  );
}
