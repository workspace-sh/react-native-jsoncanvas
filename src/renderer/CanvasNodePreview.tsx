import React, {useEffect, useMemo, useState} from 'react';
import {useColorScheme} from 'react-native';
import {Canvas, Group, Picture, type SkPicture} from 'react-native-skia';
import type {CanvasEdge, CanvasNode, FileNode, GroupNode} from '../core';
import {resolveScheme} from './theme';
import {FONT_SIZE} from './typography';
import {GROUP_LABEL} from './metrics';
import {SkiaImageRenderer} from './nodes/SkiaImageRenderer';
import {loadNodeImages, recordNodesPicture} from './useCanvasPicture';
import type {ImageNames} from './utils/fileNodeLabel';

const SVG_RE = /\.svg$/i;

/** How far a small card is enlarged in its preview, at most. */
const MAX_SCALE = 2;

export interface CanvasNodePreviewProps {
  /** What to draw: a node and, for a group, what's inside it (`onNodeLongPress`'s `contents.nodes`). */
  nodes: CanvasNode[];
  /** The edges between them (`contents.edges`). */
  edges?: CanvasEdge[];
  /** Directory containing the .canvas file, for the nodes' images. */
  basePath?: string;
  /** The room the preview has, in points: it's drawn as large as fits, up to twice its size on the canvas. */
  maxWidth: number;
  maxHeight: number;
  /** Whether an image's name is drawn in its card, as on the canvas. */
  imageNames?: ImageNames;
  /** The preview's images have loaded and it's drawn: when a host can show it. */
  onReady?: () => void;
}

/** The world-space box a preview draws: the nodes, and a group's label above it. */
function previewBounds(nodes: CanvasNode[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const labelled = node.type === 'group' && !!(node as GroupNode).label;
    const top = labelled ? node.y - (FONT_SIZE.groupLabel + GROUP_LABEL.paddingY * 2 + 8) : node.y;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  if (!isFinite(minX)) return {x: 0, y: 0, width: 1, height: 1};
  return {x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY)};
}

/**
 * The size a preview of these nodes is drawn at, in points: as large as fits
 * `maxWidth` × `maxHeight`, and no more than twice their size on the canvas.
 * A host sizes its menu's preview with it.
 */
export function canvasNodePreviewSize(nodes: CanvasNode[], maxWidth: number, maxHeight: number) {
  const b = previewBounds(nodes);
  const scale = Math.min(maxWidth / b.width, maxHeight / b.height, MAX_SCALE);
  return {width: Math.round(b.width * scale), height: Math.round(b.height * scale), scale};
}

/**
 * One node drawn on its own, as the canvas draws it: what a host shows
 * lifted in its own menu for a long-pressed node (the system's context
 * menu on iOS). The library draws the card; where it goes and what the
 * menu offers are the host's.
 */
export function CanvasNodePreview({nodes, edges = [], basePath, maxWidth, maxHeight, imageNames = 'onReveal', onReady}: CanvasNodePreviewProps) {
  const colorScheme = resolveScheme(useColorScheme());
  const [picture, setPicture] = useState<SkPicture | null>(null);
  const bounds = useMemo(() => previewBounds(nodes), [nodes]);
  const size = useMemo(() => canvasNodePreviewSize(nodes, maxWidth, maxHeight), [nodes, maxWidth, maxHeight]);
  const svgNodes = useMemo(
    () => nodes.filter((n): n is FileNode => n.type === 'file' && SVG_RE.test((n as FileNode).file)),
    [nodes],
  );

  useEffect(() => {
    let cancelled = false;
    loadNodeImages(nodes, basePath).then(images => {
      if (cancelled) return;
      setPicture(recordNodesPicture(nodes, edges, colorScheme, basePath, imageNames, images));
    });
    return () => {
      cancelled = true;
    };
  }, [nodes, edges, basePath, colorScheme, imageNames]);

  useEffect(() => {
    if (!picture) return;
    // Drawn on the next frame: tell the host after it.
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picture]);

  return (
    <Canvas style={{width: size.width, height: size.height}}>
      <Group transform={[{scale: size.scale}, {translateX: -bounds.x}, {translateY: -bounds.y}]}>
        {picture && <Picture picture={picture} />}
        {svgNodes.map(node => (
          <SkiaImageRenderer key={node.id} node={node} offsetX={0} offsetY={0} basePath={basePath} imageNames={imageNames} />
        ))}
      </Group>
    </Canvas>
  );
}
