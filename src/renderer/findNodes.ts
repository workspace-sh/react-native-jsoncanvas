import type {CanvasNode} from '../core/types';
import {toPlainText} from './markdown';

/** What a node says, as a reader would search it: a card's text, a file's or link's name, a group's label. */
function searchableText(node: CanvasNode): string {
  switch (node.type) {
    case 'text':
      return toPlainText(node.text);
    case 'file':
      return node.file.slice(node.file.lastIndexOf('/') + 1);
    case 'link':
      return node.url;
    case 'group':
      return node.label ?? '';
  }
}

/** Text as compared: lower case, with every run of spaces and line breaks as one space. */
const folded = (text: string): string => text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The nodes whose text holds `query`, ignoring case, in reading order:
 * top to bottom, then left to right. An empty query finds nothing.
 */
export function nodesMatching(nodes: readonly CanvasNode[], query: string): CanvasNode[] {
  const q = folded(query);
  if (!q) return [];
  return nodes
    .filter(n => folded(searchableText(n)).includes(q))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}
