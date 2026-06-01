import React, {useMemo} from 'react';
import {
  Group, Line, vec, matchFont, Text, rect,
  Paragraph as SkiaParagraph,
} from '@shopify/react-native-skia';
import type {TextNode} from '../../core';
import type {EnrichedTextNode} from '../extensions/cssclasses';
import {hasCallouts, parseCallouts, getHeader, getFooter, getCenteredCallout} from '../extensions/callouts';
import type {ColorScheme} from '../theme';
import {parseToSegments, toPlainText} from '../markdown';
import {buildParagraph, getParagraphColours} from '../paragraphBuilder';
import {shapeClipPath} from './shapes';

const DEG_TO_RAD = Math.PI / 180;
const ZONE_HEIGHT = 28;
const ZONE_PADDING = 6;

interface Props {
  node: TextNode;
  colorScheme: ColorScheme;
  offsetX: number;
  offsetY: number;
}

const PADDING = 12;

// Font configs (kept for header/footer/label zone rendering)
interface FontConfig {
  fontSize: number;
  lineHeight: number;
  fontWeight?: 'bold' | 'normal';
  fontFamily?: string;
}

const H4: FontConfig = {fontSize: 13, lineHeight: 18, fontWeight: 'bold'};

const fontCache = new Map<string, ReturnType<typeof matchFont>>();
function getFont(config: FontConfig) {
  const key = `${config.fontSize}-${config.fontWeight ?? 'normal'}-${config.fontFamily ?? 'System'}`;
  let f = fontCache.get(key);
  if (!f) {
    const spec: Parameters<typeof matchFont>[0] = {
      fontFamily: config.fontFamily ?? 'System',
      fontSize: config.fontSize,
    };
    if (config.fontWeight) spec.fontWeight = config.fontWeight;
    f = matchFont(spec);
    fontCache.set(key, f);
  }
  return f;
}

// ---------- Component ----------

/**
 * Renders text node content using Skia with block-level markdown formatting.
 * Headers get larger/bold fonts, lists get bullet prefixes, code blocks use
 * monospace, blockquotes are indented and muted. Inline syntax is stripped.
 */
export function SkiaTextRenderer({node, colorScheme, offsetX, offsetY}: Props) {
  const isDark = colorScheme === 'dark';
  const textColor = isDark ? '#E5E7EB' : '#1F2937';
  const mutedColor = isDark ? '#9CA3AF' : '#6B7280';

  // Use displayText (frontmatter stripped) if available, otherwise raw text
  const enriched = node as TextNode & Partial<EnrichedTextNode>;
  const rawContent = enriched.displayText ?? node.text;
  const textAlign = enriched.renderProps?.textAlign;
  const rotateText = enriched.renderProps?.rotateText;
  const rotateCard = enriched.renderProps?.rotateCard;
  const shape = enriched.renderProps?.shape;

  // Clip text to the card outline so it can't bleed past the edge into
  // neighbouring nodes (#167). For circle / parallelogram cards, clip to the
  // actual shape path rather than the bounding rect, so text also respects the
  // curved / slanted edges (#53). Falls back to the bounding rect for
  // rectangular and unshaped cards. World coords — survives the rotation Group.
  const clipX = node.x + offsetX;
  const clipY = node.y + offsetY;
  const shapeClip = shapeClipPath(shape, clipX, clipY, node.width, node.height);
  const clipRegion = shapeClip ?? rect(clipX, clipY, node.width, node.height);

  // Parse callout zones (header, footer, labels) from text content
  const {bodyText, callouts} = useMemo(
    () => hasCallouts(rawContent) ? parseCallouts(rawContent) : {bodyText: rawContent, callouts: []},
    [rawContent],
  );
  const header = useMemo(() => getHeader(callouts), [callouts]);
  const footer = useMemo(() => getFooter(callouts), [callouts]);
  const centered = useMemo(() => getCenteredCallout(callouts), [callouts]);

  // Adjust available height for header/footer zones
  const headerSpace = header ? ZONE_HEIGHT : 0;
  const footerSpace = footer ? ZONE_HEIGHT : 0;

  const textContent = centered ? centered.text : bodyText;
  const baseX = node.x + offsetX + PADDING;
  const maxWidth = node.width - PADDING * 2;
  const bodyAreaHeight = node.height - PADDING * 2 - headerSpace - footerSpace;
  const bodyYStart = node.y + offsetY + PADDING + headerSpace;

  // Build Skia Paragraph for body text — handles word wrapping, mixed
  // styles, line breaking, bold, italic, code, strikethrough natively.
  // Shared with the Picture path (`useCanvasPicture.drawTextNode`) so both
  // rendering paths produce pixel-identical output.
  const palette = getParagraphColours(colorScheme);

  const bodyParagraph = useMemo(() => {
    if (!textContent || bodyAreaHeight <= 0) return null;
    const segments = parseToSegments(textContent);
    return buildParagraph(segments, maxWidth, palette);
  }, [textContent, maxWidth, palette, bodyAreaHeight]);

  // Vertical centering
  const shouldVerticalCenter = textAlign === 'center' || centered != null
    || shape === 'circle' || shape === 'parallelogram-left' || shape === 'parallelogram-right';
  const paragraphHeight = bodyParagraph?.getHeight() ?? 0;
  const yOffset = shouldVerticalCenter && paragraphHeight < bodyAreaHeight
    ? (bodyAreaHeight - paragraphHeight) / 2
    : 0;

  // Rotation
  const rotation = rotateText ?? rotateCard;
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;

  // --- Build render elements ---
  const elements: React.ReactElement[] = [];

  // Header zone
  if (header) {
    const headerFont = getFont(H4);
    const headerY = node.y + offsetY + ZONE_PADDING + H4.fontSize;
    const headerText = toPlainText(header.text);
    if (headerText) {
      const headerTextWidth = headerFont.measureText(headerText).width;
      const headerX = baseX + (maxWidth - headerTextWidth) / 2;
      elements.push(
        <Text
          key="header"
          x={headerX}
          y={headerY}
          text={headerText}
          font={headerFont}
          color={textColor}
        />
      );
    }
    if (!header.noBorder) {
      const lineY = node.y + offsetY + ZONE_HEIGHT;
      elements.push(
        <Line
          key="header-line"
          p1={vec(node.x + offsetX + 1, lineY)}
          p2={vec(node.x + offsetX + node.width - 1, lineY)}
          color={mutedColor}
          strokeWidth={0.5}
        />
      );
    }
  }

  // Footer zone
  if (footer) {
    const footerFont = getFont(H4);
    const footerBaseY = node.y + offsetY + node.height - footerSpace;
    const footerTextY = footerBaseY + ZONE_PADDING + H4.fontSize;
    const footerText = toPlainText(footer.text);
    if (footerText) {
      const footerTextWidth = footerFont.measureText(footerText).width;
      const footerX = baseX + (maxWidth - footerTextWidth) / 2;
      elements.push(
        <Text
          key="footer"
          x={footerX}
          y={footerTextY}
          text={footerText}
          font={footerFont}
          color={textColor}
        />
      );
    }
    if (!footer.noBorder) {
      elements.push(
        <Line
          key="footer-line"
          p1={vec(node.x + offsetX + 1, footerBaseY)}
          p2={vec(node.x + offsetX + node.width - 1, footerBaseY)}
          color={mutedColor}
          strokeWidth={0.5}
        />
      );
    }
  }

  // Side labels (cc-label-left / -right) are rendered by the dedicated
  // SkiaCardLabelRenderer (a sibling in SkiaCanvasLayer), so their rotation
  // Group sits at a component top-level and rotates correctly even on
  // mixed-zone cards (#64). This renderer draws header/footer/body only.

  // Body text — rendered as a single Skia Paragraph with native word
  // wrapping, mixed styles, and text decoration support.
  if (bodyParagraph) {
    elements.push(
      <SkiaParagraph
        key="body"
        paragraph={bodyParagraph}
        x={baseX}
        y={bodyYStart + yOffset}
        width={maxWidth}
      />
    );
  }

  if (elements.length === 0) return null;

  // Wrap in rotation group if needed
  let content = <>{elements}</>;

  if (rotation != null) {
    content = (
      <Group transform={[
        {translateX: cx}, {translateY: cy},
        {rotate: rotation * DEG_TO_RAD},
        {translateX: -cx}, {translateY: -cy},
      ]}>
        {content}
      </Group>
    );
  }

  // Clip the rendered text to the card outline — long body content would
  // otherwise bleed past the card edge into adjacent nodes (#167), and on
  // circle / parallelogram cards past the curved / slanted edge (#53; see
  // `clipRegion` above). Top-level-return placement is load-bearing:
  // <Group clip> inside an element array (the parent's children list) is a
  // no-op per #96. The clip is in world coords so it survives the rotation
  // Group above it. Intra-card scroll is tracked separately at #168.
  return (
    <Group clip={clipRegion}>
      {content}
    </Group>
  );
}
