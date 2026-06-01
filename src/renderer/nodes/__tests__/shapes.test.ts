import {
  parallelogramPath,
  ovalPath,
  shapeClipPath,
  PARALLELOGRAM_SKEW,
} from '../shapes';

describe('parallelogramPath', () => {
  it('closes the path (Z) and has four corners', () => {
    const d = parallelogramPath(0, 0, 100, 50, 'left');
    expect(d.trim().endsWith('Z')).toBe(true);
    // M + 3×L = 4 vertices
    expect((d.match(/[ML]/g) ?? []).length).toBe(4);
  });

  it('left skews the top edge right by w*SKEW; bottom-left sits at x', () => {
    const d = parallelogramPath(0, 0, 100, 50, 'left');
    // top-left vertex starts at x + skew
    expect(d).toContain(`M ${100 * PARALLELOGRAM_SKEW} 0`);
    // bottom-left vertex returns to x=0
    expect(d).toContain('L 0 50');
  });

  it('right is the mirror of left (top-left at x, bottom-left at x+skew)', () => {
    const d = parallelogramPath(0, 0, 100, 50, 'right');
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain(`L ${100 * PARALLELOGRAM_SKEW} 50`);
  });

  it('respects the x/y origin offset', () => {
    const d = parallelogramPath(10, 20, 100, 50, 'left');
    // top-left = (x + skew, y) = (30, 20)
    expect(d).toContain(`M ${10 + 100 * PARALLELOGRAM_SKEW} 20`);
  });
});

describe('ovalPath', () => {
  it('produces two elliptical arcs and closes', () => {
    const d = ovalPath(0, 0, 100, 80);
    expect((d.match(/A/g) ?? []).length).toBe(2);
    expect(d.trim().endsWith('Z')).toBe(true);
  });

  it('uses half-width/half-height as the arc radii', () => {
    const d = ovalPath(0, 0, 100, 80);
    // rx=50 ry=40 appear in each arc command
    expect(d).toContain('A 50 40');
  });

  it('starts at the left-middle of the box, accounting for origin', () => {
    const d = ovalPath(10, 20, 100, 80);
    // start = (x, y + h/2) = (10, 60)
    expect(d.startsWith('M 10 60')).toBe(true);
  });
});

describe('shapeClipPath', () => {
  it('returns null for rectangular / unset / unknown shapes', () => {
    expect(shapeClipPath(undefined, 0, 0, 10, 10)).toBeNull();
    expect(shapeClipPath('rectangle', 0, 0, 10, 10)).toBeNull();
    expect(shapeClipPath('pill', 0, 0, 10, 10)).toBeNull();
  });

  it('maps circle to an oval path', () => {
    expect(shapeClipPath('circle', 0, 0, 100, 80)).toBe(ovalPath(0, 0, 100, 80));
  });

  it('maps parallelogram-left / -right to the matching parallelogram path', () => {
    expect(shapeClipPath('parallelogram-left', 0, 0, 100, 50))
      .toBe(parallelogramPath(0, 0, 100, 50, 'left'));
    expect(shapeClipPath('parallelogram-right', 0, 0, 100, 50))
      .toBe(parallelogramPath(0, 0, 100, 50, 'right'));
  });
});
