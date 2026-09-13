/**
 * At the bench.
 *
 * The brief asks for oscilloscope practice to be surfaced alongside the physics,
 * and the reason is narrow: almost every measurement in this course is one a
 * post-silicon engineer will take on real hardware, and almost every one of them
 * has an instrument setting that will quietly give the wrong answer. A scope that
 * averages a signal with random jitter reports less jitter. A probe with a long
 * ground lead adds ringing that was not on the board. An FFT with the wrong window
 * shows a noise floor tens of dB above the real one.
 *
 * These are not asides. Each one is a way to measure a number that looks perfectly
 * plausible, gets written into a report, and is wrong.
 *
 * Scope of what is written here: instrument technique that holds across vendors.
 * No model numbers, no menu paths - those go stale and differ between one vendor's
 * front end and another's - and no numbers taken from a JEDEC document. Where a
 * number appears it is either a consequence of physics (the root-sum-square of
 * rise times), a widely used engineering convention, or flagged as typical.
 */

import { MODULES } from './modules';

export type BenchCategory =
  /** Getting the instrument into a state where the measurement means something. */
  | 'setup'
  /** What the probe itself does to the signal. */
  | 'probing'
  /** Getting a stable, correctly aligned acquisition. */
  | 'trigger'
  /** Sample rate, record length, memory depth, averaging, persistence. */
  | 'acquisition'
  /** Math functions: FFT, filters, de-embedding, serial-data post-processing. */
  | 'math'
  /** Reading the result: measurements, statistics, masks. */
  | 'analysis'
  /** A specific way to get a confident wrong answer. */
  | 'pitfall';

export interface BenchTip {
  /** Stable id, for linking to a tip from a module or a glossary entry. */
  id: string;
  /** Modules this belongs beside. Most tips serve more than one. */
  modules: string[];
  category: BenchCategory;
  /** One line, in the imperative. What to do, or what to watch for. */
  title: string;
  /** Two to four sentences: what happens, why, and what it costs if ignored. */
  body: string;
  /**
   * Instrument controls by generic name, so a reader can find them in whatever
   * menu their scope puts them in.
   */
  controls?: string[];
}

export const BENCH_TIPS: BenchTip[] = [
  /* ------------------------------------------------------------------ M1 */
  {
    id: 'fft-resolution-bandwidth',
    modules: ['m1', 'm4', 'm9'],
    category: 'math',
    title: 'Your FFT resolution bandwidth is set by capture length, not by a knob',
    body: 'A scope FFT bins the captured record, so the bin spacing is one over the acquisition duration and nothing else changes it. Wanting 1 MHz resolution means capturing at least a microsecond, which at a high sample rate means deep memory. If the peaks look like broad humps rather than lines, the record is too short - lengthen the acquisition rather than reaching for a smoothing control.',
    controls: ['Math > FFT', 'Record length / memory depth', 'Time per division'],
  },
  {
    id: 'fft-window-choice',
    modules: ['m1', 'm4'],
    category: 'math',
    title: 'Choose the FFT window before you believe the noise floor',
    body: 'A rectangular window on a record that is not an exact number of periods smears every tone across the whole span, and the skirt that produces is easily read as broadband noise. A Hann or Blackman-Harris window trades a little resolution for tens of dB of sidelobe suppression, which is almost always the right trade when looking for a small spur beside a large carrier. Flat-top windows exist for the opposite case: measuring the amplitude of a tone accurately, at the cost of resolution.',
    controls: ['Math > FFT > Window'],
  },
  {
    id: 'clock-pattern-hides-bandwidth',
    modules: ['m1', 'm4', 'm5'],
    category: 'pitfall',
    title: 'A 1010 clock pattern will hide a bandwidth problem',
    body: 'A repeating 1010 stream puts essentially all its energy at half the symbol rate, so a channel that is badly behaved everywhere else can still pass it cleanly. Use a long PRBS when the question is whether the channel works, and keep the clock pattern for the questions it is good at - checking amplitude, duty cycle, and whether anything is oscillating.',
    controls: ['Pattern generator', 'BERT pattern select'],
  },

  /* ------------------------------------------------------------------ M2 */
  {
    id: 'rise-time-convention',
    modules: ['m2', 'm10'],
    category: 'analysis',
    title: 'Check whether the measurement is 10-90% or 20-80% before comparing it',
    body: 'Fast interfaces are usually specified 20-80% and general-purpose scopes usually default to 10-90%, and the two differ by roughly a factor of 0.6 for the same edge. Comparing a measured 10-90% against a 20-80% limit is one of the easiest ways to fail a good part, or pass a bad one. The threshold levels are a setting in the measurement menu, and they are worth checking every time the scope is set up from scratch.',
    controls: ['Measure > Rise time', 'Measurement thresholds / reference levels'],
  },
  {
    id: 'rise-time-rss',
    modules: ['m2', 'm10'],
    category: 'analysis',
    title: 'The scope is part of the edge you measured',
    body: 'For roughly Gaussian responses, the displayed rise time is close to the root-sum-square of the signal, the probe and the scope channel. When the instrument is three times faster than the signal it contributes about 5% and can be ignored; when it is comparable it dominates, and the number on screen is mostly a measurement of the scope. Work out the instrument contribution first - it decides whether the measurement is worth taking at all.',
    controls: ['Channel bandwidth limit', 'Probe bandwidth specification'],
  },
  {
    id: 'bandwidth-limit-filter',
    modules: ['m2', 'm6', 'm10'],
    category: 'setup',
    title: 'The bandwidth-limit switch is a filter, and it changes the answer',
    body: 'A 20 MHz bandwidth limit cleans up a noisy display and is exactly right for looking at supply ripple, but it is a low-pass filter in series with the signal: it will slow every edge and hide every fast glitch. It is a diagnostic tool, not a display preference. Turn it off before measuring anything about an edge, and turn it on deliberately when the question is about low-frequency content.',
    controls: ['Channel > Bandwidth limit'],
  },

  /* ------------------------------------------------------------------ M3 */
  {
    id: 'ground-lead-inductance',
    modules: ['m3', 'm6', 'm10'],
    category: 'probing',
    title: 'The ground lead makes ringing that is not on your board',
    body: 'The loop formed by a probe tip and a several-centimetre ground clip is an inductor, and with the probe tip capacitance it forms a resonator that rings on every fast edge. The ringing is real, but it is in the probe, not in the circuit. Use the shortest ground path available - a spring tip, a ground blade, or a soldered-in ground - whenever the signal has edges faster than a nanosecond.',
    controls: ['Probe ground accessories', 'Solder-in probe head'],
  },
  {
    id: 'tdr-distance',
    modules: ['m3'],
    category: 'analysis',
    title: 'Halve the TDR time, and know the propagation velocity before you convert to distance',
    body: 'A reflection seen on a TDR has travelled to the discontinuity and back, so the distance is the round-trip time divided by two, multiplied by the propagation velocity. That velocity is not the speed of light: on a stripline in ordinary FR-4 it is roughly half of it, and the exact value depends on the dielectric constant and on whether the trace is stripline or microstrip. Getting this factor wrong puts the fault in the wrong part of the board.',
    controls: ['TDR / TDT mode', 'Dielectric constant setting'],
  },
  {
    id: 'probe-loading',
    modules: ['m3', 'm10'],
    category: 'probing',
    title: 'A probe is a load, and on a fast net it is a significant one',
    body: 'A passive 10:1 probe presents around ten picofarads at the tip, which is a low impedance at gigahertz frequencies and will visibly slow the edge it is measuring. Active and low-capacitance probes trade cost and fragility for a tip capacitance an order of magnitude lower. If connecting the probe changes the behaviour of the circuit, the probe is part of the circuit and the measurement needs rethinking, not repeating.',
    controls: ['Probe selection', 'Probe input capacitance specification'],
  },

  /* ------------------------------------------------------------------ M4 */
  {
    id: 'vna-vs-tdr',
    modules: ['m4'],
    category: 'setup',
    title: 'Loss is a frequency-domain measurement wearing a time-domain disguise',
    body: 'A TDR shows an impedance profile along the line and is excellent for finding where a discontinuity is. Insertion loss against frequency is what decides whether a channel closes an eye, and a VNA measures it directly with far better dynamic range. The two are related by a transform and modern instruments will show either view of the same acquisition - but the calibration each one needs is different, and a TDR converted to S-parameters is only as good as its edge.',
    controls: ['S-parameter measurement', 'Time-domain / frequency-domain view'],
  },
  {
    id: 'fixture-de-embedding',
    modules: ['m4', 'm8'],
    category: 'math',
    title: 'What you measured includes the fixture, unless you removed it',
    body: 'Connectors, launches and probe pads sit between the calibration plane and the thing being measured, and at high frequency they are not negligible. De-embedding removes a modelled or measured fixture from the result so the number describes the channel. Applying the wrong fixture model does not fail loudly - it produces a plausible curve that is wrong by exactly the amount of the error.',
    controls: ['De-embedding / fixture removal', 'Calibration kit'],
  },

  /* ------------------------------------------------------------------ M5 */
  {
    id: 'eye-needs-clock-recovery',
    modules: ['m5', 'm7'],
    category: 'analysis',
    title: 'Every eye diagram contains a clock-recovery choice',
    body: 'An eye is built by slicing the waveform at recovered clock edges, so the recovery method is part of the measurement. A first-order or second-order loop with a given bandwidth tracks low-frequency jitter and removes it from the picture; a wider loop removes more and shows a better eye. The receiver being emulated has its own loop characteristics, and the measurement is only meaningful when the recovery used matches it.',
    controls: ['Clock recovery > PLL order and loop bandwidth', 'Explicit clock input'],
  },
  {
    id: 'averaging-destroys-jitter',
    modules: ['m5', 'm10'],
    category: 'pitfall',
    title: 'Never average a signal you are measuring jitter on',
    body: 'Averaging reduces random noise by combining repeated acquisitions, which is exactly why it also erases random jitter: the edges land in different places each time and the average smears them into a slow ramp. The result is a beautifully clean trace with a rise time that is too slow and a jitter number that is far too small. Use averaging for a repetitive signal with a stable trigger when the question is about amplitude, and high-resolution or peak-detect modes otherwise.',
    controls: ['Acquisition > Average / High-res / Peak detect', 'Number of averages'],
  },
  {
    id: 'eye-sample-count',
    modules: ['m5', 'm7'],
    category: 'acquisition',
    title: 'A thin eye and a wide eye can be the same eye with different sample counts',
    body: 'The outline of an eye is built up from accumulated hits, so a short acquisition simply has not yet found the rare excursions that set the real margin. Low-probability events are the ones that matter for a bit error rate, and they appear last. Always note how many symbols an eye represents, and be suspicious of a clean eye built from a few thousand of them.',
    controls: ['Persistence / accumulation', 'Waveform count', 'Segmented memory'],
  },
  {
    id: 'jitter-decomposition-assumptions',
    modules: ['m5'],
    category: 'analysis',
    title: 'Jitter decomposition is a model fit, and it can be fitted to the wrong model',
    body: 'Separating random from deterministic jitter relies on assumptions: that the random part is Gaussian, that the deterministic part is bounded, and often that the pattern repeats so data-dependent jitter can be separated by pattern position. When those assumptions do not hold - a slowly wandering supply, a rare event, a non-repeating pattern - the tool still reports a clean RJ and DJ split, and it is fiction. Look at the histogram itself before trusting the decomposition.',
    controls: ['Jitter separation / RJ-DJ analysis', 'Pattern length setting'],
  },

  /* ------------------------------------------------------------------ M6 */
  {
    id: 'ripple-measurement-coupling',
    modules: ['m6'],
    category: 'setup',
    title: 'Measure supply ripple with AC coupling and offset, not by zooming in',
    body: 'Tens of millivolts of ripple on a volt-scale rail cannot be resolved at a volt per division: the ADC simply does not have the bits. AC coupling or a DC offset moves the rail off screen so the vertical scale can be turned up until the ripple fills the display. Use a 1:1 or low-attenuation probe with a short ground path, because a 10:1 probe throws away a factor of ten of signal before the ADC ever sees it.',
    controls: ['AC coupling', 'Vertical offset', 'Probe attenuation'],
  },
  {
    id: 'crosstalk-needs-two-channels',
    modules: ['m6'],
    category: 'trigger',
    title: 'Prove crosstalk by turning the aggressor off, not by looking at the victim',
    body: 'Noise on a victim line has many possible sources, and a waveform alone will not say which. Trigger on the aggressor and look at the victim: coupled noise is time-correlated with the aggressor edge and will sit still on screen, while uncorrelated noise will not. The decisive test is still the simplest one - quiet the aggressor and see whether the noise goes away.',
    controls: ['Trigger source select', 'Multi-channel acquisition', 'Colour persistence'],
  },
  {
    id: 'sso-needs-local-reference',
    modules: ['m6'],
    category: 'probing',
    title: 'Ground bounce is measured against a local ground, or not at all',
    body: 'Simultaneous switching noise is a difference between the die reference and the board reference, so a probe referenced to a distant ground point measures a different quantity - and adds its own loop to the measurement. Reference the probe as close to the receiver as the board allows. A differential probe across the two references, where there is somewhere to place it, answers the question directly.',
    controls: ['Differential probe', 'Ground reference point'],
  },

  /* ------------------------------------------------------------------ M7 */
  {
    id: 'equalized-eye-is-computed',
    modules: ['m7', 'm8'],
    category: 'math',
    title: 'An equalized eye is a simulation result displayed on an instrument',
    body: 'The eye after CTLE and DFE is computed by the scope software from the captured waveform, not observed at a physical node - inside a real receiver there is no pin to probe. That makes it a genuinely useful prediction and an easy thing to over-trust: its accuracy depends entirely on how well the equalizer model matches the silicon. Check the model parameters against the receiver documentation before quoting the margin.',
    controls: ['Serial data analysis > CTLE / DFE', 'Equalizer parameters'],
  },
  {
    id: 'dfe-cannot-fix-noise',
    modules: ['m7'],
    category: 'analysis',
    title: 'If equalization opens the eye vertically but not horizontally, look at jitter',
    body: 'A decision-feedback equalizer cancels the trailing interference of previous symbols, so it recovers amplitude margin lost to intersymbol interference. It does nothing for random noise or for jitter, and by feeding back sliced decisions it can propagate an error once the eye is closed enough to make one. An eye that stays narrow after equalization is being limited by something equalization does not address.',
    controls: ['DFE tap count', 'Eye height / eye width measurements'],
  },

  /* ------------------------------------------------------------------ M8 */
  {
    id: 'interposer-probing',
    modules: ['m8'],
    category: 'probing',
    title: 'On a memory bus the signal you care about is under the package',
    body: 'The interesting node is the receiver ball, and on a BGA there is nothing to touch. Measurement is done with an interposer, a via stub, or a dedicated probe pad, and each of those adds its own discontinuity that must be accounted for or de-embedded. Plan where to probe at layout time; a board without a probing strategy is a board whose signal integrity cannot be measured.',
    controls: ['Interposer / socket adapter', 'De-embedding'],
  },
  {
    id: 'separate-read-and-write',
    modules: ['m8'],
    category: 'trigger',
    title: 'Separate reads from writes before measuring anything bidirectional',
    body: 'A DQ line is driven by the controller during a write and by the memory device during a read, so an eye built from both is two different transmitters, two different channel directions and two different terminations superimposed. The result is wide and meaningless. Use a protocol trigger or a command-qualified window so each direction is measured separately.',
    controls: ['Protocol / serial trigger', 'Trigger qualification', 'Segmented acquisition'],
  },
  {
    id: 'vref-and-timing-sweep',
    modules: ['m8'],
    category: 'analysis',
    title: 'A shmoo tells you where the margin is, a pass/fail tells you only that there was some',
    body: 'Sweeping the reference voltage and the sample point and recording pass or fail at each point maps the real operating region, and its shape is diagnostic: a region narrow in voltage points at noise or at amplitude loss, one narrow in time points at jitter or intersymbol interference. A single pass at the nominal point tells you none of that, and gives no warning that the margin is about to disappear.',
    controls: ['Vref sweep', 'Timing / phase sweep', 'On-die eye capture where available'],
  },

  /* ------------------------------------------------------------------ M9 */
  {
    id: 'constellation-is-an-eye',
    modules: ['m9'],
    category: 'analysis',
    title: 'A constellation diagram and an eye diagram are the same measurement',
    body: 'Both sample a waveform at recovered symbol instants and plot where the samples land relative to decision boundaries; the constellation simply does it in two dimensions because the modulation carries two. Error vector magnitude plays the role of eye height and noise margin. Recognising this is what lets a jitter or noise result from one domain be read in the other.',
    controls: ['Vector signal analysis', 'EVM measurement', 'Symbol clock recovery'],
  },
  {
    id: 'adc-dynamic-range',
    modules: ['m9', 'm10'],
    category: 'acquisition',
    title: 'Fill the ADC, and know how many bits you are actually getting',
    body: 'A scope quantises to its full-scale range, so a signal occupying a fifth of the screen is being digitised with roughly two bits fewer than the instrument can offer. Effective number of bits is also lower than the nominal figure at high frequency, sometimes substantially. Scale the signal to fill the display before measuring anything small, and check the effective resolution rather than the datasheet headline.',
    controls: ['Vertical scale', 'High-resolution mode', 'ENOB specification'],
  },

  /* ----------------------------------------------------------------- M10 */
  {
    id: 'sample-rate-vs-bandwidth',
    modules: ['m10'],
    category: 'acquisition',
    title: 'Sample rate and bandwidth are different specifications, and you need both',
    body: 'Bandwidth sets what the front end passes; sample rate sets how finely what got through is recorded. A common working rule is at least two and a half to three samples per period at the bandwidth limit, so that sin(x)/x interpolation reconstructs the waveform rather than inventing it. A scope that drops its sample rate when a second channel is enabled - many do - can quietly change the answer halfway through a session.',
    controls: ['Sample rate', 'Interpolation mode', 'Channel interleaving'],
  },
  {
    id: 'scope-noise-floor',
    modules: ['m10', 'm5'],
    category: 'pitfall',
    title: 'Some of the noise on screen is the scope, and it grows with bandwidth',
    body: 'An oscilloscope channel has its own broadband noise, and because that noise is broadband, opening the bandwidth admits more of it. Measure it directly: terminate the input, set the same vertical scale and bandwidth as the real measurement, and read the RMS. Subtract in root-sum-square when the instrument contribution is significant, and reconsider the setup when it is comparable to the signal.',
    controls: ['Channel noise floor measurement', 'Bandwidth limit', 'Vertical scale'],
  },
  {
    id: 'deskew-channels',
    modules: ['m10', 'm6', 'm8'],
    category: 'setup',
    title: 'Deskew the channels before measuring anything about time',
    body: 'Different probes and different cable lengths have different propagation delays, and tens of picoseconds of skew between channels is ordinary. Any measurement of a time relationship - setup and hold, a differential pair, an aggressor-to-victim delay - inherits that skew directly. Deskew with a common edge into both channels at the start of the session, and again after changing a probe.',
    controls: ['Channel deskew', 'Deskew fixture'],
  },
  {
    id: 'trigger-jitter-and-holdoff',
    modules: ['m10', 'm5'],
    category: 'trigger',
    title: 'An unstable display is often an unstable trigger',
    body: 'The trigger circuit has its own jitter, and a trigger level set in a noisy part of the edge will add more. Set the level at the steepest part of the transition, use hysteresis or noise-reject when the signal is noisy, and use holdoff to skip past a repeating burst so the scope arms on the same event each time. Jitter measured relative to a jittery trigger includes the trigger.',
    controls: ['Trigger level and hysteresis', 'Holdoff', 'Noise reject / HF reject'],
  },
  {
    id: 'warm-up-and-calibration',
    modules: ['m10'],
    category: 'setup',
    title: 'Run the self-calibration, and let the instrument warm up first',
    body: 'Vertical gain, offset and inter-channel timing all drift with temperature, and a scope calibrated cold will be out of specification once it is warm. The internal self-calibration takes a few minutes and needs the inputs disconnected. It is worth doing at the start of a measurement session that is going to produce numbers anyone else will rely on.',
    controls: ['Utility > Self calibration', 'Probe calibration / compensation'],
  },
  {
    id: 'probe-compensation',
    modules: ['m10', 'm2'],
    category: 'probing',
    title: 'Compensate a passive probe against the channel it will be used on',
    body: 'A 10:1 passive probe forms a compensated divider with the scope input, and the adjustment is per channel because input capacitances differ slightly. Under-compensation rounds every edge and over-compensation adds an overshoot that looks exactly like a real reflection. Check it on the calibration square wave whenever a probe moves to a different channel.',
    controls: ['Probe compensation adjustment', 'Calibration output'],
  },

  /* ----------------------------------------------------------------- M11 */
  {
    id: 'change-one-thing',
    modules: ['m11'],
    category: 'analysis',
    title: 'Change one thing at a time, and write down what you changed',
    body: 'Both here and at the bench, the useful experiment is the one where a single variable moved and everything else is known to have stayed still. When two things change together, a result that looks like a discovery is usually two effects partly cancelling. The permalink at the top of the page encodes the entire setup, so the discipline costs nothing more than pasting it somewhere before the next change.',
    controls: ['Save setup / recall setup', 'Reference waveforms'],
  },
  {
    id: 'save-a-reference',
    modules: ['m11', 'm10'],
    category: 'acquisition',
    title: 'Save a reference waveform before you touch anything',
    body: 'A reference trace stored on the instrument is the cheapest form of experimental control: the before and after sit on the same screen, on the same scale, and a difference that would be invisible in memory is obvious side by side. Most scopes will also store the full setup alongside it, which makes the measurement repeatable tomorrow.',
    controls: ['Reference waveform save/recall', 'Setup save/recall'],
  },
];

/* ---------------------------------------------------------------- lookups */

const BY_MODULE = new Map<string, BenchTip[]>();
for (const m of MODULES) BY_MODULE.set(m.id, []);
for (const tip of BENCH_TIPS) {
  for (const id of tip.modules) BY_MODULE.get(id)?.push(tip);
}

/** Tips to offer beside a module, in declaration order. */
export function tipsForModule(moduleId: string): BenchTip[] {
  return BY_MODULE.get(moduleId) ?? [];
}

export function getTip(id: string): BenchTip | undefined {
  return BENCH_TIPS.find((t) => t.id === id);
}

export function tipsByCategory(category: BenchCategory): BenchTip[] {
  return BENCH_TIPS.filter((t) => t.category === category);
}

/**
 * Pick one tip for a module deterministically from a seed.
 *
 * Deterministic rather than random so that a permalink shows the same reader the
 * same page, and so a screenshot can be reproduced. The caller supplies whatever
 * it wants the choice to depend on - usually the index of the section being read.
 */
export function tipFor(moduleId: string, seed: number): BenchTip | undefined {
  const tips = tipsForModule(moduleId);
  if (tips.length === 0) return undefined;
  const i = ((Math.trunc(seed) % tips.length) + tips.length) % tips.length;
  return tips[i];
}
