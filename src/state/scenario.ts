/**
 * The Scenario: the complete, serialisable description of what the reader is
 * looking at.
 *
 * Everything a module renders is a pure function of a Scenario. Nothing that
 * affects a plot is allowed to live in component state. That constraint is what
 * makes three things possible at once:
 *
 *   - a permalink that reproduces someone else's screen exactly,
 *   - a worker job that can be described by a plain message and cancelled,
 *   - a regression test that pins a numerical result to a fixed input.
 *
 * Units are SI throughout and stated on every field. Seconds, hertz, volts, ohms,
 * metres, farads, henries. The UI converts for display; nothing else does.
 *
 * Illustrative values: default numbers here are chosen to be representative of
 * the class of interface under discussion. They are NOT quoted from any JEDEC or
 * other standard, and the UI labels them as illustrative wherever they appear.
 */

import { z } from 'zod';

export const SCENARIO_VERSION = 1;

/* ------------------------------------------------------------------ patterns */

export const prbsOrderSchema = z.enum([
  'prbs7',
  'prbs9',
  'prbs11',
  'prbs13',
  'prbs15',
  'prbs20',
  'prbs23',
  'prbs31',
]);

export const patternKindSchema = z.enum([
  'prbs',
  'clock',
  'clock-div-n',
  'lone-one',
  'lone-zero',
  'walking-one',
  'walking-zero',
  'all-ones',
  'all-zeros',
  'burst-idle',
  'custom',
  'worst-case-isi',
]);

export const patternSchema = z.object({
  kind: patternKindSchema.default('prbs'),
  prbs: prbsOrderSchema.default('prbs13'),
  /** LFSR seed. 0 is remapped to all-ones by the generator. */
  seed: z.number().int().nonnegative().default(1),
  /** Divider for clock-div-n: n ones then n zeros. */
  divN: z.number().int().min(1).max(64).default(2),
  /** Frame length for lone-one / lone-zero / walking patterns, in bits. */
  frame: z.number().int().min(2).max(4096).default(16),
  /** Burst length for burst-idle, in bits. The idle gap is the same length. */
  burst: z.number().int().min(1).max(4096).default(8),
  /** Literal bit string for kind 'custom'. Non 0/1 characters are ignored. */
  custom: z.string().max(4096).default('11010010'),
  invert: z.boolean().default(false),
});
export type PatternState = z.infer<typeof patternSchema>;

/* -------------------------------------------------------------------- source */

export const edgeShapeSchema = z.enum(['linear', 'rc', 'gaussian', 'bessel', 'brickwall']);

export const sourceSchema = z.object({
  pattern: patternSchema.default({}),
  /** Symbols per second. 6.4e9 is one lane rate of an illustrative DDR5-class link. */
  symbolRate: z.number().positive().max(1e12).default(6.4e9),
  /** Modulation. PAM4 is introduced in M11; everything before it is NRZ. */
  levels: z.enum(['nrz', 'pam4']).default('nrz'),
  /** Single-ended swing, volts peak-to-peak at the driver. */
  amplitude: z.number().positive().max(10).default(0.5),
  /** Common-mode / DC offset in volts. */
  dcOffset: z.number().min(-5).max(5).default(0),
  /** 20-80% transition time at the driver, seconds. */
  riseTime: z.number().positive().max(1e-6).default(25e-12),
  /** Fall time, seconds. Unequal rise and fall is a source of duty-cycle distortion. */
  fallTime: z.number().positive().max(1e-6).default(25e-12),
  edgeShape: edgeShapeSchema.default('gaussian'),
  /** Driver output impedance, ohms. */
  sourceZ: z.number().positive().max(1000).default(40),
});
export type SourceState = z.infer<typeof sourceSchema>;

/* ------------------------------------------------------------------- channel */

export const channelKindSchema = z.enum(['ideal', 'rc', 'rlc', 'tline', 'lossy', 'touchstone']);

export const rcChannelSchema = z.object({
  /** -3 dB bandwidth, Hz. */
  bw: z.number().positive().max(1e12).default(8e9),
});

export const rlcChannelSchema = z.object({
  /** Series resistance, ohms. */
  r: z.number().nonnegative().max(1e4).default(20),
  /** Series inductance, henries. A package pin is of order 1 nH. */
  l: z.number().positive().max(1).default(2e-9),
  /** Shunt capacitance, farads. A receiver pad is of order 0.5 pF. */
  c: z.number().positive().max(1).default(1e-12),
});

export const tlineChannelSchema = z.object({
  /** Characteristic impedance, ohms. */
  z0: z.number().positive().max(1000).default(50),
  /** Physical length, metres. */
  length: z.number().positive().max(100).default(0.15),
  /** Propagation velocity as a fraction of c. ~0.5 for stripline in FR-4. */
  velocityFactor: z.number().positive().max(1).default(0.5),
  /** Far-end termination, ohms. Use a large value for an unterminated stub. */
  loadZ: z.number().positive().max(1e9).default(1e6),
  /** Shunt load capacitance at the far end, farads. */
  loadC: z.number().nonnegative().max(1).default(0),
  /** Number of reflection round trips to include in the bounce diagram. */
  bounces: z.number().int().min(1).max(64).default(12),
});

export const lossyChannelSchema = z.object({
  z0: z.number().positive().max(1000).default(50),
  length: z.number().positive().max(100).default(0.3),
  /** Relative permittivity of the dielectric. ~4.3 for FR-4, ~3.0 for a low-loss laminate. */
  er: z.number().min(1).max(20).default(4.0),
  /** Loss tangent at the reference frequency below. */
  lossTangent: z.number().nonnegative().max(0.2).default(0.02),
  /** Frequency at which er and lossTangent are stated, Hz. */
  referenceFreq: z.number().positive().max(1e12).default(1e9),
  /** DC series resistance per metre, ohms/m. */
  dcResistance: z.number().nonnegative().max(1e5).default(8),
  /** Conductor conductivity, S/m. Copper is 5.8e7. */
  conductivity: z.number().positive().max(1e9).default(5.8e7),
  /** Trace width, metres. Sets the skin-effect surface area. */
  traceWidth: z.number().positive().max(0.1).default(100e-6),
  /** Copper RMS surface roughness, metres. VLP foil ~0.5 um, standard ~2 um. */
  roughnessRms: z.number().nonnegative().max(1e-4).default(0.5e-6),
  /** Include the Hammerstad roughness correction. */
  roughnessEnabled: z.boolean().default(true),
  /** Number of cascaded via discontinuities along the path. */
  viaCount: z.number().int().min(0).max(16).default(2),
  /** Shunt capacitance of one via stub, farads. */
  viaC: z.number().nonnegative().max(1e-9).default(0.25e-12),
});

export const touchstoneChannelSchema = z.object({
  /** File name, for display. The data itself is far too large for a URL. */
  name: z.string().max(256).default(''),
  /** Port count of the loaded file. Zero means nothing has been loaded yet. */
  ports: z.number().int().min(0).max(12).default(0),
  /** 1-based port index driven by the transmitter. */
  txPort: z.number().int().min(1).max(12).default(1),
  /** 1-based port index observed by the receiver. */
  rxPort: z.number().int().min(1).max(12).default(2),
  /** Reference impedance to renormalise to, ohms. */
  renormalizeTo: z.number().positive().max(1000).default(50),
  /** Treat port pairs as differential and use mixed-mode Sdd21. */
  mixedMode: z.boolean().default(false),
});

export const channelSchema = z.object({
  kind: channelKindSchema.default('lossy'),
  rc: rcChannelSchema.default({}),
  rlc: rlcChannelSchema.default({}),
  tline: tlineChannelSchema.default({}),
  lossy: lossyChannelSchema.default({}),
  touchstone: touchstoneChannelSchema.default({}),
  /** Receiver termination, ohms. */
  terminationZ: z.number().positive().max(1e9).default(50),
  /** Receiver input capacitance, farads. */
  terminationC: z.number().nonnegative().max(1e-9).default(0.3e-12),
});
export type ChannelState = z.infer<typeof channelSchema>;

/* --------------------------------------------------------------- impairments */

export const impairmentsSchema = z.object({
  /** Master seed. Every impairment draws from a labelled sub-stream of this. */
  seed: z.number().int().nonnegative().max(0xffffffff).default(12345),

  /** Additive Gaussian voltage noise at the receiver, volts RMS. */
  noiseRms: z.number().nonnegative().max(1).default(3e-3),
  /** 1/f corner of the voltage noise, Hz. Zero gives flat (white) noise. */
  noiseFlickerCorner: z.number().nonnegative().max(1e12).default(0),

  /** Random jitter, seconds RMS, applied to every edge independently. */
  randomJitterRms: z.number().nonnegative().max(1e-6).default(0.6e-12),
  /** Bounded uncorrelated jitter, seconds peak-to-peak, uniformly distributed. */
  boundedJitterPp: z.number().nonnegative().max(1e-6).default(0),
  /** Periodic jitter amplitude, seconds peak (sinusoidal). */
  periodicJitterAmp: z.number().nonnegative().max(1e-6).default(0),
  /** Periodic jitter frequency, Hz. */
  periodicJitterFreq: z.number().nonnegative().max(1e12).default(100e6),
  /** Duty-cycle distortion, as a fraction of a UI. Rising and falling edges split. */
  dcdFraction: z.number().min(-0.4).max(0.4).default(0),

  /** Supply droop as a fraction of the nominal swing, for the PDN model in M6. */
  supplyDroop: z.number().nonnegative().max(0.5).default(0),
});
export type ImpairmentsState = z.infer<typeof impairmentsSchema>;

/* ----------------------------------------------------------------- crosstalk */

export const aggressorSchema = z.object({
  enabled: z.boolean().default(true),
  /** 'near' = NEXT (reverse-coupled), 'far' = FEXT (forward-coupled). */
  end: z.enum(['near', 'far']).default('far'),
  /** Backward (near-end) coupling coefficient Kb, dimensionless. */
  kb: z.number().min(0).max(0.5).default(0.03),
  /** Forward (far-end) coupling coefficient Kf, seconds per metre. */
  kf: z.number().min(0).max(1e-6).default(2e-12),
  /** Coupled length, metres. */
  coupledLength: z.number().positive().max(10).default(0.05),
  /** Timing skew of the aggressor relative to the victim, seconds. */
  skew: z.number().min(-1e-6).max(1e-6).default(0),
  /** Independent pattern seed, so aggressors are uncorrelated with the victim. */
  seed: z.number().int().nonnegative().max(0xffffffff).default(777),
  pattern: patternSchema.default({}),
});
export type AggressorState = z.infer<typeof aggressorSchema>;

export const crosstalkSchema = z.object({
  enabled: z.boolean().default(false),
  aggressors: z.array(aggressorSchema).max(8).default([]),
  /** Simultaneous switching outputs contributing to ground bounce. */
  ssoCount: z.number().int().min(0).max(64).default(0),
  /** Effective return-path inductance seen by the SSO group, henries. */
  ssoLoopInductance: z.number().nonnegative().max(1e-6).default(0.5e-9),
});
export type CrosstalkState = z.infer<typeof crosstalkSchema>;

/* ---------------------------------------------------------------- equalizer */

export const equalizerSchema = z.object({
  ffeEnabled: z.boolean().default(false),
  /** FFE tap weights, main cursor included. */
  ffeTaps: z.array(z.number().min(-2).max(2)).max(16).default([-0.1, 1, -0.2]),
  /** Index of the main cursor within ffeTaps. */
  ffeCursor: z.number().int().min(0).max(15).default(1),

  ctleEnabled: z.boolean().default(false),
  /** DC gain, dB (normally negative: the CTLE attenuates low frequency). */
  ctleDcGainDb: z.number().min(-30).max(10).default(-6),
  /** Peak gain, dB, relative to the DC gain. */
  ctlePeakGainDb: z.number().min(0).max(30).default(6),
  /** First pole, Hz. */
  ctlePole1: z.number().positive().max(1e12).default(3.2e9),
  /** Second pole, Hz. */
  ctlePole2: z.number().positive().max(1e12).default(6.4e9),

  dfeEnabled: z.boolean().default(false),
  /** DFE feedback taps, first post-cursor first. */
  dfeTaps: z.array(z.number().min(-1).max(1)).max(16).default([0.2, 0.05]),

  /** Slicer decision threshold, volts. */
  threshold: z.number().min(-5).max(5).default(0),
  /** Slicer hysteresis, volts. */
  hysteresis: z.number().nonnegative().max(1).default(0),
});
export type EqualizerState = z.infer<typeof equalizerSchema>;

/* ---------------------------------------------------------------------- CDR */

export const cdrSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.enum(['ideal', 'first-order', 'second-order']).default('second-order'),
  /** Loop bandwidth, Hz. Jitter below this is tracked; above it is not. */
  loopBandwidth: z.number().positive().max(1e12).default(10e6),
  /** Damping factor of a second-order loop. */
  damping: z.number().positive().max(10).default(0.707),
  /** Golden-PLL observation bandwidth for jitter measurement, Hz. */
  observedJitterBw: z.number().positive().max(1e12).default(10e6),
});
export type CdrState = z.infer<typeof cdrSchema>;

/* ----------------------------------------------------------------- sampling */

export const samplingSchema = z.object({
  /** Simulation oversampling, samples per unit interval. Powers of 2 are cheapest. */
  samplesPerUi: z.number().int().min(4).max(512).default(64),
  /** Receiver strobe position within the UI, 0 to 1. */
  strobePhase: z.number().min(0).max(1).default(0.5),
  /** Receiver decision threshold, volts. */
  threshold: z.number().min(-5).max(5).default(0),
  /** Setup requirement of the receiver latch, seconds. */
  setupTime: z.number().nonnegative().max(1e-6).default(15e-12),
  /** Hold requirement of the receiver latch, seconds. */
  holdTime: z.number().nonnegative().max(1e-6).default(15e-12),
  /** Minimum voltage the latch needs to resolve, volts. */
  sensitivity: z.number().nonnegative().max(1).default(20e-3),
});
export type SamplingState = z.infer<typeof samplingSchema>;

/* ----------------------------------------------------------------- analysis */

export const analysisSchema = z.object({
  /**
   * Which engine produces the eye and the bathtub.
   *   'monte-carlo' simulates bits and counts errors: honest, but it cannot reach
   *      1e-12 in a browser (that is a trillion bits).
   *   'statistical' convolves probability densities: reaches any BER instantly,
   *      but assumes the impairment model is complete.
   * The site shows both and makes their disagreement the teaching point.
   */
  engine: z.enum(['monte-carlo', 'statistical', 'both']).default('both'),
  /** Bits to simulate in the Monte-Carlo engine. */
  bits: z.number().int().min(100).max(10_000_000).default(20000),
  /** Target BER for the bathtub and eye-mask readouts. */
  targetBer: z.number().positive().max(0.5).default(1e-12),
  /** Eye histogram resolution, pixels. */
  eyeWidth: z.number().int().min(64).max(2048).default(512),
  eyeHeight: z.number().int().min(64).max(2048).default(384),
  /** UIs of eye to display, normally 1 or 2. */
  eyeUis: z.number().min(0.5).max(4).default(2),
  /** Persistence decay for the eye display, 0 = infinite persistence. */
  persistence: z.number().min(0).max(1).default(0),
});
export type AnalysisState = z.infer<typeof analysisSchema>;

/* ---------------------------------------------------- oscilloscope front end */

/**
 * The instrument, modelled explicitly, because half of what looks like a signal
 * integrity problem is a measurement problem. Everything the reader sees in M10
 * passes through this block.
 */
export const scopeSchema = z.object({
  enabled: z.boolean().default(false),
  /** Analogue bandwidth of the scope channel, Hz. */
  bandwidth: z.number().positive().max(1e12).default(16e9),
  /** Response shape of the front end. Real scopes are one or the other. */
  responseShape: z.enum(['gaussian', 'bessel', 'brickwall', 'butterworth']).default('bessel'),
  /** Sample rate, samples per second. */
  sampleRate: z.number().positive().max(1e13).default(50e9),
  /** Vertical resolution, bits. 8 is standard; 12 on a high-resolution scope. */
  adcBits: z.number().int().min(6).max(16).default(8),
  /** Full-scale vertical range, volts. Sets the quantisation step with adcBits. */
  verticalRange: z.number().positive().max(100).default(0.8),
  /** Scope input-referred noise, volts RMS. */
  noiseRms: z.number().nonnegative().max(1).default(1.2e-3),
  /** Probe loading capacitance, farads. */
  probeC: z.number().nonnegative().max(1e-9).default(0.5e-12),
  /** Probe loading resistance, ohms. */
  probeR: z.number().positive().max(1e9).default(50e3),
  /** Sample-rate interpolation the scope applies for display. */
  interpolation: z.enum(['none', 'linear', 'sinx']).default('sinx'),
  /** Waveform averaging count. 1 disables averaging. */
  averages: z.number().int().min(1).max(4096).default(1),
  /** FFT window used by the scope's math function. */
  fftWindow: z
    .enum(['rectangular', 'hann', 'hamming', 'blackman', 'blackman-harris', 'flat-top', 'kaiser', 'tukey'])
    .default('hann'),
});
export type ScopeState = z.infer<typeof scopeSchema>;

/* --------------------------------------------------------------------- view */

export const viewSchema = z.object({
  /** Horizontal span shown, in unit intervals. */
  spanUi: z.number().min(1).max(4096).default(16),
  /** Left edge of the window, in unit intervals from the start of the record. */
  offsetUi: z.number().min(0).max(1e7).default(0),
  showGrid: z.boolean().default(true),
  showIdeal: z.boolean().default(true),
  showMeasured: z.boolean().default(true),
  showEqualized: z.boolean().default(false),
  /** Vertical cursor positions in UI, horizontal cursors in volts. Empty = hidden. */
  cursorsT: z.array(z.number()).max(4).default([]),
  cursorsV: z.array(z.number()).max(4).default([]),
});
export type ViewState = z.infer<typeof viewSchema>;

/* ----------------------------------------------------------------- scenario */

export const scenarioSchema = z.object({
  version: z.number().int().default(SCENARIO_VERSION),
  source: sourceSchema.default({}),
  channel: channelSchema.default({}),
  impairments: impairmentsSchema.default({}),
  crosstalk: crosstalkSchema.default({}),
  eq: equalizerSchema.default({}),
  cdr: cdrSchema.default({}),
  sampling: samplingSchema.default({}),
  analysis: analysisSchema.default({}),
  scope: scopeSchema.default({}),
  view: viewSchema.default({}),
});

export type Scenario = z.infer<typeof scenarioSchema>;

/** A fresh Scenario with every default applied. */
export function defaultScenario(): Scenario {
  return scenarioSchema.parse({});
}

/** Parse an arbitrary object into a Scenario, filling every missing field. */
export function parseScenario(input: unknown): Scenario {
  return scenarioSchema.parse(input ?? {});
}

/** Structural clone. Scenarios hold only JSON-representable values by design. */
export function cloneScenario(s: Scenario): Scenario {
  return JSON.parse(JSON.stringify(s)) as Scenario;
}

/** Derived quantity used almost everywhere: the unit interval, in seconds. */
export function unitInterval(s: Scenario): number {
  return 1 / s.source.symbolRate;
}

/** Bits per symbol for the configured modulation. */
export function bitsPerSymbol(s: Scenario): number {
  return s.source.levels === 'pam4' ? 2 : 1;
}

/** Simulation time step, seconds. */
export function timeStep(s: Scenario): number {
  return unitInterval(s) / s.sampling.samplesPerUi;
}

/** Nyquist frequency of the data, Hz: half the symbol rate. */
export function nyquist(s: Scenario): number {
  return s.source.symbolRate / 2;
}
