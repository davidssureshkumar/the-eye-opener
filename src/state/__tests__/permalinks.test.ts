/**
 * Pinned permalinks.
 *
 * `presets.test.ts` already checks that a Scenario survives a round trip. That
 * catches a broken codec, but not the failure that actually costs something: a
 * link someone has already shared, saved in a lab notebook, or pasted into a bug
 * report no longer opening the setup it was made from.
 *
 * A round trip cannot catch that, because it only ever compares the codec with
 * itself. Renaming a Scenario field, reordering the keys, changing how a number is
 * formatted, or - most easily missed - changing a *default* all leave the round
 * trip green while quietly changing what an old link means, since the payload
 * carries only the differences from the defaults.
 *
 * So the exact strings are checked in against the code. Two directions matter and
 * they are not the same promise:
 *
 *   - Encoding is pinned as a tripwire. If it changes, something changed; the test
 *     failing is the notification. Re-pinning is allowed once the change is known
 *     to be intended.
 *   - Decoding is a compatibility guarantee. Every payload ever shipped must keep
 *     opening the setup it described. If this half fails, re-pinning is the wrong
 *     fix - the codec needs a version bump and a migration.
 *
 * Regenerate the encode half deliberately, never reflexively:
 *   npx vite-node scripts/gen-permalinks.ts
 */

import { describe, expect, it } from 'vitest';
import goldens from './__goldens__/permalinks.json';
import { PRESETS } from '../presets';
import { decodeScenario, encodeScenario, numToStr, permalinkFor } from '../url-codec';
import { defaultScenario } from '../scenario';

const payloads = goldens.payloads as Record<string, string>;
const links = goldens.links as Record<string, string>;

describe('pinned permalink payloads', () => {
  it('covers every preset, so a new one cannot slip in unpinned', () => {
    const pinned = new Set(Object.keys(payloads));
    pinned.delete('__default__');
    expect([...pinned].sort()).toEqual(PRESETS.map((p) => p.id).sort());
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s encodes to its pinned payload', (id, preset) => {
    expect(encodeScenario(preset.scenario)).toBe(payloads[id]);
  });

  it.each(PRESETS.map((p) => [p.id, p] as const))(
    'the pinned payload for %s still opens it',
    (id, preset) => {
      const { scenario, warnings } = decodeScenario(payloads[id]);
      // No warnings: a warning means a key in the payload no longer exists, which is
      // exactly the silent breakage this file is here to catch.
      expect(warnings).toEqual([]);
      expect(scenario).toEqual(preset.scenario);
    },
  );

  it.each(PRESETS.map((p) => [p.id, p] as const))('%s builds its pinned full link', (id, preset) => {
    expect(permalinkFor(preset.modules[0], 'top', preset.scenario, 'https://example.org', '/eye/')).toBe(
      links[id],
    );
  });

  it('the default scenario carries no payload at all', () => {
    // `permalinkFor` drops the query string when the payload is the bare tag, so a
    // link to an untouched module stays short. If a default ever encodes to more
    // than the tag, some field is no longer equal to its own default.
    expect(encodeScenario(defaultScenario())).toBe(payloads.__default__);
    expect(permalinkFor('m1', 'top', defaultScenario(), 'https://example.org', '/eye/')).toBe(
      'https://example.org/eye/#/m1/top',
    );
  });

  it('keeps payloads short enough to survive being pasted', () => {
    // Not a protocol limit - it is a legibility one. A permalink that wraps over
    // four lines in a chat window gets truncated by the person quoting it.
    for (const [id, payload] of Object.entries(payloads)) {
      expect(payload.length, `${id} payload`).toBeLessThan(400);
    }
  });

  it('emits keys in sorted order, so the same setup always gives the same link', () => {
    for (const [id, payload] of Object.entries(payloads)) {
      const keys = payload
        .split('~')
        .slice(1)
        .map((pair) => pair.slice(0, pair.indexOf(':')));
      expect(keys, `${id} key order`).toEqual([...keys].sort());
    }
  });
});

describe('number formatting is pinned too', () => {
  // The permalink's length, and therefore its shareability, is mostly decided here:
  // a Scenario is picoseconds and gigahertz, and '2.5e-11' against '0.000000000025'
  // is the difference between a link that fits on a line and one that does not.
  const cases: [number, string][] = [
    [0, '0'],
    [-0, '-0'],
    [1, '1'],
    [-1, '-1'],
    [0.5, '0.5'],
    [50, '50'],
    [1e-11, '1e-11'],
    [2.5e-11, '2.5e-11'],
    [1e10, '1e10'],
    [9.6e9, '9.6e9'],
    [1.2e-13, '1.2e-13'],
    [0.001, '1e-3'],
    [1e-7, '1e-7'],
    [Infinity, 'inf'],
    [-Infinity, '-inf'],
    [NaN, 'nan'],
  ];

  it.each(cases)('formats %p as %p', (value, text) => {
    expect(numToStr(value)).toBe(text);
  });

  it('round-trips every formatted value to the identical double', () => {
    for (const [value] of cases) {
      if (!Number.isFinite(value)) continue;
      expect(Object.is(Number(numToStr(value)), value)).toBe(true);
    }
  });

  it('round-trips awkward doubles exactly, not approximately', () => {
    // Shortest-representation formatting is only safe if it is verified to parse
    // back to the same bits. These are the values where a naive toPrecision loses.
    for (const x of [0.1 + 0.2, 1 / 3, Number.EPSILON, 1.7976931348623157e308, 5e-324, 123456789.123456789]) {
      expect(Number(numToStr(x))).toBe(x);
    }
  });
});

describe('links written by hand still work', () => {
  // Payloads as a reader might type or truncate one. The codec is meant to be
  // forgiving in the ways that do not change meaning, and loud in the ways that do.
  it('accepts an untagged payload', () => {
    const { scenario } = decodeScenario('source.symbolRate:8e9');
    expect(scenario.source.symbolRate).toBe(8e9);
  });

  it('accepts the long form of a boolean', () => {
    expect(decodeScenario('crosstalk.enabled:true').scenario.crosstalk.enabled).toBe(true);
    expect(decodeScenario('crosstalk.enabled:1').scenario.crosstalk.enabled).toBe(true);
    expect(decodeScenario('crosstalk.enabled:F').scenario.crosstalk.enabled).toBe(false);
  });

  it('reports an unknown key instead of dropping it silently', () => {
    const { warnings } = decodeScenario('v1~source.notAField:3');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toContain('source.notAField');
  });

  it('survives an empty or truncated payload', () => {
    for (const text of ['', 'v1', 'v1~', '~~', 'v1~source.symbolRate:']) {
      expect(() => decodeScenario(text)).not.toThrow();
    }
  });
});
