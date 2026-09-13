/**
 * One edge, measured.
 *
 * The step response of the driver's edge shape, with the rise time measured off
 * the curve rather than asserted from the setting that produced it. That loop -
 * set a bandwidth, compute a response, measure the edge, compare - is the whole
 * argument of M2, and it is also the first place a reader meets the fact that
 * "rise time" is not one number: the same edge reads 10-90% and 20-80% and the
 * two differ by about 40%.
 *
 * The response shapes differ in what they do *after* the transition, and that is
 * the part worth looking at. A single pole never overshoots. A Bessel of any
 * order barely does, because its group delay is flat. A brick wall overshoots by
 * about 9% and rings for a long time on both sides of the edge - it is the Gibbs
 * phenomenon of M1 arriving in the time domain, from a filter this time rather
 * than from a truncated series, for exactly the same reason.
 *
 * At the bench: a scope's own front end is one of these shapes, and it is in
 * series with whatever you are measuring. Rise times add in quadrature to first
 * order, so a 25 ps edge seen through a 20 ps scope reads about 32 ps. The
 * `scopeLimited` figure here is that calculation; M10 does it properly.
 */

import { applyResponse, riseTimeBandwidthProduct, type ResponseSpec } from '../filters';
import { edgeTransitionSamples, findCrossings } from '../interp';
import { buffersOf, type JobDefinition, type JobInput } from './types';
import { edgeResponseOf, EDGE_REFERENCE_LEVELS } from './adapt';

export interface EdgeParams {
  /** Samples across the whole record. */
  samples: number;
  /** Record length, as a multiple of the rise time. */
  spanInRiseTimes: number;
  /** Include the scope front end in series with the driver. */
  includeScope: boolean;
}

export interface EdgeResult {
  /** Time in seconds, zero at the commanded transition. */
  t: Float64Array;
  /** Step response at the driver pin, volts. */
  y: Float64Array;
  /** The same edge as the configured scope would show it, volts. */
  measured: Float64Array;
  /** Response the driver's edge was modelled as. */
  response: ResponseSpec;
  /** Rise time at the Scenario's 20-80% convention, seconds. */
  rise2080: number;
  /** The same edge at 10-90%, seconds: the number a different datasheet quotes. */
  rise1090: number;
  /** Ratio of the two, so the reader can see they are not interchangeable. */
  conventionRatio: number;
  /** Overshoot above the final value, as a fraction of the step. */
  overshoot: number;
  /** Settling time to within 2% of the final value, seconds. Zero if it never leaves the band. */
  settling2pct: number;
  /**
   * Rise time through the scope, seconds, or null when no scope is in the path.
   *
   * Null rather than NaN. A NaN used to mean "not applicable" is indistinguishable
   * from a NaN that means "a divide went wrong", which disarms the finite-value
   * guard in `src/dsp/guard.ts` for this whole result. Null makes the absent case a
   * thing the caller has to handle, which is also what the reader needs: "no scope
   * in the path" and "the measurement failed" should not render the same way.
   */
  scopeLimited: number | null;
  /** Knee frequency of the edge, Hz: 0.5 / t_r at 10-90%. */
  kneeFrequency: number;
  /** -3 dB bandwidth the edge corresponds to, Hz. */
  bandwidth: number;
}

export const edgeJob: JobDefinition<EdgeParams, EdgeResult> = {
  kind: 'edge',

  defaults: { samples: 4096, spanInRiseTimes: 12, includeScope: false },

  run({ scenario, params }: JobInput<EdgeParams>, report): EdgeResult {
    const src = scenario.source;
    const response = edgeResponseOf(src);

    const n = Math.max(64, Math.floor(params.samples));
    const span = Math.max(4, params.spanInRiseTimes) * src.riseTime;
    const dt = span / n;
    const sampleRate = 1 / dt;

    // The step is placed a quarter of the way in, so there is room before it for
    // the pre-transition ringing a zero-phase response produces and which a causal
    // intuition does not expect to be there.
    const stepIndex = Math.floor(n / 4);
    const low = src.dcOffset - src.amplitude / 2;
    const high = src.dcOffset + src.amplitude / 2;

    const ideal = new Float64Array(n);
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ideal[i] = i < stepIndex ? low : high;
      t[i] = (i - stepIndex) * dt;
    }

    report?.({ done: 1, total: 2, label: 'Applying edge response' });
    const y = applyResponse(ideal, sampleRate, response);

    const measured = params.includeScope
      ? applyResponse(y, sampleRate, {
          type: scenario.scope.responseShape,
          bw: scenario.scope.bandwidth,
          order: 4,
        })
      : Float64Array.from(y);

    report?.({ done: 2, total: 2, label: 'Measuring' });

    const swing = high - low;
    const at = (frac: number): number => low + frac * swing;
    const [lo, hi] = EDGE_REFERENCE_LEVELS;

    // Start the search from the first crossing of the midpoint rather than from
    // the commanded step: a zero-phase response begins moving before it.
    const mid = findCrossings(y, at(0.5), 'rising')[0];
    const from = mid === undefined ? 0 : Math.max(0, Math.floor(mid.index) - n);

    const rise2080 = edgeTransitionSamples(y, from, at(lo), at(hi), true) * dt;
    const rise1090 = edgeTransitionSamples(y, from, at(0.1), at(0.9), true) * dt;

    let peak = -Infinity;
    for (let i = stepIndex; i < n; i++) if (y[i] > peak) peak = y[i];
    const overshoot = swing === 0 ? 0 : (peak - high) / swing;

    // Settling is the last time the trace leaves a 2% band, which is the honest
    // definition: an early excursion back inside the band does not count.
    let settleIndex = -1;
    const band = 0.02 * Math.abs(swing);
    for (let i = n - 1; i >= stepIndex; i--) {
      if (Math.abs(y[i] - high) > band) {
        settleIndex = i;
        break;
      }
    }
    const settling2pct = settleIndex < 0 ? 0 : (settleIndex - stepIndex) * dt;

    const scopeLimited = params.includeScope
      ? edgeTransitionSamples(measured, from, at(lo), at(hi), true) * dt
      : null;

    return {
      t,
      y,
      measured,
      response,
      rise2080,
      rise1090,
      conventionRatio: rise1090 > 0 ? rise2080 / rise1090 : NaN,
      overshoot,
      settling2pct,
      scopeLimited,
      // Johnson and Graham's knee is defined on the 10-90% edge.
      kneeFrequency: rise1090 > 0 ? 0.5 / rise1090 : NaN,
      bandwidth: response.bw,
    };
  },

  transferables(r) {
    return buffersOf(r.t, r.y, r.measured);
  },
};

/** The 10-90% rise time a response of this bandwidth produces, seconds. */
export function riseTimeOf(spec: ResponseSpec): number {
  return riseTimeBandwidthProduct(spec) / spec.bw;
}
