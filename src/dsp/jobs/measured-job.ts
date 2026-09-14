/**
 * A measured channel, driven through the rest of the simulator.
 *
 * The input is a `Network`: a file the reader loaded, or one of two synthetic
 * four-ports built from the lossy line of M4 so the path has something known to
 * run on. Everything after that is the same whichever it came from:
 *
 *   1. A corruption, if the page asks for one, so the checks can be seen to fire:
 *      a gain above one, the phase conjugated, or the phase thrown away.
 *   2. Renormalisation to the Scenario's reference impedance.
 *   3. The wiring is read from the low-frequency transmissions and the Scenario's
 *      ports and mixed-mode switch choose one through transfer, its reflection, its
 *      mode conversion and its aggressors (`channelView`).
 *   4. Checks a file has to pass before an eye drawn from it means anything:
 *      passivity (largest singular value of S at each frequency), reciprocity,
 *      the causality screen of `impulseOf`, and how far the sweep reaches.
 *   5. Insertion loss deviation over a band, and integrated crosstalk noise from
 *      every aggressor, near and far end in separate totals.
 *   6. In time, as in the lossy job: the edge-shaped one-UI pulse multiplied by the
 *      interpolated transfer and inverted; for a pair, the P and N legs alone, whose
 *      50% crossings give the skew, and the differential-to-common conversion; and,
 *      on request, the minimum-phase transfer with the same magnitude, which is what
 *      a magnitude-only reading of the file would give.
 *
 * The launched level is `launchedLevel(amplitude)`, as in the lossy job, and every
 * aggressor is assumed to swing the same as the victim.
 *
 * Physics: PHYSICS.md section 14. Implementation: `src/sim/touchstone/`.
 */

import { minimumPhaseFromMagnitude } from '../hilbert';
import { nextPow2 } from '../fft';
import type { ResponseSpec } from '../filters';
import { bitsToNrz, generateBits } from '../patterns';
import {
  COUPLING_DEFAULTS,
  coupledPairNetwork,
  linearSweep,
  WEAVE_DEFAULTS,
  weavePairNetwork,
  type CouplingSpec,
  type WeaveLegs,
  type WeaveSpec,
} from '../../sim/touchstone/examples';
import { integratedCrosstalkNoise, insertionLossDeviation, powerSum } from '../../sim/touchstone/metrics';
import { channelView, detectTopology, type CrosstalkKind } from '../../sim/touchstone/mixed-mode';
import {
  dbOf,
  matrixAt,
  maxSingularValue,
  reciprocityError,
  renormalize,
  type Network,
} from '../../sim/touchstone/network';
import { COARSE_PHASE_STEP, impulseOf, transferInterpolant } from '../../sim/touchstone/to-impulse';
import { edgeResponseOf, patternSpecOf } from './adapt';
import {
  launchedLevel,
  plateauCentre,
  POST_CURSORS,
  PRE_CURSORS,
  pulseFromSpectrum,
  risingCrossing,
  stepFromPulse,
} from './lossy-job';
import { buffersOf, type JobDefinition, type JobInput } from './types';

export type MeasuredSource = 'weave' | 'coupled' | 'file';

/** Ways to spoil a network on purpose, so each check can be seen to catch its defect. */
export type Corruption = 'none' | 'gain' | 'conjugate' | 'magnitude';

/** Hard ceiling on time-domain samples. */
export const MEASURED_MAX_SAMPLES = 1 << 17;

/** Frequencies on which passivity is evaluated, at most; the sweep is decimated evenly to this. */
export const PASSIVITY_POINTS = 1000;

/** Largest singular value above 1 by more than this is reported as not passive. */
export const PASSIVITY_TOLERANCE = 1e-6;

/** Floor of every dB array the job returns, so a plot's autoscale is not dragged to -300 dB. */
export const DB_FLOOR = -150;

export interface MeasuredParams {
  source: MeasuredSource;
  /** The loaded network, for source 'file'. Ignored otherwise. */
  network: Network | null;
  weave: WeaveSpec;
  coupling: CouplingSpec;
  /** Step of the synthetic networks' linear sweep, Hz. */
  sweepStep: number;
  /** Top of the synthetic sweep, in multiples of the Nyquist frequency. */
  sweepMultiple: number;
  corruption: Corruption;
  /** Gain applied by the 'gain' corruption. */
  corruptionGain: number;
  /** Top of the ILD band, in multiples of the Nyquist frequency. */
  ildMultiple: number;
  /** Receiver bandwidth for ICN, in multiples of the symbol rate. */
  rxBandwidthMultiple: number;
  samplesPerUi: number;
  tailUis: number;
  bits: number;
  /** Also build the minimum-phase transfer with the same magnitude. */
  minimumPhase: boolean;
  /** Magnitude floor for the minimum-phase construction, dB below the peak. */
  minimumPhaseFloorDb: number;
}

export interface AggressorResult {
  label: string;
  kind: CrosstalkKind;
  /** 20 log10 |XT|, dB, floored at DB_FLOOR. */
  xtDb: Float64Array;
  /** Integrated crosstalk noise from this aggressor, volts RMS. */
  icn: number;
}

export interface MeasuredResult {
  source: MeasuredSource;
  ports: number;
  /** Reference impedance of each port after renormalisation, ohms. */
  reference: number[];
  /** The through lines found, 0-based. */
  lines: { input: number; output: number }[];
  pairCount: number;
  mode: 'single' | 'differential';
  /** 0-based; the N ports are -1 for a single-ended view. */
  txPort: number;
  rxPort: number;
  txPortN: number;
  rxPortN: number;
  notes: string[];

  /* ------------------------------------------------------------- frequency */
  freq: Float64Array;
  /** 20 log10 of the through transfer, dB. */
  thruDb: Float64Array;
  /** 20 log10 of the input reflection, dB. */
  reflectionDb: Float64Array;
  /** Differential in, common out, dB; empty for a single-ended view. */
  conversionDb: Float64Array;
  /** The P and N legs' own transmissions, dB; empty for a single-ended view. */
  legPDb: Float64Array;
  legNDb: Float64Array;
  aggressors: AggressorResult[];
  /** Power sums of near-end, far-end and all aggressors, volts RMS. */
  icnNext: number;
  icnFext: number;
  icnTotal: number;
  /** Aggressor and victim launched level, volts. */
  level: number;
  /** Receiver bandwidth used for ICN, Hz. */
  rxBandwidth: number;

  /** ILD over [ildLo, ildHi]; `ildValid` false when the band held too few samples. */
  ildValid: boolean;
  ildLo: number;
  ildHi: number;
  ilFit: Float64Array;
  ild: Float64Array;
  ildRms: number;
  ildPeak: number;
  ildPeakFrequency: number;

  /** Frequencies at which passivity was evaluated, and sigma_max there. */
  sigmaFreq: Float64Array;
  sigmaMax: Float64Array;
  passivityMax: number;
  passivityFrequency: number;
  passive: boolean;
  reciprocityMax: number;

  /** Causality screen of the through transfer. */
  preResponseEnergy: number;
  postResponseEnergy: number;
  acausal: boolean;
  dcPhaseResidual: number;
  inverting: boolean;
  maxPhaseStep: number;
  medianPhaseStep: number;
  coarse: boolean;
  sweepDelay: number;
  fMin: number;
  fMax: number;
  /** Highest frequency in the sweep over the Nyquist frequency. */
  nyquistCoverage: number;

  /** Weave geometry of the synthetic pair, when that is the source. */
  weaveLegs: WeaveLegs | null;

  /* ------------------------------------------------------------------ time */
  dt: number;
  samplesPerUi: number;
  startIndex: number;
  pulseIn: Float64Array;
  pulseOut: Float64Array;
  stepIn: Float64Array;
  stepOut: Float64Array;
  /** Minimum-phase pulse and step with the thru's magnitude; empty unless asked for. */
  pulseMinPhase: Float64Array;
  stepMinPhase: Float64Array;
  /** Steps through the P and N legs alone and the conversion path; empty for a single-ended view. */
  stepLegP: Float64Array;
  stepLegN: Float64Array;
  stepConversion: Float64Array;
  streamIn: Float64Array;
  streamOut: Float64Array;
  bits: Uint8Array;
  cursors: Float64Array;
  response: ResponseSpec;

  /* --------------------------------------------------------------- metrics */
  nyquist: number;
  ilNyquist: number;
  mainCursor: number;
  /** Between the 50% points of the launched and received steps, seconds. */
  pulseDelay: number;
  /** The same for the minimum-phase step; zero unless asked for. */
  minPhaseDelay: number;
  /** P leg's 50% crossing minus the N leg's, seconds; zero for a single-ended view. */
  measuredSkew: number;
  isiSum: number;
  peakDistortionEye: number;
  recordTruncated: boolean;
}

/** A copy of `net` with a defect applied. */
export function corruptNetwork(net: Network, corruption: Corruption, gain = 1.1): Network {
  const re = Float64Array.from(net.re);
  const im = Float64Array.from(net.im);
  for (let i = 0; i < re.length; i++) {
    if (corruption === 'gain') {
      re[i] *= gain;
      im[i] *= gain;
    } else if (corruption === 'conjugate') {
      im[i] = -im[i];
    } else if (corruption === 'magnitude') {
      re[i] = Math.hypot(re[i], im[i]);
      im[i] = 0;
    }
  }
  return { ports: net.ports, freq: net.freq, re, im, reference: Float64Array.from(net.reference) };
}

function dbArray(c: { re: Float64Array; im: Float64Array } | undefined): Float64Array {
  if (!c) return new Float64Array(0);
  const out = new Float64Array(c.re.length);
  for (let k = 0; k < out.length; k++) out[k] = Math.max(DB_FLOOR, dbOf(c.re[k], c.im[k]));
  return out;
}

/** Linear interpolation of y(x) at x0 on an increasing grid, clamped at the ends. */
function interpolate(x: Float64Array, y: Float64Array, x0: number): number {
  if (x0 <= x[0]) return y[0];
  const last = x.length - 1;
  if (x0 >= x[last]) return y[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= x0) lo = mid;
    else hi = mid;
  }
  return y[lo] + ((y[hi] - y[lo]) * (x0 - x[lo])) / (x[hi] - x[lo]);
}

/** Time of a step's 50% crossing of its settled level, seconds from index `from`; `fallback` if none. */
function halfCrossing(step: Float64Array, from: number, dt: number, fallback: number): number {
  const top = step[step.length - 1];
  if (!(Math.abs(top) > 1e-9)) return fallback;
  const x = top > 0 ? step : step.map((v) => -v);
  const c = risingCrossing(x, 0.5 * Math.abs(top), from);
  return Number.isFinite(c) ? (c - from) * dt : fallback;
}

function buildNetwork(
  params: MeasuredParams,
  nyquist: number,
  scenario: JobInput<MeasuredParams>['scenario'],
) {
  const line = scenario.channel.lossy;
  if (params.source === 'file' && params.network) return { network: params.network, weaveLegs: null };
  const step = Math.max(1e5, params.sweepStep);
  const count = Math.max(16, Math.min(4000, Math.ceil((Math.max(1, params.sweepMultiple) * nyquist) / step)));
  const freq = linearSweep(step, count);
  if (params.source === 'coupled') {
    return { network: coupledPairNetwork(line, params.coupling, freq), weaveLegs: null };
  }
  const built = weavePairNetwork(line, params.weave, freq);
  return { network: built.network, weaveLegs: built.legs };
}

export const measuredJob: JobDefinition<MeasuredParams, MeasuredResult> = {
  kind: 'measured',

  defaults: {
    source: 'weave',
    network: null,
    weave: WEAVE_DEFAULTS,
    coupling: COUPLING_DEFAULTS,
    sweepStep: 10e6,
    sweepMultiple: 6,
    corruption: 'none',
    corruptionGain: 1.1,
    ildMultiple: 2,
    rxBandwidthMultiple: 0.75,
    samplesPerUi: 32,
    tailUis: 48,
    bits: 48,
    minimumPhase: false,
    minimumPhaseFloorDb: -120,
  },

  run({ scenario, params }: JobInput<MeasuredParams>, report): MeasuredResult {
    const src = scenario.source;
    const ts = scenario.channel.touchstone;
    const ui = 1 / src.symbolRate;
    const nyquist = src.symbolRate / 2;
    const source: MeasuredSource = params.source === 'file' && !params.network ? 'weave' : params.source;

    /* -------------------------------------------------------------- network */
    report?.({ done: 0, total: 5, label: 'Reading the network' });
    const built = buildNetwork({ ...params, source }, nyquist, scenario);
    const spoiled = corruptNetwork(built.network, params.corruption, params.corruptionGain);
    const net = renormalize(spoiled, ts.renormalizeTo);
    const freq = net.freq;
    const nf = freq.length;
    const topology = detectTopology(net);
    const view = channelView(net, topology, ts.txPort, ts.rxPort, ts.mixedMode);
    const notes = [...view.notes];

    /* --------------------------------------------------------------- checks */
    report?.({ done: 1, total: 5, label: 'Checking passivity and causality' });
    const stride = Math.max(1, Math.ceil(nf / PASSIVITY_POINTS));
    const checked = Math.ceil(nf / stride);
    const sigmaFreq = new Float64Array(checked);
    const sigmaMax = new Float64Array(checked);
    let passivityMax = 0;
    let passivityFrequency = freq[0];
    let reciprocityMax = 0;
    for (let c = 0; c < checked; c++) {
      const k = c * stride;
      sigmaFreq[c] = freq[k];
      sigmaMax[c] = maxSingularValue(matrixAt(net, k));
      if (sigmaMax[c] > passivityMax) {
        passivityMax = sigmaMax[c];
        passivityFrequency = freq[k];
      }
      reciprocityMax = Math.max(reciprocityMax, reciprocityError(net, k));
    }

    const thruInterp = transferInterpolant(freq, view.thru.re, view.thru.im);
    const impulse = impulseOf(thruInterp);

    /* ------------------------------------------------------------ ILD, ICN */
    report?.({ done: 2, total: 5, label: 'Loss deviation and crosstalk' });
    const thruDb = dbArray(view.thru);
    const il = thruDb.map((v) => -v);
    const ildLo = freq[0];
    const ildHi = Math.min(freq[nf - 1], Math.max(0.1, params.ildMultiple) * nyquist);
    let ildValid = false;
    let ilFit: Float64Array = new Float64Array(0);
    let ild: Float64Array = new Float64Array(0);
    let ildRms = 0;
    let ildPeak = 0;
    let ildPeakFrequency = ildLo;
    try {
      const fit = insertionLossDeviation(freq, il, ildLo, ildHi);
      ildValid = true;
      ilFit = fit.fitted;
      ild = fit.deviation;
      ildRms = fit.rms;
      ildPeak = fit.peak;
      ildPeakFrequency = Number.isFinite(fit.peakFrequency) ? fit.peakFrequency : ildLo;
    } catch {
      notes.push(
        'The loss deviation band holds fewer than four frequencies of this sweep, so ILD is not computed.',
      );
    }

    const response = edgeResponseOf(src);
    const level = launchedLevel(src.amplitude);
    const rxBandwidth = Math.max(0.05, params.rxBandwidthMultiple) * src.symbolRate;
    const icnOptions = { level, symbolTime: ui, edge: response, rxBandwidth };
    const aggressors: AggressorResult[] = view.aggressors.map((a) => {
      const mag = new Float64Array(nf);
      for (let k = 0; k < nf; k++) mag[k] = Math.hypot(a.re[k], a.im[k]);
      return {
        label: a.label,
        kind: a.kind,
        xtDb: dbArray(a),
        icn: integratedCrosstalkNoise(freq, mag, icnOptions),
      };
    });
    const icnNext = powerSum(aggressors.filter((a) => a.kind === 'next').map((a) => a.icn));
    const icnFext = powerSum(aggressors.filter((a) => a.kind === 'fext').map((a) => a.icn));

    /* ---------------------------------------------------------- time domain */
    report?.({ done: 3, total: 5, label: 'Driving a pulse through the network' });
    const delay = Math.abs(thruInterp.sweepDelay);
    const leadUis = Math.max(4, Math.ceil((8 * src.riseTime) / ui));
    const wantedUis = 2 * leadUis + Math.ceil(delay / ui) + Math.max(8, Math.floor(params.tailUis));
    let spu = Math.max(4, Math.floor(params.samplesPerUi));
    while (spu > 8 && nextPow2(wantedUis * spu) > MEASURED_MAX_SAMPLES) spu >>= 1;
    const n = Math.min(MEASURED_MAX_SAMPLES, nextPow2(wantedUis * spu));
    const recordTruncated = n < wantedUis * spu;
    const dt = ui / spu;
    // A non-causal transfer (the conjugate corruption) moves energy before the
    // launch, so the record leads by twice as much as the lossy job's.
    const startIndex = 2 * leadUis * spu;
    const t0 = startIndex * dt;

    const pulseIn = pulseFromSpectrum(n, dt, ui, t0, response);
    const pulseOut = pulseFromSpectrum(n, dt, ui, t0, response, thruInterp.at);
    const stepIn = stepFromPulse(pulseIn, spu);
    const stepOut = stepFromPulse(pulseOut, spu);
    const inCross = halfCrossing(stepIn, 0, dt, t0);
    const outCross = halfCrossing(stepOut, 0, dt, inCross);
    const pulseDelay = outCross - inCross;

    let pulseMinPhase: Float64Array = new Float64Array(0);
    let stepMinPhase: Float64Array = new Float64Array(0);
    let minPhaseDelay = 0;
    if (params.minimumPhase) {
      const df = 1 / (n * dt);
      const magFull = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const v = thruInterp.at((k <= n >> 1 ? k : k - n) * df);
        magFull[k] = Math.hypot(v.re, v.im);
      }
      const mp = minimumPhaseFromMagnitude(magFull, params.minimumPhaseFloorDb);
      const sign = thruInterp.inverting ? -1 : 1;
      pulseMinPhase = pulseFromSpectrum(n, dt, ui, t0, response, (f) => {
        const k = Math.min(n - 1, Math.round(f / df));
        return { re: sign * mp.re[k], im: sign * mp.im[k] };
      });
      stepMinPhase = stepFromPulse(pulseMinPhase, spu);
      minPhaseDelay = halfCrossing(stepMinPhase, 0, dt, inCross) - inCross;
    }

    let stepLegP: Float64Array = new Float64Array(0);
    let stepLegN: Float64Array = new Float64Array(0);
    let stepConversion: Float64Array = new Float64Array(0);
    let measuredSkew = 0;
    if (view.legP && view.legN && view.conversion) {
      const leg = (c: { re: Float64Array; im: Float64Array }) =>
        stepFromPulse(
          pulseFromSpectrum(n, dt, ui, t0, response, transferInterpolant(freq, c.re, c.im).at),
          spu,
        );
      stepLegP = leg(view.legP);
      stepLegN = leg(view.legN);
      stepConversion = leg(view.conversion);
      measuredSkew = halfCrossing(stepLegP, 0, dt, 0) - halfCrossing(stepLegN, 0, dt, 0);
    }

    // Cursors against the launched pulse's height, as in the lossy job.
    const inCentre = plateauCentre(pulseIn);
    const sign = thruInterp.inverting ? -1 : 1;
    const signedOut = sign === 1 ? pulseOut : pulseOut.map((v) => -v);
    const mainIndex = plateauCentre(signedOut);
    const height = pulseIn[inCentre] > 0 ? pulseIn[inCentre] : 1;
    const main = signedOut[mainIndex];
    const cursors = new Float64Array(PRE_CURSORS + 1 + POST_CURSORS);
    for (let k = -PRE_CURSORS; k <= POST_CURSORS; k++) {
      const j = mainIndex + k * spu;
      cursors[k + PRE_CURSORS] = j >= 0 && j < n ? signedOut[j] / height : 0;
    }
    let others = 0;
    for (let j = mainIndex % spu; j < n; j += spu) if (j !== mainIndex) others += Math.abs(signedOut[j]);
    const mainAbs = Math.abs(main) > 0 ? Math.abs(main) : 1;

    /* ------------------------------------------------------------ bit stream */
    report?.({ done: 4, total: 5, label: 'Superposing the bit stream' });
    const shown = Math.max(4, Math.floor(params.bits));
    const warm = Math.ceil(n / spu);
    const allBits = generateBits(patternSpecOf(src.pattern), warm + shown);
    const nrz = bitsToNrz(allBits);
    const length = shown * spu;
    const streamIn = new Float64Array(length);
    const streamOut = new Float64Array(length);
    const delaySamples = Math.round(pulseDelay / dt);
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

    report?.({ done: 5, total: 5, label: 'Measuring' });
    const legs = built.weaveLegs;
    return {
      source,
      ports: net.ports,
      reference: Array.from(net.reference),
      lines: topology.lines.map((l) => ({ input: l.input, output: l.output })),
      pairCount: topology.pairs.length,
      mode: view.mode,
      txPort: view.txPort,
      rxPort: view.rxPort,
      txPortN: view.txPortN,
      rxPortN: view.rxPortN,
      notes,
      freq: Float64Array.from(freq),
      thruDb,
      reflectionDb: dbArray(view.reflection),
      conversionDb: dbArray(view.conversion),
      legPDb: dbArray(view.legP),
      legNDb: dbArray(view.legN),
      aggressors,
      icnNext,
      icnFext,
      icnTotal: powerSum([icnNext, icnFext]),
      level,
      rxBandwidth,
      ildValid,
      ildLo,
      ildHi,
      ilFit,
      ild,
      ildRms,
      ildPeak,
      ildPeakFrequency,
      sigmaFreq,
      sigmaMax,
      passivityMax,
      passivityFrequency,
      passive: passivityMax <= 1 + PASSIVITY_TOLERANCE,
      reciprocityMax,
      preResponseEnergy: impulse.preResponseEnergy,
      postResponseEnergy: impulse.postResponseEnergy,
      acausal: impulse.acausal,
      dcPhaseResidual: thruInterp.dcPhaseResidual,
      inverting: thruInterp.inverting,
      maxPhaseStep: thruInterp.maxPhaseStep,
      medianPhaseStep: thruInterp.medianPhaseStep,
      coarse: thruInterp.medianPhaseStep > COARSE_PHASE_STEP,
      sweepDelay: thruInterp.sweepDelay,
      fMin: freq[0],
      fMax: freq[nf - 1],
      nyquistCoverage: freq[nf - 1] / nyquist,
      weaveLegs: legs
        ? { ...legs, nullFrequency: Number.isFinite(legs.nullFrequency) ? legs.nullFrequency : 0 }
        : null,
      dt,
      samplesPerUi: spu,
      startIndex,
      pulseIn,
      pulseOut,
      stepIn,
      stepOut,
      pulseMinPhase,
      stepMinPhase,
      stepLegP,
      stepLegN,
      stepConversion,
      streamIn,
      streamOut,
      bits: allBits.slice(warm),
      cursors,
      response,
      nyquist,
      ilNyquist: -interpolate(freq, thruDb, nyquist),
      mainCursor: main / height,
      pulseDelay,
      minPhaseDelay,
      measuredSkew,
      isiSum: others / mainAbs,
      peakDistortionEye: (main - others) / height,
      recordTruncated,
    };
  },

  transferables(r) {
    return buffersOf(
      r.freq,
      r.thruDb,
      r.reflectionDb,
      r.conversionDb,
      r.legPDb,
      r.legNDb,
      ...r.aggressors.map((a) => a.xtDb),
      r.ilFit,
      r.ild,
      r.sigmaFreq,
      r.sigmaMax,
      r.pulseIn,
      r.pulseOut,
      r.stepIn,
      r.stepOut,
      r.pulseMinPhase,
      r.stepMinPhase,
      r.stepLegP,
      r.stepLegN,
      r.stepConversion,
      r.streamIn,
      r.streamOut,
      r.bits,
      r.cursors,
    );
  },
};
