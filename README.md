# Anatomy of an Edge

An interactive, self-hosted course on signal integrity, from Fourier harmonics to
receiver reconstruction on a DDR5, LPDDR5/5X or HBM interface.

One question runs through all eleven modules:

> **A transmitter sent a square wave. The receiver measured this. How do we get back
> to ones and zeros?**

Every plot on the site is computed in the browser from first principles. There is no
server, no API key and no network call at runtime — the whole thing is a folder of
static files.

---

## Status

**Milestone 1 of 11 — core layers, in progress.** The DSP, plotting, state and
content layers are implemented and tested. The React shell that assembles them into
a page is not written yet, so **`npm run dev` does not yet serve a usable site**:
there is no `index.html` or `src/main.tsx`. What you can do today is read the code
and run the test suite.

```
1501 tests, 32 files, all passing
```

See [PROGRESS.md](PROGRESS.md) for what is done, what is stubbed, and the known
inaccuracies. See [PHYSICS.md](PHYSICS.md) for every formula the site implements,
with its derivation, assumptions and range of validity — that file, not this one, is
the technical record.

---

## Quick start

Requires Node 18 or newer.

```bash
npm install
npm test          # vitest run  - the useful command today
npm run verify    # format check + lint + typecheck + test, in that order
npm run typecheck # tsc -b --force
npm run lint      # eslint .
npm run format    # prettier --write .
npm run goldens   # regenerate the pinned permalink goldens
npm run dev       # vite dev server (see Status above)
npm run build     # tsc -b && vite build  -> dist/
npm run preview   # serve the built dist/ locally
```

`npm run verify` is what CI runs, in the same order, so a green local run means a
green pipeline.

The build output in `dist/` is plain static files with relative asset paths
(`base: './'` in [vite.config.ts](vite.config.ts)), so it deploys unchanged to
GitHub Pages, Netlify, Vercel, S3, or a folder served by anything at all. Routing is
hash-based for the same reason: deep links survive a host with no rewrite rules.

---

## The eleven modules

| #   | Module                                          | The question it answers                             |
| --- | ----------------------------------------------- | --------------------------------------------------- |
| 1   | Building a square wave from nothing             | What is a square wave actually made of?             |
| 2   | From ideal edge to real edge                    | Why does a real edge have a slope?                  |
| 3   | Transmission lines and reflections              | Why does the signal come back?                      |
| 4   | Loss: where the harmonics actually go           | Why does a long trace round the corners off?        |
| 5   | ISI, eye diagrams and jitter                    | Why does this bit depend on the last one?           |
| 6   | Crosstalk, noise and the power delivery network | What does the rest of the board do to this net?     |
| 7   | Equalization: rebuilding the square wave        | How does the receiver undo the channel?             |
| 8   | Memory interfaces: DDR5, LPDDR5/5X, HBM         | How does a real memory bus find the sampling point? |
| 9   | The wireless view of the same problem           | Why is this the same maths as a radio link?         |
| 10  | Measuring it in the lab                         | Is that the signal, or is it the instrument?        |
| 11  | Sandbox                                         | Everything at once, including PAM4.                 |

The list is data, not prose: [src/content/modules.ts](src/content/modules.ts) is the
single source that navigation, progress tracking, presets and cross-links all read.

---

## How it is put together

```
src/
  dsp/       Signal processing, written from scratch. No library on a hot path.
    jobs/    Heavy computations as pure functions of a Scenario.
  workers/   The worker, its protocol, the client that cancels stale work.
  plots/     Canvas 2D rendering. No SVG, no chart library.
  state/     The Scenario, its URL codec, the presets, the store.
  content/   Module list, glossary, per-control help, bench tips.
  design/    Design tokens: the one place a colour or a font size is defined.
```

### The Scenario is the only state

Every plot on the site is a pure function of a single serialisable object, the
`Scenario` ([src/state/scenario.ts](src/state/scenario.ts)). Nothing that affects a
plot is allowed to live in component state.

That one rule buys four things at once:

- **Permalinks.** Any screen encodes into a URL and decodes back to the same picture
  ([src/state/url-codec.ts](src/state/url-codec.ts)).
- **Cancellable work.** A worker job is a Scenario in, arrays out, so a job made
  obsolete by a slider move can simply be dropped.
- **Presets.** A named starting point is just a Scenario with a sentence attached
  ([src/state/presets.ts](src/state/presets.ts)).
- **Regression tests.** A pinned Scenario plus expected numbers is a test.

Every field carries its SI unit in a comment, and the schema is Zod, so a decoded
permalink from an older version of the site is validated rather than trusted.

### Plots are declared, not drawn

A plot states its axes and its traces once, as data, and
[src/plots/chrome.ts](src/plots/chrome.ts) paints the background, grid, axes,
legend and per-division readouts around them:

```ts
withChrome(
  surface,
  {
    x: { scale: t, unit: 's', title: 'Time' },
    y: { scale: v, unit: 'V', title: 'Voltage' },
    traces: [
      { key: 'tx', label: 'Transmitted', color: ink.tx },
      { key: 'rx', label: 'Received', color: ink.rx, dash: [4, 3] },
    ],
    grid: 'graticule',
    notes: ['Illustrative values'],
  },
  () => {
    drawTrace(surface, txTime, txVolts, t, v, { color: ink.tx });
    drawTrace(surface, rxTime, rxVolts, t, v, { color: ink.rx, dash: [4, 3] });
  },
);
```

The legend appears because the traces were declared, not because anyone remembered
to call for one. `validateChrome` then rejects declarations that would produce an
ambiguous picture — an axis with no unit, two traces drawn identically, a
multi-trace plot with the legend suppressed — and the unit tests run it.

Legends and readouts are drawn **on the canvas**, not in DOM beside it, so a
screenshot pasted into a bug report still says what each trace is and what the
timebase was.

### Heavy work is a pure function, and cancellation is not its problem

A job in [src/dsp/jobs/](src/dsp/jobs/) is `(scenario, params) => result` — no DOM,
no canvas, no React, no clock, no global state. So the same function runs
identically in a worker, on the main thread, and in a node test, and the expensive
paths are testable without a browser.

What a job deliberately does **not** take is a cancel token. A synchronous function
cannot be interrupted from outside; a token in the signature would be a promise the
code cannot keep. Cancellation lives in
[src/workers/client.ts](src/workers/client.ts) instead: a result whose id is stale is
dropped, and a worker still running past its budget is terminated and replaced. Drag
a slider and the obsolete 100k-bit eye stops mattering, whether or not it stops
running.

Progress is monotonic by construction. A job that calls another job remaps the
child's ticks into a slice of its own range (`adapt.ts`), so `done / total` never
goes backwards on the progress bar.

### Nothing non-finite leaves a job

[src/dsp/guard.ts](src/dsp/guard.ts) walks every job result — objects, arrays, typed
arrays — and throws naming the field and the index of the first non-finite value:

```
job 'eye' produced a non-finite value: eye.height is NaN
```

A NaN that reaches a canvas draws nothing, and arrives as a bug report saying "the
trace stops halfway". Caught here it names the divide that produced it. Infinity is
treated as a defect too: an open termination is a large impedance and a BER floor is
a small number, so in this codebase an infinity means a divide by zero. The whole
check sits behind `import.meta.env.DEV`, which is a bundler constant, so it compiles
out of the production build rather than being skipped at runtime.

The rule that follows from it: **a NaN is never a sentinel.** A field that means
"not applicable" is `number | null`, because a NaN allowed to carry meaning is
indistinguishable from a NaN that means something went wrong, and it disarms the
guard for the entire result.

### Every plot can leave the browser

[src/plots/export.ts](src/plots/export.ts) saves any plot as PNG or CSV. The CSV
carries its units in the header and its caption, metric readouts and permalink as
`#` preamble lines, so a file opened a week later by someone who did not take the
measurement still says what it is and what produced it. Non-finite values are
written as `NaN` / `Inf` rather than as blank cells — an empty cell reads as "no
data", and this one means a defect got as far as the export. PNG rather than JPEG,
because JPEG ringing around a one-pixel trace looks exactly like the ringing the
plot exists to show.

### Help is enforced, not aspirational

Every control is a dotted path into the Scenario, and
[src/content/help.ts](src/content/help.ts) attaches an explanation to each one:
what it changes physically, why you would move it during validation, and what the
equivalent is at the bench.

`src/content/__tests__/help.test.ts` walks every leaf of a fully-populated Scenario
and fails if any path has no help — and fails the other way too, if help exists for
a path that is no longer a control. A slider cannot ship unexplained.

The [glossary](src/content/glossary.ts) holds about 110 signal-integrity terms, each
with its unit, a definition precise enough to compute with, and cross-links that a
test proves all resolve.

[bench-tips.ts](src/content/bench-tips.ts) adds 31 “At the bench” notes spread
across all eleven modules — why averaging destroys the jitter you were trying to
measure, why the ground lead is the probe, why an equalized eye on a scope is a
computed picture and not a measured one. Each names an instrument control a reader
can actually turn. A test asserts they quote no JEDEC document, name no instrument
model, and state no limit as though it came from a specification.

---

## Accuracy and provenance

The audience is a post-silicon memory validation engineer, so the physics is meant
to be correct rather than merely illustrative-looking. Two rules govern that:

**Every formula is recorded.** [PHYSICS.md](PHYSICS.md) lists each one with its
source or derivation, its assumptions, and the range over which it holds. Where an
implementation is an approximation — a 0.1-interval control-point colormap rather
than the full matplotlib table, say — it is named as an approximation in
[PROGRESS.md](PROGRESS.md) rather than quietly shipped.

**No number here is quoted from a standard.** This project has no access to JEDEC
documents and reproduces none of their text or figures. Data rates, impedances,
coupling coefficients, loss tangents and timing budgets are _representative of a
class of interface_, chosen to make the physics visible — they are not
specification values and must not be used as such. Controls whose defaults are
stand-ins are marked `illustrative` in the help data and badged in the UI; the
relevant standards are cited by document number only:

- JESD79-5 (DDR5)
- JESD209-5 (LPDDR5/5X)
- JESD238 (HBM3)

If you need a real number, read the real specification.

---

## Design constraints

These were fixed at the start and are not up for casual revision:

| Constraint                             | Why                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Fully static, no runtime network calls | It has to work behind a lab firewall, offline, from a USB stick.         |
| Canvas 2D for every plot, never SVG    | Hundred-thousand-point traces and density-graded eyes; SVG cannot do it. |
| DSP from scratch in `src/dsp/`         | A course about the maths cannot hide the maths in a library.             |
| TypeScript strict, no `any` in DSP     | A silent `NaN` in a jitter path is a wrong answer, not a crash.          |
| Heavy work in Web Workers, cancellable | A slider must respond in 100 ms while a 100k-bit eye is building.        |
| A unit test per DSP function           | Against a closed-form result or a known-good value, not a snapshot.      |
| Dark theme, one theme                  | It is a scope screen.                                                    |

Accessibility is a constraint too, not a polish item: keyboard-operable controls,
visible focus rings, `prefers-reduced-motion` honoured, and a text-readable metric
summary beside every plot so the numbers are available without reading pixels.

---

## Testing

```bash
npm test                # everything - 1501 tests across 32 files
npx vitest run src/dsp  # one layer
npx vitest              # watch mode
```

The suite is not decoration. DSP functions are checked against closed-form answers —
Parseval's relation, known PRBS periods and run-length distributions, analytically
known filter responses, histogram bin centres that must not sit on bin edges. The
content tests check coverage and cross-reference integrity. The preset tests assert
that no shipped default claims to be a specification figure.

The worker client is tested against a hand-driven fake worker rather than a timer,
so every interleaving — a stale result arriving after its replacement, a worker that
dies mid-job, progress from a superseded run — is stated rather than raced. It found
a real defect on its first run: an explicitly supplied worker factory was being
overridden by the environment check, so the worker path was never exercised.

The permalink goldens pin both halves of what a permalink promises. The **encoded**
form is a tripwire: if a change rewrites it, re-pin it once the change is confirmed
intended. The **decoded** form is a compatibility guarantee: a link shared last month
must still decode to the same picture, and re-pinning that would be silently
breaking it. A round-trip test catches neither, since it only compares the codec with
itself. `npm run goldens` regenerates the encoded half deliberately.

ESLint carries the rules that are easy to state and easy to forget: `fetch` and
`XMLHttpRequest` are restricted globals, and `any` and non-null assertions are errors
inside `src/dsp/**` and `src/sim/**`. It has already earned its place — a
`no-control-regex` finding turned out to be a literal backspace byte sitting where
`\b` was meant, in a pattern that could therefore never match.

---

## Licence

MIT. See [LICENSE](LICENSE).

The signal-integrity relationships implemented here are standard engineering
results, not the author's; where a particular formulation comes from a specific
source, PHYSICS.md says so.
