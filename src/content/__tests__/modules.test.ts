import { describe, it, expect } from 'vitest';
import { MODULES, getModule, isModuleId, moduleOrder, moduleNeighbours } from '../modules';
import { PRESETS } from '../../state/presets';

describe('module list', () => {
  it('has eleven modules', () => {
    expect(MODULES).toHaveLength(11);
  });

  it('has unique ids', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers them 1..11 in order', () => {
    expect(MODULES.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('gives every module a question and a summary', () => {
    for (const m of MODULES) {
      expect(m.title.length, m.id).toBeGreaterThan(0);
      expect(m.question.length, m.id).toBeGreaterThan(0);
      expect(m.summary.length, m.id).toBeGreaterThan(0);
    }
  });

  it('assigns every module to a milestone in the plan range', () => {
    for (const m of MODULES) {
      expect(m.milestone, m.id).toBeGreaterThanOrEqual(2);
      expect(m.milestone, m.id).toBeLessThanOrEqual(11);
    }
  });
});

describe('lookup', () => {
  it('finds every module by id', () => {
    for (const m of MODULES) expect(getModule(m.id)).toBe(m);
  });

  it('rejects unknown ids', () => {
    expect(getModule('m12')).toBeUndefined();
    expect(isModuleId('m12')).toBe(false);
    expect(isModuleId('m1')).toBe(true);
  });

  it('orders ids the same way as the list', () => {
    expect(moduleOrder()).toEqual(MODULES.map((m) => m.id));
  });
});

describe('neighbours', () => {
  it('has no previous at the first module', () => {
    const n = moduleNeighbours(MODULES[0].id);
    expect(n.previous).toBeUndefined();
    expect(n.next?.id).toBe(MODULES[1].id);
  });

  it('has no next at the last module', () => {
    const last = MODULES[MODULES.length - 1];
    const n = moduleNeighbours(last.id);
    expect(n.next).toBeUndefined();
    expect(n.previous?.id).toBe(MODULES[MODULES.length - 2].id);
  });

  it('is symmetric through the middle', () => {
    for (let i = 1; i < MODULES.length - 1; i += 1) {
      const n = moduleNeighbours(MODULES[i].id);
      expect(n.previous?.id).toBe(MODULES[i - 1].id);
      expect(n.next?.id).toBe(MODULES[i + 1].id);
    }
  });

  it('returns both undefined for an unknown id', () => {
    expect(moduleNeighbours('nope')).toEqual({ previous: undefined, next: undefined });
  });
});

describe('presets cross-reference', () => {
  it('names only real modules', () => {
    for (const p of PRESETS) {
      for (const id of p.modules) {
        expect(isModuleId(id), `${p.id} -> ${id}`).toBe(true);
      }
    }
  });
});
