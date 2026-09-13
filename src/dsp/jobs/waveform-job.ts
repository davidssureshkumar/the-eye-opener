/**
 * The transmitted waveform: symbols on a time grid, with the driver's edge.
 *
 * Two stages, kept separate because the reader is meant to see the difference.
 * First the ideal stream: each symbol held for exactly one unit interval, with
 * vertical transitions. That waveform does not exist in any circuit - it has
 * infinite bandwidth - but it is the thing every timing diagram draws, and its
 * spectrum is the sinc envelope M2 opens with. Then the driver's finite edge,
 * applied as a linear response, which is the first point at which the picture
 * starts to look like an oscilloscope screen.
 *
 * What this job does NOT contain: channel loss, reflections, crosstalk, noise or
 * jitter. It is the transmitter pin and nothing past it. Those belong to their
 * own modules and are not smuggled in here.
 *
 * At the bench: the ideal trace is what a protocol decoder shows you and the
 * shaped trace is what the probe shows you. When they disagree about where a bit
 * boundary is, the decoder is reporting its own idea of the UI, not the signal.
 */

import { applyResponse } from '../filters';
import { bitsToNrz, bitsToPam4, generateBits } from '../patterns';
import { unitInterval } from '../../state/scenario';
import { buffersOf, type JobDefinition, type JobInput } from './types';
import { edgeResponseOf, patternSpecOf, sampleRateOf } from './adapt';

export interface WaveformParams {
  /** Unit intervals to generate. */
  uis: number;
  /** Apply the driver's edge response. False gives the ideal rectangular stream. */
  shapeEdges: boolean;
}

export interface WaveformResult {
  /** Time in seconds from the start of the record. */
  t: Float64Array;
  /** Ideal rectangular symbols at the driver's levels, volts. */
  ideal: Float64Array;
  /** The same stream through the driver's edge response, volts. */
  shaped: Float64Array;
  bits: Uint8Array;
  /** Normalised symbol levels before the amplitude and offset are applied. */
  symbols: Float64Array;
  /** Simulation sample rate, samples per second. */
  sampleRate: number;
  /** Unit interval, seconds. */
  ui: number;
  /** Samples per unit interval. */
  sps: number;
  /** -3 dB bandwidth the driver's edge corresponds to, Hz. */
  edgeBandwidth: number;
}

export const waveformJob: JobDefinition<WaveformParams, WaveformResult> = {
  kind: 'waveform',

  defaults: { uis: 32, shapeEdges: true },

  run({ scenario, params }: JobInput<WaveformParams>, report): WaveformResult {
    const sps = scenario.sampling.samplesPerUi;
    const ui = unitInterval(scenario);
    const sampleRate = sampleRateOf(scenario);

    const nSymbols = Math.max(1, Math.floor(params.uis));
    const bitsPerSymbol = scenario.source.levels === 'pam4' ? 2 : 1;
    const bits = generateBits(patternSpecOf(scenario.source.pattern), nSymbols * bitsPerSymbol);
    const symbols = scenario.source.levels === 'pam4' ? bitsToPam4(bits) : bitsToNrz(bits);

    report?.({ done: 1, total: 3, label: 'Generating symbols' });

    // Peak-to-peak swing, so a +-1 symbol maps to +-amplitude/2 about the offset.
    const half = scenario.source.amplitude / 2;
    const dc = scenario.source.dcOffset;

    const n = symbols.length * sps;
    const t = new Float64Array(n);
    const ideal = new Float64Array(n);
    const dt = 1 / sampleRate;
    for (let s = 0; s < symbols.length; s++) {
      const v = symbols[s] * half + dc;
      const base = s * sps;
      for (let k = 0; k < sps; k++) {
        ideal[base + k] = v;
        t[base + k] = (base + k) * dt;
      }
    }

    report?.({ done: 2, total: 3, label: 'Shaping edges' });

    const response = edgeResponseOf(scenario.source);
    const shaped = params.shapeEdges ? applyResponse(ideal, sampleRate, response) : Float64Array.from(ideal);

    report?.({ done: 3, total: 3, label: 'Done' });

    return {
      t,
      ideal,
      shaped,
      bits,
      symbols,
      sampleRate,
      ui,
      sps,
      edgeBandwidth: response.bw,
    };
  },

  transferables(r) {
    return buffersOf(r.t, r.ideal, r.shaped, r.bits, r.symbols);
  },
};
