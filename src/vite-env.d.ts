/// <reference types="vite/client" />

// Present so `import.meta.env` is typed. The only flag the source reads is `DEV`,
// which the bundler replaces with a literal, letting the development-only guards in
// `src/dsp/guard.ts` be removed from the production build rather than skipped in it.
