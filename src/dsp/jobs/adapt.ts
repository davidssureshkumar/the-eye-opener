/**
 * Scenario fields into DSP arguments.
 *
 * The Scenario is shaped for the UI and the permalink: flat, fully defaulted,
 * every field present whether or not the current mode uses it. The DSP functions
 * are shaped for the maths: optional fields, no defaults, no knowledge of which
 * control is currently visible. This file is the seam, and it lives in one place
 * so the same translation cannot be done two different ways in two modules.
 */

import type { PatternState, Scenario, SourceState } from '../../state/scenario';
import type { PatternSpec } from '../patterns';
import type { ResponseSpec, ResponseType } from '../filters';
import { riseTimeBandwidthProduct } from '../filters';

/** A Scenario pattern block as the generator wants it. */
export function patternSpecOf(p: PatternState): PatternSpec {
  return {
    kind: p.kind,
    prbs: p.prbs,
    seed: p.seed,
    divN: p.divN,
    frame: p.frame,
    burst: p.burst,
    custom: p.custom,
    invert: p.invert,
  };
}

/**
 * The driver's edge, as a filter response.
 *
 * 'linear' is a ramp rather than a filter and has no transfer function, so it is
 * mapped to the Bessel response, whose step is the closest maximally-flat
 * approximation to a straight edge with no overshoot. Callers that can draw a
 * true ramp should check `edgeShape` themselves rather than rely on this.
 *
 * The Scenario states rise time at 20-80%, which is the convention fast-interface
 * datasheets use. Converting it to a bandwidth therefore needs the 20-80%
 * rise-time-bandwidth product of that specific response shape, not the
 * remembered 0.35 that belongs to 10-90% on a single pole.
 */
export const EDGE_REFERENCE_LEVELS: readonly [number, number] = [0.2, 0.8];

export function edgeResponseOf(src: SourceState): ResponseSpec {
  const type: ResponseType = src.edgeShape === 'linear' ? 'bessel' : src.edgeShape;
  const spec: ResponseSpec = { type, bw: 1, order: 4 };
  const [lo, hi] = EDGE_REFERENCE_LEVELS;
  const product = riseTimeBandwidthProduct(spec, lo, hi);
  return { ...spec, bw: product / src.riseTime };
}

/** Samples per second of the simulation grid. */
export function sampleRateOf(s: Scenario): number {
  return s.source.symbolRate * s.sampling.samplesPerUi;
}

/** Symbols per bit for the configured modulation: PAM4 carries two bits a symbol. */
export function bitsPerSymbolOf(s: Scenario): number {
  return s.source.levels === 'pam4' ? 2 : 1;
}
