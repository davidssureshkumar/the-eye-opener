/**
 * The section-anchor table cannot drift from PHYSICS.md, and no module can cite a
 * section that is not there.
 *
 * The expected table is regenerated from the file's numbered headings with GitHub's
 * slug rule and compared both ways, as the token test does for the stylesheet. Then
 * every `source="..."` note in every module body is split with the same function
 * MathBlock uses, and each citation must resolve.
 */

/// <reference types="node" />

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHYSICS_SECTIONS, physicsSectionUrl, splitSource } from '../physics-sections';
import { REPO_URL } from '../repo';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PHYSICS = readFileSync(join(ROOT, 'PHYSICS.md'), 'utf8');

/** GitHub's heading slug: lower case, drop punctuation other than hyphen and underscore, spaces to hyphens. */
function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\-_ ]/gu, '')
    .replace(/ /g, '-');
}

function sectionsFromFile(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of PHYSICS.split(/\r?\n/)) {
    const m = /^#{2,3} ((\d+(?:\.\d+)?)\.? .*)$/.exec(line);
    if (m) out[m[2]] = githubSlug(m[1]);
  }
  return out;
}

function moduleSources(dir: string): { file: string; source: string }[] {
  const found: { file: string; source: string }[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...moduleSources(path));
    else if (name.endsWith('.tsx')) {
      const text = readFileSync(path, 'utf8');
      for (const m of text.matchAll(/source="([^"]*)"/g)) found.push({ file: name, source: m[1] });
    }
  }
  return found;
}

describe('PHYSICS.md section anchors', () => {
  it('match the headings in the file, both ways', () => {
    expect(PHYSICS_SECTIONS).toEqual(sectionsFromFile());
  });

  it('slug a heading the way GitHub does', () => {
    expect(githubSlug('3.2 Rise-time–bandwidth product')).toBe('32-rise-timebandwidth-product');
    expect(githubSlug('6.2 Error function and the Q-function')).toBe('62-error-function-and-the-q-function');
  });

  it('build a link into the repository copy of the file', () => {
    expect(physicsSectionUrl('12.6')).toBe(`${REPO_URL}/blob/main/PHYSICS.md#126-tdr`);
    expect(physicsSectionUrl('99.9')).toBeUndefined();
  });

  it('are cited only where they exist, by every module', () => {
    const sources = moduleSources(fileURLToPath(new URL('../../modules/', import.meta.url)));
    expect(sources.length).toBeGreaterThan(20);
    for (const { file, source } of sources) {
      for (const part of splitSource(source)) {
        if (part.kind === 'section')
          expect([file, part.section, PHYSICS_SECTIONS[part.section]]).not.toContain(undefined);
      }
    }
  });
});

describe('splitSource', () => {
  it('finds every citation and keeps the text around them', () => {
    const parts = splitSource('PHYSICS.md §2.5 and §3.1. Implemented in x.');
    expect(parts).toEqual([
      { kind: 'text', text: 'PHYSICS.md ' },
      { kind: 'section', text: '§2.5', section: '2.5' },
      { kind: 'text', text: ' and ' },
      { kind: 'section', text: '§3.1', section: '3.1' },
      { kind: 'text', text: '. Implemented in x.' },
    ]);
    expect(parts.map((p) => p.text).join('')).toBe('PHYSICS.md §2.5 and §3.1. Implemented in x.');
  });

  it('returns plain text unchanged when nothing is cited', () => {
    expect(splitSource('Johnson and Graham, ch. 4.')).toEqual([
      { kind: 'text', text: 'Johnson and Graham, ch. 4.' },
    ]);
    expect(splitSource('')).toEqual([]);
  });
});
