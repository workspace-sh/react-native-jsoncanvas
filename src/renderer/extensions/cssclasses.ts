/**
 * Canvas cssclasses extension — lazy-loaded module for community rendering conventions.
 *
 * Parses YAML frontmatter from text nodes, extracts cssclasses, and maps them
 * to rendering properties. This module is only imported when a canvas file
 * contains text nodes with frontmatter — standard canvas files incur zero cost.
 *
 * canvas-core stays spec-pure (JSON Canvas only). This extension lives in
 * canvas-ui as a pluggable rendering concern.
 *
 * @see https://jsoncanvas.org — base spec
 * @see https://github.com/TfTHacker/obsidian-canvas-candy — Canvas Candy
 */

import type {CanvasNode, TextNode} from '../../core';
import yaml from 'js-yaml';

// ---------- Types ----------

export type CardShape = 'rectangle' | 'circle' | 'parallelogram-left' | 'parallelogram-right';
export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
export type TextAlign = 'left' | 'center';

export interface RenderProps {
  shape?: CardShape;
  fill?: boolean;
  transparent?: boolean;
  opaque?: boolean;
  nocolor?: boolean;
  borderStyle?: BorderStyle;
  borderSides?: Array<'top' | 'bottom' | 'left' | 'right'>;
  dropShadow?: boolean;
  textAlign?: TextAlign;
  gradientDeg?: number;
  rotateCard?: number;
  rotateText?: number;
  /** Pill / oval — corner radius = min(width, height) / 2. Driven by `cc-border-rounded`. */
  pill?: boolean;
}

export interface EnrichedTextNode extends TextNode {
  displayText: string;
  cssClasses: string[];
  renderProps: RenderProps;
}

/**
 * A node post-enrichment. Text nodes may carry enrichment fields
 * (`displayText`, `cssClasses`, `renderProps`) when their source had
 * `cssclasses` frontmatter; otherwise they pass through unchanged. Renderers
 * read enrichment via optional access (`enriched.renderProps?.shape`), so the
 * `Partial<EnrichedTextNode>` shape covers both cases without forcing a
 * fictitious "empty enrichment" object on plain text nodes.
 */
export type EnrichedNode = (TextNode & Partial<EnrichedTextNode>) | Exclude<CanvasNode, TextNode>;

// ---------- Detection ----------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const CSSCLASSES_RE = /cssclass(?:es)?[:\s]/;

/** Fast check — does any text node contain frontmatter with cssclasses? */
export function hasCssClasses(nodes: CanvasNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'text' && CSSCLASSES_RE.test(node.text)) {
      return true;
    }
  }
  return false;
}

// ---------- Frontmatter parsing ----------

interface Frontmatter {
  cssClasses: string[];
  displayText: string;
}

/**
 * Coerce a YAML value into a flat list of class strings. Accepts:
 * - array of strings: `cssclasses:\n  - foo\n  - bar`
 * - comma-separated string: `cssclasses: foo, bar`
 * - single string: `cssclasses: foo`
 * Anything else (numbers, nested objects, nulls) is rejected.
 */
function coerceClasses(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim());
  }
  if (typeof value === 'string') {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function parseFrontmatter(text: string): Frontmatter | null {
  const match = text.match(FRONTMATTER_RE);
  if (!match) return null;

  const block = match[0];
  const body = match[1];
  const displayText = text.slice(block.length).replace(/^\n+/, '');

  // js-yaml handles the YAML grammar properly — array form, comma-separated
  // inline form, quoted strings, and the `cssclasses` vs `cssclass` alias all
  // come out clean. `safe`-style FAILSAFE schema avoids executing tags.
  let parsed: unknown;
  try {
    parsed = yaml.load(body, {schema: yaml.FAILSAFE_SCHEMA});
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const fm = parsed as Record<string, unknown>;
  const classes = coerceClasses(fm.cssclasses ?? fm.cssclass);
  if (classes.length === 0) return null;

  return {cssClasses: classes, displayText};
}

// ---------- Class → RenderProps mapping ----------

const GRADIENT_RE = /^cc-card-gradient-(\d+)deg$/;
const ROTATE_CARD_RE = /^cc-rotate-card-(\d+)$/;
const ROTATE_TEXT_RE = /^cc-rotate-text-(\d+)l?$/;

function mapClasses(classes: string[]): RenderProps {
  const props: RenderProps = {};

  for (const cls of classes) {
    switch (cls) {
      // Shapes
      case 'cc-shape-circle':
        props.shape = 'circle';
        break;
      case 'cc-shape-parallelogram-left':
        props.shape = 'parallelogram-left';
        break;
      case 'cc-shape-parallelogram-right':
        props.shape = 'parallelogram-right';
        break;

      // Card fill
      case 'cc-card-fill':
        props.fill = true;
        break;
      case 'cc-card-transparent':
        props.transparent = true;
        break;
      case 'cc-card-opaque':
        props.opaque = true;
        break;
      case 'cc-card-nocolor':
        props.nocolor = true;
        break;

      // Borders
      case 'cc-border-none':
        props.borderStyle = 'none';
        break;
      case 'cc-border-dashed':
        props.borderStyle = 'dashed';
        break;
      case 'cc-border-dotted':
        props.borderStyle = 'dotted';
        break;
      case 'cc-border-double':
        props.borderStyle = 'double';
        break;
      case 'cc-border-rounded':
        // Canvas Candy "rounded" = pill — corner radius runs the full
        // height. Default rounded-rect (8px) is for non-`cc-border-rounded`
        // cards; this class promotes them to a pill / oval.
        props.pill = true;
        break;
      case 'cc-border-squared':
        props.shape = 'rectangle';
        break;
      case 'cc-border-dropshadow':
        props.dropShadow = true;
        break;
      case 'cc-border-top':
      case 'cc-border-bottom':
      case 'cc-border-left':
      case 'cc-border-right': {
        const side = cls.replace('cc-border-', '') as 'top' | 'bottom' | 'left' | 'right';
        if (!props.borderSides) props.borderSides = [];
        props.borderSides.push(side);
        break;
      }

      // Text alignment
      case 'cc-card-center':
      case 'cc-callout-center':
        props.textAlign = 'center';
        break;

      default: {
        // Gradients: cc-card-gradient-{N}deg
        const gradientMatch = cls.match(GRADIENT_RE);
        if (gradientMatch) {
          props.gradientDeg = parseInt(gradientMatch[1], 10);
          break;
        }
        // Card rotation: cc-rotate-card-{N}
        const rotateCardMatch = cls.match(ROTATE_CARD_RE);
        if (rotateCardMatch) {
          props.rotateCard = parseInt(rotateCardMatch[1], 10);
          break;
        }
        // Text rotation: cc-rotate-text-{N}
        const rotateTextMatch = cls.match(ROTATE_TEXT_RE);
        if (rotateTextMatch) {
          props.rotateText = parseInt(rotateTextMatch[1], 10);
          break;
        }
        // Unknown class — ignore silently
        break;
      }
    }
  }

  return props;
}

// ---------- Public API ----------

/** Enrich a single text node with parsed frontmatter and render props. */
export function enrichTextNode(node: TextNode): EnrichedTextNode | null {
  const parsed = parseFrontmatter(node.text);
  if (!parsed) return null;

  return {
    ...node,
    displayText: parsed.displayText,
    cssClasses: parsed.cssClasses,
    renderProps: mapClasses(parsed.cssClasses),
  };
}

/**
 * Enrich all nodes in a canvas. Text nodes with cssclasses frontmatter
 * get displayText, cssClasses, and renderProps. Other nodes pass through unchanged.
 */
export function enrichNodes(nodes: CanvasNode[]): EnrichedNode[] {
  return nodes.map(node => {
    if (node.type !== 'text') return node;
    return enrichTextNode(node) ?? node;
  });
}
