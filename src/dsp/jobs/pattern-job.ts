/**
 * What a test pattern actually contains.
 *
 * Choosing a pattern is choosing which failure you are willing to see. A PRBS
 * exercises a spread of run lengths and is what a compliance spec asks for; a
 * 1010 clock puts all its energy at Nyquist and tells you nothing about ISI; a
 * lone one in a field of zeros is the single worst case for a channel with a long
 * tail, and it is the pattern that finds the failure a PRBS averages away.
 *
 * This job generates the stream and measures it, so the reader can compare the
 * pattern they picked against the one the standard asks for before wondering why
 * their margin looks better than the lab's.
 *
 * Everything here is counting, not modelling: no channel, no impairments. It runs
 * in microseconds for the pattern lengths the UI offers.
 */

import { bitsToNrz, bitsToPam4, describePattern, generateBits, type PatternInfo } from '../patterns';
import { longestRun, onesDensity, periodicAutocorrelation, runLengthHistogram } from '../prbs';
import { buffersOf, type JobDefinition, type JobInput } from './types';
import { patternSpecOf } from './adapt';

export interface PatternParams {
  /** Bits to generate. */
  bits: number;
  /**
   * Compute the periodic autocorrelation. O(n^2) and meaningful only for a
   * stream that is an exact number of pattern periods, so it is opt-in.
   */
  autocorrelation: boolean;
}

export interface RunLengthRow {
  length: number;
  count: number;
}

export interface PatternResult {
  bits: Uint8Array;
  /** Bipolar symbols: NRZ in [-1,+1], or Gray-coded PAM4 in [-1,-1/3,+1/3,+1]. */
  symbols: Float64Array;
  info: PatternInfo;
  /** Fraction of ones. A DC-balanced pattern sits at 0.5. */
  onesDensity: number;
  /** Fraction of bit boundaries that are a transition. A 1010 clock is 1.0. */
  transitionDensity: number;
  /** Longest run of identical bits. Sets the worst-case DC wander and ISI depth. */
  longestRun: number;
  /** Running disparity extremes: how far the stream drifts from DC balance. */
  maxDisparity: number;
  runLengths: RunLengthRow[];
  /** Periodic autocorrelation, when asked for. Empty otherwise. */
  autocorrelation: Int32Array;
}

export const patternJob: JobDefinition<PatternParams, PatternResult> = {
  kind: 'pattern',

  defaults: { bits: 4096, autocorrelation: false },

  run({ scenario, params }: JobInput<PatternParams>): PatternResult {
    const spec = patternSpecOf(scenario.source.pattern);
    const n = Math.max(2, Math.floor(params.bits));
    const bits = generateBits(spec, n);

    let transitions = 0;
    let disparity = 0;
    let maxDisparity = 0;
    for (let i = 0; i < bits.length; i++) {
      if (i > 0 && bits[i] !== bits[i - 1]) transitions++;
      disparity += bits[i] ? 1 : -1;
      if (Math.abs(disparity) > Math.abs(maxDisparity)) maxDisparity = disparity;
    }

    const histogram = runLengthHistogram(bits);
    const runLengths: RunLengthRow[] = [...histogram.entries()]
      .map(([length, count]) => ({ length, count }))
      .sort((a, b) => a.length - b.length);

    return {
      bits,
      symbols: scenario.source.levels === 'pam4' ? bitsToPam4(bits) : bitsToNrz(bits),
      info: describePattern(spec),
      onesDensity: onesDensity(bits),
      transitionDensity: bits.length > 1 ? transitions / (bits.length - 1) : 0,
      longestRun: longestRun(bits),
      maxDisparity,
      runLengths,
      autocorrelation: params.autocorrelation ? periodicAutocorrelation(bits) : new Int32Array(0),
    };
  },

  transferables(r) {
    return buffersOf(r.bits, r.symbols, r.autocorrelation);
  },
};
