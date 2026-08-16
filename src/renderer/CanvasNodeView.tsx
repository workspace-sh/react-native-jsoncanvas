import React from 'react';
import {View, StyleSheet} from 'react-native';
import type {CanvasNode} from '../core';
import {getNodeColors, type ColorScheme} from './theme';
import {TextNodeContent} from './nodes/TextNodeContent';
import {LinkNodeContent} from './nodes/LinkNodeContent';
import {FileNodeContent} from './nodes/FileNodeContent';
import {GroupNodeContent} from './nodes/GroupNodeContent';

interface Props {
  node: CanvasNode;
  colorScheme: ColorScheme;
}

function renderNodeContent(node: CanvasNode, colorScheme: ColorScheme) {
  switch (node.type) {
    case 'text':
      return <TextNodeContent node={node} colorScheme={colorScheme} />;
    case 'link':
      return <LinkNodeContent node={node} colorScheme={colorScheme} />;
    case 'file':
      return <FileNodeContent node={node} colorScheme={colorScheme} />;
    case 'group':
      return <GroupNodeContent node={node} colorScheme={colorScheme} />;
  }
}

export function CanvasNodeView({node, colorScheme}: Props) {
  const isGroup = node.type === 'group';
  const colors = getNodeColors(node.color, colorScheme);

  return (
    <View
      pointerEvents="none"
      style={[
        isGroup ? styles.groupNode : styles.node,
        // Per-node geometry and palette — the only genuinely dynamic part.
        {
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          backgroundColor: isGroup ? colors.background : colors.card,
          borderColor: colors.border,
        },
      ]}>
      {renderNodeContent(node, colorScheme)}
    </View>
  );
}

// Everything that varies only by node *kind* rather than by node — the
// previous inline object recomputed these on every render and re-derived
// `isGroup ? 1 : 1` for the border width, which was never a choice.
const styles = StyleSheet.create({
  node: {
    position: 'absolute',
    overflow: 'hidden',
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 8,
  },
  groupNode: {
    position: 'absolute',
    // Groups let children paint outside the bounds; nodes clip to them.
    overflow: 'visible',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
  },
});
