/**
 * M1: build a square wave out of sine waves and watch what refuses to converge.
 *
 * The job synthesises the partial sum of the first N harmonics, measures the
 * overshoot at the edge and the RMS error over the period, and returns the
 * per-harmonic traces if they were asked for. Two numbers are the lesson:
 * `overshoot.fractionOfJump` sits at 8.949% of the jump no matter how large N
 * gets, while `rmsError` falls away steadily. The series converges in the mean
 * and not at the edge.
 *
 * The harmonic frequencies are tied to the Scenario so the reader can see where
 * the content actually lands. A repeating 1010 pattern at symbol rate f_s has a
 * fundamental at f_s/2 - the Nyquist frequency - and its Nth harmonic at
 * N*f_s/2, which is why channel loss at Nyquist is the number everyone quotes.
 */

import {
  GIBBS_OVERSHOOT_OF_JUMP,
  harmonics,
  idealWave,
  measureOvershoot,
  rmsError,
  synthesize,
  synthesizeEach,
  type HarmonicTerm,
  type OvershootMeasurement,
  type WaveShape,
} from '../fourier';
import { nyquist } from '../../state/scenario';
import { buffersOf, throttleProgress, type JobDefinition, type JobInput } from './types';

export interface FourierParams {
  shape: WaveShape;
  /** Highest harmonic number included in the partial sum. */
  maxN: number;
  /** Samples across one period. */
  samples: number;
  /** Duty cycle for shape 'pulse'. */
  duty: number;
  /** Return each harmonic separately, for the faint per-harmonic traces. */
  perHarmonic: boolean;
}

/** One harmonic, with the frequency it actually occupies in this Scenario. */
export interface HarmonicRow extends HarmonicTerm {
  /** Frequency in Hz: n * f0. */
  frequency: number;
  /** Amplitude in dB relative to the fundamental. */
  relativeDb: number;
}

export interface FourierResult {
  /** Time in seconds across exactly one period of the fundamental. */
  t: Float64Array;
  /** The partial sum. */
  y: Float64Array;
  /** What the series converges to, for the error metric and the ghost trace. */
  ideal: Float64Array;
  /** Each harmonic on its own, when `perHarmonic` was set. */
  each: Float64Array[];
  terms: HarmonicRow[];
  overshoot: OvershootMeasurement;
  /** RMS difference from the ideal, over the period. */
  rmsError: number;
  /** Fundamental frequency, Hz. */
  f0: number;
  /** Frequency of the highest harmonic included, Hz. */
  highestFrequency: number;
  /** The exact Wilbraham-Gibbs limit, so the UI can show measured against known. */
  gibbsLimit: number;
}

export const fourierJob: JobDefinition<FourierParams, FourierResult> = {
  kind: 'fourier',

  defaults: { shape: 'square', maxN: 9, samples: 2048, duty: 0.5, perHarmonic: false },

  run({ scenario, params }: JobInput<FourierParams>, report): FourierResult {
    const samples = Math.max(16, Math.floor(params.samples));
    const maxN = Math.max(1, Math.floor(params.maxN));

    // A 1010 stream is a square wave at half the symbol rate, so that is the
    // fundamental the harmonics are numbered against.
    const f0 = nyquist(scenario);
    const period = f0 > 0 ? 1 / f0 : 1;

    const terms = harmonics(params.shape, maxN, params.duty);
    const tick = throttleProgress(report, terms.length, 'Summing harmonics');

    // synthesize() is one pass over every term; the per-harmonic path is the same
    // work kept separately, so only one of the two is ever run.
    let y: Float64Array;
    let each: Float64Array[] = [];
    if (params.perHarmonic) {
      each = synthesizeEach(terms, samples);
      y = new Float64Array(samples);
      for (let k = 0; k < each.length; k++) {
        const h = each[k];
        for (let i = 0; i < samples; i++) y[i] += h[i];
        tick(k + 1);
      }
    } else {
      y = synthesize(terms, samples);
      tick(terms.length);
    }

    const ideal = idealWave(params.shape, samples, params.duty);

    const t = new Float64Array(samples);
    for (let i = 0; i < samples; i++) t[i] = (i / samples) * period;

    // Relative to the fundamental, which for a pulse is the first AC term rather
    // than the DC entry the harmonic list may start with.
    const fundamental = terms.find((h) => h.n === 1)?.amplitude ?? terms[0]?.amplitude ?? 1;
    const rows: HarmonicRow[] = terms.map((h) => ({
      ...h,
      frequency: h.n * f0,
      relativeDb:
        fundamental === 0 || h.amplitude === 0
          ? -Infinity
          : 20 * Math.log10(Math.abs(h.amplitude / fundamental)),
    }));

    return {
      t,
      y,
      ideal,
      each,
      terms: rows,
      overshoot: measureOvershoot(y, 1),
      rmsError: rmsError(y, ideal),
      f0,
      highestFrequency: maxN * f0,
      gibbsLimit: GIBBS_OVERSHOOT_OF_JUMP,
    };
  },

  transferables(r) {
    return buffersOf(r.t, r.y, r.ideal, ...r.each);
  },
};
