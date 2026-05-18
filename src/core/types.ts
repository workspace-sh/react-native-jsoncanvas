/** Preset colours per JSON Canvas spec */
export type CanvasPresetColor = '1' | '2' | '3' | '4' | '5' | '6';
export type CanvasColor = CanvasPresetColor | `#${string}`;

export type NodeType = 'text' | 'file' | 'link' | 'group';

export interface BaseNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export interface TextNode extends BaseNode {
  type: 'text';
  text: string;
}

export interface FileNode extends BaseNode {
  type: 'file';
  file: string;
  subpath?: string;
}

export interface LinkNode extends BaseNode {
  type: 'link';
  url: string;
}

export interface GroupNode extends BaseNode {
  type: 'group';
  label?: string;
  background?: string;
  backgroundStyle?: 'cover' | 'ratio' | 'repeat';
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';
export type EdgeEnd = 'none' | 'arrow';

export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: EdgeSide;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: EdgeSide;
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
}

export interface CanvasDocument {
  nodes?: CanvasNode[];
  edges?: CanvasEdge[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
