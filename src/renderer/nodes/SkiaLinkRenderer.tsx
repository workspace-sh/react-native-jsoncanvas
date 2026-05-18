import React from 'react';
import {Text, matchFont} from '@shopify/react-native-skia';
import type {LinkNode} from '../../core';
import type {ColorScheme} from '../theme';

interface Props {
  node: LinkNode;
  colorScheme: ColorScheme;
  offsetX: number;
  offsetY: number;
}

const PADDING = 12;

let _hostnameFont: ReturnType<typeof matchFont> | null = null;
let _urlFont: ReturnType<typeof matchFont> | null = null;

function getHostnameFont() {
  if (!_hostnameFont) _hostnameFont = matchFont({fontFamily: 'System', fontSize: 16, fontWeight: 'bold'});
  return _hostnameFont;
}

function getUrlFont() {
  if (!_urlFont) _urlFont = matchFont({fontFamily: 'System', fontSize: 11});
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

  const isDark = colorScheme === 'dark';
  const linkColor = isDark ? '#60A5FA' : '#2563EB';
  const mutedColor = isDark ? '#9CA3AF' : '#6B7280';
  const hostname = extractHostname(node.url);

  const x = node.x + offsetX + PADDING;
  const urlBarY = node.y + offsetY + PADDING + 11;
  const hostnameY = node.y + offsetY + PADDING + 40;
  const urlY = hostnameY + 24;

  return (
    <>
      <Text x={x} y={urlBarY} text={node.url} font={urlFont} color={mutedColor} />
      <Text x={x} y={hostnameY} text={hostname} font={hostnameFont} color={linkColor} />
      <Text x={x} y={urlY} text={node.url} font={urlFont} color={mutedColor} />
    </>
  );
}
