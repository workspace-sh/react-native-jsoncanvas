import type {CanvasNode, Rect} from './types';

const MAX_ITEMS = 8;
const MAX_DEPTH = 10;

function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function rectContainsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function nodeToRect(node: CanvasNode): Rect {
  return {x: node.x, y: node.y, width: node.width, height: node.height};
}

interface QuadTreeNode {
  bounds: Rect;
  depth: number;
  items: CanvasNode[];
  children: QuadTreeNode[] | null;
}

function createQuadNode(bounds: Rect, depth: number): QuadTreeNode {
  return {bounds, depth, items: [], children: null};
}

function subdivide(node: QuadTreeNode): void {
  const {x, y, width, height} = node.bounds;
  const halfW = width / 2;
  const halfH = height / 2;
  const d = node.depth + 1;

  node.children = [
    createQuadNode({x, y, width: halfW, height: halfH}, d),
    createQuadNode({x: x + halfW, y, width: halfW, height: halfH}, d),
    createQuadNode({x, y: y + halfH, width: halfW, height: halfH}, d),
    createQuadNode({x: x + halfW, y: y + halfH, width: halfW, height: halfH}, d),
  ];
}

function insertInto(qNode: QuadTreeNode, item: CanvasNode): void {
  const itemRect = nodeToRect(item);

  if (qNode.children) {
    for (const child of qNode.children) {
      if (rectContainsRect(child.bounds, itemRect)) {
        insertInto(child, item);
        return;
      }
    }
    // Spans multiple children — store at this level
    qNode.items.push(item);
    return;
  }

  qNode.items.push(item);

  if (qNode.items.length > MAX_ITEMS && qNode.depth < MAX_DEPTH) {
    subdivide(qNode);
    const existing = qNode.items;
    qNode.items = [];
    for (const ex of existing) {
      insertInto(qNode, ex);
    }
  }
}

function queryRect(qNode: QuadTreeNode, viewport: Rect, results: CanvasNode[]): void {
  if (!rectsIntersect(qNode.bounds, viewport)) {
    return;
  }

  for (const item of qNode.items) {
    if (rectsIntersect(nodeToRect(item), viewport)) {
      results.push(item);
    }
  }

  if (qNode.children) {
    for (const child of qNode.children) {
      queryRect(child, viewport, results);
    }
  }
}

function queryPointInNode(qNode: QuadTreeNode, x: number, y: number, results: CanvasNode[]): void {
  if (!rectContainsPoint(qNode.bounds, x, y)) {
    return;
  }

  for (const item of qNode.items) {
    if (rectContainsPoint(nodeToRect(item), x, y)) {
      results.push(item);
    }
  }

  if (qNode.children) {
    for (const child of qNode.children) {
      queryPointInNode(child, x, y, results);
    }
  }
}

function removeFrom(qNode: QuadTreeNode, nodeId: string): boolean {
  const idx = qNode.items.findIndex(item => item.id === nodeId);
  if (idx !== -1) {
    qNode.items.splice(idx, 1);
    return true;
  }

  if (qNode.children) {
    for (const child of qNode.children) {
      if (removeFrom(child, nodeId)) {
        return true;
      }
    }
  }

  return false;
}

export interface SpatialIndex {
  insert(node: CanvasNode): void;
  remove(nodeId: string): void;
  update(node: CanvasNode): void;
  query(viewport: Rect): CanvasNode[];
  queryPoint(x: number, y: number): CanvasNode[];
}

export function createSpatialIndex(worldBounds?: Rect): SpatialIndex {
  const bounds = worldBounds ?? {x: -50000, y: -50000, width: 100000, height: 100000};
  let root = createQuadNode(bounds, 0);

  return {
    insert(node: CanvasNode): void {
      insertInto(root, node);
    },

    remove(nodeId: string): void {
      removeFrom(root, nodeId);
    },

    update(node: CanvasNode): void {
      removeFrom(root, node.id);
      insertInto(root, node);
    },

    query(viewport: Rect): CanvasNode[] {
      const results: CanvasNode[] = [];
      queryRect(root, viewport, results);
      return results;
    },

    queryPoint(x: number, y: number): CanvasNode[] {
      const results: CanvasNode[] = [];
      queryPointInNode(root, x, y, results);
      return results;
    },
  };
}
