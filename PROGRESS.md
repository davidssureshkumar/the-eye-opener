# PROGRESS.md

What is done, what is stubbed, what is known to be inaccurate, and what is waiting
on an answer.

Updated at the end of each milestone. Last updated: **2026-09-14**, at gate 4a of
Milestone 4.

---

## Milestone status

| #   | Milestone | Covers                             | State                   |
| --- | --------- | ---------------------------------- | ----------------------- |
| 1   | Core      | DSP, plots, state, content, shell  | Complete                |
| 2   | M1 + M2   | Harmonics; ideal edge to real edge | Complete                |
| 3   | M3        | Transmission lines and reflections | Complete                |
| 4   | M4        | Loss                               | **4a at gate; 4b next** |
| 5   | M5        | ISI, eye diagrams, jitter          | Not started             |
| 6   | M7        | Equalization                       | Not started             |
| 7   | M6        | Crosstalk, noise, PDN              | Not started             |
| 8   | M8        | DDR5 / LPDDR5 / HBM                | Not started             |
| 9   | M9 + M10  | Wireless view; lab measurement     | Not started             |
| 10  | M11       | Sandbox                            | Not started             |
| 11  | Polish    | Accessibility, performance, docs   | Not started             |

Modules are built in the order above, not in numeric order: equalization (M7) comes
before crosstalk (M6) because the eye-closure machinery it needs is built in
Milestone 5.

---

## Milestone 4a — at gate

**1782 tests across 44 files, all passing.** Milestone 4 is split into two gates, as
decided at the Milestone 3 gate. Gate 4a is the loss physics and what it does to an
edge; gate 4b adds measured channels. Gate 4a added 123 tests in four new files, the
second file in `src/sim/`, a new job, a small complex-arithmetic module and the fourth
entry in `BODIES`.

| Layer          | Tests | Change |
| -------------- | ----- | ------ |
| `src/content`  | 789   | +26    |
| `src/dsp`      | 289   | +14    |
| `src/plots`    | 265   | —      |
| `src/state`    | 138   | +1     |
| `src/modules`  | 95    | +29    |
| `src/dsp/jobs` | 91    | +13    |
| `src/sim`      | 83    | +40    |
| `src/workers`  | 27    | —      |
| `src/design`   | 5     | —      |

### M4 — Loss (gate 4a)

`src/modules/m4/M4.tsx`, with its figures in `src/modules/m4/plots.ts`. The module's
status is `in-progress` until 4b is written.

The argument: a lossy line does not just make the far end smaller. Loss rises with
frequency, so it removes the harmonics that made the edge sharp, and the pulse that
arrives is shorter and wider than the one launched. Its tail lands in the next bits.
The page builds that from the two mechanisms up:

- **Skin effect.** The skin depth, and a conductor model that runs from DC resistance
  into the skin regime.
- **Rough copper.** Hammerstad and Huray, why both need a reactance to be causal, and
  what goes wrong at the far end without one.
- **Dielectric loss.** A wideband Debye laminate fitted to one Dk and Df.
- **From RLGC to insertion loss.** The two mechanisms, the low-loss formulas beside
  the exact curve, and a table of four illustrative material classes evaluated live.
- **Return loss, vias and group delay.**
- **The edge at the far end.** Pulse and step response, cursors, the causal/real
  roughness comparison.
- **Before and after.** A launched and a received bit stream overlaid.

Displayed and implemented (PHYSICS.md §13): skin depth and surface resistance (4.1),
the internal impedance (4.2), Hammerstad (4.3), Huray (4.4), the causal rough
surface impedance (4.5), the wideband Debye permittivity (4.6), the line's
propagation constant (4.7), S21 from ABCD (4.8), the low-loss attenuation formulas
(4.9), group delay (4.10), the pulse spectrum (4.11) and the job that runs it (4.12).

Every number on the page is evaluated. The materials table calls
`conductorAttenuation` and `dielectricAttenuation` at the current Nyquist frequency.
The self-check answers come from `skinDepth`, the same attenuation functions and the
job's precursor measurement. Callouts:

- A silicon callout on where the loss sits on a memory route. DDR5 receivers
  equalize it with DFE at the DRAM, and the text cites JESD79-5 and JESD209-5 by
  number only. HBM's interposer RC regime is described, not simulated.
- A bench callout on measuring loss and removing it: S-parameter file import,
  de-embed filters and their bandwidth limit, TDR/TDT, averaging.

**Claims corrected before the gate.** Each experiment's expected result was checked
numerically against the job before it was written down, and four drafts were wrong:

- On the standard FR-4 class with a 100 µm trace, the dielectric does **not**
  dominate at Nyquist. The crossover is near 13 GHz, because conductor loss scales
  inversely with width. The experiment now changes the width and shows the crossover
  move.
- At 6.4 Gb/s, routes of 30 cm and longer close the eye with no noise at all, so the
  length experiment runs 5 to 30 cm, where the collapse can be watched.
- A self-check distractor claimed the dielectric term was larger at 2 GHz; it
  overtakes the conductor term by 4 GHz.
- The HBM paragraph asked the reader to set a trace width the controls cannot reach
  (25 µm minimum). That regime is now described, not offered as an experiment.

### New physics — `src/sim/channel/lossy.ts`

- **Conductor.** DC resistance, then the skin effect, in one causal, passive internal
  impedance.
- **Roughness, real and causal.** Hammerstad and Huray; Bracken's closed-form causal
  Huray; and a numerical Kramers-Kronig completion for Hammerstad, which has no
  closed form. The completion is checked by running it on Huray and comparing with
  Bracken.
- **Dielectric and line.** Djordjevic-Sarkar wideband Debye; RLGC, γ and Z0;
  scaled ABCD cascading with shunt-capacitance vias; S-parameters; group delay by an
  argument-ratio difference that cannot wrap.
- **Tests.** 40, against closed forms. Among them: a mismatched lossless section and
  a single via checked to 10⁻¹², Kramers-Kronig at DC for the laminate, the 2.31 dB
  per inch per GHz dielectric coefficient, and a 100 m route that would overflow a
  naive cosh.

### New job — `lossy`

`src/dsp/jobs/lossy-job.ts` sweeps the route and its breakdown (conductor only,
dielectric only, smooth, Hammerstad, Huray, the low-loss formula). It also sweeps return
loss, group delay and the roughness factors. It builds launched and received one-UI
pulses from their spectra on a record sized to outlast the far-end tail, and derives
steps, cursors and a 50 % delay. Before superposing the bit stream it warms the
stream up for a full record. It reports its own checks:

- `precursorLeak`: causality;
- `tailResidual`: the record wrap;
- `recordTruncated`: the sample ceiling.

The default route runs well inside the 2 s budget.

### New DSP — `src/dsp/complex.ts`

Complex arithmetic on plain `{re, im}` records, with a principal square root and
logarithm, tested against identities. No allocation beyond the result object.

### Scenario change — the conductor is now physical

`channel.lossy.dcResistance`, a free number, is gone. DC resistance now follows from
`traceWidth`, `thickness` and `conductivity`. Otherwise the skin effect and the DC
resistance could contradict each other. The change adds:

- `thickness`;
- `conductorLossEnabled` and `dielectricLossEnabled`;
- `roughnessModel` (`hammerstad` or `huray`);
- `hurayRadius` and `hurayRatio`, illustrative.

Each has a control and help. An old link carrying `dcResistance` still opens: the key
is dropped with one warning, pinned by a new test in `permalinks.test.ts`. The
permalink goldens are unchanged.

### Decisions taken at the Milestone 3 gate

- **Schema:** approved as proposed above.
- **Materials:** the presets are named by class ("Standard FR-4 class", "Low-loss
  class", "Ultra-low-loss class", "Package substrate class"), with illustrative values.
  Product names may appear in prose, never with a number.
- **Touchstone:** imported files stay in memory only (gate 4b).
- **Gating:** two gates. 4a is loss physics, S21, IL and dB/in, group delay, pulse and
  step, before/after stream. 4b is Touchstone import, mixed-mode, ILD/ICN,
  passivity and causality checks on measured data, fibre weave and skew, and the
  silicon loss-budget callout.

---

## Milestone 3 — done

**1659 tests across 40 files, all passing.** `npm run verify` is clean end to end.
Milestone 3 added 87 tests in five new files, the first file in `src/sim/`, a new
job, and the third entry in `BODIES`.

| Layer          | Tests | Change |
| -------------- | ----- | ------ |
| `src/content`  | 763   | +8     |
| `src/dsp`      | 275   | —      |
| `src/plots`    | 265   | —      |
| `src/state`    | 137   | —      |
| `src/dsp/jobs` | 78    | +14    |
| `src/modules`  | 66    | +22    |
| `src/sim`      | 43    | +43    |
| `src/workers`  | 27    | —      |
| `src/design`   | 5     | —      |

### M3 — Transmission lines and reflections

`src/modules/m3/M3.tsx`, with its three figures in `src/modules/m3/plots.ts`.

The argument: once the delay across a route is comparable with the edge, the driver
launches a wave into Z0 without knowing what is at the far end, and every mismatch
sends part of it back. The **lattice** figure draws that from the closed form, with
each wave's amplitude and each end's level labelled. The **waveform** figure shows
the driver pin and the receiver pad from the simulator, with the lattice's staircase
over them, so the reader can see the two agree on every plateau and differ only on
the edges. The **TDR** figure shows what a 50 Ω instrument displays looking into the
same line, with the true impedance profile beneath it, on a time or distance axis.

Displayed and implemented (PHYSICS.md §12): delay and effective permittivity (3.1),
critical length (3.2), Z0 and v from L′ and C′ (3.3), the launch divider (3.4), Γ and
the node voltage (3.5), the lattice sum and its resistive-divider limit (3.6), the
reflection from a parallel RC load (3.7), the TDR conversion (3.8), TDR distance
(3.9) and the apparent second reflection (3.10).

Both tables are evaluated live: the critical-length table through `criticalLength` at
k = 1/2, 1/4, 1/6, 1/10 using the driver's rise time converted to 10-90 % for its
edge shape; the termination table through `bounceDiagram` for unterminated, series,
parallel and both-ends schemes at the current line and driver. The self-check answers
are computed from `tdrDistance`, `reflectionCoefficient` and
`apparentSecondReflection`, so the quiz cannot disagree with the figures.

Callouts: a silicon callout on programmable driver impedance and on-die termination
(POD to the I/O supply for DDR4/DDR5, LVSTL to ground for LPDDR4/LPDDR5; no values,
JESD79-5 and JESD209-5 cited by number only), one on first-incident switching, and a
bench callout on TDR reference planes, the step rise-time filter, ρ versus ohms
units, and probe ground-lead ringing masquerading as a reflection.

### New physics — `src/sim/channel/tline.ts`

The lossless line in two forms that are tested against each other. `bounceDiagram` is
the analytic lattice and the oracle. `simulateLine` is a wave-variable time-stepper
with integer-sample delay: exact for resistive ends, and exact at a parallel R ∥ C
far-end node under a zero-order hold. Plus the TDR conversion, distance, the apparent
second reflection, the RC-load reflection closed form, critical length and the
per-unit-length relations. 43 tests against closed forms, including the 73.3775 Ω
worked example.

### New job — `tline`

`src/dsp/jobs/tline-job.ts` shapes the driver edge with `applyResponse`, picks a grid
on which the delay is a whole number of samples, simulates the step, adds the DC
level back by superposition, runs a matched 50 Ω TDR with the same edge, and measures
launch, overshoot, ringback, 2 % settling and the TDR line and load readings.

### New UI — `ChannelKindNotice`

The channel panel shows only the selected model's controls, and the default model is
`lossy`. A module about the transmission line therefore opened with its controls
hidden. `src/modules/ChannelKindNotice.tsx` says so when the selected model differs
and offers one button to switch, which pushes a history entry. M3 uses it for the
line; M2 now uses it for the lumped RLC above its damping section.

### Fixed

Unwritten modules' placeholder pages named PROGRESS.md and PHYSICS.md as plain text,
which a reader of the site cannot open. They now link to the files on GitHub
(`src/content/repo.ts`), opening in a new tab; a test fails if either file is renamed
or removed. These are ordinary links, not requests the site makes.

Equation source notes in the same way named "PHYSICS.md §12.3" without a link. Each
section citation now links to that section's heading on GitHub. The anchors are
restated in `src/content/physics-sections.ts`, and a test regenerates them from the
file's headings and fails on any difference, or on any module citing a section that
does not exist.

The help text for **Far-end C** said a capacitive far end reflects like an open at low
frequency. It reflects like the load resistance alone; for a matched resistor that is
no reflection at all. Corrected in `src/content/help.ts`.

---

## Milestone 2 — done

**1572 tests across 35 files, all passing.** `npm run verify` is clean end to end.
Milestone 2 added 66 tests in two new files and the first two entries in `BODIES`.

| Layer          | Tests | Change |
| -------------- | ----- | ------ |
| `src/content`  | 755   | —      |
| `src/dsp`      | 275   | +22    |
| `src/plots`    | 265   | —      |
| `src/state`    | 137   | —      |
| `src/dsp/jobs` | 64    | —      |
| `src/modules`  | 44    | +44    |
| `src/workers`  | 27    | —      |
| `src/design`   | 5     | —      |

### M1 — Building a square wave from nothing

`src/modules/m1/M1.tsx`, with its two figures in `src/modules/m1/plots.ts`.

The argument: a transmitter cannot send a square wave, because a square wave is an
infinite sum; what left the pin was the first few terms of it, and every impairment
later in the course is a statement about which terms survived. The synthesis figure
shows the partial sum converging in the mean and never at the edge. The spectrum
figure shows where the terms actually land in frequency, which is what makes "loss at
Nyquist" a sentence about the picture rather than a number off a datasheet.

Displayed and implemented: the square-wave series (§2.1), the Wilbraham–Gibbs limit
as (2/π)·Si(π) (§2.2), the pulse coefficients as a sampled sinc (§2.5), the duty
relation |a₂/a₁| = |cos πd| and its inverse (§2.5), and the knee frequency (§3.1).
The duty-error table is evaluated through `secondHarmonicRatio` rather than quoted,
so it cannot disagree with the metric beside the plot: a 1 % duty error puts the
second harmonic at −30.06 dBc.

### M2 — From ideal edge to real edge

`src/modules/m2/M2.tsx`, with its two figures in `src/modules/m2/plots.ts`.

The argument: band-limiting is a filter, not a defect. A step through one pole gives
t_r(10–90 %) = ln9/(2π·BW) = 0.3497/BW, which is where the remembered 0.35 comes
from, and it is exact for a single pole at 10–90 % and for nothing else. The edge
figure draws all four threshold levels on one curve, so the two rise-time conventions
are visibly two readings of the same edge. The damping figure shows a series RLC at
three dampings against a first-order reference, which is where overshoot and ringing
come from when nothing has been truncated.

Both tables in the body are computed live — `riseTimeBandwidthProduct` across five
shapes at both conventions, and `cascadedPoleRiseTime` against the quadrature rule —
so no number in the prose is a remembered one.

### New DSP — `cascadedPoleRiseTime`

M2 claims that rise times added in quadrature are optimistic for anything but a
Gaussian. Rather than quoting a remembered percentage, `src/dsp/filters.ts` now
solves the rise time of n identical cascaded poles from the Erlang step response by
bisection. It reduces to the closed form of §3.2 at n = 1, asserted at three level
pairs, and it produces the counterexample the module prints: two identical poles give
0.5344277/BW against a quadrature estimate of 0.4945493/BW, which is 7.46 % low.
PHYSICS.md §3.7 carries the derivation and the 30-digit values.

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

- **Seven of the eleven module bodies.** `BODIES` holds `m1` to `m4`; M5 through M11
  render `Placeholder`, which names the milestone each is waiting on. The panels
  beside them are live and the controls really write to the Scenario.
- **M4 is half written.** Gate 4b's sections do not exist yet: Touchstone import,
  differential pairs and mixed-mode, ILD/ICN, and fibre weave. The page's closing
  paragraph says they are coming rather than implying the page is complete.
- **`src/sim/{equalizer,eye,impairments,touchstone}` are empty.** `src/sim/channel`
  holds the lossless and lossy lines and nothing else. No physics was invented to make
  the pages look finished.
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

Gate 4a does not use it. The lossy line's S21 carries its own exact phase from the
ABCD cascade, so no phase is reconstructed from magnitude. The obligation moves to
gate 4b, where a measured file with suspect or missing phase is the case that needs it.

### 5. Lumped RLC validity

The RLC model is lumped, so it is valid only while the propagation delay across the
structure is small compared with the rise time. Outside that range it understates
what happens, and Module 3's transmission-line treatment is the correct model.

### 6. Job parameters are not in the permalink

M1's harmonic count and waveform choice, and M2's record length and scope toggle, are
module-local state. A permalink therefore restores the link — source, channel, scope,
pattern — but not which figure settings the reader had. Sharing "look at this at 99
harmonics" needs a sentence alongside the link. This follows directly from the
decision recorded below, and is the price of it; a `TryThis` that needed to set one
of these would have to promote it to the Scenario first.

### 7. The `linear` edge shape is modelled as a Bessel

A straight ramp has no transfer function, so `edgeResponseOf` maps the Scenario's
`linear` edge shape to a fourth-order Bessel — the maximally-flat-delay shape closest
to a ramp with no overshoot. M2 says so on screen when that shape is selected, rather
than silently renaming it in the legend.

### 8. Lossless lines only

Every line in M3 is lossless: no skin effect, no dielectric loss, frequency-independent
Z0. Real routes at these edge rates lose amplitude and edge rate as they go, so M3's
ringing persists longer and its edges arrive sharper than on a board. That is the
subject of M4 and is said on screen.

### 9. A capacitive far end is first-order in the time step

With `loadC` above zero the far-end node voltage is exact under a zero-order hold,
but the wave sent back up the line is sampled at the start of each interval, so what
returns to the driver is first-order accurate in Δt. At the hundreds of samples per
delay M3 uses it is below plot resolution. With `loadC` zero the simulator is exact.

### 10. The TDR reads exactly only to the first discontinuity

The modelled TDR converts every sample against 50 Ω as though it came from a single
interface, as real instruments do. Readings behind the first discontinuity are
apparent values (PHYSICS.md §12.6); M3 teaches this rather than correcting for it,
and the load metric's target is the true load so the discrepancy is visible.

### 11. The Scenario's "open" end is 1 MΩ

Γ = 0.9999 on 50 Ω, not 1. Invisible on screen; tests assert open-end plateaus to
three digits for that reason.

### 12. The transmission-line controls need `channel.kind = tline`

The channel panel shows one model's controls at a time. M3's figures read the
`tline` fields whatever is selected, so they are correct, but the controls the prose
refers to are hidden until the model is selected. `ChannelKindNotice` says so and
offers the switch. Job parameters (record length, lattice rows, the TDR axis, the
overlays) are module-local and not in the permalink, as in item 6. M4 has the same
arrangement for the `lossy` model, and the Scenario's default model is `lossy`.

### 13. The lossy line's geometry is a rule of thumb

Conductor loss uses one conductor surface of the trace width, with the return path
lossless. That is not a field solution: a real stripline carries current on both
faces and its edges, and loses in its planes too. Trace width and thickness are
inputs to that simple model, not a stack-up, and conductor dB per inch read from M4
is a rule-of-thumb value for a trace of that width. PHYSICS.md §13.1.

### 14. The dielectric is homogeneous

One permittivity fills the cross-section, so the line is exactly TEM. A microstrip, or
a stripline with resin-rich layers, would have an effective permittivity. Dk and Df
are matched exactly at the reference frequency; elsewhere the wideband Debye shape is
a consistent extrapolation, not a laminate measurement. PHYSICS.md §13.3.

### 15. The lossy route sits between 50 Ω ports

S-parameters, pulses and the bit stream are computed between ideal 50 Ω reference
ports. The Scenario's driver impedance and far-end termination are not applied to the
lossy route, so M4 shows loss and not mismatch on top of it, except for the line's own
Z0 and the vias. This was decided at gate 4a and holds for gate 4b as well. The ports
stand in for a 50 Ω source and receiver. `source.amplitude` is the open-circuit swing
(question 4, closed), so the launched wave is half of it, ±A/4 per bit
(`launchedLevel`).

### 16. Roughness is added to the surface impedance

The roughness term is (K_c − 1)(1 + j)R_s/w added to the finite-thickness internal
impedance, rather than a factor on it. The two agree far above the skin onset; below
it, the added form keeps DC resistance exact. The Huray model assumes one nodule size
on a flat base. PHYSICS.md §13.2.

### 17. The pulse record is periodic

The one-UI pulse comes from an inverse FFT, so its tail wraps onto its start. The
record is sized to outlast the tail, and the job reports `tailResidual` and
`recordTruncated`; M4 prints a note when either says the record was too short. The
smooth-copper pulse's small pre-arrival residue is this wrap, which is why the
causality test compares rough copper with smooth rather than with zero.

### 18. Breakdown curves force their mechanism on

The conductor-only, dielectric-only, smooth, Hammerstad and Huray curves each run the
route with the mechanism they show switched on, whatever the channel panel says.
Otherwise a curve would vanish when its mechanism is off. The figure says so when that
happens.

### 19. The low-loss formulas are approximate

The conductor attenuation R′/(2Z0) overstates the exact value by about R′/(2ωL′),
roughly 1.5 % for a 100 µm trace at 2 GHz. Adding the two mechanisms in dB is within
2 % of the exact loss at Nyquist on the default route. M4 draws the formula over the
exact curve so the reader can see where it departs. PHYSICS.md §13.5.

### 20. HBM's interposer regime is described, not simulated

The controls stop at board dimensions (trace width 25 µm). A fine-line interposer or
redistribution layer, where resistance competes with ωL′ across the band, is described
in M4's silicon callout but cannot be dialled up.

### 21. The material classes are illustrative

M4's four classes (Dk, Df, copper roughness) are round illustrative values chosen to
span the range, labelled as such on the page. They come from no datasheet and should
not be read as any product's numbers.

### 22. M4's figure settings are not in the permalink

Normalisation, the approximation overlay, the roughness and dielectric views, the
pulse view, the number of UIs shown and the causal/real comparison are job or view
parameters, as in item 6.

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

**A job parameter is not a Scenario field.** A Scenario field describes the _link_:
it is Zod-validated, it travels in the permalink, and it owes a control declaration,
a help entry and a coverage test. A job parameter describes the _experiment a module
runs on that link_ — M1's harmonic count, M2's record length, whether the scope is in
the path — and lives in component state beside the figure it drives. Mixing the two
would put "how many harmonics am I currently drawing" into the description of a
transmitter. The cost is recorded under known limitations above.

**A figure's declaration is a claim, so it is tested away from the component.** Both
module figure pairs live in a plain `.ts` file beside the `.tsx` body, because vitest
collects `src/**/*.test.ts` in a node environment and a `.tsx` test would never be
run at all. The specs under test are built from a real `runJob` result rather than a
fixture: a fixture lets the figure and the job drift apart in exactly the way the
test exists to prevent.

**M2's second figure does not go through a worker.** A second-order step response is
a closed form three exponentials wide, and a round trip through `postMessage` would
cost more than evaluating it. It is computed inline through the same
`rlcStepResponse` the test suite checks, so "cheap enough to do inline" does not
become "done differently". The file header says so, so the asymmetry is not read as
an oversight.

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

**M3 simulates the line by scattering, not by FFT.** A lossless line with an open or
shorted end never stops ringing, so any finite FFT window wraps the tail onto the
start. The wave-variable form truncates cleanly and is exact for resistive ends, and
the analytic lattice is kept alongside it as the test oracle.

**The TDR is a 50 Ω instrument, not the driver.** Running the TDR with the driver's
own impedance would make every displayed impedance wrong by construction. 50 Ω is an
instrument convention, so it is a constant (`TDR_REFERENCE_OHMS`), not a Scenario
field.

**DC offset by superposition.** The simulator starts from an uncharged line; the job
simulates the step and adds the pre-step divider level. Exact for a linear model, and
it avoids launching a step at t = 0 from a line that was never at zero.

**Roughness is causal by default, and the non-causal form is kept to be shown.** The
real Hammerstad and Huray factors are what most tools apply, and they make a far-end
pulse arrive before light could. M4's line uses the complex, causal factor, with the loss
identical to the real one. The real factor is still available as a job parameter,
so the page can put the two precursors side by side instead of asserting the point.

**M4 builds its pulse by FFT, unlike M3.** M3 avoided the FFT because a lossless open
line rings forever. A lossy line's response dies away, and loss is defined in the
frequency domain. The record is sized from the slowest possible arrival plus a tail,
and the wrap is measured and reported rather than assumed away.

---

## Open questions — none

### Closed

All questions raised at gates so far are closed. The resolutions are kept rather than
deleted, because a decision with no record is one somebody re-opens by accident.

### 4. What does `source.amplitude` mean? — **closed at gate 4a: the open-circuit swing**

Asked at the Milestone 3 gate. The choice was delegated ("choose the best"), and the
Scenario keeps the **open-circuit** swing of an ideal source behind its impedance.
Reasons:

- It is the only reading defined before a load is known. A swing quoted into a load
  changes meaning every time the load does, and this course changes loads constantly.
- It is what the line equations need. M3's launch divider (equation 3.4) takes it
  directly.
- It matches how a push-pull memory driver is built: a rail swing behind a
  programmable output impedance. The voltage at a pin is then a consequence of that
  impedance and what the pin drives, which is the point M3 makes.

M4 was not consistent with it: its job launched ±A/2 into a 50 Ω port, which is the
incident wave of a source with twice the swing. It now launches ±A/4 through one exported
function, `launchedLevel`, which the job and the stream figure share. Equation 4.12 and
PHYSICS.md §13.6 say A/4, and M4's prose says why. Metrics normalised to the launched
level (cursors, the worst centre level) are unchanged; volts on the stream figure halve.
The help text for **Swing** now says open-circuit.

Also decided at gate 4a: the lossy route stays between 50 Ω ports in gate 4b (item 15).

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

**Milestone 4 is at gate 4a.** M4's loss sections are written, wired to the `lossy` job
and reachable from the site. Every formula they display is implemented in
`src/sim/channel/lossy.ts` or `src/dsp/jobs/lossy-job.ts`, and derived in PHYSICS.md
§13. Every number in the prose, the materials table and the self-checks is evaluated
rather than quoted.

Gate 4b completes M4 with measured channels:

- Touchstone import, kept in memory only;
- differential pairs and mixed-mode S-parameters;
- ILD and ICN;
- passivity and causality checks on a measured file, and the minimum-phase
  construction that item 4 says must be stated on screen;
- fibre weave and intra-pair skew;
- the silicon loss-budget callout.

No questions are open. Gate 4a's review changed nothing on the page except the amplitude
convention above.
