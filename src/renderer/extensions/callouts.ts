/**
 * Canvas callout extension — layout zones for Canvas Candy.
 *
 * Parses Obsidian callout syntax (>[!cc-header], >[!cc-footer], etc.)
 * from text node content and extracts layout zone information. This
 * module runs after the cssclasses extension — it processes displayText
 * that's already had frontmatter stripped.
 *
 * canvas-core stays spec-pure. Callout syntax is an Obsidian markdown
 * extension, not part of the JSON Canvas spec.
 *
 * Implementation: callouts are recognised by walking the mdast tree
 * produced by remark-parse + remark-gfm (the same parser the rest of
 * canvas-ui markdown goes through). A blockquote whose collapsed text
 * starts with `[!cc-XYZ]` is extracted as a callout; everything else
 * stays in the body. The original source string is reconstructed by
 * removing the callout blockquotes' position ranges, so non-callout
 * formatting is preserved exactly without a stringify round-trip.
 *
 * @see https://github.com/TfTHacker/obsidian-canvas-candy — Canvas Candy
 */

import unified from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type {Root, Blockquote, Content} from 'mdast';

// ---------- Types ----------

export type CalloutZone = 'header' | 'footer' | 'label-left' | 'label-right' | 'callout-center';

export interface CalloutInfo {
  zone: CalloutZone;
  text: string;
  noBorder: boolean;
}

export interface ParsedCallouts {
  /** Text with callout syntax removed */
  bodyText: string;
  /** Extracted callout zones */
  callouts: CalloutInfo[];
}

// ---------- Detection ----------

/** Cheap prefilter so plain text never builds an mdast tree. */
const FAST_DETECT_RE = />\s?\[!cc-/;
/** Marker pattern matched against the collapsed text of a blockquote. */
const CALLOUT_MARKER_RE = /^\[!cc-([\w-]+)\]\s*([\s\S]*)$/;

/** Fast check — does the text contain any cc- callout syntax? */
export function hasCallouts(text: string): boolean {
  return FAST_DETECT_RE.test(text);
}

// ---------- Parsing ----------

const calloutParser = unified().use(remarkParse).use(remarkGfm);

/**
 * Pull the original source text of a blockquote and strip the `>` line
 * prefix. We work from the original input string (sliced by the AST's
 * `position` offsets) rather than collapsing the parsed children — so
 * inline markdown like `**Tutorial**` survives unchanged for downstream
 * re-parsing by `parseToSegments`. Walking the AST would flatten the
 * strong/emphasis/etc. wrappers and lose their source markers.
 */
function extractBlockquoteSource(source: string, node: Blockquote): string | null {
  if (
    !node.position ||
    typeof node.position.start.offset !== 'number' ||
    typeof node.position.end.offset !== 'number'
  ) {
    return null;
  }
  const raw = source.slice(node.position.start.offset, node.position.end.offset);
  // Strip the `>` (and optional single space) from each line.
  return raw
    .split('\n')
    .map(line => line.replace(/^>\s?/, ''))
    .join('\n');
}

interface MatchedCallout {
  zone: CalloutZone;
  text: string;
  noBorder: boolean;
}

function matchCalloutBlockquote(source: string, node: Blockquote): MatchedCallout | null {
  const stripped = extractBlockquoteSource(source, node);
  if (stripped == null) return null;
  const match = CALLOUT_MARKER_RE.exec(stripped);
  if (!match) return null;

  const rawType = match[1];
  const text = match[2].trim();

  const noBorder = rawType.endsWith('-noborder');
  const baseType = rawType.replace(/-noborder$/, '');

  switch (baseType) {
    case 'header':          return {zone: 'header', text, noBorder};
    case 'footer':          return {zone: 'footer', text, noBorder};
    case 'label-left':      return {zone: 'label-left', text, noBorder};
    case 'label-right':     return {zone: 'label-right', text, noBorder};
    case 'callout-center':  return {zone: 'callout-center', text, noBorder};
    default:                return null; // unknown type — stays in body
  }
}

/**
 * Reconstruct the body source by cutting the callout blockquotes out of the
 * original input by their mdast `position` offsets. This preserves all
 * non-callout formatting exactly (round-trip stringification would
 * normalise list indentation, heading style, trailing whitespace, …).
 * The remark-parse default settings populate `position.start.offset` and
 * `position.end.offset` for every node, so this is reliable.
 */
function spliceOutRanges(source: string, ranges: Array<{start: number; end: number}>): string {
  if (ranges.length === 0) return source;
  ranges.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const r of ranges) {
    out += source.slice(cursor, r.start);
    // remark's blockquote `position.end.offset` lands at the end of the
    // last line's content, before the line-terminating `\n`. Eat that
    // newline too so we don't leave an orphan blank line where the
    // callout used to be (matches the legacy line-based parser's output).
    let end = r.end;
    if (source[end] === '\n') end++;
    cursor = end;
  }
  out += source.slice(cursor);
  return out;
}

/**
 * Parse callout syntax from text content. Extracts callout zones and
 * returns the remaining body text with callouts removed.
 *
 * Supports:
 *   >[!cc-header] Header text
 *   >[!cc-footer] Footer text
 *   >continuation line
 *   >[!cc-label-left] Label text
 *   >[!cc-label-right] Label text
 *   >[!cc-callout-center]
 *   >Centered content
 *
 * Each callout can span multiple lines (continuation lines start with >).
 */
export function parseCallouts(source: string): ParsedCallouts {
  if (!hasCallouts(source)) return {bodyText: source.trim(), callouts: []};

  const tree = calloutParser.parse(source) as Root;
  const callouts: CalloutInfo[] = [];
  const removed: Array<{start: number; end: number}> = [];

  for (const node of tree.children as Content[]) {
    if (node.type !== 'blockquote') continue;
    const matched = matchCalloutBlockquote(source, node);
    if (!matched) continue;

    callouts.push(matched);
    if (
      node.position &&
      typeof node.position.start.offset === 'number' &&
      typeof node.position.end.offset === 'number'
    ) {
      removed.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
    }
  }

  return {
    bodyText: spliceOutRanges(source, removed).trim(),
    callouts,
  };
}

// ---------- Helpers ----------

/** Get the header callout if present */
export function getHeader(callouts: CalloutInfo[]): CalloutInfo | undefined {
  return callouts.find(c => c.zone === 'header');
}

/** Get the footer callout if present */
export function getFooter(callouts: CalloutInfo[]): CalloutInfo | undefined {
  return callouts.find(c => c.zone === 'footer');
}

/** Get side labels */
export function getLabels(callouts: CalloutInfo[]): CalloutInfo[] {
  return callouts.filter(c => c.zone === 'label-left' || c.zone === 'label-right');
}

/** Get centered callout */
export function getCenteredCallout(callouts: CalloutInfo[]): CalloutInfo | undefined {
  return callouts.find(c => c.zone === 'callout-center');
}
