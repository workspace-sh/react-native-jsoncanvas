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
        {
          position: 'absolute',
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          backgroundColor: isGroup ? colors.background : colors.card,
          borderColor: colors.border,
          borderWidth: isGroup ? 1 : 1,
          borderStyle: isGroup ? 'dashed' : 'solid',
          borderRadius: isGroup ? 12 : 8,
        },
      ]}>
      {renderNodeContent(node, colorScheme)}
    </View>
  );
}

const styles = StyleSheet.create({
  node: {
    overflow: 'hidden',
  },
  groupNode: {
    overflow: 'visible',
  },
});
