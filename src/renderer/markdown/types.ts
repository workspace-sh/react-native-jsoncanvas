export interface SegmentStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight?: 'bold' | 'normal';
  fontFamily?: string;
  italic?: boolean;
  isStrikethrough?: boolean;
  color?: string;
  indent?: number;
  isBlank?: boolean;
}

export interface TextSegment {
  text: string;
  style: SegmentStyle;
}

export interface PositionedSegment extends TextSegment {
  x: number;
}

export interface WrappedLine {
  segments: PositionedSegment[];
  y: number;
}
