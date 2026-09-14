/**
 * The site links to repository documents by name, so a renamed or deleted file
 * would leave a dead link on every unwritten module's page. This checks the files
 * are where the links say.
 */

/// <reference types="node" />

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO_URL, repoDocumentUrl, type RepoDocument } from '../repo';

const DOCUMENTS: RepoDocument[] = ['PROGRESS.md', 'PHYSICS.md', 'README.md', 'BRIEF.md'];

describe('repository document links', () => {
  it('point at files that exist at the repository root', () => {
    for (const file of DOCUMENTS) {
      expect(existsSync(fileURLToPath(new URL(`../../../${file}`, import.meta.url)))).toBe(true);
      expect(repoDocumentUrl(file)).toBe(`${REPO_URL}/blob/main/${file}`);
    }
  });

  it('are plain https links with no query or fragment', () => {
    const url = new URL(repoDocumentUrl('PHYSICS.md'));
    expect(url.protocol).toBe('https:');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });
});
