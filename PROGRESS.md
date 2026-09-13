# PROGRESS.md

What is done, what is stubbed, what is known to be inaccurate, and what is waiting
on an answer.

Updated at the end of each milestone. Last updated: **2026-09-13**, at the
Milestone 1 gate.

---

## Milestone status

| #   | Milestone | Covers                             | State                  |
| --- | --------- | ---------------------------------- | ---------------------- |
| 1   | Core      | DSP, plots, state, content, shell  | **Complete - at gate** |
| 2   | M1 + M2   | Harmonics; ideal edge to real edge | Not started            |
| 3   | M3        | Transmission lines and reflections | Not started            |
| 4   | M4        | Loss                               | Not started            |
| 5   | M5        | ISI, eye diagrams, jitter          | Not started            |
| 6   | M7        | Equalization                       | Not started            |
| 7   | M6        | Crosstalk, noise, PDN              | Not started            |
| 8   | M8        | DDR5 / LPDDR5 / HBM                | Not started            |
| 9   | M9 + M10  | Wireless view; lab measurement     | Not started            |
| 10  | M11       | Sandbox                            | Not started            |
| 11  | Polish    | Accessibility, performance, docs   | Not started            |

Modules are built in the order above, not in numeric order: equalization (M7) comes
before crosstalk (M6) because the eye-closure machinery it needs is built in
Milestone 5.

---

## Milestone 1 — done

**1506 tests across 33 files, all passing.** `npm run verify` — format check,
lint, typecheck, tests — is clean end to end, `npx vite build` bundles, and
`npm run dev` serves the site.

| Layer          | Tests |
| -------------- | ----- |
| `src/content`  | 755   |
| `src/plots`    | 265   |
| `src/dsp`      | 253   |
| `src/state`    | 137   |
| `src/dsp/jobs` | 64    |
| `src/workers`  | 27    |
| `src/design`   | 5     |

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

`BRIEF.md` (the governing brief, verbatim, with the pasted copy's encoding damage
repaired — it is in `.prettierignore` so a reformat cannot make the copy differ from
the document it copies) · `README.md` · `PHYSICS.md` · `PROGRESS.md` · `LICENSE`.

---

### Tooling and CI

ESLint 9 flat config encodes the brief's hard rules as lint rules rather than as
prose someone has to remember: `fetch` and `XMLHttpRequest` are restricted globals
(the site is fully static), and `any` and non-null assertions are errors inside
`src/dsp/**` and `src/sim/**`. Prettier is the single formatter, with the generated
goldens and snapshots excluded so a reformat cannot invalidate a pinned file.
`.github/workflows/ci.yml` runs format check, lint, typecheck, tests and the Vite
build on every push. `.github/workflows/pages.yml` deploys `dist/` to GitHub Pages
from `main` after the same gate passes.

`npm run verify` runs the same four checks locally in the same order.

---

### Design layer — `src/design/`

`tokens.ts` is the source of truth for the palette, type scale, spacing and
geometry; every canvas stroke and the Tailwind config both read it. `tokens.css`
restates the same values as custom properties, because hand-written CSS cannot
import TypeScript. Two files holding one palette is exactly the arrangement that
rots, so `__tests__/tokens-css.test.ts` **generates** the expected properties from
the token objects and compares the set both ways: a changed value fails, a token
added to `tokens.ts` and not to the CSS fails, and a property left behind after its
token was deleted fails too — the case a one-directional check would miss. Colours
are compared case-insensitively, because Prettier lowercases CSS hex and that is not
drift.

`global.css` carries the base layer: dark ground, `tabular-nums` on every readout so
a changing number does not shiver, one `:focus-visible` ring for the whole site, a
`prefers-reduced-motion` block and the `.prose-column` measure.

### UI — `src/ui/`

The instrument panel is **declaration-driven**. `src/content/controls.ts` says which
affordance and over what range, `src/content/help.ts` says what it is called and what
it does, and the Scenario says what it currently is; `Control.tsx` only routes
between them. A control added to the schema therefore appears in the right panel,
with a working explanation and a help disclosure, without anyone writing JSX for it.

Native form elements throughout, not hand-rolled widgets: `<input type="range">`
brings arrow / PageUp / Home / End stepping, the correct ARIA role, platform touch
sizing and a focus ring for free. Sliders work in _step positions_ mapped through
`normalize` / `denormalize`, so one arrow key is one declared step even on a log
axis, and `aria-valuetext` carries the formatted value with its unit — without it a
screen reader announces "position 313 of 501".

Irrelevant controls are **hidden, not disabled**, and their values persist, so
switching a model back restores the reader's setup.

| File                                                        | Provides                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Plot.tsx`                                                  | The one canvas host: rAF paint, DPR sizing, busy/progress overlay, PNG + CSV export, text metric summary  |
| `InstrumentPanel.tsx`                                       | Panels, groups, advanced fold, and the aggressor selector for the one array-valued registry entry         |
| `Control.tsx`, `Slider.tsx`, `Choice.tsx`, `NumberList.tsx` | The affordances a declaration can ask for                                                                 |
| `HelpTip.tsx`                                               | A `<details>` disclosure, not a hover tooltip — hover does not exist on a phone                           |
| `Math.tsx`                                                  | KaTeX, with the source line pointing at PHYSICS.md                                                        |
| `Callout.tsx`                                               | The three fixed asides — caveat / in silicon / at the bench — plus the standing illustrative-value notice |
| `MetricList.tsx`                                            | Metric readouts with targets and a verdict given as a word as well as a colour                            |
| `SelfCheck.tsx`                                             | Multiple choice; the explanation is shown for every option once answered                                  |
| `TryThis.tsx`                                               | A named experiment that patches the Scenario and pushes history                                           |
| `ModuleShell.tsx`                                           | Reading column beside a sticky panel; permalink, reset, presets, bench tips, terms, prev/next             |

Plot text is derived once: `describePlot(spec)` produces the caption, the canvas
`aria-label` and the metric summary from the same declaration, so the words and the
picture cannot disagree.

### App — `src/app/`, `src/modules/`

`App.tsx` is the hash router as a switch, not a library: the route already lives in
`src/state/store.ts` because the scenario travels with it, and a router would be a
second source of truth for something that has one. `SiteHeader` carries the
through-line and an 1–11 stepper. `HomePage` shows each module's build status
honestly. `GlossaryPage` is deep-linkable per term, which matters because every
`see` reference in the control help points at it. `ErrorBoundary` turns a thrown
component into the error plus the link that reproduces it, rather than a blank page.

`modules/registry.ts` maps each module to the panels it offers — a claim about what
the module lets you change, not a claim that the simulation behind it exists yet.
`modules/Placeholder.tsx` stands in for every unwritten module and says so, naming
the milestone it is waiting on. `ModulePage`'s `BODIES` table is empty at Milestone
1 by design: the difference between a written module and an outline is one entry in
one table, visible in the diff.

### Entry — `index.html`, `src/main.tsx`

Latin subsets only from `@fontsource` (the full `400.css` pulls in cyrillic, greek
and vietnamese — four times the bytes for glyphs this course never renders).
StrictMode is on, so a plot that leaks a rAF handle or a worker that is not cancelled
on re-run fails in development rather than on a reader's laptop. `vite build`
emits relative asset paths, confirmed against `vite preview`.

`.github/workflows/pages.yml` builds and deploys on push to `main`, behind the same
`npm run verify` gate.

---

## Stubbed, and honestly so

- **Every module body.** `ModulePage`'s `BODIES` table is empty; all eleven modules
  render `Placeholder`, which names the milestone the module is waiting on. The
  panels beside them are live and the controls really write to the Scenario.
- **`src/sim/{channel,equalizer,eye,impairments,touchstone}` are empty.** No channel
  physics exists yet. None was invented to make the pages look finished.
- **No direct numeric entry on a slider.** A reader who wants exactly 187.5 ps has
  to arrive there by stepping. The permalink and the preset list cover the cases
  where an exact value matters today; a typed-entry affordance is a Polish-milestone
  item, not a Milestone 1 omission being hidden.

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

**A control's help lives beside its declaration, not in its component.** Which is
what lets `HelpTip` be one component rather than one per control, and what lets the
coverage test assert that no control ships without an explanation.

**Panel state is not Scenario state.** Which aggressor the panel is currently editing
changes what you are looking at, not what is simulated, so it stays in component
state and out of the permalink. The same rule sends self-check answers and reading
progress to localStorage and nowhere near the URL.

**`replace` vs `push` history is a reader-facing decision.** A slider drag replaces
the history entry, so the back button does not step through four hundred intermediate
values; navigation, presets and a `TryThis` setup push, so the back button undoes the
experiment. That is the behaviour a reader expects without being told.

**The token drift test reads the stylesheet from disk.** The obvious
`import '../tokens.css?raw'` comes back empty under Vitest, which runs with CSS
processing off — the test would then pass by comparing nothing with nothing, which is
the worst failure mode a guard can have. It uses `node:fs` behind a file-scoped
`/// <reference types="node" />`, so the app's type environment stays browser-only
everywhere else.

---

## Open questions — none

All three raised at the Milestone 1 gate are closed. The resolutions are kept rather
than deleted, because a decision with no record is one somebody re-opens by accident.

### 1. Gibbs overshoot figure — **closed: the exact value**

The brief states 8.93 %. The exact Wilbraham–Gibbs value is **8.9490 %** of the jump
discontinuity — (2/π)·Si(π) − 1, halved for the jump reference.

These are not two conventions; they are one constant, quoted long and quoted short.
The exact value stands in code and prose. `GIBBS_OVERSHOOT_OF_JUMP` and
`GIBBS_OVERSHOOT_OF_AMPLITUDE` are both exported and the test suite re-derives them
from the sine integral, so neither literal is trusted. M1's whole argument is where
the overshoot comes from; printing a rounded version of it there would undercut the
module.

### 2. Dual-Dirac convention — **closed: n(BER) = 2·Q⁻¹(BER)**

The argument is the specified BER, and each of the two crossings contributes a tail
of that probability. This is the form that reproduces the table a scope's TJ@BER
readout is quoted against (1e-12 → 14.069), which is what lets a number on this site
be compared with a number off an instrument.

The BER/2 variant is real and always slightly more pessimistic: +1.86 % at 1e-9,
+1.37 % at 1e-12, +1.01 % at 1e-16. That is well below the uncertainty in the
extrapolation itself — dual-Dirac projects 10⁻¹² from perhaps 10⁻⁸ of measured data,
and its accuracy turns on whether the bounded mechanism is genuinely bounded, not on
which argument the Q-inverse takes. Switching is one line in `dualDiracN`, and its
doc comment says which line and what it costs.

### 3. Clean brief — **closed**

`BRIEF.md` is now in the repository. The pasted copy's UTF-8 had been decoded as
Latin-1 (em dash as `â`), which is exactly invertible, so the file is the brief
byte for byte with the encoding undone rather than a retyping of it. Twenty-one
distinct non-ASCII characters survive, all of them intended: dashes, arrows, Greek
letters and the mathematical minus.

---

## Next

**Milestone 1 is at its gate.** The site builds, serves and deploys; the DSP,
plotting, state, content and UI layers are in place and tested; no module argument
has been written, and none has been faked.

Milestone 2 is M1 (harmonics) and M2 (ideal edge to real edge) — the first two module
bodies, the first plots wired to real jobs, and the first entries in `BODIES`.
Nothing blocks it: the gate's three questions are closed and the physics they
concerned is settled in code, in PHYSICS.md and here.
