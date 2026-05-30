/**
 * Parses markdown text into flat styled segments for Skia rendering.
 *
 * Uses the unified/remark/syntax-tree ecosystem:
 * - unified@9 + remark-parse@9 — CommonMark parser
 * - remark-gfm@1 — strikethrough, tables, task lists
 * - remark-frontmatter@3 — YAML frontmatter (parsed as AST node, not rendered)
 * - mdast-util-to-string@2 — plain text extraction from AST nodes
 *
 * Phase 2: rich inline rendering — bold, italic, code, and links render
 * with distinct styles. Each inline run produces its own TextSegment.
 */

import unified from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import {fromHtml} from 'hast-util-from-html';
import type {Root, Content, PhrasingContent} from 'mdast';
import type {TextSegment, SegmentStyle} from './types';

// ---------- Style presets ----------

const BODY: SegmentStyle = {fontSize: 13, lineHeight: 18};
const H1: SegmentStyle = {fontSize: 20, lineHeight: 26, fontWeight: 'bold'};
const H2: SegmentStyle = {fontSize: 17, lineHeight: 23, fontWeight: 'bold'};
const H3: SegmentStyle = {fontSize: 15, lineHeight: 21, fontWeight: 'bold'};
const H4: SegmentStyle = {fontSize: 13, lineHeight: 18, fontWeight: 'bold'};
const CODE: SegmentStyle = {fontSize: 12, lineHeight: 17, fontFamily: 'Menlo'};

const HEADING_STYLES: SegmentStyle[] = [H1, H1, H2, H3, H4, H4, H4];

// ---------- HTML text extraction ----------

/**
 * Walks an HTML fragment as a hast tree and returns plain text. `<br>` becomes
 * a newline; everything else is unwrapped to its text content. Comments,
 * CDATA, and elements with no text content (e.g. empty `<span></span>`)
 * collapse to an empty string. Lazy-loaded callers should still gate this
 * on the html mdast node having a non-empty value.
 */
function htmlToText(html: string): string {
  const tree = fromHtml(html, {fragment: true});
  const out: string[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {type?: string; tagName?: string; value?: string; children?: unknown[]};
    if (n.type === 'text' && typeof n.value === 'string') {
      out.push(n.value);
      return;
    }
    if (n.type === 'element') {
      if (n.tagName === 'br') {
        out.push('\n');
        return;
      }
      if (Array.isArray(n.children)) for (const c of n.children) walk(c);
      return;
    }
    // root, doctype, comment — recurse into children (or skip if none)
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  };

  walk(tree);
  return out.join('');
}

// ---------- Input normalisation ----------

function normaliseEmphasis(text: string): string {
  return text
    .replace(/\n\*\*$/gm, '**')
    .replace(/\n__$/gm, '__');
}

// ---------- Inline content → styled segments ----------

/**
 * Walk mdast phrasing (inline) content and emit styled segments.
 * Each emphasis/strong/code/link run produces its own segment with
 * the appropriate style modifications applied to the base style.
 */
function walkInline(nodes: PhrasingContent[], baseStyle: SegmentStyle, segments: TextSegment[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text': {
        if (node.value) segments.push({text: node.value, style: baseStyle});
        break;
      }
      case 'strong': {
        const boldStyle: SegmentStyle = {...baseStyle, fontWeight: 'bold'};
        walkInline(node.children, boldStyle, segments);
        break;
      }
      case 'emphasis': {
        const italicStyle: SegmentStyle = {...baseStyle, italic: true};
        walkInline(node.children, italicStyle, segments);
        break;
      }
      case 'inlineCode': {
        segments.push({
          text: node.value,
          style: {...baseStyle, fontFamily: 'Menlo', fontSize: 12, lineHeight: 17},
        });
        break;
      }
      case 'link': {
        const linkStyle: SegmentStyle = {...baseStyle, color: 'link'};
        walkInline(node.children, linkStyle, segments);
        break;
      }
      case 'delete': {
        const strikeStyle: SegmentStyle = {...baseStyle, isStrikethrough: true};
        walkInline(node.children, strikeStyle, segments);
        break;
      }
      case 'image': {
        // Strip images
        break;
      }
      case 'html': {
        const text = htmlToText(node.value);
        if (text.trim()) segments.push({text, style: baseStyle});
        break;
      }
      default: {
        // Unknown inline — try to extract text
        if ('children' in node) {
          walkInline((node as any).children, baseStyle, segments);
        } else if ('value' in node) {
          segments.push({text: (node as any).value, style: baseStyle});
        }
        break;
      }
    }
  }
}

/**
 * Collect inline segments for a node, then split on newlines so each
 * resulting segment is a single renderable line fragment.
 */
function inlineSegments(nodes: PhrasingContent[], baseStyle: SegmentStyle): TextSegment[] {
  const raw: TextSegment[] = [];
  walkInline(nodes, baseStyle, raw);

  // Split segments that contain newlines into separate segments
  const result: TextSegment[] = [];
  for (const seg of raw) {
    if (seg.text.includes('\n')) {
      const parts = seg.text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) result.push({text: parts[i], style: seg.style});
        if (i < parts.length - 1) result.push({text: '', style: {...seg.style, isBlank: true}});
      }
    } else {
      result.push(seg);
    }
  }
  return result;
}

// ---------- Block-level walking ----------

function walkTree(nodes: Content[], segments: TextSegment[]): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'heading': {
        const style = HEADING_STYLES[node.depth] ?? H4;
        const segs = inlineSegments(node.children, style);
        segments.push(...segs);
        break;
      }

      case 'paragraph': {
        const segs = inlineSegments(node.children, BODY);
        segments.push(...segs);
        break;
      }

      case 'list': {
        for (let i = 0; i < node.children.length; i++) {
          const item = node.children[i];
          const prefix = node.ordered ? `${(node.start ?? 1) + i}. ` : '• ';
          // Prefix as its own segment, then inline content
          const itemSegs: TextSegment[] = [];
          for (const child of item.children) {
            if (child.type === 'paragraph') {
              walkInline(child.children, BODY, itemSegs);
            } else if ('value' in child) {
              itemSegs.push({text: (child as any).value, style: BODY});
            }
          }
          // Prepend prefix to first segment's text
          if (itemSegs.length > 0) {
            itemSegs[0] = {text: prefix + itemSegs[0].text, style: itemSegs[0].style};
          } else {
            itemSegs.push({text: prefix, style: BODY});
          }
          segments.push(...itemSegs);
        }
        break;
      }

      case 'blockquote': {
        const bqSegments: TextSegment[] = [];
        walkTree(node.children, bqSegments);
        for (const seg of bqSegments) {
          segments.push({
            text: seg.text,
            style: {...seg.style, indent: 8, color: 'muted'},
          });
        }
        break;
      }

      case 'code': {
        const lines = node.value.split('\n');
        for (const line of lines) {
          segments.push({text: line, style: CODE});
        }
        break;
      }

      case 'thematicBreak': {
        segments.push({text: '', style: {...BODY, isBlank: true}});
        break;
      }

      case 'html': {
        const text = htmlToText(node.value).trim();
        if (text) {
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.trim()) segments.push({text: line.trim(), style: BODY});
          }
        }
        break;
      }

      case 'yaml':
        break;

      default: {
        if ('children' in node) {
          walkTree((node as any).children, segments);
        }
        break;
      }
    }
  }
}

// ---------- Public API ----------

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml']);

function parseToSegmentsUncached(text: string): TextSegment[] {
  const normalised = normaliseEmphasis(text);
  const tree = parser.parse(normalised) as Root;
  const segments: TextSegment[] = [];
  walkTree(tree.children, segments);

  const result: TextSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    result.push(segments[i]);
    if (i < segments.length - 1 && segments[i].style !== segments[i + 1].style) {
      if (!segments[i].style.isBlank && !segments[i + 1].style.isBlank) {
        result.push({text: '', style: {...BODY, isBlank: true}});
      }
    }
  }

  return result;
}

// Bounded FIFO cache keyed on the raw markdown string.
//
// `parseToSegments` is pure (same text → same segments) but expensive: a full
// unified/remark CommonMark parse + AST walk per call. On canvas mount it is
// invoked many times for the *same* text — once for a text node's body in the
// live React tree, again for the same node in the deferred Picture-recording
// pass, and again per callout zone via `toPlainText` (header/footer/labels/
// centered). Memoising collapses all of those to a single parse, which is the
// dominant slice of the open-time main-thread hang (#55).
//
// Keyed on the exact input string. The cap bounds memory across many distinct
// files/nodes; eviction is simple insertion-order FIFO (oldest out first),
// which is fine here — the hot set is "every text string in the currently open
// canvas", comfortably under the cap for typical documents.
const SEGMENT_CACHE_MAX = 512;
const _segmentCache = new Map<string, TextSegment[]>();

export function parseToSegments(text: string): TextSegment[] {
  if (!text) return [];

  const cached = _segmentCache.get(text);
  if (cached) return cached;

  const result = parseToSegmentsUncached(text);

  if (_segmentCache.size >= SEGMENT_CACHE_MAX) {
    // Evict oldest insertion (first key) to keep the cache bounded.
    const oldest = _segmentCache.keys().next().value;
    if (oldest !== undefined) _segmentCache.delete(oldest);
  }
  _segmentCache.set(text, result);

  return result;
}

/** Clear the segment cache. Exposed for tests; not part of the render path. */
export function _clearSegmentCache(): void {
  _segmentCache.clear();
}

/**
 * Extract plain rendered text from a markdown/HTML string. Uses the same
 * pipeline as `parseToSegments`, then concatenates segment text. Used for
 * single-line callout zones (header / footer / labels) where styling is
 * fixed by the zone and only the plain content matters.
 *
 * Empty `<span></span>`-style HTML, frontmatter, and unrenderable nodes
 * collapse to an empty string.
 */
export function toPlainText(text: string): string {
  return parseToSegments(text)
    .filter(s => !s.style.isBlank)
    .map(s => s.text)
    .join(' ')
    .trim();
}
