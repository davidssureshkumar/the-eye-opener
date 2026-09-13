# PROGRESS.md

What is done, what is stubbed, what is known to be inaccurate, and what is waiting
on an answer.

Updated at the end of each milestone. Last updated: **2026-09-13**, during
Milestone 1.

---

## Milestone status

| #   | Milestone | Covers                             | State           |
| --- | --------- | ---------------------------------- | --------------- |
| 1   | Core      | DSP, plots, state, content, shell  | **In progress** |
| 2   | M1 + M2   | Harmonics; ideal edge to real edge | Not started     |
| 3   | M3        | Transmission lines and reflections | Not started     |
| 4   | M4        | Loss                               | Not started     |
| 5   | M5        | ISI, eye diagrams, jitter          | Not started     |
| 6   | M7        | Equalization                       | Not started     |
| 7   | M6        | Crosstalk, noise, PDN              | Not started     |
| 8   | M8        | DDR5 / LPDDR5 / HBM                | Not started     |
| 9   | M9 + M10  | Wireless view; lab measurement     | Not started     |
| 10  | M11       | Sandbox                            | Not started     |
| 11  | Polish    | Accessibility, performance, docs   | Not started     |

Modules are built in the order above, not in numeric order: equalization (M7) comes
before crosstalk (M6) because the eye-closure machinery it needs is built in
Milestone 5.

---

## Milestone 1 — done

**1501 tests across 32 files, all passing.** `npm run verify` — format check,
lint, typecheck, tests — is clean end to end.

| Layer          | Tests |
| -------------- | ----- |
| `src/content`  | 755   |
| `src/plots`    | 265   |
| `src/dsp`      | 253   |
| `src/state`    | 137   |
| `src/dsp/jobs` | 64    |
| `src/workers`  | 27    |

### DSP — `src/dsp/`

| File          | Provides                                                                                                       | Tests                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `fft.ts`      | Radix-2 + Bluestein FFT, rfft/irfft, magnitude, phase, unwrap                                                  | Parseval, known transforms, arbitrary N          |
| `fourier.ts`  | Harmonic series, partial sums, Gibbs, sine integral, knee frequency                                            | Gibbs re-derived from Si(π); 50 % pulse ≡ square |
| `filters.ts`  | RC / Butterworth / Bessel / Gaussian / brickwall, RLC step response, group delay, rise-time–bandwidth products | Closed-form RC and Gaussian; DC gain unity       |
| `convolve.ts` | Direct, FFT, overlap-add convolution; correlation                                                              | Three methods agree; linear ≠ circular           |
| `interp.ts`   | Linear / cubic / sinc interpolation, resampling, threshold crossings, edge timing                              | Sub-sample crossing accuracy                     |
| `patterns.ts` | Twelve pattern generators, worst-case ISI construction, NRZ/PAM4 mapping                                       | Peak-distortion bound; pattern periods           |
| `prbs.ts`     | Eight PRBS polynomials, autocorrelation, run-length histogram                                                  | Period, ones density, two-valued autocorrelation |
| `random.ts`   | Seeded sub-streams, Gaussian sampling, erfc, Q, inverse normal CDF, dual-Dirac                                 | Known quantiles; n(BER) table                    |
| `window.ts`   | Eight windows, coherent gain, noise power bandwidth                                                            | Sidelobes measured, not quoted                   |
| `hilbert.ts`  | Analytic signal, envelope, minimum-phase construction                                                          | Causality of the constructed response            |

### Plotting — `src/plots/`

Canvas 2D throughout; no SVG, no chart library. DPR-aware sizing, crisp hairlines,
clipped trace drawing.

`canvas.ts` (surfaces, DPR, insets) · `scale.ts` (linear/log scales, nice ticks,
engineering formatting) · `grid.ts` (grids, scope graticule, per-division values) ·
`axes.ts` (linear and log axes, legend, corner readouts) · `trace.ts` ·
`stem.ts` (stems, bars, histograms) · `density-eye.ts` · `heatmap.ts` ·
`cursors.ts` · `colormaps.ts` · **`chrome.ts`** (declarative plot chrome — see
below).

### State — `src/state/`

`scenario.ts` is the single source of truth: a Zod-validated, fully serialisable
description of everything that affects any plot, with SI units documented on every
field. `url-codec.ts` round-trips it through a permalink. `presets.ts` holds 21
named starting points. `store.ts` holds the hash route and the scenario.

### Jobs — `src/dsp/jobs/`

A job is a pure function `(scenario, params) => result`: no DOM, no canvas, no
React, no clock, no global state. The same function therefore runs identically in a
worker, on the main thread, and in a node test — which is what makes the heavy paths
testable at all. Five jobs so far: `fourier`, `pattern`, `waveform`, `spectrum`,
`edge`. `adapt.ts` remaps a child job's progress into a slice of its parent's range
so `done / total` never goes backwards.

`guard.ts` is the NaN tripwire. `runJob` walks every result — objects, arrays,
typed arrays — and throws naming the field and index of the first non-finite value.
Infinity counts as a defect too; nothing in this course has a correct value of
infinity. The whole check is behind `import.meta.env.DEV`, so it is a bundler
constant and the calls disappear from a production build rather than being skipped
at runtime.

### Workers — `src/workers/`

`protocol.ts` (the message types and a runtime type guard) · `dsp.worker.ts` ·
`client.ts` · `use-job.ts` (the React hook).

**Cancellation is not in the job contract**, deliberately: a synchronous function
cannot be interrupted from outside, and pretending otherwise would put a lie in
every job signature. It lives in the client instead — stale results are discarded by
id, and a worker still running past `budgetMs` is terminated and replaced. A build
with no `Worker` falls back to running inline, deferred by a microtask so the caller
never sees a synchronous resolve.

### Export — `src/plots/export.ts`

Any plot can be saved as PNG or CSV. The CSV carries units in the header and the
caption, the metric readouts and the permalink as `#` preamble lines, so a file
opened a week later still says what it is and what produced it. Non-finite values
are written as `NaN` / `Inf` rather than as blank cells, because an empty cell reads
as "no data" and this one means "a defect reached the export". PNG rather than JPEG:
JPEG ringing around a one-pixel trace looks exactly like the ringing the plot exists
to show.

### Content — `src/content/`

`modules.ts` (the eleven-module outline as data) · `glossary.ts` (~110 terms with
units, definitions and cross-links) · `help.ts` (per-control help for every
Scenario path) · `bench-tips.ts` (31 “At the bench”
notes across all eleven modules, each tied to an instrument control a reader can
actually turn). A test asserts the tips quote no JEDEC document, name no instrument
model, and state no limit as if it were a specification.

### Documentation

`README.md` · `PHYSICS.md` · `PROGRESS.md` · `LICENSE`.

---

### Tooling and CI

ESLint 9 flat config encodes the brief's hard rules as lint rules rather than as
prose someone has to remember: `fetch` and `XMLHttpRequest` are restricted globals
(the site is fully static), and `any` and non-null assertions are errors inside
`src/dsp/**` and `src/sim/**`. Prettier is the single formatter, with the generated
goldens and snapshots excluded so a reformat cannot invalidate a pinned file.
`.github/workflows/ci.yml` runs format check, lint, typecheck and tests on every
push; the build step is gated on `hashFiles('index.html')` and switches itself on
when the app shell lands.

`npm run verify` runs the same four checks locally in the same order.

---

## Milestone 1 — not done

These block the Milestone 1 gate:

- **`src/ui/` shell.** `ModuleShell`, `InstrumentPanel`, `MetricList`, `Slider`,
  `Callout` (notice / silicon / bench variants), `SelfCheck`, `TryThis`, and the
  KaTeX `Math` component. None written.
- **App entry.** `index.html`, `src/main.tsx`, the hash router wired to
  `src/state/store.ts`, `@fontsource` imports. **Consequence: `npm run dev` does not
  serve a usable site yet.**
- **Global CSS.** `tokens.css` hand-mirrored from `src/design/tokens.ts`, guarded by
  a unit test so the two cannot drift.
- **`BRIEF.md`.** A clean UTF-8 copy of the project brief; the pasted original
  contains mojibake.
- **`.github/workflows/pages.yml`.** `ci.yml` is in place; the Pages deployment
  workflow is not, and has nothing to deploy until `index.html` exists.

---

## Known inaccuracies and approximations

Each of these is a deliberate, bounded compromise. None of them is a bug, and all of
them are visible to the reader where it matters.

### 1. Colormap interpolation

Viridis and Inferno are built from control points at 0.1 intervals with linear
interpolation between them, rather than the full 256-entry matplotlib tables.
Perceptual uniformity is therefore approximate. Acceptable because the colormaps
shade _relative_ density in an eye or a shmoo; it would not be acceptable if a
colour were read as a value, and no plot does that.

### 2. Bessel bandwidth normalisation

The −3 dB scale factor for each Bessel order is found by 80 steps of bisection and
cached, rather than from a closed form. Converged to roughly 10⁻¹², which is far
below anything visible.

### 3. erfc accuracy

The Chebyshev fit has fractional error below 1.2 × 10⁻⁷. It sits inside a Halley
refinement (where it only needs to be close) and in Q-to-BER conversion (where the
answer spans decades). Not a limitation in practice, but stated rather than assumed.

### 4. Minimum-phase construction near nulls

A magnitude floor protects the logarithm at deep nulls. A channel with a true
transmission zero — a resonant stub — is not minimum-phase at all and needs measured
phase. Module 4 must say this on screen when the construction is used.

### 5. Lumped RLC validity

The RLC model is lumped, so it is valid only while the propagation delay across the
structure is small compared with the rise time. Outside that range it understates
what happens, and Module 3's transmission-line treatment is the correct model.

---

## Decisions worth recording

**The Scenario is the only plot-affecting state.** Nothing that changes a picture
may live in component state. This is what simultaneously makes permalinks,
cancellable worker jobs, presets and pinned regression tests possible.

**Plot chrome is declared, not drawn.** `src/plots/chrome.ts` takes axes and traces
as data and paints background, grid, axes, legend and per-division readouts around
them. A legend appears because traces were declared, not because someone remembered
to ask for one, and `validateChrome` fails a test on a declaration that would produce
an ambiguous plot. Legends live on the canvas, not in DOM beside it, so a pasted
screenshot still identifies its traces.

**Help coverage is machine-enforced.** `src/content/__tests__/help.test.ts` walks
every leaf of a fully-populated Scenario and fails if any control lacks help — and
fails the other way too, if help exists for a path that is no longer a control. The
walk injects one crosstalk aggressor, because `crosstalk.aggressors` defaults to an
empty list and the assertion would otherwise pass vacuously.

**Array paths are canonicalised in help.** `crosstalk.aggressors.3.kb` resolves to
one entry, because aggressor three is not a different control from aggressor one.

**No invented specification numbers.** Enforced for presets by
`src/state/__tests__/presets.test.ts`, and recorded per control by the
`illustrative` flag in `src/content/help.ts`.

**A job is a pure function; cancellation belongs to the caller.** Putting a cancel
token in the job signature would claim something a synchronous function cannot do.
Keeping it out is what lets the same code run in a worker, on the main thread and in
a test with no branching.

**A NaN is never a sentinel.** `edge-job.ts` used to return `NaN` for "scope
bandwidth not limiting"; it now returns `null`. A NaN allowed to carry meaning is
indistinguishable from a NaN that means a divide went wrong, and it disarms the
finite-value guard for the whole result. The guard found this one on its first run.

**A golden file makes two different promises.** The encoded form of a Scenario is a
_tripwire_ — if a code change rewrites it, re-pinning is the right fix once the
change is confirmed intended. The decoded form is a _compatibility guarantee_: an
existing permalink must still decode to the same picture, and re-pinning it would be
silently breaking every link ever shared. A round-trip test catches neither, because
it only ever compares the codec with itself. `src/state/__tests__/permalinks.test.ts`
pins both halves and says which is which in its header.

**`react-router-dom` is dropped.** It was an unused dependency: hash routing has
been implemented directly against `window.location.hash` in `src/state/store.ts`
from the start, and nothing ever imported the package. This was open question 3
below; it is resolved now rather than left open, because a `npm audit` on the
unrelated vitest chain also flagged an advisory against the installed
`react-router-dom` range, which is a concrete cost an unused dependency was
imposing on every future audit. `vite.config.ts`'s comment pointing at a
`src/app/router.tsx` that was never written is corrected to point at
`src/state/store.ts` instead.

**`vite-node` was never a real dependency.** `npm run goldens` invoked it without
declaring it in `package.json` — it happened to be resolvable because vitest 2.x
depended on it internally and npm hoisted the binary. Vitest 4 dropped that
dependency, and the script broke on the next routine `npm install` with no
warning at commit time. Replaced with `tsx`, a devDependency in its own right
with no coupling to Vite's release cadence, so this class of breakage cannot
recur silently the same way. The regenerated goldens file is byte-identical to
the one it replaced, confirming the swap changed nothing about what the script
produces.

---

## Open questions

Raised at the Milestone 1 gate; work continues under the stated assumption until
answered.

### 1. Gibbs overshoot figure

The brief states 8.93 %. The exact Wilbraham–Gibbs value is **8.9490 %** of the jump
discontinuity — (2/π)·Si(π) − 1, halved for the jump reference.

_Assumed:_ the exact value, in both code and prose. Both constants are exported and
the test suite re-derives them from the sine integral.

### 2. Dual-Dirac convention

`dualDiracN` implements n(BER) = 2·Q⁻¹(BER), which reproduces the familiar bench
table (1e-12 → 14.069). Some houses use the BER/2 argument instead, which shifts
every multiplier.

_Assumed:_ the 2·Q⁻¹(BER) form. Confirm it matches house practice.

### 3. Clean brief

The pasted project brief contains UTF-8 mojibake (em-dashes rendered as `â`). A
clean `BRIEF.md` is owed so the governing document is readable in the repository.

---

## Next

Finish the Milestone 1 shell and entry point and add the Pages workflow, then **stop
for review** before starting Milestone 2. The three open questions above want
answers at that gate.
