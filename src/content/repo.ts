/**
 * Where the project's own documents live, for links from the site.
 *
 * PROGRESS.md and PHYSICS.md are not part of the build, so a page that names them
 * must link to them or the reader has no way to open them. These are ordinary
 * links: the site makes no request of its own.
 */

export const REPO_URL = 'https://github.com/davidssureshkumar/the-eye-opener';

/** A repository document at the head of `main`. */
export type RepoDocument = 'PROGRESS.md' | 'PHYSICS.md' | 'README.md' | 'BRIEF.md';

export function repoDocumentUrl(file: RepoDocument): string {
  return `${REPO_URL}/blob/main/${file}`;
}
