/**
 * The entry point.
 *
 * Font faces first, then the design tokens and global styles, then the app. The
 * order matters: `global.css` imports `tokens.css`, and Tailwind's base layer has to
 * land before the component layer that overrides parts of it.
 *
 * Only the latin subsets are imported. The full `400.css` from @fontsource pulls in
 * cyrillic, greek and vietnamese as well - about four times the bytes for glyphs this
 * course never renders. Weights: 400 and 600 for text, 400 and 500 for the mono face
 * used by every numeric readout.
 *
 * StrictMode is on. It double-invokes effects in development, which is exactly the
 * pressure the canvas and worker code should be under: a plot that leaks a rAF handle
 * or a worker that is not cancelled on re-run shows up here rather than on a reader's
 * laptop.
 */

import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import './design/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';

const host = document.getElementById('root');
if (!host) {
  // index.html is part of this repository, so this cannot happen from a correct
  // build - but a silent blank page is the worst possible way to find out it did.
  throw new Error('No #root element: index.html and main.tsx have gone out of sync.');
}

createRoot(host).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
