/**
 * The bench tips are prose, so what can be tested is structure and discipline:
 * that every module has some, that none is a stub, that the ids a link could point
 * at are unique and stable, and - the one that matters for the brief - that
 * nothing here quotes a specification it is not allowed to quote.
 */

import { describe, expect, it } from 'vitest';
import { BENCH_TIPS, getTip, tipFor, tipsByCategory, tipsForModule } from '../bench-tips';
import { MODULES } from '../modules';

const MODULE_IDS = new Set(MODULES.map((m) => m.id));

describe('the bench tip catalogue', () => {
  it('has unique ids', () => {
    const ids = BENCH_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case ids, so one can be put in a URL fragment', () => {
    for (const t of BENCH_TIPS) expect(t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('points every tip at modules that exist', () => {
    for (const t of BENCH_TIPS) {
      expect(t.modules.length, `${t.id} names no module`).toBeGreaterThan(0);
      for (const m of t.modules) expect(MODULE_IDS.has(m), `${t.id} -> ${m}`).toBe(true);
    }
  });

  it('gives every module something to say at the bench', () => {
    // A module with no tips would silently render an empty callout slot. The brief
    // asks for instrument practice throughout, not only where it was easy to write.
    for (const m of MODULES) {
      expect(tipsForModule(m.id).length, `${m.id} has no bench tips`).toBeGreaterThan(0);
    }
  });

  it('has no stub titles or bodies', () => {
    for (const t of BENCH_TIPS) {
      expect(t.title.length, `${t.id} title`).toBeGreaterThan(20);
      // Two to four sentences. Shorter than this is an assertion without a reason,
      // which is the kind of tip a reader cannot act on or check.
      expect(t.body.length, `${t.id} body`).toBeGreaterThan(140);
      expect(t.body.trim().endsWith('.'), `${t.id} body ends mid-sentence`).toBe(true);
      expect(t.title.trim().endsWith('.'), `${t.id} title should not end in a period`).toBe(false);
    }
  });

  it('names at least one instrument control wherever it claims one exists', () => {
    for (const t of BENCH_TIPS) {
      if (t.controls === undefined) continue;
      expect(t.controls.length, `${t.id} has an empty controls list`).toBeGreaterThan(0);
      for (const c of t.controls) expect(c.trim().length, `${t.id} control`).toBeGreaterThan(2);
    }
  });

  it('covers the categories that carry the warnings, not only the how-to ones', () => {
    // 'pitfall' is the category a reader most needs and the one easiest to leave
    // out, because writing one means admitting a measurement can look fine and be
    // wrong. If this ever drops to zero, something was quietly edited away.
    expect(tipsByCategory('pitfall').length).toBeGreaterThanOrEqual(3);
    expect(tipsByCategory('probing').length).toBeGreaterThanOrEqual(3);
  });
});

describe('the tips stay inside what the brief allows', () => {
  const text = BENCH_TIPS.map((t) => `${t.title} ${t.body} ${(t.controls ?? []).join(' ')}`).join('\n');

  it('quotes no JEDEC document', () => {
    // Citing a document number is permitted; reproducing its contents is not, and
    // a limit stated as if it came from one is the failure mode being guarded.
    expect(text).not.toMatch(/JESD\s*\d/i);
    expect(text).not.toMatch(/per (the )?JEDEC/i);
  });

  it('names no instrument model, which would date the text', () => {
    expect(text).not.toMatch(/\b(MSO|DPO|DSO|MXR|UXR|RTP|RTO)\s*\d/);
  });

  it('states a limit only where physics or convention supplies it', () => {
    // Anything phrased as a specification limit needs a source. These tips are
    // technique, so the correct number of such phrases is zero.
    expect(text).not.toMatch(/\b(shall|must not exceed|specification limit of)\b/i);
  });
});

describe('tip lookup', () => {
  it('finds a tip by id and returns undefined for one that does not exist', () => {
    expect(getTip('averaging-destroys-jitter')?.category).toBe('pitfall');
    expect(getTip('no-such-tip')).toBeUndefined();
  });

  it('returns no tips for a module that does not exist, rather than throwing', () => {
    expect(tipsForModule('m99')).toEqual([]);
    expect(tipFor('m99', 0)).toBeUndefined();
  });

  it('picks the same tip for the same seed, so a permalink is reproducible', () => {
    expect(tipFor('m10', 3)?.id).toBe(tipFor('m10', 3)?.id);
  });

  it('cycles through a module tips as the seed advances, including negative seeds', () => {
    const tips = tipsForModule('m10');
    const seen = new Set<string>();
    for (let s = 0; s < tips.length; s++) seen.add(tipFor('m10', s)?.id ?? '');
    expect(seen.size).toBe(tips.length);
    // A section index derived from a scroll position can go negative in flight.
    expect(tipFor('m10', -1)?.id).toBe(tipFor('m10', tips.length - 1)?.id);
  });
});
