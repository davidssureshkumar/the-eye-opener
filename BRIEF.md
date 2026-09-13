# Claude Code Project Brief — "Anatomy of an Edge"
### An interactive, browser-based course on signal integrity: from Fourier harmonics to DDR5/LPDDR5/HBM receiver reconstruction

> Paste this whole file into Claude Code as the opening prompt, or save it as `BRIEF.md` in an empty repo and start with:
> *"Read BRIEF.md. Confirm your understanding, propose the design plan and file structure, and wait for my approval before writing code."*

---

## 0. Role and working agreement

You are the lead engineer and designer on this project. I am a post-silicon memory validation engineer — assume I know DDR/LPDDR/HBM validation, eye margining, and lab equipment, and that I want the physics to be *correct*, not hand-waved. Do not dumb down the math. Do not invent JEDEC numbers; where a value is illustrative rather than spec-exact, label it as illustrative in the UI.

Working rules:
- Work in milestones (Section 9). Finish, verify, and commit one milestone before starting the next. Do not scaffold all 11 modules at once.
- Maintain `PROGRESS.md` at the repo root: what's done, what's stubbed, known inaccuracies, open questions for me.
- Maintain `PHYSICS.md`: every formula implemented, its source/derivation, its assumptions, and its valid range. This is the document I will review for technical correctness.
- Before any refactor touching more than 3 files, describe it and wait for my go-ahead.
- Write unit tests for every DSP function against closed-form or known-good values. A wrong FFT silently produces a beautiful, useless eye diagram.
- Ask me questions when a spec detail is ambiguous instead of guessing.

---

## 1. What we are building

A static, self-hosted, single-page web application that teaches — visually and interactively — how a clean digital edge is destroyed by a real channel, and how a real receiver reconstructs it.

The through-line of the whole site is one question, asked at increasing levels of sophistication:

> **"A transmitter sent a square wave. The receiver measured *this*. How do we get back to ones and zeros?"**

Every module is a different part of the answer: bandwidth, reflections, loss, ISI, crosstalk, jitter, equalization, clock recovery, training. The site ends with a sandbox where the learner drives a full TX → channel → RX chain and watches the eye open and close.

**Audience:** practising hardware/validation/SI engineers and strong students. Someone who already knows what a scope is, but has never seen ISI and DFE taps interact in real time.

**Non-goals:** no login, no backend, no database, no analytics, no AI-generated prose filler. Every pixel is either a control, a plot, or a precise explanation.

---

## 2. Technical constraints

- **Stack:** Vite + React 18 + TypeScript + Tailwind CSS. Strict TS (`strict: true`, no `any` in DSP code).
- **Fully static.** Must deploy unchanged to GitHub Pages, Netlify, Vercel, or any S3 bucket. Use hash-based routing so GitHub Pages deep links work. Set `base` in `vite.config.ts` so it works from a subpath.
- **No server, no API keys, no network calls at runtime.** Everything computes in the browser.
- **Rendering:** Canvas 2D for waveforms, eye diagrams, shmoo heatmaps and constellations — never SVG or Recharts for high-density plots. Eye diagrams accumulate 10k–100k traces; SVG will die. Use device-pixel-ratio-aware canvas sizing so plots are sharp on HiDPI.
- **Heavy DSP in Web Workers** with transferable `Float64Array` buffers, so sliders never block the UI. Debounce/throttle to animation frames; cancel in-flight worker jobs when a slider moves again.
- **Implement the DSP yourself** in `src/dsp/` — radix-2 and mixed-radix FFT, IFFT, linear and circular convolution, resampling/interpolation, Hilbert transform, PRBS generators, Gaussian RNG (Box–Muller with a seeded PRNG so results are reproducible). No `mathjs` for hot paths.
- **Math typesetting:** KaTeX, rendered statically at build where possible.
- **State:** URL-encoded scenario state (`#/module/eye?br=6400&len=8&ctle=6&dfe=2`) so any configuration is a shareable permalink. This matters — I want to send a link to a colleague showing a specific failure mode. `localStorage` only for reading progress and theme.
- **Performance budget:** interactive controls respond within 100 ms; a full 100k-bit eye build completes within 2 s with a visible progress indicator.
- **Accessibility floor:** keyboard-operable controls, visible focus rings, `prefers-reduced-motion` respected, plots have text-readable summaries of key metrics (eye height, eye width, BER) next to them so the numbers aren't locked inside a canvas.
- **Mobile:** the site must be readable on a phone. Plots can stack and simplify; controls collapse into a sheet. Don't pretend a 2D shmoo is usable at 380 px — provide a reduced view and say so.

---

## 3. Module specifications

Build these as independent, deep-linkable modules sharing a common simulation core. Each module needs: a short precise intro, live interactive canvas(es), a control panel, a live-updating metrics readout, a "what you should notice" callout, and a "what this means in silicon" callout tying it to a real interface.

### M1 — Building a square wave from nothing
- Fourier series of an ideal square wave: odd harmonics only, amplitude `4A/(nπ)`.
- Slider: number of harmonics 1 → 199. Show the time-domain sum building up, each harmonic as a faint separate trace, and the spectrum as a stem plot.
- Demonstrate **Gibbs phenomenon**: the ~8.9% overshoot that never goes away as N increases. Print the measured overshoot so the learner sees it converge to 8.9%, not 0.
- Then flip the framing: a band-limited channel is a low-pass filter, so *removing* harmonics is what a real channel does to you. Add a brick-wall/Butterworth low-pass slider on a real square wave and show the identical result arriving from the other direction.
- Key relationships to derive and display live: knee frequency `F_knee = 0.5 / T_r`; scope/channel bandwidth `BW ≈ 0.35 / T_r(10–90%)`; for a clock-like 1010 pattern at bit rate `f_b`, fundamental = `f_b / 2`.
- **Silicon callout:** why a 6400 MT/s DDR5 DQ line needs channel bandwidth well past 3.2 GHz, and what happens to the edge when it doesn't have it.

### M2 — From ideal edge to real edge
- Step response of RC and RLC (series-R, L, C) networks. Sliders for R, L, C.
- Show damping factor `ζ`, overshoot `exp(-πζ/√(1-ζ²))`, ringing frequency, settling time; mark underdamped / critically damped / overdamped regions on a live phase plot.
- Overlay measurement conventions: 10–90% and 20–80% rise time, slew rate in V/ns, monotonicity violation detection on the rising edge (flag non-monotonic edges explicitly — that's a real DDR training failure mode).
- **Silicon callout:** package/via inductance plus receiver capacitance forms exactly this network; non-monotonic edges break DQS-based sampling.

### M3 — Transmission lines and reflections
- Model: driver output impedance `R_d` → trace of impedance `Z₀`, length `L`, propagation delay `T_pd` → load `Z_L` (with `R_odt`, `C_load`).
- Interactive **lattice/bounce diagram** synchronized with a live waveform at TX and RX. Dragging a time cursor on the waveform highlights which reflection bounce is responsible for that step. This synchronization is the point of the module — build it properly.
- Reflection coefficient `ρ = (Z_L − Z₀)/(Z_L + Z₀)` shown at both ends, with sign and magnitude.
- Discontinuity library the learner can insert into the line: via with stub, connector, package transition, a length of wrong-impedance trace, an unterminated branch. Each shows its TDR signature.
- Termination comparison mode: none / series (source) / parallel / Thevenin / on-die termination with selectable `RTT` values. Show waveform, power, and edge quality side by side.
- Include a **TDR view** — launch a fast edge, plot the reflected impedance profile vs distance, and let the learner read discontinuities off it the way they would on a real TDR.

### M4 — Loss: where the harmonics actually go
- Frequency-domain channel model with separable, individually toggleable loss mechanisms:
  - **Conductor / skin-effect loss** ∝ √f, with skin depth `δ = √(ρ/(π f μ))`.
  - **Dielectric loss** ∝ f · tan δ.
  - **Surface roughness** via Hammerstad and Huray (snowball) models — let the learner compare them.
- Material presets with realistic `Dk`/`Df`: standard FR-4, Megtron 6, Tachyon 100G, and a low-loss package substrate. Sliders for trace geometry, length, copper roughness.
- Outputs: insertion loss dB/inch vs frequency, total `S21` for the chosen length, group delay, and the resulting **pulse response** and **step response** obtained by IFFT. Show the same bit stream before and after the channel.
- Add S-parameter literacy: what `S11`, `S21`, `SDD21`, `SCD21` mean; insertion loss deviation (ILD); integrated crosstalk noise (ICN); causality and passivity as sanity checks. Allow **Touchstone `.s4p` / `.s2p` file upload**, parsed entirely client-side, so a real measured channel can be dropped in and driven through the rest of the simulator. This is the single highest-value feature in the site — design the data model around it from day one.
- Cover **fiber-weave effect** and intra-pair skew, with a visual of how glass bundles create P/N delay mismatch.
- **Silicon callout:** loss budget comparison — a DIMM channel vs an LPDDR5 package-on-package route vs an HBM interposer link.

### M5 — ISI, eye diagrams, and jitter
- Pulse response decomposition into **pre-cursor, main cursor, and post-cursor ISI taps**. Show the single-bit response with cursor sampling points marked, and a bar chart of tap magnitudes.
- Live eye diagram builder: PRBS7/9/15/23/31 and user-editable custom patterns. Animate the first ~50 traces overlaying to build intuition, then fast-accumulate the rest as a density (heat) eye.
- Metrics computed and displayed live: eye height, eye width at a chosen BER, mask margin against a user-defined mask polygon, vertical and horizontal opening at the sampling point.
- **Jitter decomposition:** total jitter as `TJ(BER) = DJ + n(BER)·RJ_rms`. Separate and individually control RJ (Gaussian σ), DCD, DDJ (pattern-dependent, derived from the channel — not a knob), PJ (sinusoidal, with frequency), and BUJ. Show the histogram, the **dual-Dirac** fit, and the **bathtub curve** with the BER extrapolation. Make it obvious how a 1e-12 number is extrapolated from far fewer measured bits, and where that extrapolation lies.
- Let the learner sweep the sampling phase and threshold to see the eye contour emerge — this is the conceptual bridge to M8's shmoo.

### M6 — Crosstalk, noise, and the power delivery network
- Multi-line coupling: one victim, configurable aggressors. Near-end (NEXT) and far-end (FEXT) crosstalk from mutual `L_m`/`C_m`, with correct polarity behaviour for microstrip vs stripline (explain why FEXT vanishes in a homogeneous stripline medium).
- Aggressor pattern control, including the worst-case alignment search — let the learner press a button that finds the aggressor timing that maximally closes the victim eye.
- **SSO/SSN and ground bounce:** N simultaneously switching outputs through a shared return inductance.
- **PDN:** impedance vs frequency for a VRM + bulk + decoupling caps + package + die capacitance ladder. Show target impedance `Z_target = V·ripple% / I_transient`, anti-resonance peaks, and the resulting voltage droop for a given current step. Connect droop directly back to a shrinking eye in M5.
- **Silicon callout:** why DQ crosstalk shows up as pattern-dependent Vref shift, and how `RTT_PARK`/`RTT_NOM`/`RTT_WR` choices trade reflection against amplitude.

### M7 — Equalization: rebuilding the square wave
This is the payoff module. One page, one signal, four stages, each toggleable, with the eye redrawn after every stage.

1. **TX FFE / de-emphasis** — configurable pre-cursor and post-cursor taps with a normalized-power constraint; show the cursor coefficient, the de-emphasis ratio in dB, and the cost in main-cursor amplitude.
2. **CTLE** — pole/zero peaking filter with adjustable DC gain, AC gain, peaking frequency. Show the transfer function alongside the channel `S21` and the equalized composite response. Make the "cancel the channel's slope" idea visible.
3. **DFE** — 1 to 8 taps, with adaptation (LMS) optionally enabled and animated as taps converge. Demonstrate **error propagation** by deliberately injecting a wrong decision. Explain why DFE cannot cancel pre-cursor ISI, and why that's what FFE and CTLE are for.
4. **Slicer and Vref** — adjustable decision threshold and sampling phase, live BER counter.

Then **CDR**: bang-bang (Alexander) phase detector, loop filter, and a jitter tolerance curve vs jitter frequency. Show the recovered clock's phase wandering relative to the data, and what happens when jitter frequency exceeds loop bandwidth.

Finish the module with the money shot: the original TX square wave, the received mess, and the reconstructed digital output on one time axis, aligned.

### M8 — Memory interfaces: DDR5, LPDDR5/5X, HBM
Deepest and most detailed module. Build it as a comparative architecture explorer, not prose.

- **Topology diagrams** for each: DDR5 DIMM channel (sub-channels, RCD, stub-free daisy chain), LPDDR5 package-on-package short point-to-point route, HBM 1024-bit wide bus over a silicon interposer with microbumps and TSVs.
- **Signalling:** DDR5 PODL, `VDDQ` = 1.1 V, single-ended DQ referenced to internal `VrefDQ`, differential DQS. LPDDR5/5X's low-swing `VDDQ` ≈ 0.5 V, the WCK/RDQS architecture, WCK-to-CK synchronization, and 2:1 vs 4:1 WCK:CK ratios. HBM's very short, very wide, low-per-pin-rate approach.
- **Source-synchronous timing explorer:** a live diagram of DQ vs DQS/WCK with adjustable skew, showing `tDQSQ`, setup/hold windows, and how centering the strobe in the data eye is the entire game.
- **Training sequence walkthrough** — interactive, step-by-step, with the eye and margins updating at each step: CA training, write leveling, read DQS centering, write DQ centering, Vref training, DFE tap training, duty cycle adjustment. At each step show what is being swept, what the pass/fail criterion is, and what a failure looks like.
- **2D shmoo / margin explorer:** Vref (y) vs sampling phase (x) heatmap with pass/fail/marginal regions, per-DQ-lane selection, and the ability to see how channel loss, crosstalk, and DFE settings deform the shmoo. Let the learner inject a fault — one lane with extra loss, one with a crosstalk aggressor, a Vref offset — and read it off the shmoo, the way an RMT-style margin sweep is read in the lab.
- **Comparison matrix** across DDR5 / LPDDR5X / HBM2e / HBM3: per-pin data rate, bus width, aggregate bandwidth, channel length, insertion loss budget, termination strategy, equalization required, energy per bit, and why each design point lands where it does. Cite JEDEC documents by number (JESD79-5, JESD209-5, JESD235) without reproducing spec text.
- **Silicon callout:** why HBM needs almost no equalization while DDR5 at 6400+ MT/s needs DFE, and what that says about the loss-vs-width trade.

### M9 — The wireless view of the same problem
Show that the wireless world solved identical ISI problems with different vocabulary.
- **Pulse shaping:** raised-cosine and root-raised-cosine filters, roll-off β from 0 to 1, and the **Nyquist ISI criterion**. Demonstrate that zero-ISI does not require a square pulse — a deliberate reframing of M1.
- **Multipath:** tapped-delay-line channel with adjustable delays and gains; show delay spread, coherence bandwidth, and the resulting frequency-selective fading notches. Connect directly to M4's insertion loss dips.
- **Equalizers:** zero-forcing vs MMSE, and why ZF amplifies noise at the notches. Then OFDM with a cyclic prefix as the structural alternative to equalization.
- **Constellations and EVM** as the wireless analogue of the eye diagram. Put an eye diagram and a constellation side by side driven by the same impairments.
- **Terminology bridge table:** eye height ↔ EVM, BER ↔ BER, jitter ↔ phase noise, insertion loss ↔ path loss, crosstalk ↔ co-channel interference, DFE ↔ MMSE-DFE, CDR ↔ carrier and timing recovery.

### M10 — Measuring it in the lab
- Scope bandwidth selection: why you need 3–5× the knee frequency; show the same edge captured at insufficient, marginal, and adequate bandwidth.
- Probe loading: capacitive loading of the probe tip changing the signal you are trying to measure.
- TDR/TDT vs VNA: same channel, two instruments, two views, and how to convert between them.
- De-embedding: fixture removal, and what happens when you skip it.
- Scope-based equalization emulation — applying CTLE/DFE in post-processing to open a closed eye, and the honest caveats.
- BERT and bathtub measurement; why error counting to 1e-12 takes the time it takes.

### M11 — Sandbox
Everything unlocked on one page. Protocol presets (DDR5-4800 / 5600 / 6400 / 8000, LPDDR5X-8533, HBM2e, plus a generic SerDes and a wireless link), full control over channel, noise, crosstalk, EQ, and receiver, with the eye, bathtub, shmoo, and BER live. Save/load scenarios as JSON files and as URL permalinks. Add a small set of pre-built **"diagnose this failure"** scenarios — a closed eye caused by one specific root cause — where the learner adjusts instruments to identify the cause and the app confirms or corrects the diagnosis.

---

## 4. Shared simulation core

Design this before any module. Everything above is a view over one engine.

```
src/dsp/          fft.ts, convolve.ts, filters.ts, prbs.ts, random.ts, window.ts, interp.ts
src/sim/          channel.ts, driver.ts, receiver.ts, equalizer.ts, cdr.ts,
                  jitter.ts, crosstalk.ts, pdn.ts, eye.ts, ber.ts, shmoo.ts
src/sim/touchstone/   parser.ts, rational-fit.ts, to-impulse.ts
src/workers/      eye.worker.ts, channel.worker.ts, shmoo.worker.ts
src/plots/        canvas primitives: axes, grid, cursors, heatmap, density-eye, trace
src/modules/      m1-harmonics/ … m11-sandbox/
src/state/        scenario schema (zod), URL codec, presets
```

A single `Scenario` type describes a complete simulation: bit rate, pattern, driver, channel (synthesized or Touchstone-loaded), aggressors, noise, equalizer chain, receiver, and sampling. Every module reads and writes a subset of it. Moving from M5 to M7 must preserve the channel you configured — continuity across modules is what makes this a course rather than a pile of demos.

---

## 5. Visual design direction

Read `/mnt/skills/public/frontend-design/SKILL.md` if available; otherwise apply these principles directly. **Do not produce the default AI aesthetic.** Specifically avoid: cream backgrounds with terracotta accents, identical rounded cards in a grid, ALL-CAPS tracked eyebrow labels, `01 / 02 / 03` numbered markers on non-sequential content, gradient washes as decoration, and `→` appended to every link.

Design from the subject matter. This is an oscilloscope-and-lab-bench world: dense data, precise grids, phosphor-density plots, monospaced numerics that don't reflow as values change. The visual identity should feel like a well-designed instrument, not a marketing site. Think in terms of:
- A plot-first layout. Canvas is the hero on every page; text is in service of it.
- A palette derived from measurement, not fashion — decide on 4–6 named hex values, and make the eye-density colormap perceptually uniform (viridis/inferno-class, not rainbow) since people read magnitudes off it. Ensure pass/fail encoding is not colour-only.
- Two typefaces at most: one for reading, one tabular monospace for all numeric readouts. Numbers must not shift horizontally as they update.
- Motion only where it explains: harmonics summing, traces accumulating into an eye, DFE taps converging. No section-entrance animations.
- Hero treatment: open the site with a live, running demo of the core question — an ideal square wave on the left morphing into a measured mess on the right, with a single control the visitor can grab immediately. No hero paragraph before the visitor gets to touch something.

Before writing UI code, propose a compact token system (colour, type, spacing, layout concept with an ASCII wireframe) and review it against this brief. Tell me what you changed after that review and why. Wait for my approval on the design plan.

---

## 6. Writing and content standards

- Explanations are short, precise, and load-bearing. No filler, no "in today's fast-paced world", no restating the control labels in prose.
- Every formula displayed is also implemented — no decorative equations.
- Units everywhere, always. dB vs dBm distinguished. `mV`, `ps`, `UI`, `GT/s` used consistently and correctly.
- Where a value is a typical industry number rather than a spec requirement, say so inline.
- Do not reproduce JEDEC spec text or copyrighted figures. Cite document numbers and describe behaviour in your own words.
- Each module ends with 3–5 self-check questions with revealed answers, and a "try this" prompt that names specific slider settings producing a specific observable effect.

---

## 7. Quality bar and verification

For each DSP and simulation function, write tests that verify against known-good results:
- FFT against a naive DFT on random vectors, and against analytic transforms of a delta, a rectangle, and a sinusoid.
- Square-wave Fourier reconstruction overshoot converging to 8.93%.
- Reflection coefficients for open, short, and matched loads returning +1, −1, 0.
- A lossless matched line producing an ideal eye; a known RC channel producing the analytic step response.
- PRBS generators reproducing the correct sequence length (2ⁿ−1) and known first bytes for standard polynomials.
- Gaussian jitter injection producing the requested σ within tolerance over large N.
- BER from a clean, noiseless channel equal to exactly zero — a canary for indexing bugs.

Verify visually too: after each milestone, screenshot the module and critique it against the design plan before moving on.

---

## 8. Deliverables

- Deployed-ready static build (`npm run build` → `dist/`), plus a GitHub Actions workflow for Pages deployment.
- `README.md`: what it is, how to run, how to deploy, how to add a module.
- `PHYSICS.md`, `PROGRESS.md` as described in Section 0.
- MIT licence, and a clear statement that all simulations are educational models, not sign-off tools.

---

## 9. Milestones

1. **Core** — repo, tooling, design tokens, layout shell, `Scenario` schema, URL state codec, canvas plot primitives, DSP library with tests. No modules yet.
2. **M1 + M2** — harmonics and edges. Proves the plotting and interaction model end to end.
3. **M3** — transmission lines, bounce diagram, TDR view.
4. **M4** — loss models, S-parameters, Touchstone import. Channel engine becomes real.
5. **M5** — eye builder, jitter decomposition, bathtub. Workers and performance work happens here.
6. **M7** — equalization chain and CDR. (Deliberately before M6 — it's the conceptual payoff and the highest-risk module.)
7. **M6** — crosstalk and PDN.
8. **M8** — memory interfaces, training walkthrough, shmoo explorer.
9. **M9 + M10** — wireless view and lab measurement.
10. **M11** — sandbox, scenario save/load, diagnostic challenges.
11. **Polish** — mobile, accessibility, performance pass, deployment, content review.

Start with Milestone 1. Before writing any code, give me: your understanding of the project in your own words, the proposed design plan per Section 5, the file structure, and any questions. Then wait.
