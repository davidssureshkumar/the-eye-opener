import { describe, it, expect } from 'vitest';
import {
  CONTROL_HELP,
  NON_CONTROL_PATHS,
  canonicalPath,
  controlPaths,
  helpFor,
  referencedTerms,
  danglingTermRefs,
  illustrativeControls,
} from '../help';
import { hasTerm } from '../glossary';
import { defaultScenario, aggressorSchema, type Scenario } from '../../state/scenario';

/**
 * A Scenario that exercises every control. `crosstalk.aggressors` defaults to an
 * empty list, so without an element injected here every aggressor control would
 * be invisible to the walk and the coverage assertion would pass vacuously.
 */
function fullScenario(): Scenario {
  const s = defaultScenario();
  return {
    ...s,
    crosstalk: { ...s.crosstalk, aggressors: [aggressorSchema.parse({})] },
  };
}

describe('canonicalPath', () => {
  it('collapses array indices, so one entry serves every aggressor', () => {
    expect(canonicalPath('crosstalk.aggressors.0.kb')).toBe('crosstalk.aggressors.[].kb');
    expect(canonicalPath('crosstalk.aggressors.7.kb')).toBe('crosstalk.aggressors.[].kb');
  });

  it('leaves a non-numeric path alone', () => {
    expect(canonicalPath('source.symbolRate')).toBe('source.symbolRate');
  });

  it('does not collapse a segment that merely contains digits', () => {
    expect(canonicalPath('channel.tline.z0')).toBe('channel.tline.z0');
    expect(canonicalPath('eq.ctlePole1')).toBe('eq.ctlePole1');
  });
});

describe('controlPaths', () => {
  it('treats a number array as one control, not one per element', () => {
    expect(controlPaths([1, 2, 3], 'eq.ffeTaps')).toEqual(['eq.ffeTaps']);
  });

  it('yields the array itself plus its element controls', () => {
    expect(controlPaths([{ a: 1, b: 2 }], 'xs')).toEqual(['xs', 'xs.[].a', 'xs.[].b']);
  });

  it('yields only the array when it is empty, since there is no element shape', () => {
    expect(controlPaths([], 'xs')).toEqual(['xs']);
  });

  it('walks nested objects to their leaves', () => {
    expect(controlPaths({ a: { b: 1, c: 'x' } })).toEqual(['a.b', 'a.c']);
  });
});

describe('coverage', () => {
  const paths = controlPaths(fullScenario()).map(canonicalPath);

  it('walks a non-trivial number of controls', () => {
    expect(paths.length).toBeGreaterThan(80);
  });

  it('explains every control in the scenario', () => {
    const missing = paths.filter((p) => !NON_CONTROL_PATHS.has(p) && CONTROL_HELP[p] === undefined);
    expect(missing).toEqual([]);
  });

  it('reaches the aggressor controls', () => {
    expect(paths).toContain('crosstalk.aggressors.[].kb');
    expect(paths).toContain('crosstalk.aggressors.[].pattern.kind');
  });

  it('has no help for a path that is not a control', () => {
    const known = new Set(paths);
    const orphans = Object.keys(CONTROL_HELP).filter((p) => !known.has(p));
    expect(orphans).toEqual([]);
  });

  it('exempts nothing it does not have to', () => {
    const known = new Set(paths);
    for (const p of NON_CONTROL_PATHS) expect(known.has(p), p).toBe(true);
  });
});

describe('help entries', () => {
  it('gives every control a label and a "what"', () => {
    for (const [path, h] of Object.entries(CONTROL_HELP)) {
      expect(h.label.length, path).toBeGreaterThan(0);
      expect(h.label.endsWith(':'), path).toBe(false);
      expect(h.what.length, path).toBeGreaterThan(40);
    }
  });

  it('resolves every glossary cross-reference', () => {
    expect(danglingTermRefs()).toEqual([]);
  });

  it('references a useful number of terms', () => {
    const terms = referencedTerms();
    expect(terms.length).toBeGreaterThan(40);
    for (const t of terms) expect(hasTerm(t), t).toBe(true);
  });

  it('lists no duplicate cross-references', () => {
    for (const [path, h] of Object.entries(CONTROL_HELP)) {
      const see = h.see ?? [];
      expect(new Set(see).size, path).toBe(see.length);
    }
  });

  it('marks the illustrative defaults, since none of them are spec figures', () => {
    const marked = illustrativeControls();
    expect(marked.length).toBeGreaterThan(5);
    expect(marked).toContain('source.symbolRate');
    expect(marked).toContain('crosstalk.aggressors.[].kb');
  });
});

describe('helpFor', () => {
  it('accepts a concrete indexed path', () => {
    expect(helpFor('crosstalk.aggressors.3.kf')?.label).toBe('Forward coupling Kf');
  });

  it('returns undefined for an unknown path', () => {
    expect(helpFor('source.nothing')).toBeUndefined();
  });
});
