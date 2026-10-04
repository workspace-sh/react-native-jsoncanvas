import {
  hasCallouts,
  parseCallouts,
  getHeader,
  getFooter,
  getLabels,
  getCenteredCallout,
  type CalloutZone,
} from '../callouts';

// Canvas Candy callout-zone conformance (#16, slice 3).
//
// `parseCallouts` turns `>[!cc-header]`-style markers into layout zones and
// removes them from the body. Nothing tested it until now, so a regression
// that left raw markers visible in a card would have shipped silently.
//
// The eight fixtures below are the demo-card texts taken verbatim from
// Canvas Candy's "Headers and Labels.canvas" demo vault. Each one holds the
// live marker on one line and the SAME syntax repeated inside a fenced code
// block as a copy-paste example. The contract under test:
//
//   - the live marker is consumed into a zone (and gone from the body), and
//   - the fenced example is untouched (it is documentation, not a marker).
//
// callouts.ts imports only unified / remark-parse / remark-gfm, all of which
// are CommonJS, so this runs under the existing ts-jest config with no
// mocking. (Slice 3 was originally parked as ESM-blocked; that was wrong. The
// ESM problem is specific to hast-util-from-html in parseToSegments.)

const FENCE = '```';
const example = (marker: string) => `**Decorations:**\n${FENCE}\n>[!${marker}]\n${FENCE}`;

// ── every marker in Headers and Labels.canvas ────────────────────────────────

interface DemoCard {
  name: string;
  text: string; // verbatim node text from the demo vault
  marker: string;
  zone: CalloutZone;
  noBorder: boolean;
  zoneText: string;
}

const DEMO_CARDS: DemoCard[] = [
  {
    name: 'header',
    text: '>[!cc-header] header\n\n**Decorations:**\n```\n>[!cc-header]\n```',
    marker: 'cc-header', zone: 'header', noBorder: false, zoneText: 'header',
  },
  {
    name: 'header-noborder',
    text: '>[!cc-header-noborder] header\n\n**Decorations:**\n```\n>[!cc-header-noborder]\n```\n',
    marker: 'cc-header-noborder', zone: 'header', noBorder: true, zoneText: 'header',
  },
  {
    // Footer markers sit at the END of the text, after the fenced example.
    name: 'footer',
    text: '\n**Decorations:**\n```\n>[!cc-footer]\n```\n\n\n>[!cc-footer] footer',
    marker: 'cc-footer', zone: 'footer', noBorder: false, zoneText: 'footer',
  },
  {
    name: 'footer-noborder',
    text: '\n**Decorations:**\n```\n>[!cc-footer-noborder]\n```\n\n>[!cc-footer-noborder] footer\n',
    marker: 'cc-footer-noborder', zone: 'footer', noBorder: true, zoneText: 'footer',
  },
  {
    name: 'label-left',
    text: '>[!cc-label-left] Label Left\n\n\n**Decorations:**\n```\n>[!cc-label-left]\n```\n',
    marker: 'cc-label-left', zone: 'label-left', noBorder: false, zoneText: 'Label Left',
  },
  {
    name: 'label-left-noborder',
    text: '>[!cc-label-left-noborder] Label Left\n\n\n**Decorations:**\n```\n>[!cc-label-left-noborder]\n```\n',
    marker: 'cc-label-left-noborder', zone: 'label-left', noBorder: true, zoneText: 'Label Left',
  },
  {
    name: 'label-right',
    text: '>[!cc-label-right] Label right\n\n\n**Decorations:**\n```\n>[!cc-label-right]\n```',
    marker: 'cc-label-right', zone: 'label-right', noBorder: false, zoneText: 'Label right',
  },
  {
    name: 'label-right-noborder',
    text: '>[!cc-label-right-noborder] Label right\n\n\n**Decorations:**\n```\n>[!cc-label-right-noborder]\n```',
    marker: 'cc-label-right-noborder', zone: 'label-right', noBorder: true, zoneText: 'Label right',
  },
];

describe('demo-vault cards (Headers and Labels.canvas)', () => {
  for (const card of DEMO_CARDS) {
    describe(card.name, () => {
      const parsed = parseCallouts(card.text);

      it('is detected by the fast-path prefilter', () => {
        expect(hasCallouts(card.text)).toBe(true);
      });

      it('extracts exactly one zone (the fenced example is not a second one)', () => {
        expect(parsed.callouts).toHaveLength(1);
      });

      it(`extracts zone "${card.zone}" with noBorder=${card.noBorder}`, () => {
        expect(parsed.callouts[0]).toEqual({
          zone: card.zone,
          text: card.zoneText,
          noBorder: card.noBorder,
        });
      });

      it('removes the live marker line from the body', () => {
        // No line may still read ">[!cc-…] <title>" (a live marker with its
        // title). The bare fenced example ">[!cc-…]" has no title, so it does
        // not match this.
        expect(parsed.bodyText).not.toContain(`>[!${card.marker}] ${card.zoneText}`);
        expect(parsed.bodyText).not.toMatch(/^>\s?\[!cc-[\w-]+\][ \t]+\S/m);
      });

      it('leaves the fenced example verbatim in the body', () => {
        expect(parsed.bodyText).toBe(example(card.marker));
      });
    });
  }
});

// ── hasCallouts (fast path) ──────────────────────────────────────────────────

describe('hasCallouts', () => {
  it('detects a marker with or without a space after ">"', () => {
    expect(hasCallouts('>[!cc-header] x')).toBe(true);
    expect(hasCallouts('> [!cc-header] x')).toBe(true);
  });

  it('is false for plain text (zero-overhead path)', () => {
    expect(hasCallouts('# Just a heading\n\nNo callouts here.')).toBe(false);
  });

  it('is false for standard Obsidian callouts (non cc-)', () => {
    expect(hasCallouts('> [!note] A normal Obsidian callout')).toBe(false);
    expect(hasCallouts('> [!warning]\n> Careful')).toBe(false);
  });

  it('is deliberately loose: true even when the marker is only inside a code fence', () => {
    // It is a cheap prefilter, not a parser. parseCallouts does the real work
    // and (see below) correctly ignores the fenced occurrence.
    expect(hasCallouts('```\n>[!cc-header]\n```')).toBe(true);
    expect(parseCallouts('```\n>[!cc-header]\n```').callouts).toEqual([]);
  });
});

// ── parseCallouts behaviour ──────────────────────────────────────────────────

describe('parseCallouts — zero-overhead path', () => {
  it('returns the trimmed source and no callouts for plain text', () => {
    expect(parseCallouts('  hello world  \n')).toEqual({bodyText: 'hello world', callouts: []});
  });

  it('leaves standard Obsidian callouts in the body untouched', () => {
    const src = '> [!note] Keep me';
    expect(parseCallouts(src)).toEqual({bodyText: src, callouts: []});
  });
});

describe('parseCallouts — syntax', () => {
  it('folds continuation lines (">" prefixed) into the callout text', () => {
    const {callouts} = parseCallouts('>[!cc-header] Title\n>second line');
    expect(callouts).toHaveLength(1);
    expect(callouts[0].zone).toBe('header');
    expect(callouts[0].text).toBe('Title\nsecond line');
  });

  it('supports the centred callout with content on following lines', () => {
    const {callouts, bodyText} = parseCallouts('>[!cc-callout-center]\n>Centred content');
    expect(callouts).toEqual([{zone: 'callout-center', text: 'Centred content', noBorder: false}]);
    expect(bodyText).toBe('');
  });

  it('keeps inline markdown in the zone text (re-parsed downstream)', () => {
    const {callouts} = parseCallouts('>[!cc-header] **Tutorial** part _1_');
    expect(callouts[0].text).toBe('**Tutorial** part _1_');
  });

  it('accepts an empty title', () => {
    const {callouts} = parseCallouts('>[!cc-footer]');
    expect(callouts).toEqual([{zone: 'footer', text: '', noBorder: false}]);
  });

  it('leaves an unknown cc- type in the body and extracts nothing', () => {
    const src = '>[!cc-bogus] not a real zone\n\nbody';
    const parsed = parseCallouts(src);
    expect(parsed.callouts).toEqual([]);
    expect(parsed.bodyText).toContain('[!cc-bogus]');
  });

  it('leaves ordinary blockquotes in the body when a callout is also present', () => {
    const parsed = parseCallouts('>[!cc-header] Head\n\n> a normal quote\n\nbody');
    expect(parsed.callouts).toHaveLength(1);
    expect(parsed.bodyText).toContain('> a normal quote');
    expect(parsed.bodyText).toContain('body');
    expect(parsed.bodyText).not.toContain('cc-header');
  });

  it('preserves non-callout formatting exactly (no re-stringification)', () => {
    const body = '# Title\n\n- one\n  - nested\n\n**bold** and `code`';
    const parsed = parseCallouts(`>[!cc-header] H\n\n${body}`);
    expect(parsed.bodyText).toBe(body);
  });
});

describe('parseCallouts — combinations', () => {
  it('header + footer in one card', () => {
    const {callouts, bodyText} = parseCallouts('>[!cc-header] Top\n\nMiddle\n\n>[!cc-footer] Bottom');
    expect(getHeader(callouts)?.text).toBe('Top');
    expect(getFooter(callouts)?.text).toBe('Bottom');
    expect(bodyText).toBe('Middle');
  });

  it('left + right labels in one card', () => {
    const {callouts} = parseCallouts('>[!cc-label-left] L\n\n>[!cc-label-right] R\n\nbody');
    expect(getLabels(callouts).map(c => c.zone)).toEqual(['label-left', 'label-right']);
  });

  it('label + header + footer together (supported since #64)', () => {
    const {callouts, bodyText} = parseCallouts(
      '>[!cc-header] H\n\n>[!cc-label-left] L\n\nbody\n\n>[!cc-footer] F',
    );
    expect(callouts.map(c => c.zone).sort()).toEqual(['footer', 'header', 'label-left']);
    expect(bodyText).toBe('body');
  });
});

// ── getters ──────────────────────────────────────────────────────────────────

describe('zone getters', () => {
  const {callouts} = parseCallouts(
    '>[!cc-header] H\n\n>[!cc-footer] F\n\n>[!cc-label-right] R\n\n>[!cc-callout-center]\n>C',
  );

  it('getHeader / getFooter / getCenteredCallout find their zone', () => {
    expect(getHeader(callouts)?.text).toBe('H');
    expect(getFooter(callouts)?.text).toBe('F');
    expect(getCenteredCallout(callouts)?.text).toBe('C');
  });

  it('getLabels returns only side labels', () => {
    expect(getLabels(callouts).map(c => c.zone)).toEqual(['label-right']);
  });

  it('getters return undefined / [] when the zone is absent', () => {
    expect(getHeader([])).toBeUndefined();
    expect(getFooter([])).toBeUndefined();
    expect(getCenteredCallout([])).toBeUndefined();
    expect(getLabels([])).toEqual([]);
  });
});
