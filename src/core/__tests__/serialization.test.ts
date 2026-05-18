import * as fs from 'fs';
import * as path from 'path';
import {parseCanvas, serializeCanvas} from '../serialization';

const samplePath = path.join(__dirname, 'fixtures', 'sample.canvas');
const sampleJson = fs.readFileSync(samplePath, 'utf-8');

describe('parseCanvas', () => {
  it('parses a valid canvas document', () => {
    const doc = parseCanvas(sampleJson);
    expect(doc.nodes).toHaveLength(4);
    expect(doc.edges).toHaveLength(2);
  });

  it('parses text nodes correctly', () => {
    const doc = parseCanvas(sampleJson);
    const node = doc.nodes!.find(n => n.id === 'node-1');
    expect(node).toBeDefined();
    expect(node!.type).toBe('text');
    expect(node!.x).toBe(100);
    expect(node!.y).toBe(100);
    if (node!.type === 'text') {
      expect(node!.text).toContain('Hello World');
    }
  });

  it('parses link nodes correctly', () => {
    const doc = parseCanvas(sampleJson);
    const node = doc.nodes!.find(n => n.id === 'node-3');
    expect(node).toBeDefined();
    expect(node!.type).toBe('link');
    if (node!.type === 'link') {
      expect(node!.url).toBe('https://jsoncanvas.org');
    }
  });

  it('parses group nodes with colour', () => {
    const doc = parseCanvas(sampleJson);
    const node = doc.nodes!.find(n => n.id === 'node-4');
    expect(node).toBeDefined();
    expect(node!.type).toBe('group');
    expect(node!.color).toBe('5');
  });

  it('parses edges with sides and ends', () => {
    const doc = parseCanvas(sampleJson);
    const edge = doc.edges!.find(e => e.id === 'edge-2');
    expect(edge).toBeDefined();
    expect(edge!.fromSide).toBe('bottom');
    expect(edge!.toSide).toBe('top');
    expect(edge!.toEnd).toBe('arrow');
  });

  it('handles an empty document', () => {
    const doc = parseCanvas('{}');
    expect(doc.nodes).toBeUndefined();
    expect(doc.edges).toBeUndefined();
  });

  it('handles empty arrays', () => {
    const doc = parseCanvas('{"nodes": [], "edges": []}');
    expect(doc.nodes).toHaveLength(0);
    expect(doc.edges).toHaveLength(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseCanvas('not json')).toThrow('Invalid JSON');
  });

  it('throws on non-object root', () => {
    expect(() => parseCanvas('[]')).toThrow('must be a JSON object');
  });

  it('throws on missing node id', () => {
    const json = JSON.stringify({nodes: [{type: 'text', x: 0, y: 0, width: 100, height: 100, text: 'hi'}]});
    expect(() => parseCanvas(json)).toThrow('"id" must be a non-empty string');
  });

  it('throws on invalid node type', () => {
    const json = JSON.stringify({nodes: [{id: 'n1', type: 'invalid', x: 0, y: 0, width: 100, height: 100}]});
    expect(() => parseCanvas(json)).toThrow('"type" must be one of');
  });

  it('throws on text node without text field', () => {
    const json = JSON.stringify({nodes: [{id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 100}]});
    expect(() => parseCanvas(json)).toThrow('must have a "text" string');
  });

  it('throws on link node without url field', () => {
    const json = JSON.stringify({nodes: [{id: 'n1', type: 'link', x: 0, y: 0, width: 100, height: 100}]});
    expect(() => parseCanvas(json)).toThrow('must have a "url" string');
  });

  it('throws on invalid edge side', () => {
    const json = JSON.stringify({
      edges: [{id: 'e1', fromNode: 'n1', toNode: 'n2', fromSide: 'diagonal'}],
    });
    expect(() => parseCanvas(json)).toThrow('"fromSide" must be one of');
  });
});

describe('serializeCanvas', () => {
  it('round-trips a parsed document', () => {
    const doc = parseCanvas(sampleJson);
    const serialized = serializeCanvas(doc);
    const reparsed = parseCanvas(serialized);
    expect(reparsed.nodes).toHaveLength(doc.nodes!.length);
    expect(reparsed.edges).toHaveLength(doc.edges!.length);
    expect(reparsed.nodes![0].id).toBe(doc.nodes![0].id);
  });

  it('serializes an empty document', () => {
    const serialized = serializeCanvas({});
    expect(parseCanvas(serialized)).toEqual({});
  });

  it('preserves unknown properties on nodes during round-trip', () => {
    const json = JSON.stringify({
      nodes: [{
        id: 'n1', type: 'text', x: 0, y: 0, width: 100, height: 100,
        text: 'hi', styleAttributes: {shape: 'rounded'},
      }],
    });
    const doc = parseCanvas(json);
    const serialized = serializeCanvas(doc);
    const reparsed = parseCanvas(serialized);
    expect((reparsed.nodes![0] as any).styleAttributes).toEqual({shape: 'rounded'});
  });

  it('preserves unknown properties on edges during round-trip', () => {
    const json = JSON.stringify({
      edges: [{
        id: 'e1', fromNode: 'n1', toNode: 'n2',
        styleAttributes: {path: 'short-dashed'},
      }],
    });
    const doc = parseCanvas(json);
    const serialized = serializeCanvas(doc);
    const reparsed = parseCanvas(serialized);
    expect((reparsed.edges![0] as any).styleAttributes).toEqual({path: 'short-dashed'});
  });

  it('preserves unknown top-level properties during round-trip', () => {
    const json = JSON.stringify({
      nodes: [],
      edges: [],
      metadata: {version: '1.0'},
    });
    const doc = parseCanvas(json);
    const serialized = serializeCanvas(doc);
    const reparsed = JSON.parse(serialized);
    expect(reparsed.metadata).toEqual({version: '1.0'});
  });
});
