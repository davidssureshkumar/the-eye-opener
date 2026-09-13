/**
 * The CSS mirror cannot drift from the TypeScript source.
 *
 * `src/design/tokens.ts` is the single source of truth, but hand-written CSS cannot
 * import it, so `src/design/tokens.css` restates every token as a custom property.
 * Two files holding the same palette is exactly the arrangement that rots: someone
 * darkens the panel ground in one and the canvas no longer matches the div it sits
 * in, and nothing complains.
 *
 * So this generates the expected custom properties from the tokens themselves and
 * compares the whole set both ways. A changed value fails. A token added to
 * tokens.ts and not to tokens.css fails. A property left in the CSS after its token
 * was deleted also fails, which is the case a one-directional check would miss.
 *
 * Colours are compared case-insensitively: tokens.ts writes `#0B0E12` and Prettier
 * normalises CSS hex to lowercase, and that difference is not drift.
 *
 * The stylesheet is read from disk rather than imported. Vitest runs with CSS
 * processing off, so an `import '../tokens.css?raw'` comes back empty and the test
 * would pass by comparing nothing to nothing - the worst possible failure mode for a
 * guard. Reading the bytes is the only way to be sure this checks the real file.
 *
 * The Node reference below is scoped to this file for the same reason: it is the one
 * test that touches the filesystem, and the app's type environment stays browser-only
 * everywhere else.
 */

/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { font, fontSize, geometry, semantic, signal, signalMuted, space, surface } from '../tokens';

const CSS = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');

/** `ink900` to `ink-900`, `textHi` to `text-hi`. Splits at a case or digit boundary. */
function kebab(key: string): string {
  return key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();
}

/** Every `--name: value;` declaration in the file, in source order. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** What tokens.ts says the file must contain. */
function expected(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(surface)) out.set(`--${kebab(k)}`, v);
  for (const [k, v] of Object.entries(signal)) out.set(`--${k}`, v);
  for (const [k, v] of Object.entries(signalMuted)) out.set(`--${k}-dim`, v);
  for (const [k, v] of Object.entries(semantic)) out.set(`--${kebab(k)}`, v);
  for (const [k, v] of Object.entries(fontSize)) out.set(`--fs-${k}`, `${v}px`);
  space.forEach((v, i) => out.set(`--space-${i}`, `${v}px`));
  for (const [k, v] of Object.entries(geometry)) out.set(`--${kebab(k)}`, `${v}px`);
  for (const [k, v] of Object.entries(font)) out.set(`--font-${k}`, v);
  return out;
}

const actual = declarations(CSS);
const want = expected();

describe('tokens.css', () => {
  it('declares every token in tokens.ts', () => {
    const missing = [...want.keys()].filter((k) => !actual.has(k));
    expect(missing).toEqual([]);
  });

  it('declares nothing tokens.ts does not define', () => {
    const extra = [...actual.keys()].filter((k) => !want.has(k));
    expect(extra).toEqual([]);
  });

  it('gives every token the same value the TypeScript source gives it', () => {
    const wrong: string[] = [];
    for (const [name, value] of want) {
      const got = actual.get(name);
      if (got === undefined) continue; // reported by the first test
      if (got.toLowerCase() !== value.toLowerCase()) wrong.push(`${name}: ${got} != ${value}`);
    }
    expect(wrong).toEqual([]);
  });

  it('is dark only, with no light-theme block to keep in step', () => {
    // A second palette behind a media query is a second palette to maintain, and
    // the signal colours are chosen against a near-black ground. The decision is
    // recorded in PROGRESS.md; this pins it so it cannot be reversed by accident.
    expect(CSS).not.toMatch(/prefers-color-scheme/);
    expect(CSS).toMatch(/color-scheme:\s*dark/);
  });

  it('covers the palette it claims to - a sanity floor on the generated set', () => {
    // 6 surface + 4 signal + 4 muted + 10 semantic + 7 sizes + 9 spaces
    // + 4 geometry + 2 fonts.
    expect(want.size).toBe(46);
    expect(actual.size).toBe(46);
  });
});
