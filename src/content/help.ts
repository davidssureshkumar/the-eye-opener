/**
 * Per-control help.
 *
 * Every control in every instrument panel is a path into a Scenario, and every
 * one of those paths has an entry here. `__tests__/help.test.ts` walks a Scenario
 * that exercises every field and fails if any path is missing, so a control added
 * to the schema cannot ship without an explanation. That is the whole point: a
 * slider labelled "Kf" with no help is a slider nobody moves.
 *
 * Four fields, in the order the tooltip renders them:
 *
 *   what   - what the control changes, physically. Always present.
 *   why    - why a validation engineer would move it. Usually present.
 *   bench  - how the same thing looks or is done on real instruments.
 *   see    - glossary ids for the terms the other three used.
 *
 * `illustrative` marks a control whose DEFAULT value is a plausible stand-in
 * rather than a figure from a standard or a datasheet. The panel renders it as a
 * visible badge. Nothing in this file is quoted from JEDEC.
 */

import { hasTerm } from './glossary';

export interface ControlHelp {
  /** Short label for the panel. Sentence case, no trailing colon. */
  label: string;
  /** SI unit symbol; '' for a choice, a toggle or a pure count. */
  unit: string;
  /** What the control changes, physically. One or two sentences. */
  what: string;
  /** Why you would move it during validation or debug. */
  why?: string;
  /** The bench equivalent: what to press on a scope, what to watch for. */
  bench?: string;
  /** Glossary ids this control is explained by. */
  see?: string[];
  /** True when the default is a representative stand-in, not a spec number. */
  illustrative?: boolean;
}

/* ------------------------------------------------------------ path handling */

/**
 * The key a Scenario path is looked up under.
 *
 * Array elements collapse to `[]`, so `crosstalk.aggressors.2.kb` and
 * `crosstalk.aggressors.0.kb` share one entry. Aggressor three is not a different
 * control from aggressor one.
 */
export function canonicalPath(path: string): string {
  return path
    .split('.')
    .map((seg) => (/^\d+$/.test(seg) ? '[]' : seg))
    .join('.');
}

/**
 * Every control path in a Scenario-shaped value, canonicalised.
 *
 * A number array (FFE taps, cursor positions) is one control, not one per
 * element. An array of objects is one control for the array itself - "how many
 * aggressors" - plus the controls of its elements under `[]`.
 */
export function controlPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'number')) return [prefix];
    const inner = value.length > 0 ? controlPaths(value[0], `${prefix}.[]`) : [];
    return [prefix, ...inner];
  }
  if (value !== null && typeof value === 'object') {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(...controlPaths(v, prefix === '' ? k : `${prefix}.${k}`));
    }
    return out;
  }
  return [prefix];
}

/**
 * Paths that are state rather than controls, and so carry no help.
 *
 * Kept short and justified. Anything added here is a thing the reader cannot
 * change, which means it does not belong in a panel either.
 */
export const NON_CONTROL_PATHS: ReadonlySet<string> = new Set([
  // Written by the codec, migrated on decode, never shown.
  'version',
  // Set by the file loader when a Touchstone file is read, not by the reader.
  'channel.touchstone.name',
  'channel.touchstone.ports',
]);

/** Prefix a block of shared entries, so one definition serves several panels. */
function withPrefix(prefix: string, entries: Record<string, ControlHelp>): Record<string, ControlHelp> {
  const out: Record<string, ControlHelp> = {};
  for (const [k, v] of Object.entries(entries)) out[`${prefix}.${k}`] = v;
  return out;
}

/* ------------------------------------------------------------------ pattern */

/**
 * The pattern generator, used by the transmitter and by every aggressor. Defined
 * once and mounted under both prefixes: an aggressor's pattern controls mean
 * exactly what the victim's do.
 */
const PATTERN_HELP: Record<string, ControlHelp> = {
  kind: {
    label: 'Pattern',
    unit: '',
    what: 'Which symbol sequence is transmitted. PRBS gives broadband content, a clock pattern gives a single tone at half the symbol rate, a lone one gives the isolated pulse response, and the worst-case sequence is constructed to maximise ISI against the current channel.',
    why: 'A pattern that does not excite the failure mechanism will pass a broken link. Lone-one isolates the channel response; a long PRBS exposes low-frequency behaviour; burst-idle exposes AC coupling and DFE recovery.',
    bench:
      'On a BERT or pattern generator this is the pattern select. On a scope, know which pattern the DUT is sending before you read anything into the eye.',
    see: ['pattern', 'prbs', 'isi', 'pulse-response'],
  },
  prbs: {
    label: 'PRBS order',
    unit: '',
    what: 'Order of the linear feedback shift register, so the sequence repeats every 2^n - 1 bits and the longest run of identical symbols is n.',
    why: 'A higher order means longer runs and more low-frequency content, which stresses AC coupling, DFE adaptation and baseline wander. PRBS7 will not find problems that PRBS31 finds.',
    bench:
      'Pattern length also sets how long a scope must acquire before the eye is fully populated: the eye is not converged until the pattern has repeated several times.',
    see: ['prbs', 'pattern', 'isi'],
  },
  seed: {
    label: 'Seed',
    unit: '',
    what: 'Initial LFSR state. A seed of zero would lock the register, so the generator remaps it to all ones.',
    why: 'Changing the seed changes which part of the sequence you are looking at without changing its statistics. Two aggressors on the same seed are correlated, which is not what real neighbouring lanes do.',
    see: ['prbs'],
  },
  divN: {
    label: 'Divide ratio',
    unit: '',
    what: 'For the divided-clock pattern: n identical symbols, then n of the opposite value, so the fundamental is the symbol rate divided by 2n.',
    why: 'Sweeping the divide ratio walks a single tone down through the channel response, which is the time-domain way to find a resonance or a stub null.',
    see: ['pattern', 'resonance', 'nyquist-frequency'],
  },
  frame: {
    label: 'Frame length',
    unit: '',
    what: 'Length in symbols of the repeating frame used by the lone-one, lone-zero and walking patterns.',
    why: 'The frame must be longer than the channel impulse response for the lone-one pulse to be genuinely isolated. If it is not, you are measuring a pulse train, not a single-bit response.',
    see: ['pulse-response', 'isi', 'pattern'],
  },
  burst: {
    label: 'Burst length',
    unit: '',
    what: 'For the burst-idle pattern: number of active symbols, followed by an idle gap of the same length.',
    why: 'Bursts expose everything with a memory longer than a symbol - AC coupling droop, DFE tap adaptation, supply droop that builds over a burst and recovers in the gap.',
    see: ['supply-droop', 'dfe', 'pattern'],
  },
  custom: {
    label: 'Custom bits',
    unit: '',
    what: 'A literal symbol string, repeated. Characters other than 0 and 1 are ignored, so spacing for readability is safe.',
    why: 'The way to reproduce a specific failing sequence from a log, or to hand-build a pattern that puts a known worst case next to a known good case.',
    see: ['pattern', 'isi'],
  },
  invert: {
    label: 'Invert',
    unit: '',
    what: 'Swaps ones and zeros before transmission.',
    why: 'Asymmetric behaviour - unequal rise and fall, a threshold that is not centred, level-dependent loss - shows up as a result that changes when the pattern is inverted and should not.',
    bench:
      'The equivalent of swapping the differential pair polarity, and a quick check for a polarity error in a fixture.',
    see: ['dcd', 'differential-signaling'],
  },
};

/* ----------------------------------------------------------------- the help */

export const CONTROL_HELP: Record<string, ControlHelp> = {
  /* -------------------------------------------------------------- source */
  ...withPrefix('source.pattern', PATTERN_HELP),
  'source.symbolRate': {
    label: 'Symbol rate',
    unit: 'Bd',
    what: 'Symbols transmitted per second. Its reciprocal is the unit interval, and half of it is the Nyquist frequency where channel loss is quoted.',
    why: 'Everything scales from here. Doubling the rate halves the UI while leaving the channel impulse response the same length, which is why ISI gets worse faster than the rate goes up.',
    bench:
      'Set the scope timebase from this, not by eye: a fixed number of UI per division keeps plots comparable across rates.',
    see: ['symbol-rate', 'unit-interval', 'nyquist-frequency'],
    illustrative: true,
  },
  'source.levels': {
    label: 'Modulation',
    unit: '',
    what: 'NRZ sends one bit per symbol at two levels; PAM4 sends two bits per symbol at four levels and three thresholds.',
    why: 'PAM4 halves the symbol rate for a given bit rate, which halves the Nyquist frequency and so the channel loss, but it costs about two thirds of the amplitude margin.',
    see: ['pam4', 'unit-interval', 'threshold'],
  },
  'source.amplitude': {
    label: 'Swing',
    unit: 'V',
    what: 'Single-ended peak-to-peak voltage at the driver, before any channel loss.',
    why: 'Sets the numerator of every margin ratio. Increasing it raises the signal and the crosstalk it injects into neighbours in equal measure.',
    see: ['eye-height', 'crosstalk', 'q-factor'],
    illustrative: true,
  },
  'source.dcOffset': {
    label: 'DC offset',
    unit: 'V',
    what: 'Common-mode voltage added to the whole waveform.',
    why: 'An offset between the transmitter common mode and the receiver threshold eats vertical margin asymmetrically and shows up as duty-cycle distortion.',
    see: ['dcd', 'threshold', 'differential-signaling'],
  },
  'source.riseTime': {
    label: 'Rise time',
    unit: 's',
    what: '20-80% transition time at the driver output. Note the thresholds: the 10-90% figure for the same edge is about 1.56 times larger.',
    why: 'The edge rate sets the knee frequency and therefore how much of the channel the signal actually sees. It also sets FEXT amplitude, which is proportional to the derivative of the edge.',
    bench:
      'A measured rise time is the root-sum-square of the signal, the probe and the scope. Subtract the instrument in quadrature before quoting it.',
    see: ['rise-time', 'knee-frequency', 'fext', 'bandwidth'],
    illustrative: true,
  },
  'source.fallTime': {
    label: 'Fall time',
    unit: 's',
    what: '20-80% fall time at the driver. Separate from rise time because real drivers are not symmetric.',
    why: 'Unequal rise and fall moves the threshold crossing of one edge relative to the other, which is duty-cycle distortion and appears in the eye as two crossing points.',
    see: ['rise-time', 'dcd', 'deterministic-jitter'],
  },
  'source.edgeShape': {
    label: 'Edge shape',
    unit: '',
    what: 'The trajectory between levels: a linear ramp, a single-pole exponential, a Gaussian, a Bessel response, or the sinc-ringing of a brickwall band limit.',
    why: 'Two edges with identical 20-80% times but different shapes have different spectra and different overshoot. The shape decides how much energy sits above the knee.',
    see: ['rise-time', 'bessel-response', 'brickwall-filter', 'gibbs-phenomenon'],
  },
  'source.sourceZ': {
    label: 'Source impedance',
    unit: 'ohm',
    what: 'Driver output impedance, which forms a divider with the line and sets how much of a returning reflection is re-reflected forwards.',
    why: 'Matching it to the line impedance is series termination: the driver then absorbs the reflection coming back from the far end instead of sending it out again.',
    see: ['termination', 'reflection-coefficient', 'characteristic-impedance'],
    illustrative: true,
  },

  /* ------------------------------------------------------------- channel */
  'channel.kind': {
    label: 'Channel model',
    unit: '',
    what: 'Which model carries the signal from driver to receiver: ideal wire, single-pole RC, lumped RLC, lossless transmission line, frequency-dependent lossy line, or a measured Touchstone file.',
    why: 'Each model can only show what it contains. An RC channel produces ISI but cannot produce a reflection; a lossless line produces reflections but no frequency-dependent loss. Pick the simplest model that contains the effect you are studying.',
    see: ['transmission-line', 'rlc', 'insertion-loss', 'touchstone'],
  },
  'channel.rc.bw': {
    label: 'Channel bandwidth',
    unit: 'Hz',
    what: '-3 dB bandwidth of the single-pole channel. The 10-90% rise time it imposes is 0.35 divided by this.',
    why: 'The cheapest way to see ISI appear: lower the bandwidth below the knee frequency and watch the eye close as each bit starts to depend on the last.',
    see: ['bandwidth', 'knee-frequency', 'isi'],
  },
  'channel.rlc.r': {
    label: 'Series R',
    unit: 'ohm',
    what: 'Series resistance of the lumped network. It damps the LC resonance and attenuates the signal.',
    why: 'Raising it moves the response from underdamped to overdamped: ringing disappears and is replaced by a slow edge.',
    see: ['rlc', 'damping-factor', 'ringing'],
  },
  'channel.rlc.l': {
    label: 'Series L',
    unit: 'H',
    what: 'Series inductance, standing in for a package pin, a bond wire or a via barrel. A package pin is of order a nanohenry.',
    why: 'With the shunt capacitance it sets the resonant frequency. Inductance is also what converts dI/dt into ground bounce, so the same number appears in the SSN model.',
    see: ['rlc', 'resonance', 'ssn'],
    illustrative: true,
  },
  'channel.rlc.c': {
    label: 'Shunt C',
    unit: 'F',
    what: 'Shunt capacitance of the lumped network, standing in for a pad, a via antipad or a receiver input. A receiver pad is of order half a picofarad.',
    why: 'Capacitance loads the edge and, with the series inductance, sets the ringing frequency. It is also the dominant term in probe loading.',
    see: ['rlc', 'probe-loading', 'resonance'],
    illustrative: true,
  },
  'channel.tline.z0': {
    label: 'Line impedance',
    unit: 'ohm',
    what: 'Characteristic impedance of the transmission line, a property of its cross-section and independent of its length.',
    why: 'Every reflection in the module comes from a mismatch between this and something else. Change it and watch which reflections grow.',
    see: ['characteristic-impedance', 'reflection-coefficient', 'tdr'],
  },
  'channel.tline.length': {
    label: 'Length',
    unit: 'm',
    what: 'Physical length of the line. With the velocity factor it gives the one-way propagation delay.',
    why: 'Length sets the spacing of the reflections in time, not their amplitude. A short line puts the reflection inside the edge where it hides; a long one puts it out where you can see it.',
    bench:
      'On a TDR the horizontal axis is round-trip time, so a discontinuity at time t is at half that electrical distance.',
    see: ['electrical-length', 'tdr', 'transmission-line'],
  },
  'channel.tline.velocityFactor': {
    label: 'Velocity factor',
    unit: '1',
    what: 'Propagation velocity as a fraction of the speed of light, equal to one over the square root of the effective relative permittivity.',
    why: 'It converts physical length into delay. Roughly 0.5 for stripline in FR-4, which is about 6 to 7 picoseconds per millimetre.',
    see: ['electrical-length', 'permittivity'],
    illustrative: true,
  },
  'channel.tline.loadZ': {
    label: 'Far-end load',
    unit: 'ohm',
    what: 'Resistance terminating the far end of the line. A very large value is an unterminated open; a value equal to the line impedance absorbs the wave entirely.',
    why: 'This is the reflection coefficient in disguise. Sweep it from a short through a match to an open and watch the reflected step invert, vanish and return.',
    see: ['termination', 'reflection-coefficient', 'stub'],
  },
  'channel.tline.loadC': {
    label: 'Far-end C',
    unit: 'F',
    what: 'Capacitance across the far-end load, standing in for receiver input capacitance.',
    why: 'A capacitive far end reflects like a short at high frequency and like the load resistance alone at low frequency, which is why its reflection is a dip that recovers to the resistive value rather than a step.',
    see: ['reflection-coefficient', 'rlc', 'probe-loading'],
  },
  'channel.tline.bounces': {
    label: 'Round trips',
    unit: '',
    what: 'How many reflection round trips the bounce diagram computes before truncating.',
    why: 'Enough to see the settling behaviour, few enough to keep the diagram readable. If the waveform is still moving at the last trip, raise it.',
    see: ['reflection-coefficient', 'ringing'],
  },
  'channel.lossy.z0': {
    label: 'Line impedance',
    unit: 'ohm',
    what: 'Nominal characteristic impedance of the lossy line at high frequency, where it approaches sqrt(L/C).',
    why: 'At low frequency a lossy line’s impedance rises above this value because the series resistance stops being negligible. That is a real effect, visible at the start of a TDR trace.',
    see: ['characteristic-impedance', 'rlgc', 'tdr'],
  },
  'channel.lossy.length': {
    label: 'Length',
    unit: 'm',
    what: 'Physical length of the lossy line. Loss in decibels is proportional to it.',
    why: 'The single most effective term in a loss budget, and the one a layout change actually moves. Doubling length doubles decibels of loss at every frequency.',
    see: ['insertion-loss', 'electrical-length'],
  },
  'channel.lossy.er': {
    label: 'Permittivity (Dk)',
    unit: '1',
    what: 'Relative permittivity of the dielectric at the reference frequency. It sets propagation velocity and contributes to dielectric loss.',
    why: 'A lower-Dk laminate is faster and usually lower loss. Around 4 for FR-4 and around 3 for a low-loss laminate, both varying with frequency and with glass weave.',
    see: ['permittivity', 'dielectric-loss', 'electrical-length'],
    illustrative: true,
  },
  'channel.lossy.lossTangent': {
    label: 'Loss tangent (Df)',
    unit: '1',
    what: 'Fraction of energy the dielectric absorbs per radian, quoted at the reference frequency below.',
    why: 'Dielectric loss rises linearly with frequency, so this term dominates the high-frequency end of an insertion-loss curve. It is the number that decides whether a laminate upgrade is worth its cost.',
    see: ['loss-tangent', 'dielectric-loss', 'insertion-loss'],
    illustrative: true,
  },
  'channel.lossy.referenceFreq': {
    label: 'Reference frequency',
    unit: 'Hz',
    what: 'The frequency at which the permittivity and loss tangent above are stated. A causal material model interpolates away from it.',
    why: 'A Dk and Df pair without its reference frequency is unusable. Datasheets quote at 1 GHz or 10 GHz and the values differ meaningfully between them.',
    see: ['loss-tangent', 'permittivity', 'dispersion'],
  },
  'channel.lossy.dcResistance': {
    label: 'DC resistance',
    unit: 'ohm/m',
    what: 'Series resistance per metre at DC, before skin effect confines the current.',
    why: 'It sets the low-frequency floor of conductor loss and the droop on a long run of identical symbols, which is baseline wander.',
    see: ['rlgc', 'skin-effect', 'insertion-loss'],
  },
  'channel.lossy.conductivity': {
    label: 'Conductivity',
    unit: 'S/m',
    what: 'Bulk conductivity of the conductor, which sets skin depth together with frequency and permeability. Copper is 5.8e7 S/m.',
    why: 'Lower conductivity means deeper skin depth and more resistance at every frequency. It is how a plating or an alloy change enters the loss model.',
    see: ['skin-effect', 'dielectric-loss'],
  },
  'channel.lossy.traceWidth': {
    label: 'Trace width',
    unit: 'm',
    what: 'Conductor width, which sets the surface area available to skin-limited current.',
    why: 'Wider traces have lower conductor loss but need a different stack-up to hold the same impedance. This is the trade the loss budget is really about.',
    see: ['skin-effect', 'characteristic-impedance', 'insertion-loss'],
  },
  'channel.lossy.roughnessRms': {
    label: 'Copper roughness',
    unit: 'm',
    what: 'RMS surface profile of the copper foil. Very-low-profile foil is a fraction of a micrometre; standard foil is a few micrometres.',
    why: 'Roughness starts to matter when the skin depth falls to the profile height, which for typical foils is in the low gigahertz. Above that it can nearly double conductor loss.',
    see: ['roughness', 'skin-effect'],
    illustrative: true,
  },
  'channel.lossy.roughnessEnabled': {
    label: 'Roughness correction',
    unit: '',
    what: 'Applies the Hammerstad correction factor to conductor loss, which saturates at 2.',
    why: 'Turning it off and on separates how much of the measured loss is surface profile and how much is bulk conductor and dielectric.',
    see: ['roughness', 'skin-effect', 'insertion-loss'],
  },
  'channel.lossy.viaCount': {
    label: 'Via count',
    unit: '',
    what: 'Number of via discontinuities cascaded along the path.',
    why: 'Vias are usually capacitive, so each one is a small impedance dip and a small reflection. Several of them at regular spacing create a periodic structure with a resonant null.',
    see: ['via', 'stub', 'return-loss'],
  },
  'channel.lossy.viaC': {
    label: 'Via capacitance',
    unit: 'F',
    what: 'Effective shunt capacitance of one via, from its pad and antipad.',
    why: 'The amplitude of each via reflection. If return loss is poor but insertion loss looks reasonable, this is the first term to suspect.',
    see: ['via', 'return-loss', 'reflection-coefficient'],
    illustrative: true,
  },
  'channel.touchstone.name': {
    label: 'File',
    unit: '',
    what: 'Name of the loaded Touchstone file, shown for reference. The data itself stays in memory and never enters a permalink.',
    why: 'A permalink reproduces every other setting but cannot carry a measured channel, so a shared link with a Touchstone channel needs the file sent alongside it.',
    see: ['touchstone', 's-parameters'],
  },
  'channel.touchstone.ports': {
    label: 'Ports',
    unit: '',
    what: 'Port count of the loaded file, read from its data rather than from its extension.',
    why: 'Port count decides what is available: two ports give one path, four give a differential pair, twelve give a pair plus aggressors.',
    see: ['touchstone', 's-parameters', 'mixed-mode'],
  },
  'channel.touchstone.txPort': {
    label: 'Transmit port',
    unit: '',
    what: 'Which port of the file the transmitter drives.',
    why: 'Port numbering in a measured file follows the fixture, not intuition. Getting it wrong gives a channel response that is really a crosstalk path, which looks like enormous loss.',
    see: ['touchstone', 's-parameters', 'insertion-loss'],
  },
  'channel.touchstone.rxPort': {
    label: 'Receive port',
    unit: '',
    what: 'Which port of the file the receiver observes. With the transmit port it selects the Sij term used as the channel.',
    why: 'Swapping transmit and receive ports should give the same insertion loss on a passive reciprocal channel. If it does not, the file or the port map is wrong.',
    see: ['touchstone', 's-parameters'],
  },
  'channel.touchstone.renormalizeTo': {
    label: 'Renormalise to',
    unit: 'ohm',
    what: 'Reference impedance the S-parameters are converted to before use.',
    why: 'S-parameters are only meaningful against their reference impedance. Using a 50 ohm file with a 100 ohm differential system without renormalising silently changes every number.',
    see: ['s-parameters', 'touchstone', 'characteristic-impedance'],
  },
  'channel.touchstone.mixedMode': {
    label: 'Mixed mode',
    unit: '',
    what: 'Treats port pairs as differential and uses the differential insertion loss Sdd21 rather than a single-ended term.',
    why: 'A differential channel measured single-ended understates loss and misses mode conversion entirely. Mode conversion is where intra-pair skew shows up.',
    see: ['mixed-mode', 'differential-signaling', 'skew'],
  },
  'channel.terminationZ': {
    label: 'Receiver termination',
    unit: 'ohm',
    what: 'Resistance to the reference at the receiver input.',
    why: 'Matching it to the line impedance absorbs the incident wave and stops reflection. Everything else is a compromise between reflection and power.',
    bench:
      'On a memory bus this is the ODT setting, and it is a trained, register-programmed value rather than a fixed resistor.',
    see: ['termination', 'odt', 'reflection-coefficient'],
  },
  'channel.terminationC': {
    label: 'Receiver capacitance',
    unit: 'F',
    what: 'Input capacitance at the receiver pad, which loads the arriving edge.',
    why: 'It slows the edge exactly where timing is measured, and it is the reason a receiver-side rise time is always longer than the transmitter’s.',
    see: ['rlc', 'rise-time', 'probe-loading'],
    illustrative: true,
  },

  /* --------------------------------------------------------- impairments */
  'impairments.seed': {
    label: 'Random seed',
    unit: '',
    what: 'Master seed. Every impairment draws from its own labelled sub-stream, so changing the noise level does not change which jitter samples are drawn.',
    why: 'A fixed seed makes a result reproducible and a permalink honest. Changing only the seed shows how much of an observed margin is luck of the draw.',
    see: ['random-jitter', 'noise'],
  },
  'impairments.noiseRms': {
    label: 'Voltage noise',
    unit: 'V',
    what: 'Gaussian noise added at the receiver, quoted as an RMS value.',
    why: 'It closes the eye vertically and, through the slew rate at the crossing, also converts into timing jitter. Both effects come from this one number.',
    bench:
      'Measure the noise floor with the input terminated and nothing driving, and subtract it in quadrature before quoting the signal’s own noise.',
    see: ['noise', 'noise-to-jitter', 'q-factor', 'eye-height'],
    illustrative: true,
  },
  'impairments.noiseFlickerCorner': {
    label: 'Flicker corner',
    unit: 'Hz',
    what: 'Frequency below which the noise power rises as 1/f. Zero gives flat white noise.',
    why: 'Flicker noise drifts slowly, so it behaves like a wandering offset rather than like a per-sample disturbance. A CDR tracks it; a fixed threshold does not.',
    see: ['noise', 'cdr', 'threshold'],
  },
  'impairments.randomJitterRms': {
    label: 'Random jitter',
    unit: 's',
    what: 'Gaussian timing displacement applied independently to each edge, quoted as an RMS value because it is unbounded.',
    why: 'It sets how far the bathtub tails extend and therefore the whole extrapolation to a low BER. Deterministic jitter moves the walls of the eye; random jitter decides how fast they fade.',
    bench:
      'Never measure this on an averaged trace: averaging removes exactly the thing you are trying to measure.',
    see: ['random-jitter', 'total-jitter', 'bathtub-curve', 'averaging'],
    illustrative: true,
  },
  'impairments.boundedJitterPp': {
    label: 'Bounded jitter',
    unit: 's',
    what: 'Uniformly distributed timing displacement with a hard peak-to-peak limit, standing in for bounded uncorrelated jitter such as crosstalk-induced timing noise.',
    why: 'Bounded jitter widens the eye crossings by a fixed amount at every BER, unlike random jitter which keeps growing the longer you look.',
    see: ['deterministic-jitter', 'crosstalk', 'total-jitter'],
  },
  'impairments.periodicJitterAmp': {
    label: 'Periodic jitter',
    unit: 's',
    what: 'Amplitude, in seconds peak, of a sinusoidal modulation of edge timing.',
    why: 'Its distribution is the arcsine shape - two peaks at the extremes - which is what makes it identifiable in a jitter histogram rather than just more spread.',
    see: ['periodic-jitter', 'deterministic-jitter'],
  },
  'impairments.periodicJitterFreq': {
    label: 'PJ frequency',
    unit: 'Hz',
    what: 'Frequency of the sinusoidal timing modulation.',
    why: 'The frequency identifies the aggressor: a switching regulator, a reference clock, a spread-spectrum profile. It also decides whether a CDR tracks the jitter or has to tolerate it.',
    bench:
      'A jitter spectrum from the scope’s jitter analysis package shows this as a line. Match its frequency against the known clocks on the board.',
    see: ['periodic-jitter', 'cdr', 'jitter-transfer'],
  },
  'impairments.dcdFraction': {
    label: 'Duty-cycle distortion',
    unit: 'UI',
    what: 'Displacement of rising and falling edges in opposite directions, as a fraction of a unit interval, so alternate intervals are long and short.',
    why: 'It splits the eye crossing into two distinct points. Any measurement that assumes one crossing - including many automatic eye-width readouts - gets confused by it.',
    see: ['dcd', 'deterministic-jitter', 'eye-width'],
  },
  'impairments.supplyDroop': {
    label: 'Supply droop',
    unit: '1',
    what: 'Reduction in supply voltage under load, as a fraction of the nominal swing.',
    why: 'Droop reduces swing and shifts the threshold at the same time, and because it follows the data pattern it converts into data-dependent jitter rather than into a static offset.',
    see: ['supply-droop', 'pdn', 'ddj'],
  },

  /* ----------------------------------------------------------- crosstalk */
  'crosstalk.enabled': {
    label: 'Crosstalk',
    unit: '',
    what: 'Includes the aggressor contributions in the received waveform.',
    why: 'Toggling it is the cleanest attribution test there is: whatever changes in the eye when this goes off is crosstalk and nothing else.',
    see: ['crosstalk', 'next', 'fext'],
  },
  'crosstalk.aggressors': {
    label: 'Aggressors',
    unit: '',
    what: 'The list of coupled nets. Each has its own coupling, length, skew, pattern and seed.',
    why: 'Crosstalk from independent aggressors adds in power, not in amplitude, so four aggressors of equal strength are about twice one - unless they are correlated, in which case they add directly. Give each one a different seed to keep them independent.',
    see: ['crosstalk', 'coupling-coefficient'],
  },
  'crosstalk.aggressors.[].enabled': {
    label: 'Enabled',
    unit: '',
    what: 'Includes this aggressor in the summed crosstalk seen by the victim. Disabled aggressors still keep their settings.',
    why: 'Turning aggressors on one at a time ranks them, which is what a layout change needs in order to be worth making.',
    see: ['crosstalk'],
  },
  'crosstalk.aggressors.[].end': {
    label: 'Coupling end',
    unit: '',
    what: 'Whether this aggressor contributes near-end (reverse-travelling) or far-end (forward-travelling) crosstalk at the victim receiver.',
    why: 'They look completely different. NEXT is a wide flat pulse that saturates with coupled length; FEXT is a narrow derivative-shaped spike that keeps growing with length.',
    see: ['next', 'fext', 'crosstalk'],
  },
  'crosstalk.aggressors.[].kb': {
    label: 'Backward coupling Kb',
    unit: '1',
    what: 'Dimensionless backward coupling coefficient. Near-end crosstalk amplitude is this times the aggressor swing, once the coupled length exceeds half the spatial extent of the edge.',
    why: 'Because NEXT saturates, Kb alone sets the worst case: beyond a certain coupled length, more parallel run adds no more near-end crosstalk.',
    see: ['next', 'coupling-coefficient', 'crosstalk'],
    illustrative: true,
  },
  'crosstalk.aggressors.[].kf': {
    label: 'Forward coupling Kf',
    unit: 's/m',
    what: 'Forward coupling coefficient in seconds per metre. Far-end crosstalk is this times the coupled length times the time derivative of the aggressor edge.',
    why: 'FEXT does not saturate, so it grows with every extra millimetre of parallel run and with every picosecond taken off the edge. In a homogeneous medium such as stripline it is near zero because the inductive and capacitive terms cancel.',
    see: ['fext', 'coupling-coefficient', 'rise-time'],
    illustrative: true,
  },
  'crosstalk.aggressors.[].coupledLength': {
    label: 'Coupled length',
    unit: 'm',
    what: 'Length over which the aggressor runs parallel to the victim.',
    why: 'The axis on which NEXT and FEXT behave differently. Sweep it and watch one saturate while the other keeps climbing.',
    see: ['next', 'fext', 'coupling-coefficient'],
  },
  'crosstalk.aggressors.[].skew': {
    label: 'Skew',
    unit: 's',
    what: 'Timing offset of the aggressor relative to the victim.',
    why: 'Worst-case crosstalk is when the aggressor edge lands on the victim’s sampling instant, and that alignment is a matter of skew. Sweeping it finds the worst case instead of assuming it.',
    see: ['skew', 'crosstalk', 'sampling-point'],
  },
  'crosstalk.aggressors.[].seed': {
    label: 'Aggressor seed',
    unit: '',
    what: 'Independent random seed for this aggressor’s pattern.',
    why: 'Two aggressors sharing a seed send identical data and their crosstalk adds in amplitude, which is a worst case that real independent lanes do not usually produce. Different seeds keep them uncorrelated.',
    see: ['prbs', 'crosstalk'],
  },
  ...withPrefix('crosstalk.aggressors.[].pattern', PATTERN_HELP),
  'crosstalk.ssoCount': {
    label: 'Switching outputs',
    unit: '',
    what: 'Number of outputs switching simultaneously through the shared return-path inductance.',
    why: 'Ground bounce is the inductance times the sum of all their dI/dt, so it scales with this count. It is the reason a byte lane behaves differently from a single net on a bench fixture.',
    see: ['ssn', 'return-path', 'pdn'],
  },
  'crosstalk.ssoLoopInductance': {
    label: 'Return inductance',
    unit: 'H',
    what: 'Effective loop inductance shared by the switching group, from package pins, vias and any detour the return current has to take.',
    why: 'This is the term a layout fix actually changes: more return vias, an unbroken reference plane, shorter package return path.',
    see: ['ssn', 'return-path'],
    illustrative: true,
  },

  /* ---------------------------------------------------------- equalizer */
  'eq.ffeEnabled': {
    label: 'FFE',
    unit: '',
    what: 'Enables the feed-forward equalizer, a symbol-spaced FIR filter on the transmitted or received stream.',
    why: 'The only equalizer here that can cancel pre-cursor ISI, because it is the only one that sees a symbol before deciding it.',
    see: ['ffe', 'cursor-taps', 'equalization'],
  },
  'eq.ffeTaps': {
    label: 'FFE taps',
    unit: '1',
    what: 'Dimensionless tap weights, main cursor included, applied at unit-interval spacing.',
    why: 'Set them to the negated cursor taps of the single-bit response and the ISI cancels. A transmitter FFE cannot add energy, so the cost of cancellation is attenuation of everything else.',
    see: ['ffe', 'cursor-taps', 'pulse-response', 'isi'],
  },
  'eq.ffeCursor': {
    label: 'Main cursor index',
    unit: '',
    what: 'Which tap is the main cursor. Taps before it act on pre-cursor ISI, taps after it on post-cursor ISI.',
    why: 'Moving the main cursor changes the filter’s latency and which side of the pulse it can correct. Getting it wrong turns a correction into an inversion.',
    see: ['ffe', 'cursor-taps'],
  },
  'eq.ctleEnabled': {
    label: 'CTLE',
    unit: '',
    what: 'Enables the continuous-time linear equalizer, an analogue zero-pole-pole network that boosts high frequency relative to low.',
    why: 'It compensates the channel’s roll-off cheaply and continuously, and it amplifies noise and crosstalk while doing so. That trade is the whole design question.',
    see: ['ctle', 'equalization', 'insertion-loss'],
  },
  'eq.ctleDcGainDb': {
    label: 'DC gain',
    unit: 'dB',
    what: 'Gain at low frequency, normally negative: the CTLE attenuates the low end rather than amplifying the high end.',
    why: 'Attenuating low frequency is how a passive or gain-limited stage achieves peaking without needing headroom it does not have.',
    see: ['ctle', 'equalization'],
  },
  'eq.ctlePeakGainDb': {
    label: 'Peak gain',
    unit: 'dB',
    what: 'Gain at the peaking frequency, relative to the DC gain. Their difference is the boost.',
    why: 'Match the boost to the channel loss at Nyquist and the eye reopens. Exceed it and the edges overshoot while the noise floor rises with them.',
    see: ['ctle', 'insertion-loss', 'nyquist-frequency'],
  },
  'eq.ctlePole1': {
    label: 'Pole 1',
    unit: 'Hz',
    what: 'First pole of the CTLE response, which ends the boost region.',
    why: 'Placing it near the Nyquist frequency puts the peak where the data fundamental sits. Too low and the boost is wasted below the band; too high and it amplifies noise above it.',
    see: ['ctle', 'nyquist-frequency'],
  },
  'eq.ctlePole2': {
    label: 'Pole 2',
    unit: 'Hz',
    what: 'Second pole, which sets the roll-off above the peak.',
    why: 'It limits how far the boost extends into frequencies that carry no signal, only noise and crosstalk.',
    see: ['ctle', 'crosstalk', 'noise'],
  },
  'eq.dfeEnabled': {
    label: 'DFE',
    unit: '',
    what: 'Enables the decision feedback equalizer, which subtracts the post-cursor ISI of already-decided symbols.',
    why: 'It cancels ISI without amplifying noise, which no linear equalizer can do. Its price is error propagation: one wrong decision corrupts the next several.',
    see: ['dfe', 'cursor-taps', 'slicer'],
  },
  'eq.dfeTaps': {
    label: 'DFE taps',
    unit: '1',
    what: 'Feedback weights, first post-cursor first, normalised to the main cursor.',
    why: 'Each tap should equal the corresponding post-cursor sample of the single-bit response. A DFE cannot touch pre-cursor ISI at all, because those symbols have not been decided yet.',
    see: ['dfe', 'cursor-taps', 'pulse-response'],
  },
  'eq.threshold': {
    label: 'Slicer threshold',
    unit: 'V',
    what: 'Decision level the equalized signal is compared against at the sampling instant.',
    why: 'Offsetting it trades margin on one rail against the other. When the two rails are asymmetric - from level-dependent loss or from a DC offset - the optimum is not zero.',
    see: ['threshold', 'slicer', 'eye-height'],
  },
  'eq.hysteresis': {
    label: 'Hysteresis',
    unit: 'V',
    what: 'Difference between the rising and falling decision thresholds.',
    why: 'It suppresses multiple transitions on a noisy slow edge, and it adds duty-cycle distortion in exchange, because rising and falling edges now cross at different levels.',
    see: ['hysteresis', 'dcd', 'slicer'],
  },

  /* ----------------------------------------------------------------- cdr */
  'cdr.enabled': {
    label: 'CDR',
    unit: '',
    what: 'Recovers the sampling clock from the data transitions instead of using an ideal reference.',
    why: 'With a CDR, low-frequency jitter is tracked and effectively disappears. A jitter number measured with and without one differs by however much energy sits below the loop bandwidth.',
    see: ['cdr', 'jitter', 'golden-pll'],
  },
  'cdr.type': {
    label: 'Loop order',
    unit: '',
    what: 'Ideal clock, a first-order loop with a single corner, or a second-order loop with a damping factor and possible peaking.',
    why: 'A second-order loop can track a frequency offset as well as a phase offset, which a first-order loop cannot. It can also peak, amplifying jitter near its corner.',
    see: ['cdr', 'jitter-transfer', 'damping-factor'],
  },
  'cdr.loopBandwidth': {
    label: 'Loop bandwidth',
    unit: 'Hz',
    what: 'Corner frequency of the clock recovery loop. Jitter below it is tracked; jitter above it must be tolerated by the eye.',
    why: 'This single number decides which jitter counts. Raising it hides more low-frequency jitter and makes the loop itself noisier.',
    see: ['cdr', 'jitter-transfer', 'periodic-jitter'],
    illustrative: true,
  },
  'cdr.damping': {
    label: 'Damping',
    unit: '1',
    what: 'Damping factor of the second-order loop. Below about 0.7 the jitter transfer peaks before rolling off.',
    why: 'Peaking means the loop amplifies jitter at some frequencies rather than tracking it, which in a repeater chain accumulates stage by stage.',
    see: ['damping-factor', 'jitter-transfer', 'cdr'],
  },
  'cdr.observedJitterBw': {
    label: 'Observation bandwidth',
    unit: 'Hz',
    what: 'Bandwidth of the reference clock recovery used when measuring jitter, independent of the receiver’s own loop.',
    why: 'Jitter numbers are only comparable when measured through the same observation bandwidth. Two instruments disagreeing about jitter are usually disagreeing about this.',
    see: ['golden-pll', 'cdr', 'jitter'],
  },

  /* ------------------------------------------------------------ sampling */
  'sampling.samplesPerUi': {
    label: 'Samples per UI',
    unit: '',
    what: 'Simulation oversampling: time steps per unit interval. Powers of two are cheapest because the FFT likes them.',
    why: 'Too few and edges are quantised in time, which shows up as fake jitter and a stepped eye. Raise it until the measured jitter stops changing.',
    bench:
      'The direct analogue of scope sample rate, and it fails the same way: too few samples per edge and the reconstruction, not the signal, sets what you see.',
    see: ['sample-rate', 'interpolation', 'aliasing'],
  },
  'sampling.strobePhase': {
    label: 'Strobe position',
    unit: 'UI',
    what: 'Where in the unit interval the receiver samples, as a fraction from 0 to 1.',
    why: 'Sweeping it traces the bathtub curve. The best position is the centre of the widest passing region, not the point of maximum eye height - on a clean eye those are a plateau and an arbitrary point within it.',
    bench: 'This is what read training sweeps and centres on a memory bus.',
    see: ['sampling-point', 'bathtub-curve', 'memory-training', 'shmoo'],
  },
  'sampling.threshold': {
    label: 'Decision threshold',
    unit: 'V',
    what: 'Voltage the receiver compares against at the sampling instant.',
    why: 'The vertical axis of a shmoo, and the direct measurement of voltage margin. Sweep it against strobe position for the two-dimensional operating window.',
    bench: 'On DDR this is the internal reference voltage, and it is a trained, register-programmed setting.',
    see: ['threshold', 'shmoo', 'memory-training', 'eye-height'],
  },
  'sampling.setupTime': {
    label: 'Setup time',
    unit: 's',
    what: 'How long the data must already be stable before the sampling edge for the latch to resolve.',
    why: 'An open eye is not sufficient. The eye must be wider than setup plus hold, and it is that sum, not the raw eye width, that the margin is measured against.',
    see: ['setup-time', 'eye-width', 'sampling-point'],
    illustrative: true,
  },
  'sampling.holdTime': {
    label: 'Hold time',
    unit: 's',
    what: 'How long the data must remain stable after the sampling edge.',
    why: 'Hold violations come from a signal arriving too early, which makes them the failure that gets worse when you speed a path up. They are also the ones a slow-corner-only analysis misses.',
    see: ['setup-time', 'skew', 'sampling-point'],
    illustrative: true,
  },
  'sampling.sensitivity': {
    label: 'Latch sensitivity',
    unit: 'V',
    what: 'Minimum voltage difference from the threshold that the latch needs to resolve within the cycle.',
    why: 'Below it the latch goes metastable rather than simply deciding wrongly, and a metastable output is worse than an error because it can propagate as an invalid level.',
    see: ['slicer', 'threshold', 'eye-height'],
    illustrative: true,
  },

  /* ------------------------------------------------------------ analysis */
  'analysis.engine': {
    label: 'Engine',
    unit: '',
    what: 'Monte-Carlo simulates individual bits and counts errors. Statistical convolves probability densities and reaches any BER instantly. "Both" runs the two and shows where they disagree.',
    why: 'Monte-Carlo is honest but cannot reach 1e-12 in a browser - that is a trillion bits. Statistical reaches it immediately but assumes the impairment model is complete. Their disagreement is the interesting number.',
    see: ['ber', 'bathtub-curve', 'dual-dirac'],
  },
  'analysis.bits': {
    label: 'Bits simulated',
    unit: '',
    what: 'Number of symbols the Monte-Carlo engine transmits.',
    why: 'The lowest BER you can observe is about one over this. Twenty thousand bits cannot see 1e-6, so any smaller number on the screen came from extrapolation, not from counting.',
    see: ['ber', 'random-jitter', 'bathtub-curve'],
  },
  'analysis.targetBer': {
    label: 'Target BER',
    unit: '1',
    what: 'The bit error ratio at which eye opening, timing margin and total jitter are reported.',
    why: 'Every margin number depends on it. Eye height at 1e-6 and at 1e-12 are different measurements of the same eye, and quoting one without the other is meaningless.',
    see: ['ber', 'total-jitter', 'eye-height', 'bathtub-curve'],
  },
  'analysis.eyeWidth': {
    label: 'Eye bins (horizontal)',
    unit: '',
    what: 'Horizontal resolution of the eye histogram, in bins across the displayed window.',
    why: 'It sets the timing resolution of every measurement read off the eye. Finer bins need more bits to fill them before the density is meaningful.',
    see: ['eye-diagram', 'colour-grading'],
  },
  'analysis.eyeHeight': {
    label: 'Eye bins (vertical)',
    unit: '',
    what: 'Vertical resolution of the eye histogram, in bins across the voltage window.',
    why: 'It quantises every voltage read off the eye, so an eye height is only accurate to about one bin. It is also why the best sampling point on a clean eye is a plateau rather than a point.',
    see: ['eye-diagram', 'eye-height'],
  },
  'analysis.eyeUis': {
    label: 'Eye span',
    unit: 'UI',
    what: 'How many unit intervals wide the fold window is, normally one or two.',
    why: 'Two UI shows both crossings and the transition into and out of the eye. One UI shows only the opening. A pattern whose period equals the window produces no overlay at all - the most common way an eye lies.',
    see: ['eye-diagram', 'unit-interval', 'pattern'],
  },
  'analysis.persistence': {
    label: 'Persistence',
    unit: '1',
    what: 'Decay applied to accumulated hits each update. Zero is infinite persistence, which keeps every acquisition.',
    why: 'Infinite persistence is how rare outliers become visible, and the outer skirts are what set the BER. A decay shows recent behaviour and hides exactly the events that matter.',
    bench:
      'The scope control of the same name, and the reason a five-minute infinite-persistence run finds intermittents that a single acquisition never will.',
    see: ['persistence', 'colour-grading', 'eye-diagram'],
  },

  /* --------------------------------------------------------------- scope */
  'scope.enabled': {
    label: 'Scope model',
    unit: '',
    what: 'Passes the signal through a model of the measuring instrument before it is displayed.',
    why: 'Half of what looks like a signal integrity problem is a measurement problem. Toggling this separates what the receiver sees from what you would see on a bench.',
    see: ['bandwidth', 'probe-loading', 'sample-rate'],
  },
  'scope.bandwidth': {
    label: 'Scope bandwidth',
    unit: 'Hz',
    what: 'Analogue -3 dB bandwidth of the scope channel.',
    why: 'A scope too slow for the edge reports a rise time that is mostly its own. Measured rise time is the root-sum-square of signal, probe and scope, so subtract the instrument in quadrature.',
    bench:
      'A useful floor is about three times the knee frequency of the edge you are measuring, at which point the instrument contributes a few percent rather than dominating.',
    see: ['bandwidth', 'rise-time', 'knee-frequency'],
    illustrative: true,
  },
  'scope.responseShape': {
    label: 'Response shape',
    unit: '',
    what: 'The front-end roll-off: Gaussian, Bessel-Thomson, brickwall or Butterworth.',
    why: 'The shape decides whether the instrument adds overshoot. A brickwall front end rings on a clean edge; a Bessel one does not, which is why fast real-time scopes use it.',
    see: ['bessel-response', 'brickwall-filter', 'gibbs-phenomenon'],
  },
  'scope.sampleRate': {
    label: 'Sample rate',
    unit: 'Sa/s',
    what: 'Samples per second the digitiser takes, which sets how finely an edge is captured in time.',
    why: 'Below twice the content that survives the front end, energy aliases to a lower frequency and looks like a real signal. The practical guidance of 2.5 to 4 times the bandwidth is about edge reconstruction, not just Nyquist.',
    bench:
      'If a feature moves when you change the sample rate, it is an alias. That single test settles the question.',
    see: ['sample-rate', 'aliasing', 'nyquist-frequency'],
  },
  'scope.adcBits': {
    label: 'ADC bits',
    unit: 'bit',
    what: 'Vertical resolution of the digitiser. The quantisation step is the full-scale range divided by two to this power.',
    why: 'Quantisation adds noise of one LSB over the square root of twelve, which sets a floor on any noise or jitter measurement. Eight bits is standard; high-resolution modes trade bandwidth for more.',
    see: ['adc-resolution', 'vertical-range', 'noise'],
  },
  'scope.verticalRange': {
    label: 'Vertical range',
    unit: 'V',
    what: 'Full-scale voltage the acquisition spans, normally volts per division times the number of divisions.',
    why: 'With the ADC bits it sets the quantisation step. Too large wastes resolution; too small clips, and clipping destroys the measurement rather than degrading it.',
    bench:
      'Fill about 80% of the screen. A 12-bit acquisition at a tenth of full scale has less usable resolution than a well-scaled 8-bit one.',
    see: ['vertical-range', 'adc-resolution'],
  },
  'scope.noiseRms': {
    label: 'Scope noise',
    unit: 'V',
    what: 'Input-referred noise of the instrument, quoted as an RMS value.',
    why: 'It adds in quadrature with the signal’s own noise, so the reported figure is always larger than the truth. Measure the floor with the input terminated and subtract it.',
    see: ['noise', 'adc-resolution', 'q-factor'],
    illustrative: true,
  },
  'scope.probeC': {
    label: 'Probe capacitance',
    unit: 'F',
    what: 'Capacitance the probe tip adds to the circuit.',
    why: 'A fraction of a picofarad is enough to slow a fast edge measurably, and the probe is then part of the circuit rather than an observer of it.',
    bench:
      'If the waveform changes when you move the probe, you are measuring the probe. A solder-in tip with a short ground is the usual fix.',
    see: ['probe-loading', 'rise-time', 'rlc'],
    illustrative: true,
  },
  'scope.probeR': {
    label: 'Probe resistance',
    unit: 'ohm',
    what: 'Resistive loading of the probe tip, which dominates at low frequency.',
    why: 'A low-impedance probe loads a high-impedance node and shifts its DC level, changing the very threshold crossing you are trying to measure.',
    see: ['probe-loading', 'termination'],
  },
  'scope.interpolation': {
    label: 'Interpolation',
    unit: '',
    what: 'How the display reconstructs between samples: none, linear, or sin(x)/x.',
    why: 'Linear understates peaks and overstates rise time. Sin(x)/x is correct for a genuinely band-limited signal and invents overshoot when the signal is not. Both can lie, in opposite directions.',
    see: ['interpolation', 'sample-rate', 'aliasing'],
  },
  'scope.averages': {
    label: 'Averages',
    unit: '',
    what: 'Number of acquisitions averaged together. One disables averaging.',
    why: 'Averaging reduces uncorrelated noise by the square root of the count and removes random jitter entirely, leaving deterministic effects behind. That makes it excellent for seeing a small reflection and useless for measuring jitter.',
    bench:
      'Averaging needs a stable trigger on a repetitive signal. On random data it averages towards the mean level and destroys the waveform.',
    see: ['averaging', 'noise', 'random-jitter', 'trigger'],
  },
  'scope.fftWindow': {
    label: 'FFT window',
    unit: '',
    what: 'Taper applied to the record before the scope’s math FFT, trading main-lobe width against side-lobe height.',
    why: 'Flat-top gives accurate amplitude for a tone. Blackman-Harris gives the lowest side lobes, so a small tone is visible beside a big one. Rectangular gives the narrowest main lobe and the worst leakage.',
    see: ['window-function', 'spectral-leakage', 'dft'],
  },

  /* ---------------------------------------------------------------- view */
  'view.spanUi': {
    label: 'Time span',
    unit: 'UI',
    what: 'Width of the displayed window in unit intervals. The equivalent of a scope timebase, expressed in UI so it stays meaningful across data rates.',
    why: 'A few UI to see edge shape, hundreds to see a pattern-dependent effect build and decay. The per-division readout beside the plot gives the equivalent time.',
    bench:
      'Scope timebase, in seconds per division. Expressing it in UI is what makes two different data rates comparable at a glance.',
    see: ['unit-interval', 'symbol-rate'],
  },
  'view.offsetUi': {
    label: 'Time offset',
    unit: 'UI',
    what: 'Left edge of the displayed window, measured in unit intervals from the start of the record.',
    why: 'Panning to a specific bit index is how you get back to the one interesting event in a long record, and it is carried in the permalink so someone else lands on the same bit.',
    bench: 'Horizontal position, and the reason a scope has a trigger delay control at all.',
    see: ['trigger', 'unit-interval'],
  },
  'view.showGrid': {
    label: 'Graticule',
    unit: '',
    what: 'Draws the ten-by-eight division graticule behind the trace.',
    why: 'The graticule is fixed to the screen while the signal moves through it, which is what makes reading a value off it possible at all.',
    see: ['persistence'],
  },
  'view.showIdeal': {
    label: 'Show transmitted',
    unit: '',
    what: 'Overlays the ideal transmitted waveform, before any channel or impairment.',
    why: 'The reference the whole course is measured against. The difference between this trace and the measured one is the entire subject.',
    see: ['pattern', 'isi'],
  },
  'view.showMeasured': {
    label: 'Show received',
    unit: '',
    what: 'Draws the waveform as it arrives at the receiver, after channel, impairments and any scope model.',
    why: 'This is the trace that corresponds to what a probe at the receiver would show.',
    see: ['isi', 'probe-loading'],
  },
  'view.showEqualized': {
    label: 'Show equalized',
    unit: '',
    what: 'Draws the waveform after the receiver’s equalization, which is the signal the slicer actually decides on.',
    why: 'The received trace can look closed while the equalized one is open. The slicer sees only this one, so it is the trace that decides the BER.',
    see: ['equalization', 'slicer', 'dfe', 'ctle'],
  },
  'view.cursorsT': {
    label: 'Time cursors',
    unit: 's',
    what: 'Positions of the vertical cursors. The readout gives each position, their difference, and the reciprocal of that difference as a frequency.',
    why: 'The reciprocal is the second measurement a bench engineer always wants: how far apart are these edges, and so what frequency is that.',
    bench: 'Exactly the scope cursor readout, including the 1/dX line.',
    see: ['unit-interval', 'rise-time'],
  },
  'view.cursorsV': {
    label: 'Voltage cursors',
    unit: 'V',
    what: 'Positions of the horizontal cursors, with a readout of each position and their difference.',
    why: 'Measuring an overshoot, a reflection amplitude or an eye height by hand, and checking an automatic readout that you do not yet trust.',
    see: ['eye-height', 'ringing', 'threshold'],
  },
};

/* -------------------------------------------------------------- accessors */

/** Help for a Scenario path, array indices and all. */
export function helpFor(path: string): ControlHelp | undefined {
  return CONTROL_HELP[canonicalPath(path)];
}

/** Every glossary id referenced by any control, deduplicated. */
export function referencedTerms(): string[] {
  const out = new Set<string>();
  for (const h of Object.values(CONTROL_HELP)) for (const t of h.see ?? []) out.add(t);
  return [...out].sort();
}

/**
 * Controls whose default value is a stand-in rather than a specification figure.
 * The panel badges these, and the about page lists them.
 */
export function illustrativeControls(): string[] {
  return Object.entries(CONTROL_HELP)
    .filter(([, h]) => h.illustrative === true)
    .map(([path]) => path)
    .sort();
}

/** Dangling cross-references, for the test and for a content lint script. */
export function danglingTermRefs(): string[] {
  return referencedTerms().filter((t) => !hasTerm(t));
}
