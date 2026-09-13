/**
 * The two figures of M2, as pure functions of their inputs.
 *
 * Same arrangement as M1 and for the same reason: a `ChromeSpec` is a claim, and
 * `__tests__/plots.test.ts` checks the claims rather than trusting them.
 *
 * The first figure is a job result - one edge, measured off the curve. The second
 * is not, and that is deliberate: a second-order step response is a closed form,
 * three exponentials wide, and pushing it through a worker would cost more in
 * message latency than it costs to evaluate. It is computed here through
 * `rlcStepResponse` and `rcStepResponse`, the same functions the test suite checks
 * against the FFT path, so "cheap enough to do inline" does not mean "done
 * differently".
 */

import { rcStepResponse, rlcCharacteristics, rlcStepResponse, type RlcParams } from '../../dsp/filters';
import type { EdgeResult } from '../../dsp/jobs';
import { semantic, signal } from '../../design/tokens';
import type { Surface } from '../../plots/canvas';
import type { ChromeSpec, MetricSpec } from '../../plots/chrome';
import { formatEng, linearScale, niceDomain } from '../../plots/scale';
import { drawHLine, drawUniformTrace } from '../../plots/trace';
import type { PlotRender } from '../../ui';

/** Human names for the response shapes, for captions and legends. */
export const RESPONSE_NAMES: Record<string, string> = {
  brickwall: 'brick wall',
  rc: 'single pole',
  butterworth: 'Butterworth',
  bessel: 'Bessel-Thomson',
  gaussian: 'Gaussian',
};

/* -------------------------------------------------------------------- edge */

export interface EdgeOptions {
  /** Low level of the step, volts. */
  low: number;
  /** High level of the step, volts. */
  high: number;
  /** Draw the scope-limited version of the same edge. */
  showScope: boolean;
}

/**
 * One edge, with the thresholds the rise time was measured between drawn on it.
 *
 * The reference lines are the argument. "Rise time" is not a property of an edge;
 * it is a property of an edge and a pair of levels, and the only way to make that
 * visible is to put both pairs of levels on the same picture and let the reader see
 * that they cut the same curve at four different places.
 */
export function edgeRender(r: EdgeResult, o: EdgeOptions): (s: Surface) => PlotRender {
  const n = r.t.length;
  const t0 = n > 0 ? r.t[0] : 0;
  const dt = n > 1 ? r.t[1] - r.t[0] : 1;
  const swing = o.high - o.low;
  const levels = [0.1, 0.2, 0.8, 0.9].map((f) => o.low + f * swing);

  let peak = o.high;
  for (let i = 0; i < n; i++) if (r.y[i] > peak) peak = r.y[i];
  const [lo, hi] = niceDomain([o.low - 0.08 * Math.abs(swing), peak + 0.08 * Math.abs(swing)], 5);

  const shape = RESPONSE_NAMES[r.response.type] ?? r.response.type;

  const metrics: MetricSpec[] = [
    {
      key: 'tr2080',
      label: 'Rise time, 20-80%',
      value: r.rise2080,
      unit: 's',
      note: 'the convention this Scenario states the driver in',
    },
    { key: 'tr1090', label: 'Rise time, 10-90%', value: r.rise1090, unit: 's' },
  ];

  if (Number.isFinite(r.conventionRatio)) {
    metrics.push({
      key: 'ratio',
      label: 'Ratio, 20-80% to 10-90%',
      value: r.conventionRatio,
      unit: '1',
      sig: 4,
      note: 'ln4/ln9 = 0.6309 for a single pole; every other shape differs',
    });
  }

  metrics.push(
    { key: 'overshoot', label: 'Overshoot', value: r.overshoot, unit: '%', sig: 3 },
    {
      key: 'settling',
      label: 'Settling, to within 2%',
      value: r.settling2pct,
      unit: 's',
      note: 'last time the trace leaves the band, not the first time it enters',
    },
    { key: 'bw', label: 'Response bandwidth, -3 dB', value: r.bandwidth, unit: 'Hz' },
  );

  if (Number.isFinite(r.kneeFrequency)) {
    metrics.push({
      key: 'knee',
      label: 'Knee frequency',
      value: r.kneeFrequency,
      unit: 'Hz',
      note: '0.5 / t_r at 10-90%',
    });
  }

  if (o.showScope && r.scopeLimited !== null && Number.isFinite(r.scopeLimited)) {
    metrics.push({
      key: 'scope',
      label: 'Rise time through the scope, 20-80%',
      value: r.scopeLimited,
      unit: 's',
      note: 'what the instrument would display, not what the driver did',
    });
  }

  return (s: Surface): PlotRender => {
    const xScale = linearScale([t0, t0 + dt * Math.max(1, n - 1)], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale([lo, hi], [s.plot.y + s.plot.height, s.plot.y]);

    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time, from the commanded transition', target: 0 },
      y: { scale: yScale, unit: 'V', title: 'Voltage' },
      traces: [
        {
          key: 'levels',
          label: 'Reference levels, 10 / 20 / 80 / 90%',
          color: semantic.marker,
          dash: [2, 3],
        },
        { key: 'edge', label: `Driver output, ${shape} response`, color: semantic.ideal },
        {
          key: 'scope',
          label: 'As the configured scope would show it',
          color: semantic.measured,
          dash: [6, 3],
          hidden: !o.showScope || r.scopeLimited === null,
        },
      ],
      caption: `A single rising edge through a ${shape} response of ${formatEng(r.response.bw, 'Hz', 3)}, with the four threshold levels the two rise-time conventions are measured between.`,
      metrics,
      grid: 'auto',
      legend: 'br',
      readout: 'none',
      notes: [
        'The commanded step is at t = 0. A response with no phase distortion begins moving before it, which is a property of the model and not of any real driver.',
      ],
    };

    return {
      spec,
      drawTraces(surface: Surface): void {
        for (const v of levels) {
          drawHLine(surface, v, yScale, { color: semantic.marker, width: 1, dash: [2, 3], alpha: 0.7 });
        }
        if (o.showScope && r.scopeLimited !== null) {
          drawUniformTrace(surface, r.measured, t0, dt, xScale, yScale, {
            color: semantic.measured,
            width: 1.5,
            dash: [6, 3],
          });
        }
        drawUniformTrace(surface, r.y, t0, dt, xScale, yScale, { color: semantic.ideal, width: 1.75 });
      },
    };
  };
}

/* ----------------------------------------------------------------- damping */

export interface DampingOptions extends RlcParams {
  /** Samples across the record. */
  samples?: number;
}

/**
 * The same L and C at three dampings, plus a first-order reference.
 *
 * Three traces from one network: the resistance the Scenario sets, the resistance
 * that would critically damp it, and a single pole of the same characteristic time.
 * The third is a reference and not the same circuit - it is what a first-order
 * system with time constant 1/omega_n does - and the caption says so, because a
 * curve on a plot that looks like the others invites being read as one of them.
 *
 * The record length follows the network rather than being fixed. A lightly damped
 * resonance needs to be seen ringing; a heavily damped one shown over the same span
 * would be a step with a flat line after it.
 */
export function dampingRender(o: DampingOptions): (s: Surface) => PlotRender {
  const { r, l, c } = o;
  const n = Math.max(64, Math.floor(o.samples ?? 1024));
  const ch = rlcCharacteristics({ r, l, c });
  const wn = 2 * Math.PI * ch.fn;
  const rCritical = 2 * ch.z0;

  // Long enough to show the behaviour, bounded so an overdamped network does not
  // collapse into the first pixel column and a lightly damped one is not cut off.
  const span = Math.min(Math.max(1.4 * ch.settling2pct, 6 / wn), 60 / wn);

  const t = new Float64Array(n);
  const dt = span / (n - 1);
  for (let i = 0; i < n; i++) t[i] = i * dt;

  const asSet = rlcStepResponse({ r, l, c }, t);
  const critical = rlcStepResponse({ r: rCritical, l, c }, t);
  const onePole = rcStepResponse(1 / wn, t);

  let peak = 1;
  for (let i = 0; i < n; i++) if (asSet[i] > peak) peak = asSet[i];
  const [lo, hi] = niceDomain([-0.05, peak + 0.08], 5);

  const metrics: MetricSpec[] = [
    {
      key: 'zeta',
      label: 'Damping ratio',
      value: ch.zeta,
      unit: '1',
      sig: 4,
      target: 1,
      note: `${ch.regime}; zeta = (R/2)*sqrt(C/L)`,
    },
    { key: 'fn', label: 'Undamped natural frequency', value: ch.fn, unit: 'Hz' },
    {
      key: 'fd',
      label: 'Ringing frequency',
      value: ch.fd,
      unit: 'Hz',
      note: ch.regime === 'underdamped' ? 'f_n * sqrt(1 - zeta^2)' : 'no ringing: not underdamped',
    },
    {
      key: 'overshoot',
      label: 'First-peak overshoot',
      value: ch.overshoot,
      unit: '%',
      sig: 4,
      note: 'exp(-pi*zeta/sqrt(1-zeta^2))',
    },
    { key: 'settling', label: 'Settling, to within 2%', value: ch.settling2pct, unit: 's' },
    {
      key: 'z0',
      label: 'LC characteristic impedance',
      value: ch.z0,
      unit: 'ohm',
      note: 'sqrt(L/C)',
    },
    {
      key: 'rcrit',
      label: 'Resistance for critical damping',
      value: rCritical,
      unit: 'ohm',
      target: r,
      note: 'R = 2*sqrt(L/C); the target beside it is the R currently set',
    },
  ];

  if (Number.isFinite(ch.timeToPeak)) {
    metrics.push({
      key: 'tpeak',
      label: 'Time to first peak',
      value: ch.timeToPeak,
      unit: 's',
      note: 'pi / omega_d',
    });
  }

  return (s: Surface): PlotRender => {
    const xScale = linearScale([0, span], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale([lo, hi], [s.plot.y + s.plot.height, s.plot.y]);

    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time from the step' },
      y: { scale: yScale, unit: '1', title: 'Response, normalised to the final value' },
      traces: [
        { key: 'one-pole', label: 'One pole, time constant 1/omega_n', color: signal.ch3, dash: [2, 3] },
        { key: 'critical', label: 'Same L and C, critically damped', color: semantic.ideal, dash: [6, 4] },
        { key: 'as-set', label: 'Series RLC, R as set', color: semantic.measured },
      ],
      caption: `Step response across the capacitor of a series RLC: as configured (${ch.regime}), the same network critically damped, and a first-order reference of the same characteristic time.`,
      metrics,
      grid: 'auto',
      legend: 'br',
      readout: 'none',
      notes: [
        'The first-order curve is a reference, not the same network: it is what a single pole with time constant 1/omega_n does, drawn for comparison.',
      ],
    };

    return {
      spec,
      drawTraces(surface: Surface): void {
        drawUniformTrace(surface, onePole, 0, dt, xScale, yScale, {
          color: signal.ch3,
          width: 1.25,
          dash: [2, 3],
        });
        drawUniformTrace(surface, critical, 0, dt, xScale, yScale, {
          color: semantic.ideal,
          width: 1.25,
          dash: [6, 4],
        });
        drawUniformTrace(surface, asSet, 0, dt, xScale, yScale, {
          color: semantic.measured,
          width: 1.75,
        });
      },
    };
  };
}
