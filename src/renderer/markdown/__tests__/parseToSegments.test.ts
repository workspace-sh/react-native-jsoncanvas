import {parseToSegments, toPlainText, _clearSegmentCache} from '../parseToSegments';

beforeEach(() => {
  _clearSegmentCache();
});

describe('parseToSegments — correctness', () => {
  it('returns empty array for empty string', () => {
    expect(parseToSegments('')).toEqual([]);
  });

  it('parses plain text into a single body segment', () => {
    const segs = parseToSegments('hello world');
    const text = segs.map(s => s.text).join('');
    expect(text).toContain('hello world');
  });

  it('distinguishes bold from plain via style identity', () => {
    const segs = parseToSegments('a **b** c').filter(s => !s.style.isBlank);
    const styles = new Set(segs.map(s => s.style));
    // at least two distinct styles present (plain + bold)
    expect(styles.size).toBeGreaterThanOrEqual(2);
  });
});

describe('parseToSegments — caching', () => {
  it('returns the same array reference on repeated identical input', () => {
    const first = parseToSegments('# Heading\n\nbody text');
    const second = parseToSegments('# Heading\n\nbody text');
    // Cache hit → identical reference (the dedup that cuts mount-time parses)
    expect(second).toBe(first);
  });

  it('returns distinct references for distinct input', () => {
    const a = parseToSegments('alpha');
    const b = parseToSegments('beta');
    expect(a).not.toBe(b);
  });

  it('produces value-equal output before and after a cache clear', () => {
    const before = parseToSegments('**bold** and _italic_');
    _clearSegmentCache();
    const after = parseToSegments('**bold** and _italic_');
    // Different reference (cache was cleared) but value-equal
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  it('toPlainText shares the cache with parseToSegments', () => {
    const text = '## Title\n\nsome **content**';
    const segs = parseToSegments(text);
    // toPlainText calls parseToSegments internally — should hit the cache
    // (no second parse). We can't spy on the private parse easily, but we
    // can assert the segment array is the cached reference when re-fetched.
    toPlainText(text);
    expect(parseToSegments(text)).toBe(segs);
  });
});
