/**
 * Lint rules for The Eye Opener.
 *
 * Formatting is Prettier's job and is switched off here (`eslint-config-prettier`
 * last), so everything below is about meaning. Three groups:
 *
 *  1. The usual TypeScript and React-hook correctness rules.
 *  2. Project rules that encode the brief. The site is static and offline: it must
 *     never make a network call at runtime, and the DSP must never fall back to
 *     `any`, because an `any` in a filter is how a units error survives to the plot.
 *  3. Exemptions where a rule would be wrong rather than inconvenient - a worker
 *     entry point has no exports to lint, a test may assert on a deliberately
 *     malformed value.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'public/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // An unused import is usually a half-finished edit. An argument prefixed with
      // an underscore is a deliberate signature match and is allowed to stay.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // `let` that is never reassigned reads as "this changes later" and misleads.
      'prefer-const': 'error',
      'no-var': 'error',

      // `==` against anything but null is a trap around NaN and empty strings, both
      // of which occur in this codebase for real reasons.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // The site is static and must run with no network at all: no origin to call,
      // no key to hold, and it has to work from a file:// copy on a lab machine.
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'The site is fully static: no runtime network calls.' },
        { name: 'XMLHttpRequest', message: 'The site is fully static: no runtime network calls.' },
      ],

      // Physics that silently swallows a failure is worse than physics that stops.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },

  {
    // The DSP is the part a reader is asked to trust. `any` there would let a
    // sample count and a sample rate be added together without complaint.
    files: ['src/dsp/**/*.ts', 'src/sim/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },

  {
    // Files carrying published rational-approximation coefficients: the Si(x)
    // auxiliary functions and the Chebyshev table behind erfc. They are quoted at
    // the precision of the source they came from, which is more digits than a
    // double holds, so `no-loss-of-precision` fires on every one of them.
    //
    // Quoting them in full is the correct thing to do: the literal rounds to the
    // nearest representable double either way, and the extra digits are what lets
    // someone check the table against the paper. Shortening them to please the
    // linter would trade a real property - verifiability - for a cosmetic one.
    files: ['src/dsp/fourier.ts', 'src/dsp/random.ts'],
    rules: { 'no-loss-of-precision': 'off' },
  },

  {
    // A worker entry point is a side effect by design: it installs a message
    // handler and exports nothing.
    files: ['src/workers/*.worker.ts'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  {
    // Tests hand deliberately wrong values to guards to prove they are rejected,
    // and build fakes that do not implement a whole DOM interface.
    files: ['**/__tests__/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      // A test indexes a table it has just built and knows the length of.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Tests pin how awkward doubles are formatted, which needs awkward doubles.
      'no-loss-of-precision': 'off',
      'no-empty': 'off',
      'no-console': 'off',
    },
  },

  prettier,
);
