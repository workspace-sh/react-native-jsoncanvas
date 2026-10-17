// hast-util-from-html is ESM-only, which ts-jest can't load; these cards have no HTML.
jest.mock('hast-util-from-html', () => ({fromHtml: () => ({type: 'root', children: []})}));

import type {CanvasNode} from '../../core/types';
import {nodesMatching} from '../findNodes';

const nodes: CanvasNode[] = [
  {id: 'b', type: 'text', x: 400, y: 0, width: 100, height: 50, text: 'The **Lighthouse** runs it'},
  {id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 50, text: '## A function\nruns once'},
  {id: 'f', type: 'file', x: 0, y: 200, width: 100, height: 50, file: 'notes/lighthouse.md'},
  {id: 'g', type: 'group', x: 0, y: 400, width: 100, height: 50, label: 'Other peers'},
  {id: 'l', type: 'link', x: 0, y: 600, width: 100, height: 50, url: 'https://example.com/run'},
];

describe('nodesMatching', () => {
  it('finds rendered text, ignoring case and Markdown', () => {
    expect(nodesMatching(nodes, 'lighthouse runs').map(n => n.id)).toEqual(['b']);
  });
  it('finds file names, group labels and links, in reading order', () => {
    expect(nodesMatching(nodes, 'lighthouse').map(n => n.id)).toEqual(['b', 'f']);
    expect(nodesMatching(nodes, 'peers').map(n => n.id)).toEqual(['g']);
    expect(nodesMatching(nodes, 'run').map(n => n.id)).toEqual(['a', 'b', 'l']);
  });
  it('finds nothing for an empty query', () => {
    expect(nodesMatching(nodes, '  ')).toEqual([]);
  });
});
