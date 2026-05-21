import React, {useMemo} from 'react';
import {
  Path,
  Skia,
  Text,
  RoundedRect,
  Group,
  matchFont,
} from '@shopify/react-native-skia';
import type {CanvasEdge, CanvasNode, EdgeSide} from '../../core';
import {devFlags} from '../devFlags';

interface Props {
  edge: CanvasEdge;
  fromNode: CanvasNode;
  toNode: CanvasNode;
  offsetX?: number;
  offsetY?: number;
}

const PRESET_COLORS: Record<string, string> = {
  '1': '#EF4444',
  '2': '#F97316',
  '3': '#EAB308',
  '4': '#22C55E',
  '5': '#3B82F6',
  '6': '#A855F7',
};

const DEFAULT_EDGE_COLOR = '#6B7280';
let _labelFont: ReturnType<typeof matchFont> | null = null;
function getLabelFont() {
  if (!_labelFont) _labelFont = matchFont({fontFamily: 'System', fontSize: 12});
  return _labelFont;
}
const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 4;

function resolveColor(color?: string): string {
  if (!color) return DEFAULT_EDGE_COLOR;
  if (color.startsWith('#')) return color;
  return PRESET_COLORS[color] ?? DEFAULT_EDGE_COLOR;
}

function getConnectionPoint(
  node: CanvasNode,
  side?: EdgeSide,
  ox = 0,
  oy = 0,
): {x: number; y: number} {
  const cx = node.x + node.width / 2 + ox;
  const cy = node.y + node.height / 2 + oy;

  switch (side) {
    case 'top':
      return {x: cx, y: node.y + oy};
    case 'bottom':
      return {x: cx, y: node.y + node.height + oy};
    case 'left':
      return {x: node.x + ox, y: cy};
    case 'right':
      return {x: node.x + node.width + ox, y: cy};
    default:
      return {x: cx, y: cy};
  }
}

function makeArrowPath(
  x: number,
  y: number,
  angle: number,
  size: number,
): ReturnType<typeof Skia.Path.Make> {
  const path = Skia.Path.Make();
  const a1 = angle + Math.PI * 0.8;
  const a2 = angle - Math.PI * 0.8;
  path.moveTo(x, y);
  path.lineTo(x + size * Math.cos(a1), y + size * Math.sin(a1));
  path.lineTo(x + size * Math.cos(a2), y + size * Math.sin(a2));
  path.close();
  return path;
}

/**
 * Compute cubic bezier control points for a smooth curve between two nodes.
 * Offsets control points based on the connection sides so horizontal edges
 * bow vertically and vertical edges bow horizontally.
 */
function computeControlPoints(
  from: {x: number; y: number},
  to: {x: number; y: number},
  fromSide?: EdgeSide,
  toSide?: EdgeSide,
): {cp1: {x: number; y: number}; cp2: {x: number; y: number}} {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const curvature = Math.min(dist * 0.4, 120);

  // Determine control point direction from connection side
  const sideOffset = (side: EdgeSide | undefined, fallbackH: number, fallbackV: number) => {
    switch (side) {
      case 'left': return {x: -curvature, y: 0};
      case 'right': return {x: curvature, y: 0};
      case 'top': return {x: 0, y: -curvature};
      case 'bottom': return {x: 0, y: curvature};
      default: return {x: fallbackH, y: fallbackV};
    }
  };

  // Default: curve toward the target
  const o1 = sideOffset(fromSide, dx * 0.4, dy * 0.4);
  const o2 = sideOffset(toSide, -dx * 0.4, -dy * 0.4);

  return {
    cp1: {x: from.x + o1.x, y: from.y + o1.y},
    cp2: {x: to.x + o2.x, y: to.y + o2.y},
  };
}

/** Tangent angle of a cubic bezier at t=0 or t=1. */
function bezierEndAngle(
  p: {x: number; y: number},
  cp: {x: number; y: number},
): number {
  return Math.atan2(p.y - cp.y, p.x - cp.x);
}

function EdgeRendererMemoized({edge, fromNode, toNode, offsetX = 0, offsetY = 0}: Props) {
  const color = resolveColor(edge.color);
  const showFromArrow = edge.fromEnd === 'arrow';
  const showToArrow = edge.toEnd !== 'none';

  // Fine-grained deps on fromNode/toNode geometry fields (rather than the
  // whole node objects). Intentional — re-memoise only when geometry
  // actually changes, not on every object-identity churn. The exhaustive-deps
  // rule can't statically prove this is complete because the closure also
  // passes the whole node into getConnectionPoint, so suppress it on the
  // deps array below.
  const geometry = useMemo(() => {
    const from = getConnectionPoint(fromNode, edge.fromSide, offsetX, offsetY);
    const to = getConnectionPoint(toNode, edge.toSide, offsetX, offsetY);
    const {cp1, cp2} = computeControlPoints(from, to, edge.fromSide, edge.toSide);
    return {from, to, cp1, cp2};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fromNode.x, fromNode.y, fromNode.width, fromNode.height,
    toNode.x, toNode.y, toNode.width, toNode.height,
    edge.fromSide, edge.toSide, offsetX, offsetY,
  ]);

  const curvePath = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(geometry.from.x, geometry.from.y);
    p.cubicTo(geometry.cp1.x, geometry.cp1.y, geometry.cp2.x, geometry.cp2.y, geometry.to.x, geometry.to.y);
    return p;
  }, [geometry]);

  const {fromArrowPath, toArrowPath} = useMemo(() => {
    const fAngle = bezierEndAngle(geometry.from, geometry.cp1);
    const tAngle = bezierEndAngle(geometry.to, geometry.cp2);
    return {
      fromArrowPath: showFromArrow ? makeArrowPath(geometry.from.x, geometry.from.y, fAngle, 8) : null,
      toArrowPath: showToArrow ? makeArrowPath(geometry.to.x, geometry.to.y, tAngle, 8) : null,
    };
  }, [geometry, showFromArrow, showToArrow]);

  const label = edge.label;
  const midX = 0.125 * geometry.from.x + 0.375 * geometry.cp1.x + 0.375 * geometry.cp2.x + 0.125 * geometry.to.x;
  const midY = 0.125 * geometry.from.y + 0.375 * geometry.cp1.y + 0.375 * geometry.cp2.y + 0.125 * geometry.to.y;
  const labelWidth = label ? getLabelFont().measureText(label).width + LABEL_PADDING_X * 2 : 0;
  const labelHeight = label ? 12 + LABEL_PADDING_Y * 2 : 0;

  return (
    <>
      <Path path={curvePath} color={color} strokeWidth={2} style="stroke" />
      {fromArrowPath && <Path path={fromArrowPath} color={color} style="fill" />}
      {toArrowPath && <Path path={toArrowPath} color={color} style="fill" />}
      {label && (
        <Group>
          <RoundedRect
            x={midX - labelWidth / 2}
            y={midY - labelHeight / 2}
            width={labelWidth}
            height={labelHeight}
            r={6}
            color={color}
          />
          <Text
            x={midX - labelWidth / 2 + LABEL_PADDING_X}
            y={midY + 4}
            text={label}
            font={getLabelFont()}
            color="#FFFFFF"
          />
        </Group>
      )}
    </>
  );
}

function EdgeRendererInline({edge, fromNode, toNode, offsetX = 0, offsetY = 0}: Props) {
  const from = getConnectionPoint(fromNode, edge.fromSide, offsetX, offsetY);
  const to = getConnectionPoint(toNode, edge.toSide, offsetX, offsetY);
  const color = resolveColor(edge.color);
  const {cp1, cp2} = computeControlPoints(from, to, edge.fromSide, edge.toSide);

  const showFromArrow = edge.fromEnd === 'arrow';
  const showToArrow = edge.toEnd !== 'none';

  const curvePath = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(from.x, from.y);
    p.cubicTo(cp1.x, cp1.y, cp2.x, cp2.y, to.x, to.y);
    return p;
  }, [from.x, from.y, cp1.x, cp1.y, cp2.x, cp2.y, to.x, to.y]);

  // Arrow angles follow the bezier tangent at the endpoints
  const fromAngle = bezierEndAngle(from, cp1);
  const toAngle = bezierEndAngle(to, cp2);

  const fromArrowPath = useMemo(
    () => (showFromArrow ? makeArrowPath(from.x, from.y, fromAngle, 8) : null),
    [from.x, from.y, fromAngle, showFromArrow],
  );
  const toArrowPath = useMemo(
    () => (showToArrow ? makeArrowPath(to.x, to.y, toAngle, 8) : null),
    [to.x, to.y, toAngle, showToArrow],
  );

  // Label at curve midpoint (t=0.5 of the bezier)
  const label = edge.label;
  const midX = 0.125 * from.x + 0.375 * cp1.x + 0.375 * cp2.x + 0.125 * to.x;
  const midY = 0.125 * from.y + 0.375 * cp1.y + 0.375 * cp2.y + 0.125 * to.y;
  const labelWidth = label ? getLabelFont().measureText(label).width + LABEL_PADDING_X * 2 : 0;
  const labelHeight = label ? 12 + LABEL_PADDING_Y * 2 : 0;

  return (
    <>
      <Path
        path={curvePath}
        color={color}
        strokeWidth={2}
        style="stroke"
      />
      {fromArrowPath && <Path path={fromArrowPath} color={color} style="fill" />}
      {toArrowPath && <Path path={toArrowPath} color={color} style="fill" />}
      {label && (
        <Group>
          <RoundedRect
            x={midX - labelWidth / 2}
            y={midY - labelHeight / 2}
            width={labelWidth}
            height={labelHeight}
            r={6}
            color={color}
          />
          <Text
            x={midX - labelWidth / 2 + LABEL_PADDING_X}
            y={midY + 4}
            text={label}
            font={getLabelFont()}
            color="#FFFFFF"
          />
        </Group>
      )}
    </>
  );
}

export function EdgeRenderer(props: Props) {
  return devFlags.memoizeEdgeGeometry
    ? <EdgeRendererMemoized {...props} />
    : <EdgeRendererInline {...props} />;
}
