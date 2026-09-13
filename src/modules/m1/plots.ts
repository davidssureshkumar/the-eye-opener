/**
 * The two figures of M1, as pure functions of a job result.
 *
 * Kept out of the `.tsx` body deliberately. A `ChromeSpec` is a claim about what a
 * picture says - its axes, its traces, its numbers and the sentence under it - and a
 * claim is worth testing. `__tests__/plots.test.ts` builds both specs from a real
 * `runJob('fourier', ...)` result and runs them through `validateChrome`, so a
 * mislabelled axis or an unlabelled trace fails the build rather than shipping.
 *
 * Nothing here computes physics. Everything drawn comes from `FourierResult`, and
 * the one curve that is not a job output - the coefficient envelope - is evaluated
 * through `harmonicEnvelope`, the same function the harmonic amplitudes come from.
 * A figure drawn from its own private arithmetic is a figure that can disagree with
 * the text beside it.
 */

import { harmonicEnvelope, type WaveShape } from '../../dsp/fourier';
import type { FourierResult } from '../../dsp/jobs';
import { semantic, signal, signalMuted } from '../../design/tokens';
import type { Surface } from '../../plots/canvas';
import type { ChromeSpec, MetricSpec } from '../../plots/chrome';
import { linearScale, niceDomain } from '../../plots/scale';
import { drawStems } from '../../plots/stem';
import { drawUniformTrace, drawXY } from '../../plots/trace';
import type { PlotRender } from '../../ui';

/** Shapes whose ideal waveform has a jump, and therefore a Gibbs overshoot. */
const DISCONTINUOUS: readonly WaveShape[] = ['square', 'sawtooth', 'pulse'];

/** Shapes whose envelope is a pure power law, so a roll-off figure means something. */
const POWER_LAW: readonly WaveShape[] = ['square', 'triangle', 'sawtooth'];

export const SHAPE_NAMES: Record<WaveShape, string> = {
  square: 'square wave',
  triangle: 'triangle wave',
  sawtooth: 'sawtooth',
  pulse: 'pulse train',
};

export interface SynthesisOptions {
  shape: WaveShape;
  /** Draw each harmonic underneath the sum. */
  showEach: boolean;
}

/* ---------------------------------------------------------------- synthesis */

/**
 * The partial sum against what it is converging to.
 *
 * Three things share one picture because the argument needs all three at once: the
 * ideal waveform, the sum of N harmonics, and - optionally - the harmonics
 * themselves, so the reader can see which one is responsible for which wiggle.
 *
 * The vertical scale is set from the data rather than fixed at plus or minus one.
 * Fixing it would clip the very thing the module is about: at N = 1 a square wave's
 * partial sum peaks at 4/pi = 1.27, well outside the ideal.
 */
export function synthesisRender(r: FourierResult, o: SynthesisOptions): (s: Surface) => PlotRender {
  const n = r.y.length;
  const period = n > 1 ? r.t[1] * n : 1;
  const dt = period / n;
  const count = r.terms.filter((t) => t.n > 0).length;

  let m = 1;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(r.y[i]);
    if (a > m) m = a;
  }
  const [lo, hi] = niceDomain([-m * 1.06, m * 1.06], 5);

  const gibbs = DISCONTINUOUS.includes(o.shape);
  const metrics: MetricSpec[] = [
    {
      key: 'harmonics',
      label: 'Harmonics summed',
      value: count,
      unit: '1',
      format: 'integer',
      note: `highest is n = ${r.terms.length > 0 ? r.terms[r.terms.length - 1].n : 0}`,
    },
    { key: 'fmax', label: 'Highest harmonic', value: r.highestFrequency, unit: 'Hz' },
    {
      key: 'overshoot',
      label: 'Peak overshoot',
      value: r.overshoot.fractionOfJump,
      unit: '%',
      sig: 4,
      ...(gibbs ? { target: r.gibbsLimit } : {}),
      note: gibbs
        ? 'fraction of the jump; the target is the Wilbraham-Gibbs limit'
        : 'this shape is continuous, so there is no jump to overshoot',
    },
    { key: 'rms', label: 'RMS error', value: r.rmsError, unit: '1', sig: 3 },
    {
      key: 'peak-offset',
      label: 'Overshoot peak, from the edge',
      value: (r.overshoot.peakIndex / n) * period,
      unit: 's',
      note: 'moves toward the edge as harmonics are added; its height does not',
    },
  ];

  return (s: Surface): PlotRender => {
    const xScale = linearScale([0, period], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale([lo, hi], [s.plot.y + s.plot.height, s.plot.y]);

    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time' },
      y: { scale: yScale, unit: '1', title: 'Amplitude' },
      traces: [
        {
          key: 'each',
          label: 'Individual harmonics',
          color: signalMuted.ch3,
          hidden: !o.showEach || r.each.length === 0,
        },
        { key: 'ideal', label: `Ideal ${SHAPE_NAMES[o.shape]}`, color: semantic.ideal, dash: [5, 4] },
        { key: 'sum', label: `Sum of ${count} harmonics`, color: signal.ch3 },
      ],
      caption: `One period of a ${SHAPE_NAMES[o.shape]}: the waveform the series converges to, and the sum of its first ${count} harmonics.`,
      metrics,
      grid: 'auto',
      legend: 'tr',
      readout: 'none',
      notes: gibbs ? ['The overshoot does not shrink as harmonics are added. It only gets narrower.'] : [],
    };

    return {
      spec,
      drawTraces(surface: Surface): void {
        if (o.showEach) {
          for (const h of r.each) {
            drawUniformTrace(surface, h, 0, dt, xScale, yScale, {
              color: signalMuted.ch3,
              width: 1,
            });
          }
        }
        drawUniformTrace(surface, r.ideal, 0, dt, xScale, yScale, {
          color: semantic.ideal,
          width: 1.25,
          dash: [5, 4],
        });
        drawUniformTrace(surface, r.y, 0, dt, xScale, yScale, { color: signal.ch3, width: 1.75 });
      },
    };
  };
}

/* ----------------------------------------------------------------- spectrum */

export interface SpectrumOptions {
  shape: WaveShape;
  duty: number;
  /** Lowest level shown, dB relative to the fundamental. */
  floorDb?: number;
}

/**
 * Where the harmonics land, and how fast they die away.
 *
 * A stem per term at its real frequency, against the continuous envelope the
 * coefficients follow. Levels are relative to the fundamental, so the picture is
 * about shape and does not move when the amplitude slider does.
 *
 * The stems hang from the bottom of the axis rather than from zero. On a dB axis a
 * baseline of zero would draw every stem downward from the top of the plot, which
 * is arithmetically defensible and visually backwards.
 */
export function spectrumRender(r: FourierResult, o: SpectrumOptions): (s: Surface) => PlotRender {
  const floorDb = o.floorDb ?? -60;
  const ac = r.terms.filter((t) => t.n > 0);
  const highestN = ac.length > 0 ? ac[ac.length - 1].n : 1;
  const fMax = (highestN + 1) * r.f0;

  const freqs = new Float64Array(ac.length);
  const levels = new Float64Array(ac.length);
  for (let i = 0; i < ac.length; i++) {
    freqs[i] = ac[i].frequency;
    levels[i] = Math.max(floorDb, ac[i].relativeDb);
  }

  const fundamental = Math.abs(ac.find((t) => t.n === 1)?.amplitude ?? 1);

  const metrics: MetricSpec[] = [
    { key: 'f0', label: 'Fundamental', value: r.f0, unit: 'Hz' },
    { key: 'fmax', label: 'Highest harmonic', value: r.highestFrequency, unit: 'Hz' },
  ];

  if (POWER_LAW.includes(o.shape)) {
    const decade =
      20 * Math.log10(harmonicEnvelope(o.shape, 10, o.duty) / harmonicEnvelope(o.shape, 1, o.duty));
    metrics.push({
      key: 'rolloff',
      label: 'Envelope roll-off per decade',
      value: decade,
      unit: 'dB',
      note: o.shape === 'triangle' ? 'a continuous waveform, so 1/n squared' : '1/n',
    });
  }

  // Only for a pulse, and only when the second harmonic exists: at exactly 50% it is
  // a null, and reporting "-inf dB" as a duty measurement helps nobody.
  const second = ac.find((t) => t.n === 2);
  if (o.shape === 'pulse' && second !== undefined && Number.isFinite(second.relativeDb)) {
    const ratio = Math.abs(second.amplitude) / fundamental;
    metrics.push(
      { key: 'h2', label: 'Second harmonic', value: second.relativeDb, unit: 'dB', sig: 4 },
      {
        key: 'duty-h2',
        label: 'Duty recovered from the second harmonic',
        value: Math.acos(Math.min(1, ratio)) / Math.PI,
        unit: '1',
        sig: 4,
        target: Math.min(o.duty, 1 - o.duty),
        note: 'from |a2/a1| = |cos(pi d)|; the two-to-one ambiguity is settled by the DC level',
      },
    );
  }

  return (s: Surface): PlotRender => {
    const xScale = linearScale([0, fMax], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale([floorDb, 6], [s.plot.y + s.plot.height, s.plot.y]);

    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', target: r.f0 },
      y: { scale: yScale, unit: 'dB', title: 'Level, relative to the fundamental' },
      traces: [
        { key: 'envelope', label: 'Coefficient envelope', color: signal.ch2, dash: [4, 4] },
        { key: 'lines', label: 'Harmonics', color: signal.ch3 },
      ],
      caption: `Harmonic content of a ${SHAPE_NAMES[o.shape]}: one line per term, at the frequency it occupies, against the envelope the coefficients follow.`,
      metrics,
      grid: 'auto',
      legend: 'tr',
      readout: 'none',
      notes: ['Levels are relative to the fundamental, so the picture does not move with amplitude.'],
    };

    return {
      spec,
      drawTraces(surface: Surface): void {
        // The envelope is continuous in frequency; sample it once per pixel column.
        const cols = Math.max(2, Math.round(surface.plot.width));
        const ex = new Float64Array(cols);
        const ey = new Float64Array(cols);
        for (let i = 0; i < cols; i++) {
          const f = (i / (cols - 1)) * fMax;
          const nu = r.f0 > 0 ? f / r.f0 : 0;
          const e = harmonicEnvelope(o.shape, nu, o.duty);
          ex[i] = f;
          ey[i] = e > 0 && Number.isFinite(e) ? Math.max(floorDb, 20 * Math.log10(e / fundamental)) : floorDb;
        }
        drawXY(surface, ex, ey, xScale, yScale, { color: signal.ch2, width: 1.25, dash: [4, 4] });
        drawStems(
          surface,
          freqs,
          levels,
          xScale,
          yScale,
          { color: signal.ch3, width: 2, markerRadius: 3 },
          floorDb,
        );
      },
    };
  };
}
