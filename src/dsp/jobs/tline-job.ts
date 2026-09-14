/**
 * One edge down one lossless line, watched from both ends and from a TDR.
 *
 * The argument of M3 in a single computation. The driver's edge - the same edge
 * M2 measured - is launched into the Scenario's transmission line, and the job
 * returns what a probe would see at the driver pin, what it would see at the
 * receiver pad, and what a TDR instrument would display looking into the same
 * line. Alongside the waveforms it returns the analytic bounce diagram, so the
 * figure can draw the lattice and the staircase from the closed form and the
 * waveform from the simulator, and a reader can see the two agree.
 *
 * Two modelling choices a reader needs to know about, both stated on screen:
 *
 *   - `source.amplitude` is taken as the open-circuit swing of an ideal source
 *     behind `source.sourceZ`. That is the only reading that is well defined
 *     before a load is known, and it is the one the line equations need; a
 *     datasheet "swing at the pin" into a stated load is a different number.
 *   - The TDR run uses its own matched 50 ohm source and the same edge, rather than
 *     the driver's impedance. A TDR is an instrument with a known reference; using
 *     the driver's 40 ohms would make the display read every impedance wrong.
 *
 * Superposition does the DC offset. The simulator starts from an uncharged line,
 * so the job simulates a unit step and adds back the level the line sat at before
 * the step, which on a lossless line is the resistive divider at both ends. That
 * is exact for this model, and it avoids launching a spurious step at t = 0 from a
 * line that was never actually at zero.
 *
 * Physics: PHYSICS.md section 12. Implementation: `src/sim/channel/tline.ts`.
 */

import { applyResponse, type ResponseSpec } from '../filters';
import {
  bounceDiagram,
  propagationDelay,
  simulateLine,
  steadyStateVoltage,
  tdrImpedance,
  tdrReflection,
  type BounceDiagram,
} from '../../sim/channel/tline';
import { edgeResponseOf } from './adapt';
import { buffersOf, type JobDefinition, type JobInput } from './types';

/**
 * Reference impedance of the modelled TDR, ohms.
 *
 * 50 ohms is the near-universal reference for coaxial test equipment. It is an
 * instrument convention, not a property of the link, which is why it is a
 * constant here rather than a Scenario field.
 */
export const TDR_REFERENCE_OHMS = 50;

/** Hard ceiling on samples, whatever the geometry asks for. */
export const TLINE_MAX_SAMPLES = 1 << 18;

export interface TlineParams {
  /** Target samples across the record. The job adjusts it so the delay is a whole number of samples. */
  samples: number;
  /** Record length after the step, in one-way delays. */
  delays: number;
  /** Record length after the step, in rise times, used when the line is short. */
  minRiseTimes: number;
  /** Run the TDR as well. */
  includeTdr: boolean;
}

export interface TlineResult {
  /** Time, seconds, zero at the commanded step. */
  t: Float64Array;
  /** Open-circuit source voltage, volts. */
  source: Float64Array;
  /** Voltage at the driver pin, volts. */
  near: Float64Array;
  /** Voltage at the receiver pad, volts. */
  far: Float64Array;
  /** Apparent impedance a 50 ohm TDR would display, ohms. Empty when not requested. */
  tdrZ: Float64Array;
  /** Sample interval, seconds. */
  dt: number;
  /** Index of t = 0. */
  stepIndex: number;
  /** One-way delay of the line as specified, seconds. */
  delay: number;
  /** The delay the simulator actually used, minus the specified one, seconds. */
  delayError: number;
  /** How many samples one rise time spans. Below about 4, the edge is not resolved. */
  samplesPerRise: number;
  /** The edge the driver was modelled with. */
  response: ResponseSpec;
  /** Reflection coefficient at the driver. */
  gammaSource: number;
  /** Reflection coefficient at the load resistance. */
  gammaLoad: number;
  /** Size of the first wave down the line, volts. */
  launch: number;
  /** Where both ends sat before the step, volts. */
  initialLevel: number;
  /** Where both ends settle, volts. */
  finalLevel: number;
  /** The analytic lattice for the resistive part of the termination, in volts of change. */
  bounce: BounceDiagram;
  /** Far-end peak above its final value, as a fraction of the far-end step. */
  overshoot: number;
  /** After that peak, the lowest the far end falls below its final value, as a fraction of the step. */
  ringback: number;
  /** Last time the far end is outside 2% of its step from the final value, seconds after t = 0. */
  settling2pct: number;
  /** Whether the far end had settled within the record. */
  settled: boolean;
  /** TDR reading halfway down the line, ohms. */
  tdrLine: number;
  /** TDR reading one full delay after the load reflection first returns, ohms. */
  tdrLoad: number;
}

export const tlineJob: JobDefinition<TlineParams, TlineResult> = {
  kind: 'tline',

  defaults: { samples: 8192, delays: 10, minRiseTimes: 40, includeTdr: true },

  run({ scenario, params }: JobInput<TlineParams>, report): TlineResult {
    const src = scenario.source;
    const line = scenario.channel.tline;
    const response = edgeResponseOf(src);
    const tr = src.riseTime;
    const td = propagationDelay(line);

    // Grid. Enough record before the step for a zero-phase edge to start moving,
    // then whichever is longer of the requested number of delays or of rise times,
    // so a line much shorter than its edge still shows the whole edge.
    const pre = 6 * tr;
    const body = Math.max(Math.max(1, params.delays) * td, Math.max(4, params.minRiseTimes) * tr);
    const target = Math.min(TLINE_MAX_SAMPLES, Math.max(256, Math.floor(params.samples)));
    const dt0 = (pre + body) / target;

    // Make the delay a whole number of samples. When the line is shorter than half
    // a sample it is lumped at this resolution anyway, and one sample of delay is
    // used with the discrepancy reported rather than hidden.
    const m = Math.max(1, Math.round(td / dt0));
    const dt = td / dt0 < 0.5 ? dt0 : td / m;
    const n = Math.min(TLINE_MAX_SAMPLES, Math.ceil((pre + body) / dt));
    const stepIndex = Math.min(n - 1, Math.round(pre / dt));

    const ideal = new Float64Array(n);
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      ideal[i] = i < stepIndex ? 0 : 1;
      t[i] = (i - stepIndex) * dt;
    }

    report?.({ done: 1, total: 4, label: 'Shaping the launched edge' });
    const unit = applyResponse(ideal, 1 / dt, response);

    report?.({ done: 2, total: 4, label: 'Propagating' });
    const sim = simulateLine({ ...line, sourceZ: src.sourceZ }, unit, dt);

    const low = src.dcOffset - src.amplitude / 2;
    const swing = src.amplitude;
    const initialLevel = steadyStateVoltage(low, src.sourceZ, line.loadZ);
    const finalLevel = steadyStateVoltage(low + swing, src.sourceZ, line.loadZ);

    const source = new Float64Array(n);
    const near = new Float64Array(n);
    const far = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      source[i] = low + swing * unit[i];
      near[i] = initialLevel + swing * sim.near[i];
      far[i] = initialLevel + swing * sim.far[i];
    }

    report?.({ done: 3, total: 4, label: 'Running the TDR' });
    let tdrZ: Float64Array = new Float64Array(0);
    let tdrLine = line.z0;
    let tdrLoad = line.z0;
    if (params.includeTdr) {
      const probe = simulateLine({ ...line, sourceZ: TDR_REFERENCE_OHMS }, unit, dt);
      tdrZ = tdrImpedance(tdrReflection(probe.near, unit, 1), TDR_REFERENCE_OHMS);
      const at = (seconds: number): number => tdrZ[Math.min(n - 1, stepIndex + Math.round(seconds / dt))];
      tdrLine = at(td);
      tdrLoad = at(3 * td);
    }

    // Far-end measurements, against the step the far end actually takes.
    const step = finalLevel - initialLevel;
    const scale = Math.abs(step) > 0 ? Math.abs(step) : 1;
    let peak = -Infinity;
    let peakIndex = stepIndex;
    for (let i = stepIndex; i < n; i++) {
      if (far[i] > peak) {
        peak = far[i];
        peakIndex = i;
      }
    }
    let trough = finalLevel;
    for (let i = peakIndex; i < n; i++) if (far[i] < trough) trough = far[i];
    const overshoot = Math.max(0, (peak - finalLevel) / scale);
    const ringback = Math.max(0, (finalLevel - trough) / scale);

    let leave = -1;
    const band = 0.02 * scale;
    for (let i = n - 1; i >= stepIndex; i--) {
      if (Math.abs(far[i] - finalLevel) > band) {
        leave = i;
        break;
      }
    }
    // Settled means inside the band for at least the last 5% of the record, so a
    // trace that happens to cross back in on its final sample is not called settled.
    const settled = leave < n - 1 - Math.floor(0.05 * n);
    const settling2pct = leave < 0 ? 0 : (leave - stepIndex) * dt;

    report?.({ done: 4, total: 4, label: 'Drawing the lattice' });
    const bounce = bounceDiagram(
      { ...line, sourceZ: src.sourceZ, loadZ: line.loadZ, amplitude: swing },
      line.bounces,
    );

    return {
      t,
      source,
      near,
      far,
      tdrZ,
      dt,
      stepIndex,
      delay: td,
      delayError: sim.delay - td,
      samplesPerRise: tr / dt,
      response,
      gammaSource: sim.gammaSource,
      gammaLoad: sim.gammaLoad,
      launch: swing * sim.launchFraction,
      initialLevel,
      finalLevel,
      bounce,
      overshoot,
      ringback,
      settling2pct,
      settled,
      tdrLine,
      tdrLoad,
    };
  },

  transferables(r) {
    return buffersOf(r.t, r.source, r.near, r.far, r.tdrZ);
  },
};
