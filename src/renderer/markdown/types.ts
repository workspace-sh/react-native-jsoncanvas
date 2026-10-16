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
  /** The next segment carries on the same line (a sentence's bold, code or link runs); absent, a line ends here. */
  inline?: boolean;
  /** The style of the block it's in (a paragraph's, a heading's): blank lines go between blocks of different styles. */
  block?: SegmentStyle;
}

export interface PositionedSegment extends TextSegment {
  x: number;
}

export interface WrappedLine {
  segments: PositionedSegment[];
  y: number;
}
