import React from 'react';
import {Image, ImageSVG, useImage, Group, rect, fitbox, type SkSVG, type SkImage} from '@shopify/react-native-skia';
import type {FileNode} from '../../core';
import {devFlags} from '../devFlags';
import {resolveFileUri} from '../utils/resolveFileUri';
import {useValidatedSvg, getBrokenImageSvg, type ValidatedSvg} from '../utils/useValidatedSvg';

interface Props {
  node: FileNode;
  offsetX: number;
  offsetY: number;
  /** Directory containing the .canvas file — used to resolve relative `file` paths. */
  basePath?: string;
}

const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp|bmp|ico)$/i;
const SVG_RE = /\.svg$/i;
const MARGIN = 8;
const LABEL_SPACE = 28;

/** Compute the destination box (inside the file node's bounds, padded for the
 *  filename label) into which the image content is fit. */
function destBox(node: FileNode, offsetX: number, offsetY: number) {
  const x = node.x + offsetX + MARGIN;
  const y = node.y + offsetY + MARGIN;
  const w = Math.max(0, node.width - MARGIN * 2);
  const h = Math.max(0, node.height - MARGIN * 2 - LABEL_SPACE);
  return {x, y, w, h};
}

/** Render an SVG (whether the requested asset or the broken-image placeholder)
 *  into the destination box, fit by `contain`. Centralises the fitbox + clip
 *  logic so the success and failure paths render identically.
 *
 *  We pass explicit `width`/`height` (the viewBox-derived intrinsic size)
 *  to `<ImageSVG>` because Skia renders nothing when neither the document
 *  nor the consumer provides a size — and `useValidatedSvg` strips any
 *  `width`/`height` from the root `<svg>` so the document can't override
 *  these (e.g. `width="100%"` resolving against an undefined parent box).
 *  The fitbox transform handles fitting into `dst`. */
function renderSvg(svg: SkSVG, intrinsicW: number, intrinsicH: number, x: number, y: number, w: number, h: number) {
  const src = rect(0, 0, intrinsicW, intrinsicH);
  const dst = rect(x, y, w, h);
  if (devFlags.skipImageGroupClip) {
    return (
      <Group transform={fitbox('contain', src, dst)}>
        <ImageSVG svg={svg} x={0} y={0} width={intrinsicW} height={intrinsicH} />
      </Group>
    );
  }
  return (
    <Group clip={rect(x, y, w, h)}>
      <Group transform={fitbox('contain', src, dst)}>
        <ImageSVG svg={svg} x={0} y={0} width={intrinsicW} height={intrinsicH} />
      </Group>
    </Group>
  );
}

/** Inline broken-image placeholder rendered when an asset can't be loaded.
 *  Returns null only if the placeholder itself failed to construct (which
 *  shouldn't happen — its XML is bundled with the package). */
function BrokenImage({x, y, w, h}: {x: number; y: number; w: number; h: number}) {
  const broken = getBrokenImageSvg();
  if (!broken) return null;
  return renderSvg(broken.svg, broken.intrinsicWidth, broken.intrinsicHeight, x, y, w, h);
}

function SkiaRasterImage({node, offsetX, offsetY, basePath}: Props) {
  const uri = resolveFileUri(node.file, basePath);
  const image: SkImage | null = useImage(uri);
  const {x, y, w, h} = destBox(node, offsetX, offsetY);
  if (w === 0 || h === 0) return null;

  // No URI (relative path with no basePath) is a known-failed load — show the
  // placeholder rather than rendering nothing, so users can see which nodes
  // failed to resolve.
  if (uri == null) return <BrokenImage x={x} y={y} w={w} h={h} />;

  // useImage returns null while loading too, so we can't distinguish loading
  // from missing here. The placeholder appears only after the next render
  // settles — acceptable since useImage typically resolves synchronously for
  // file:// URIs.
  if (!image) return null;

  if (devFlags.skipImageGroupClip) {
    return <Image image={image} x={x} y={y} width={w} height={h} fit="contain" />;
  }
  return (
    <Group clip={rect(x, y, w, h)}>
      <Image image={image} x={x} y={y} width={w} height={h} fit="contain" />
    </Group>
  );
}

function SkiaSvgImage({node, offsetX, offsetY, basePath}: Props) {
  const uri = resolveFileUri(node.file, basePath);
  const result: ValidatedSvg | null = useValidatedSvg(uri);
  const {x, y, w, h} = destBox(node, offsetX, offsetY);
  if (w === 0 || h === 0) return null;

  if (result === null) return null; // still loading
  if (!result.valid) return <BrokenImage x={x} y={y} w={w} h={h} />;
  return renderSvg(result.svg, result.intrinsicWidth, result.intrinsicHeight, x, y, w, h);
}

/**
 * Renders file node images via Skia. Uses the validated-SVG path for SVGs
 * (avoiding the JSI `svg.width()` crash described in #122) and `useImage`
 * for raster formats. When loading fails for any reason the bundled
 * Netscape-style "broken image" placeholder is rendered in place.
 */
export function SkiaImageRenderer(props: Props) {
  const {node} = props;
  const isSvg = SVG_RE.test(node.file);
  const isImage = IMAGE_RE.test(node.file) || isSvg;
  if (!isImage) return null;
  return isSvg ? <SkiaSvgImage {...props} /> : <SkiaRasterImage {...props} />;
}
