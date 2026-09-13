import { describe, it, expect } from 'vitest';
import {
  GLOSSARY,
  getTerm,
  hasTerm,
  glossaryAlphabetical,
  termsForModule,
  searchGlossary,
} from '../glossary';
import { isModuleId } from '../modules';

describe('glossary integrity', () => {
  it('has unique ids', () => {
    const ids = GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses kebab-case ids, because they appear in the URL', () => {
    for (const e of GLOSSARY) {
      expect(e.id, e.term).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('defines every term', () => {
    for (const e of GLOSSARY) {
      expect(e.term.length, e.id).toBeGreaterThan(0);
      // Long enough that "the thing that does the thing" cannot pass.
      expect(e.definition.length, e.id).toBeGreaterThan(40);
    }
  });

  it('resolves every cross-reference', () => {
    const missing: string[] = [];
    for (const e of GLOSSARY) {
      for (const s of e.see ?? []) if (!hasTerm(s)) missing.push(`${e.id} -> ${s}`);
    }
    expect(missing).toEqual([]);
  });

  it('never cross-references itself', () => {
    for (const e of GLOSSARY) {
      expect(e.see ?? [], e.id).not.toContain(e.id);
    }
  });

  it('lists no duplicate cross-references', () => {
    for (const e of GLOSSARY) {
      const see = e.see ?? [];
      expect(new Set(see).size, e.id).toBe(see.length);
    }
  });

  it('attributes every term to a real module', () => {
    for (const e of GLOSSARY) {
      if (e.module !== undefined) expect(isModuleId(e.module), e.id).toBe(true);
    }
  });

  it('gives no empty aka list', () => {
    for (const e of GLOSSARY) {
      if (e.aka !== undefined) expect(e.aka.length, e.id).toBeGreaterThan(0);
    }
  });
});

describe('lookup', () => {
  it('finds every term by id', () => {
    for (const e of GLOSSARY) expect(getTerm(e.id)).toBe(e);
  });

  it('reports unknown ids as absent', () => {
    expect(getTerm('not-a-term')).toBeUndefined();
    expect(hasTerm('not-a-term')).toBe(false);
  });
});

describe('alphabetical order', () => {
  it('sorts by term and keeps every entry', () => {
    const sorted = glossaryAlphabetical();
    expect(sorted).toHaveLength(GLOSSARY.length);
    const terms = sorted.map((e) => e.term.toLowerCase());
    expect([...terms].sort()).toEqual(terms);
  });

  it('does not mutate the source list', () => {
    const before = GLOSSARY.map((e) => e.id);
    glossaryAlphabetical();
    expect(GLOSSARY.map((e) => e.id)).toEqual(before);
  });
});

describe('module filter', () => {
  it('returns only terms attributed to that module', () => {
    for (const entry of termsForModule('m5')) expect(entry.module).toBe('m5');
  });

  it('returns nothing for a module with no terms of its own', () => {
    expect(termsForModule('nonexistent')).toEqual([]);
  });
});

describe('search', () => {
  it('finds an exact term', () => {
    const hits = searchGlossary('unit interval');
    expect(hits[0]?.id).toBe('unit-interval');
  });

  it('matches an abbreviation ahead of a passing mention', () => {
    const hits = searchGlossary('ISI');
    expect(hits[0]?.id).toBe('isi');
  });

  it('is case- and space-insensitive', () => {
    expect(searchGlossary('  EyE HeIgHt ')[0]?.id).toBe('eye-height');
  });

  it('returns nothing for an empty query', () => {
    expect(searchGlossary('')).toEqual([]);
    expect(searchGlossary('   ')).toEqual([]);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchGlossary('zzzzqqqq')).toEqual([]);
  });
});
