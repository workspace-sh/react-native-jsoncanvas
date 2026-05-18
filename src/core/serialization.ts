import type {
  CanvasDocument,
  CanvasNode,
  CanvasEdge,
  NodeType,
  EdgeSide,
  EdgeEnd,
} from './types';

const VALID_NODE_TYPES: NodeType[] = ['text', 'file', 'link', 'group'];
const VALID_EDGE_SIDES: EdgeSide[] = ['top', 'right', 'bottom', 'left'];
const VALID_EDGE_ENDS: EdgeEnd[] = ['none', 'arrow'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateBaseNode(raw: Record<string, unknown>, index: number): void {
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new Error(`Node at index ${index}: "id" must be a non-empty string`);
  }
  if (!VALID_NODE_TYPES.includes(raw.type as NodeType)) {
    throw new Error(
      `Node "${raw.id}": "type" must be one of ${VALID_NODE_TYPES.join(', ')}`,
    );
  }
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    if (typeof raw[field] !== 'number') {
      throw new Error(`Node "${raw.id}": "${field}" must be a number`);
    }
  }
}

function validateNode(raw: unknown, index: number): CanvasNode {
  if (!isRecord(raw)) {
    throw new Error(`Node at index ${index}: must be an object`);
  }
  validateBaseNode(raw, index);

  switch (raw.type) {
    case 'text':
      if (typeof raw.text !== 'string') {
        throw new Error(`Node "${raw.id}": text node must have a "text" string`);
      }
      break;
    case 'file':
      if (typeof raw.file !== 'string') {
        throw new Error(`Node "${raw.id}": file node must have a "file" string`);
      }
      break;
    case 'link':
      if (typeof raw.url !== 'string') {
        throw new Error(`Node "${raw.id}": link node must have a "url" string`);
      }
      break;
    case 'group':
      break;
  }

  return raw as unknown as CanvasNode;
}

function validateEdge(raw: unknown, index: number): CanvasEdge {
  if (!isRecord(raw)) {
    throw new Error(`Edge at index ${index}: must be an object`);
  }
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new Error(`Edge at index ${index}: "id" must be a non-empty string`);
  }
  if (typeof raw.fromNode !== 'string') {
    throw new Error(`Edge "${raw.id}": "fromNode" must be a string`);
  }
  if (typeof raw.toNode !== 'string') {
    throw new Error(`Edge "${raw.id}": "toNode" must be a string`);
  }
  if (raw.fromSide !== undefined && !VALID_EDGE_SIDES.includes(raw.fromSide as EdgeSide)) {
    throw new Error(`Edge "${raw.id}": "fromSide" must be one of ${VALID_EDGE_SIDES.join(', ')}`);
  }
  if (raw.toSide !== undefined && !VALID_EDGE_SIDES.includes(raw.toSide as EdgeSide)) {
    throw new Error(`Edge "${raw.id}": "toSide" must be one of ${VALID_EDGE_SIDES.join(', ')}`);
  }
  if (raw.fromEnd !== undefined && !VALID_EDGE_ENDS.includes(raw.fromEnd as EdgeEnd)) {
    throw new Error(`Edge "${raw.id}": "fromEnd" must be one of ${VALID_EDGE_ENDS.join(', ')}`);
  }
  if (raw.toEnd !== undefined && !VALID_EDGE_ENDS.includes(raw.toEnd as EdgeEnd)) {
    throw new Error(`Edge "${raw.id}": "toEnd" must be one of ${VALID_EDGE_ENDS.join(', ')}`);
  }

  return raw as unknown as CanvasEdge;
}

export function parseCanvas(json: string): CanvasDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }

  if (!isRecord(raw)) {
    throw new Error('Canvas document must be a JSON object');
  }

  // Spread all top-level properties to preserve unknown fields (e.g. metadata)
  const doc: CanvasDocument = {...raw} as CanvasDocument;

  if (raw.nodes !== undefined) {
    if (!Array.isArray(raw.nodes)) {
      throw new Error('"nodes" must be an array');
    }
    doc.nodes = raw.nodes.map((node, i) => validateNode(node, i));
  }

  if (raw.edges !== undefined) {
    if (!Array.isArray(raw.edges)) {
      throw new Error('"edges" must be an array');
    }
    doc.edges = raw.edges.map((edge, i) => validateEdge(edge, i));
  }

  return doc;
}

export function serializeCanvas(doc: CanvasDocument): string {
  return JSON.stringify(doc, null, '\t');
}
