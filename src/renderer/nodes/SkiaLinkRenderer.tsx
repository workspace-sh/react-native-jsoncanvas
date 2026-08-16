import React from 'react';
import {Text, matchFont} from '@shopify/react-native-skia';
import type {LinkNode} from '../../core';
import {getLinkColor, getMutedTextColor, type ColorScheme} from '../theme';
import {LINK, NODE} from '../metrics';
import {FONT_SIZE} from '../typography';

interface Props {
  node: LinkNode;
  colorScheme: ColorScheme;
  offsetX: number;
  offsetY: number;
}


let _hostnameFont: ReturnType<typeof matchFont> | null = null;
let _urlFont: ReturnType<typeof matchFont> | null = null;

function getHostnameFont() {
  if (!_hostnameFont) _hostnameFont = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.linkHostname, fontWeight: 'bold'});
  return _hostnameFont;
}

function getUrlFont() {
  if (!_urlFont) _urlFont = matchFont({fontFamily: 'System', fontSize: FONT_SIZE.linkUrl});
  return _urlFont;
}

function extractHostname(url: string): string {
  const match = url.match(/^https?:\/\/([^/?#]+)/);
  return match ? match[1] : url;
}

export function SkiaLinkRenderer({node, colorScheme, offsetX, offsetY}: Props) {
  const hostnameFont = getHostnameFont();
  const urlFont = getUrlFont();
  if (!hostnameFont || !urlFont) return null;

  const linkColor = getLinkColor(colorScheme);
  const mutedColor = getMutedTextColor(colorScheme);
  const hostname = extractHostname(node.url);

  const x = node.x + offsetX + NODE.padding;
  const urlBarY = node.y + offsetY + NODE.padding + LINK.urlBarOffset;
  const hostnameY = node.y + offsetY + NODE.padding + LINK.hostnameOffset;
  const urlY = hostnameY + 24;

  return (
    <>
      <Text x={x} y={urlBarY} text={node.url} font={urlFont} color={mutedColor} />
      <Text x={x} y={hostnameY} text={hostname} font={hostnameFont} color={linkColor} />
      <Text x={x} y={urlY} text={node.url} font={urlFont} color={mutedColor} />
    </>
  );
}
