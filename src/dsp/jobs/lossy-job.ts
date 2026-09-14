/**
 * What a lossy route does to one pulse, and so to every bit stream.
 *
 * The argument of M4 in one computation, in two domains that must agree.
 *
 * In frequency, the job evaluates the Scenario's lossy line as a cascaded network
 * on a log-spaced grid and returns its insertion loss, return loss and group delay,
 * together with the same line with one mechanism at a time: conductor alone,
 * dielectric alone, and the conductor loss with smooth copper, Hammerstad and Huray
 * roughness. Beside the exact curves it returns the closed-form low-loss
 * attenuation, so the figure can show where the rule of thumb holds.
 *
 * In time, it builds the edge-shaped one-UI pulse directly in the frequency domain,
 * multiplies it by S21 on the FFT grid and inverts. Linear, time-invariant
 * superposition then gives everything else exactly: the step response is the
 * running sum of pulses one UI apart, and the received bit stream is the sum of
 * signed pulses, one per bit.
 *
 * Modelling choices a reader needs to know, all stated on screen:
 *
 *   - The line sits between 50 ohm reference ports, so S21 is the ratio of the
 *     far-end wave to the incident wave. `source.amplitude` is the open-circuit
 *     swing, as in M3, here behind the 50 ohm port, so the launched waveform is the
 *     incident wave, half of it: +/- amplitude / 4 (`launchedLevel`). The driver
 *     impedance and receiver termination of the Scenario are not applied here; M3
 *     is where they act.
 *   - The DFT is periodic. A tail longer than the record wraps round and appears
 *     before the arrival; the job measures it and reports it as `precursorLeak`
 *     and `tailResidual` rather than hiding it.
 *   - Roughness is applied in its causal form unless `causalRoughness` is false,
 *     which puts back the real factor so the page can show the precursor it makes.
 *   - Delay is measured the way a scope measures it, between the 50% points of the
 *     launched and received steps, and the received bit stream is shifted back by
 *     it. The main cursor is the received pulse's peak, taken at the middle of its
 *     flat top; on a short line that top is so flat that the peak's position says
 *     nothing about delay, which is why the delay is not read from it.
 *
 * Physics: PHYSICS.md section 13. Implementation: `src/sim/channel/lossy.ts`.
 */

import { irfft, nextPow2 } from '../fft';
import { transferAt, type ResponseSpec } from '../filters';
import { bitsToNrz, generateBits } from '../patterns';
import {
  conductorAttenuation,
  dielectricAttenuation,
  groupDelayAt,
  hammerstadCausalFactor,
  hammerstadFactor,
  hurayCausalFactor,
  hurayFactor,
  insertionLossDb,
  lossTangentAt,
  losslessDelay,
  METRES_PER_INCH,
  NEPER_TO_DB,
  permittivityAt,
  prepareLine,
  roughnessFactor,
  skinDepth,
  sParametersAt,
  type LineModel,
  type LossyLineSpec,
} from '../../sim/channel/lossy';
import { SPEED_OF_LIGHT } from '../../sim/channel/tline';
import { edgeResponseOf, patternSpecOf } from './adapt';
import { buffersOf, type JobDefinition, type JobInput } from './types';

/** Reference impedance of both ports, ohms. An instrument convention, like the TDR's. */
export const LOSSY_REFERENCE_OHMS = 50;

/** Hard ceiling on time-domain samples. */
export const LOSSY_MAX_SAMPLES = 1 << 17;

/** Return loss is reported down to this, dB, where a matched lossless line would be infinite. */
export const RETURN_LOSS_CAP_DB = 80;

/** Cursors reported either side of the main one: this many before, and `POST_CURSORS` after. */
export const PRE_CURSORS = 2;
export const POST_CURSORS = 8;

export interface LossyParams {
  /** Points on the log-spaced frequency grid. */
  freqPoints: number;
  /** Lowest frequency on that grid, Hz. */
  fMin: number;
  /** Highest frequency, in multiples of the Nyquist frequency of the symbol rate. */
  nyquistMultiple: number;
  /** Time-domain samples per UI. */
  samplesPerUi: number;
  /** Record kept after the slowest possible arrival, in UIs, for the pulse tail. */
  tailUis: number;
  /** Bits shown in the before-and-after bit stream. */
  bits: number;
  /** Apply roughness in its causal complex form. False puts back the real factor, which is not causal. */
  causalRoughness: boolean;
}

export interface LossyResult {
  /* ------------------------------------------------------------- frequency */
  /** Log-spaced frequency grid, Hz. */
  freq: Float64Array;
  /** Insertion loss of the line as configured, dB (positive is loss). */
  ilTotal: Float64Array;
  /** Insertion loss with only conductor loss (and its roughness setting), dB. */
  ilConductor: Float64Array;
  /** Insertion loss with only dielectric loss, dB. */
  ilDielectric: Float64Array;
  /** Conductor-only insertion loss with smooth copper, dB. */
  ilSmooth: Float64Array;
  /** Conductor-only insertion loss with Hammerstad roughness, dB. */
  ilHammerstad: Float64Array;
  /** Conductor-only insertion loss with Huray roughness, dB. */
  ilHuray: Float64Array;
  /** Closed-form low-loss insertion loss, (alpha_c + alpha_d) l, dB, for the mechanisms switched on. */
  ilApprox: Float64Array;
  /** Return loss of the line as configured, dB, capped at RETURN_LOSS_CAP_DB. */
  returnLoss: Float64Array;
  /** Group delay of the line as configured, seconds. */
  groupDelay: Float64Array;
  /** Real relative permittivity the line uses, 1. */
  epsReal: Float64Array;
  /** Loss tangent the line uses, 1. Zero everywhere with dielectric loss off. */
  lossTangent: Float64Array;
  /** Hammerstad roughness factor, from the RMS height, 1. */
  kHammerstad: Float64Array;
  /** Huray roughness factor, from the radius and ratio, 1. */
  kHuray: Float64Array;
  /** Imaginary part of the causal Hammerstad factor, 1: the reactance its loss must come with. */
  kHammerstadIm: Float64Array;
  /** Imaginary part of Bracken's causal Huray factor, 1. */
  kHurayIm: Float64Array;

  /* ------------------------------------------------------------------ time */
  /** Sample interval, seconds. */
  dt: number;
  /** Samples per UI actually used. */
  samplesPerUi: number;
  /** Index of the leading edge of the launched pulse, which is t = 0. */
  startIndex: number;
  /** Incident one-UI pulse of unit height, 1. */
  pulseIn: Float64Array;
  /** The same pulse at the far end, 1. */
  pulseOut: Float64Array;
  /** Incident unit step, launched at t = 0, 1. */
  stepIn: Float64Array;
  /** Far-end step response, 1. */
  stepOut: Float64Array;
  /** Launched bit stream, volts, one entry per sample over `bits` UIs. */
  streamIn: Float64Array;
  /** Received bit stream, volts, shifted back by the main-cursor delay so it overlays. */
  streamOut: Float64Array;
  /** The bits shown, 0 or 1. */
  bits: Uint8Array;
  /** Far-end pulse sampled at the main cursor and whole UIs either side, from -PRE_CURSORS. */
  cursors: Float64Array;
  /** The edge the pulse was shaped with. */
  response: ResponseSpec;

  /* --------------------------------------------------------------- metrics */
  /** Nyquist frequency of the symbol rate, Hz. */
  nyquist: number;
  /** Line length, inches. */
  lengthInches: number;
  /** Insertion loss at Nyquist, dB. */
  ilNyquist: number;
  /** Insertion loss at Nyquist per inch, dB/in. */
  ilNyquistPerInch: number;
  /** Conductor-only and dielectric-only loss at Nyquist, dB. */
  conductorNyquist: number;
  dielectricNyquist: number;
  /** Closed-form low-loss estimate at Nyquist, dB. */
  approxNyquist: number;
  /** Return loss at Nyquist, dB. */
  returnLossNyquist: number;
  /** Skin depth at Nyquist, metres. */
  skinDepthNyquist: number;
  /** Roughness factor in use at Nyquist, 1. */
  roughnessNyquist: number;
  /** Group delay at Nyquist, seconds. */
  groupDelayNyquist: number;
  /** Delay of the same line with a lossless dielectric of permittivity er, seconds. */
  losslessDelay: number;
  /** Fastest any energy can arrive, l sqrt(eps_inf) / c, seconds. */
  earliestArrival: number;
  /** |S21| at DC, 1. */
  dcGain: number;
  /** Height of the far-end pulse at its peak, as a fraction of the launched pulse height. */
  mainCursor: number;
  /** Time between the 50% points of the launched and received steps, seconds. */
  pulseDelay: number;
  /** Sum of the magnitudes of every other cursor in the record, relative to the main cursor. */
  isiSum: number;
  /** Worst-case inner eye opening by peak distortion, main minus every other cursor, as a fraction of the launched height. */
  peakDistortionEye: number;
  /** Largest far-end value before the earliest causal arrival, relative to the main cursor. */
  precursorLeak: number;
  /** Largest far-end value in the last 10% of the record, relative to the main cursor. */
  tailResidual: number;
  /** Whether the sample ceiling cut the record shorter than asked. */
  recordTruncated: boolean;
}

/**
 * Peak level of the launched wave, volts, for an open-circuit swing `amplitude`
 * peak to peak behind a 50 ohm reference port: the port halves the swing, and the
 * level is half of that, amplitude / 4.
 */
export function launchedLevel(amplitude: number): number {
  return amplitude / 4;
}

/** `n` points from `f0` to `f1`, evenly spaced in log frequency. */
export function logGrid(f0: number, f1: number, n: number): Float64Array {
  const out = new Float64Array(n);
  if (n === 1) {
    out[0] = f0;
    return out;
  }
  const r = Math.log(f1 / f0);
  for (let i = 0; i < n; i++) out[i] = f0 * Math.exp((r * i) / (n - 1));
  return out;
}

/**
 * Samples of a band-limited one-UI pulse, from its spectrum.
 *
 * A rectangle of width T starting at t0 has the transform
 * T sinc(fT) e^{-j pi f T} e^{-j 2 pi f t0}; shaping it with the edge response
 * multiplies that by H(f). Sampling a signal at dt makes the DFT bin k equal to
 * X(f_k) / dt, up to aliasing the edge response has already removed. `h` is an
 * optional extra transfer function, S21 for the far end.
 */
export function pulseFromSpectrum(
  n: number,
  dt: number,
  ui: number,
  t0: number,
  edge: ResponseSpec,
  h?: (f: number) => { re: number; im: number },
): Float64Array {
  const half = (n >> 1) + 1;
  const re = new Float64Array(half);
  const im = new Float64Array(half);
  const df = 1 / (n * dt);
  for (let k = 0; k < half; k++) {
    const f = k * df;
    const x = Math.PI * f * ui;
    const sinc = k === 0 ? 1 : Math.sin(x) / x;
    const e = transferAt(edge, f);
    const phase = -Math.PI * f * ui - 2 * Math.PI * f * t0;
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    // (ui sinc / dt) e^{j phase} H(f)
    const a = (ui * sinc) / dt;
    let pr = a * (c * e.re - s * e.im);
    let pi = a * (c * e.im + s * e.re);
    if (h) {
      const g = h(f);
      const r = pr * g.re - pi * g.im;
      pi = pr * g.im + pi * g.re;
      pr = r;
    }
    re[k] = pr;
    im[k] = pi;
  }
  // A real signal's Nyquist bin is real.
  if (n % 2 === 0) im[half - 1] = 0;
  return irfft(re, im, n);
}

/**
 * Index of the middle of the flat top that holds the largest sample: the run of
 * samples within `tolerance` of the peak, as a fraction of it. On a flat top the
 * single largest sample is decided by rounding, which can put it anywhere along it.
 */
export function plateauCentre(x: Float64Array, tolerance = 1e-6): number {
  let peak = 0;
  for (let i = 1; i < x.length; i++) if (x[i] > x[peak]) peak = i;
  const floor = x[peak] - tolerance * Math.abs(x[peak]);
  let lo = peak;
  let hi = peak;
  while (lo > 0 && x[lo - 1] >= floor) lo--;
  while (hi < x.length - 1 && x[hi + 1] >= floor) hi++;
  return (lo + hi) >> 1;
}

/** First fractional index at or after `from` where x rises through `level`, by linear interpolation; NaN if it never does. */
export function risingCrossing(x: Float64Array, level: number, from = 0): number {
  for (let i = Math.max(1, from); i < x.length; i++) {
    if (x[i - 1] < level && x[i] >= level) return i - 1 + (level - x[i - 1]) / (x[i] - x[i - 1]);
  }
  return NaN;
}

/** Step response from a one-UI pulse response: s[i] = p[i] + s[i - spu]. */
export function stepFromPulse(pulse: Float64Array, spu: number): Float64Array {
  const out = new Float64Array(pulse.length);
  for (let i = 0; i < pulse.length; i++) out[i] = pulse[i] + (i >= spu ? out[i - spu] : 0);
  return out;
}

function withSpec(m: LineModel, patch: Partial<LossyLineSpec>): LineModel {
  return prepareLine({ ...m.spec, ...patch }, { causalRoughness: m.causalRoughness });
}

function returnLossDb(s11: { re: number; im: number }): number {
  const mag = Math.hypot(s11.re, s11.im);
  return mag > 0 ? Math.min(RETURN_LOSS_CAP_DB, -20 * Math.log10(mag)) : RETURN_LOSS_CAP_DB;
}

function approxLossDb(m: LineModel, f: number): number {
  return (conductorAttenuation(m, f) + dielectricAttenuation(m, f)) * m.spec.length * NEPER_TO_DB;
}

export const lossyJob: JobDefinition<LossyParams, LossyResult> = {
  kind: 'lossy',

  defaults: {
    freqPoints: 301,
    fMin: 1e6,
    nyquistMultiple: 10,
    samplesPerUi: 32,
    tailUis: 64,
    bits: 48,
    causalRoughness: true,
  },

  run({ scenario, params }: JobInput<LossyParams>, report): LossyResult {
    const spec: LossyLineSpec = scenario.channel.lossy;
    const src = scenario.source;
    const r0 = LOSSY_REFERENCE_OHMS;
    const line = prepareLine(spec, { causalRoughness: params.causalRoughness });
    const ui = 1 / src.symbolRate;
    const nyquist = src.symbolRate / 2;

    /* ----------------------------------------------------- frequency domain */
    report?.({ done: 0, total: 4, label: 'Sweeping the line' });
    const conductorOnly = withSpec(line, { conductorLossEnabled: true, dielectricLossEnabled: false });
    const dielectricOnly = withSpec(line, { conductorLossEnabled: false, dielectricLossEnabled: true });
    const smooth = withSpec(conductorOnly, { roughnessEnabled: false });
    const hammerstad = withSpec(conductorOnly, { roughnessEnabled: true, roughnessModel: 'hammerstad' });
    const huray = withSpec(conductorOnly, { roughnessEnabled: true, roughnessModel: 'huray' });

    const points = Math.max(2, Math.floor(params.freqPoints));
    const fMin = Math.max(1, params.fMin);
    const fMax = Math.max(10 * fMin, Math.max(1, params.nyquistMultiple) * nyquist);
    const freq = logGrid(fMin, fMax, points);
    const il = (m: LineModel, f: number): number => insertionLossDb(sParametersAt(m, f, r0).s21);

    const ilTotal = new Float64Array(points);
    const ilConductor = new Float64Array(points);
    const ilDielectric = new Float64Array(points);
    const ilSmooth = new Float64Array(points);
    const ilHammerstad = new Float64Array(points);
    const ilHuray = new Float64Array(points);
    const ilApprox = new Float64Array(points);
    const returnLoss = new Float64Array(points);
    const groupDelay = new Float64Array(points);
    const epsReal = new Float64Array(points);
    const lossTangent = new Float64Array(points);
    const kHammerstad = new Float64Array(points);
    const kHuray = new Float64Array(points);
    const kHammerstadIm = new Float64Array(points);
    const kHurayIm = new Float64Array(points);
    for (let i = 0; i < points; i++) {
      const f = freq[i];
      const s = sParametersAt(line, f, r0);
      ilTotal[i] = insertionLossDb(s.s21);
      returnLoss[i] = returnLossDb(s.s11);
      groupDelay[i] = groupDelayAt(line, f, r0);
      ilConductor[i] = il(conductorOnly, f);
      ilDielectric[i] = il(dielectricOnly, f);
      ilSmooth[i] = il(smooth, f);
      ilHammerstad[i] = il(hammerstad, f);
      ilHuray[i] = il(huray, f);
      ilApprox[i] = approxLossDb(line, f);
      if (spec.dielectricLossEnabled) {
        epsReal[i] = permittivityAt(line.debye, f).re;
        lossTangent[i] = lossTangentAt(line.debye, f);
      } else {
        epsReal[i] = spec.er;
        lossTangent[i] = 0;
      }
      kHammerstad[i] = hammerstadFactor(f, spec.roughnessRms, spec.conductivity);
      kHuray[i] = hurayFactor(f, spec.hurayRadius, spec.hurayRatio, spec.conductivity);
      kHammerstadIm[i] = hammerstadCausalFactor(f, spec.roughnessRms, spec.conductivity).im;
      kHurayIm[i] = hurayCausalFactor(f, spec.hurayRadius, spec.hurayRatio, spec.conductivity).im;
    }

    /* ---------------------------------------------------------- time domain */
    report?.({ done: 1, total: 4, label: 'Launching a pulse' });
    const response = edgeResponseOf(src);
    const epsInf = spec.dielectricLossEnabled ? line.debye.epsInf : spec.er;
    const epsDc = spec.dielectricLossEnabled ? line.debye.epsInf + line.debye.deltaEps : spec.er;
    const earliestArrival = (spec.length * Math.sqrt(epsInf)) / SPEED_OF_LIGHT;
    const latestDelay = (spec.length * Math.sqrt(epsDc)) / SPEED_OF_LIGHT;

    // A zero-phase edge starts to move before its nominal instant, so the record
    // leads with a few UIs, or more if the edge is slow compared with the UI.
    const leadUis = Math.max(4, Math.ceil((8 * src.riseTime) / ui));
    const wantedUis = leadUis + Math.ceil(latestDelay / ui) + Math.max(8, Math.floor(params.tailUis));
    let spu = Math.max(4, Math.floor(params.samplesPerUi));
    while (spu > 8 && nextPow2(wantedUis * spu) > LOSSY_MAX_SAMPLES) spu >>= 1;
    const n = Math.min(LOSSY_MAX_SAMPLES, nextPow2(wantedUis * spu));
    const recordTruncated = n < wantedUis * spu;
    const dt = ui / spu;
    const startIndex = leadUis * spu;
    const t0 = startIndex * dt;

    const pulseIn = pulseFromSpectrum(n, dt, ui, t0, response);
    report?.({ done: 2, total: 4, label: 'Propagating the pulse' });
    const pulseOut = pulseFromSpectrum(n, dt, ui, t0, response, (f) => sParametersAt(line, f, r0).s21);
    const stepIn = stepFromPulse(pulseIn, spu);
    const stepOut = stepFromPulse(pulseOut, spu);

    // Cursors, against the launched pulse's own height so a lossless line reads 1,
    // taken at the middle of each pulse's flat top.
    const inCentre = plateauCentre(pulseIn);
    const mainIndex = plateauCentre(pulseOut);
    const height = pulseIn[inCentre] > 0 ? pulseIn[inCentre] : 1;
    const main = pulseOut[mainIndex];
    const cursors = new Float64Array(PRE_CURSORS + 1 + POST_CURSORS);
    for (let k = -PRE_CURSORS; k <= POST_CURSORS; k++) {
      const j = mainIndex + k * spu;
      cursors[k + PRE_CURSORS] = j >= 0 && j < n ? pulseOut[j] / height : 0;
    }
    let others = 0;
    for (let j = mainIndex % spu; j < n; j += spu) if (j !== mainIndex) others += Math.abs(pulseOut[j]);
    const mainAbs = Math.abs(main) > 0 ? Math.abs(main) : 1;

    // Delay between the 50% points of the steps, each of the level it reaches in the
    // record, as a scope's delay measurement takes 50% of the settled top.
    const crossIn = risingCrossing(stepIn, 0.5 * stepIn[n - 1], startIndex);
    const crossOut = risingCrossing(stepOut, 0.5 * stepOut[n - 1], startIndex);
    const stepDelay = (crossOut - crossIn) * dt;
    const pulseDelay = Number.isFinite(stepDelay) ? stepDelay : (mainIndex - inCentre) * dt;
    const delaySamples = Math.round(pulseDelay / dt);

    // Causality: nothing can reach the far end sooner than the fastest wave. The
    // launched pulse itself starts where it first rises above 1e-6 of its peak.
    let firstIn = 0;
    while (firstIn < n && Math.abs(pulseIn[firstIn]) < 1e-6 * height) firstIn++;
    const arrivalIndex = Math.min(n, firstIn + Math.floor(earliestArrival / dt));
    let leak = 0;
    for (let i = 0; i < arrivalIndex; i++) leak = Math.max(leak, Math.abs(pulseOut[i]));
    let tail = 0;
    for (let i = Math.floor(0.9 * n); i < n; i++) tail = Math.max(tail, Math.abs(pulseOut[i]));

    /* ------------------------------------------------------------ bit stream */
    report?.({ done: 3, total: 4, label: 'Superposing the bit stream' });
    const shown = Math.max(4, Math.floor(params.bits));
    const recordUis = Math.ceil(n / spu);
    const warm = recordUis;
    const allBits = generateBits(patternSpecOf(src.pattern), warm + shown);
    const nrz = bitsToNrz(allBits);
    const level = launchedLevel(src.amplitude);
    const length = shown * spu;
    const streamIn = new Float64Array(length);
    const streamOut = new Float64Array(length);
    // Bit b starts at display sample (b - warm) spu; its pulse sample j lands at
    // (b - warm) spu + j - startIndex, and the received one a further delay later,
    // which the overlay removes by aligning the main cursor with the launched pulse's middle.
    for (let b = 0; b < warm + shown; b++) {
      const base = (b - warm) * spu - startIndex;
      const a = level * nrz[b];
      const jStart = Math.max(0, -base);
      const jEnd = Math.min(n, length - base);
      for (let j = jStart; j < jEnd; j++) streamIn[base + j] += a * pulseIn[j];
      const oStart = Math.max(0, delaySamples - base);
      const oEnd = Math.min(n, length - base + delaySamples);
      for (let j = oStart; j < oEnd; j++) streamOut[base + j - delaySamples] += a * pulseOut[j];
    }

    /* -------------------------------------------------------------- metrics */
    report?.({ done: 4, total: 4, label: 'Measuring' });
    const sN = sParametersAt(line, nyquist, r0);
    const ilNyquist = insertionLossDb(sN.s21);
    const lengthInches = spec.length / METRES_PER_INCH;
    const dc = sParametersAt(line, 0, r0).s21;

    return {
      freq,
      ilTotal,
      ilConductor,
      ilDielectric,
      ilSmooth,
      ilHammerstad,
      ilHuray,
      ilApprox,
      returnLoss,
      groupDelay,
      epsReal,
      lossTangent,
      kHammerstad,
      kHuray,
      kHammerstadIm,
      kHurayIm,
      dt,
      samplesPerUi: spu,
      startIndex,
      pulseIn,
      pulseOut,
      stepIn,
      stepOut,
      streamIn,
      streamOut,
      bits: allBits.slice(warm),
      cursors,
      response,
      nyquist,
      lengthInches,
      ilNyquist,
      ilNyquistPerInch: ilNyquist / lengthInches,
      conductorNyquist: il(conductorOnly, nyquist),
      dielectricNyquist: il(dielectricOnly, nyquist),
      approxNyquist: approxLossDb(line, nyquist),
      returnLossNyquist: returnLossDb(sN.s11),
      skinDepthNyquist: skinDepth(nyquist, spec.conductivity),
      roughnessNyquist: roughnessFactor(spec, nyquist),
      groupDelayNyquist: groupDelayAt(line, nyquist, r0),
      losslessDelay: losslessDelay(spec),
      earliestArrival,
      dcGain: Math.hypot(dc.re, dc.im),
      mainCursor: main / height,
      pulseDelay,
      isiSum: others / mainAbs,
      peakDistortionEye: (main - others) / height,
      precursorLeak: leak / mainAbs,
      tailResidual: tail / mainAbs,
      recordTruncated,
    };
  },

  transferables(r) {
    return buffersOf(
      r.freq,
      r.ilTotal,
      r.ilConductor,
      r.ilDielectric,
      r.ilSmooth,
      r.ilHammerstad,
      r.ilHuray,
      r.ilApprox,
      r.returnLoss,
      r.groupDelay,
      r.epsReal,
      r.lossTangent,
      r.kHammerstad,
      r.kHuray,
      r.kHammerstadIm,
      r.kHurayIm,
      r.pulseIn,
      r.pulseOut,
      r.stepIn,
      r.stepOut,
      r.streamIn,
      r.streamOut,
      r.bits,
      r.cursors,
    );
  },
};
