/**
 * The figures of M4, as pure functions of a `lossy` job result.
 *
 * Same arrangement as M1 to M3: a `ChromeSpec` is a claim, and
 * `__tests__/plots.test.ts` checks the claims against the closed forms and against
 * `src/sim/channel/lossy.ts` evaluated directly.
 *
 * The frequency figures plot |S21| in dB, negative downward, because that is what a
 * VNA displays. The metrics state insertion loss as a positive number, because that
 * is how a loss budget is written. Both conventions are in use on every bench, and
 * the axis title and the metric label say which one each number follows.
 */

import {
  PRE_CURSORS,
  RETURN_LOSS_CAP_DB,
  launchedLevel,
  plateauCentre,
  type LossyResult,
} from '../../dsp/jobs/lossy-job';
import { semantic, signal, surface as ink } from '../../design/tokens';
import type { Surface } from '../../plots/canvas';
import type { ChromeSpec, MetricSpec } from '../../plots/chrome';
import { formatEng, linearScale, logScale, niceDomain } from '../../plots/scale';
import { drawHLine, drawSamples, drawUniformTrace, drawVLine, drawXY } from '../../plots/trace';
import type { PlotRender } from '../../ui';
import { roughnessRatio } from '../../sim/channel/lossy';

/** Mechanism colours, shared by every frequency figure so a curve keeps its identity. */
const TOTAL = semantic.measured;
const CONDUCTOR = signal.ch3;
const DIELECTRIC = semantic.ideal;
const APPROX = semantic.cursor;

/**
 * y(f) from samples on a log-spaced grid, interpolated linearly in log frequency,
 * clamped to the ends. The job's grid is fine enough (about 60 points a decade by
 * default) that the interpolation error is far below the width of a trace.
 */
export function valueAt(freq: Float64Array, y: Float64Array, f: number): number {
  const n = freq.length;
  if (n === 0) return NaN;
  if (!(f > freq[0])) return y[0];
  if (f >= freq[n - 1]) return y[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (freq[mid] <= f) lo = mid;
    else hi = mid;
  }
  const u = Math.log(f / freq[lo]) / Math.log(freq[hi] / freq[lo]);
  return y[lo] + u * (y[hi] - y[lo]);
}

/** The frequency at which the skin depth equals a surface length L: 1 / (pi mu0 sigma L^2), Hz. */
export function roughnessCorner(length: number, conductivity: number): number {
  const perHertz = roughnessRatio(1, length, conductivity);
  return perHertz > 0 ? 1 / perHertz : Infinity;
}

function negated(y: Float64Array, scale = 1): Float64Array {
  return y.map((v) => -v * scale);
}

function extent(arrays: readonly ArrayLike<number>[], from = 0, to?: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    const end = Math.min(a.length, to ?? a.length);
    for (let i = from; i < end; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo)) return [0, 1];
  return [lo, hi];
}

function freqScale(r: LossyResult, s: Surface) {
  const n = r.freq.length;
  return logScale([r.freq[0], r.freq[n - 1]], [s.plot.x, s.plot.x + s.plot.width]);
}

/* ------------------------------------------------------------------ breakdown */

export interface LossOptions {
  /** 'total' plots the route; 'perInch' divides every curve by its length in inches. */
  normalise: 'total' | 'perInch';
  /** Overlay the closed-form low-loss estimate. */
  showApprox: boolean;
  /**
   * Whether each mechanism is in the route. The single-mechanism curves are always
   * computed with their own mechanism on, so a switched-off one still shows what it
   * would add; the figure says so rather than drawing a flat line at zero.
   */
  conductorEnabled: boolean;
  dielectricEnabled: boolean;
}

/**
 * Insertion loss against frequency, the route and its two mechanisms.
 *
 * Conductor loss grows as sqrt(f) once the skin effect sets in, times a roughness
 * factor that rises towards its ceiling; dielectric loss grows as f. Where the two curves cross is the frequency above which the laminate,
 * not the copper, sets the loss, and it is the most useful single number on the plot.
 */
export function lossRender(r: LossyResult, o: LossOptions): (s: Surface) => PlotRender {
  const perInch = o.normalise === 'perInch';
  const k = perInch ? 1 / r.lengthInches : 1;
  const unit = perInch ? 'dB/in' : 'dB';
  const total = negated(r.ilTotal, k);
  const conductor = negated(r.ilConductor, k);
  const dielectric = negated(r.ilDielectric, k);
  const approx = negated(r.ilApprox, k);
  const [lo] = extent(o.showApprox ? [total, conductor, dielectric, approx] : [total, conductor, dielectric]);
  const [yLo, yHi] = niceDomain([Math.min(lo, -1e-3 * k), 0], 6);

  // Where conductor and dielectric loss are equal, from below: the first sign change.
  let crossover = NaN;
  for (let i = 1; i < r.freq.length; i++) {
    const a = r.ilConductor[i - 1] - r.ilDielectric[i - 1];
    const b = r.ilConductor[i] - r.ilDielectric[i];
    if (a > 0 && b <= 0) {
      const u = a / (a - b);
      crossover = r.freq[i - 1] * (r.freq[i] / r.freq[i - 1]) ** u;
      break;
    }
  }

  const metrics: MetricSpec[] = [
    {
      key: 'il',
      label: 'Insertion loss at Nyquist',
      value: r.ilNyquist,
      unit: 'dB',
      sig: 4,
      note: `${formatEng(r.nyquist, 'Hz', 3)}, half the symbol rate`,
    },
    {
      key: 'perInch',
      label: 'Insertion loss at Nyquist, per inch',
      value: r.ilNyquistPerInch,
      unit: 'dB/in',
      sig: 3,
      note: `over ${r.lengthInches.toFixed(2)} in, vias included`,
    },
    {
      key: 'conductor',
      label: 'Conductor loss alone at Nyquist',
      value: r.conductorNyquist,
      unit: 'dB',
      sig: 3,
    },
    {
      key: 'dielectric',
      label: 'Dielectric loss alone at Nyquist',
      value: r.dielectricNyquist,
      unit: 'dB',
      sig: 3,
    },
    {
      key: 'approx',
      label: 'Low-loss formula at Nyquist',
      value: r.approxNyquist,
      unit: 'dB',
      sig: 4,
      target: r.ilNyquist,
      note: '(alpha_c + alpha_d) l; no vias, no reflections, no internal inductance',
    },
    {
      key: 'skin',
      label: 'Skin depth at Nyquist',
      value: r.skinDepthNyquist,
      unit: 'm',
      sig: 3,
    },
    {
      key: 'rough',
      label: 'Roughness factor at Nyquist',
      value: r.roughnessNyquist,
      unit: '1',
      sig: 4,
      note: 'the loss multiplier on the skin-effect resistance; 1 with roughness off',
    },
  ];
  if (Number.isFinite(crossover)) {
    metrics.push({
      key: 'crossover',
      label: 'Frequency where the laminate overtakes the copper',
      value: crossover,
      unit: 'Hz',
      sig: 3,
    });
  }

  const notes: string[] = ['Between 50 ohm reference ports.'];
  if (!o.conductorEnabled) {
    notes.push('Conductor loss is switched off in the route; its curve shows what it would add.');
  }
  if (!o.dielectricEnabled) {
    notes.push('Dielectric loss is switched off in the route; its curve shows what it would add.');
  }

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale([yLo, yHi], [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', log: true, target: r.nyquist },
      y: { scale: yScale, unit, title: perInch ? '|S21| per inch' : '|S21|' },
      traces: [
        { key: 'total', label: 'Route as configured', color: TOTAL },
        { key: 'conductor', label: 'Conductor loss only', color: CONDUCTOR, dash: [6, 3] },
        { key: 'dielectric', label: 'Dielectric loss only', color: DIELECTRIC, dash: [6, 3] },
        {
          key: 'approx',
          label: 'Low-loss formula',
          color: APPROX,
          dash: [2, 3],
          hidden: !o.showApprox,
        },
      ],
      caption: `Insertion loss of the ${formatEng(r.lengthInches * 0.0254, 'm', 3)} route${perInch ? ' per inch' : ''}, and of each loss mechanism on its own, from ${formatEng(r.freq[0], 'Hz', 2)} to ${formatEng(r.freq[r.freq.length - 1], 'Hz', 2)}; the dotted vertical line is Nyquist.`,
      metrics,
      grid: 'auto',
      legend: 'bl',
      readout: 'none',
      notes,
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        drawVLine(sf, r.nyquist, xScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.8 });
        drawXY(sf, r.freq, conductor, xScale, yScale, { color: CONDUCTOR, width: 1.25, dash: [6, 3] });
        drawXY(sf, r.freq, dielectric, xScale, yScale, { color: DIELECTRIC, width: 1.25, dash: [6, 3] });
        if (o.showApprox)
          drawXY(sf, r.freq, approx, xScale, yScale, { color: APPROX, width: 1.25, dash: [2, 3] });
        drawXY(sf, r.freq, total, xScale, yScale, { color: TOTAL, width: 1.75 });
      },
    };
  };
}

/* ------------------------------------------------------------------ roughness */

export interface RoughnessOptions {
  /** 'loss' compares conductor-only insertion loss; 'factor' plots the factors themselves. */
  view: 'loss' | 'factor';
  /** Scenario copper, for the corner frequencies. */
  conductivity: number;
  roughnessRms: number;
  hurayRadius: number;
  hurayRatio: number;
}

/**
 * Smooth, Hammerstad and Huray copper, side by side.
 *
 * In the 'factor' view the solid curves are the real factors K, the multiplier on
 * resistance every loss budget uses, and the dashed ones are the imaginary parts of
 * their causal completions: the extra internal reactance, per unit of the smooth
 * surface reactance, that the same loss has to come with. They are drawn together
 * because the second is not optional; M4 shows what the far end does without it.
 */
export function roughnessRender(r: LossyResult, o: RoughnessOptions): (s: Surface) => PlotRender {
  const hammerCorner = roughnessCorner(o.roughnessRms, o.conductivity);
  const hurayCorner = roughnessCorner(o.hurayRadius, o.conductivity);
  const at = (y: Float64Array): number => valueAt(r.freq, y, r.nyquist);
  const isLoss = o.view === 'loss';

  const smooth = negated(r.ilSmooth);
  const hammer = negated(r.ilHammerstad);
  const huray = negated(r.ilHuray);

  let domain: [number, number];
  if (isLoss) {
    const [lo] = extent([smooth, hammer, huray]);
    domain = niceDomain([Math.min(lo, -1e-3), 0], 6);
  } else {
    const [, hi] = extent([r.kHammerstad, r.kHuray]);
    domain = niceDomain([0, Math.max(2.05, hi * 1.05)], 6);
  }

  const metrics: MetricSpec[] = isLoss
    ? [
        {
          key: 'smooth',
          label: 'Smooth copper at Nyquist',
          value: at(r.ilSmooth),
          unit: 'dB',
          sig: 3,
          note: 'conductor loss only',
        },
        {
          key: 'hammerstadExtra',
          label: 'Added by Hammerstad roughness at Nyquist',
          value: at(r.ilHammerstad) - at(r.ilSmooth),
          unit: 'dB',
          sig: 3,
        },
        {
          key: 'hurayExtra',
          label: 'Added by Huray roughness at Nyquist',
          value: at(r.ilHuray) - at(r.ilSmooth),
          unit: 'dB',
          sig: 3,
        },
      ]
    : [
        {
          key: 'kHammerstad',
          label: 'Hammerstad factor at Nyquist',
          value: at(r.kHammerstad),
          unit: '1',
          sig: 4,
          note: 'never exceeds 2',
        },
        {
          key: 'kHuray',
          label: 'Huray factor at Nyquist',
          value: at(r.kHuray),
          unit: '1',
          sig: 4,
          note: `tends to 1 + S = ${(1 + o.hurayRatio).toFixed(2)}`,
        },
        {
          key: 'imHammerstad',
          label: 'Hammerstad causal reactance term at Nyquist',
          value: at(r.kHammerstadIm),
          unit: '1',
          sig: 3,
        },
        {
          key: 'imHuray',
          label: 'Huray causal reactance term at Nyquist',
          value: at(r.kHurayIm),
          unit: '1',
          sig: 3,
        },
      ];
  if (Number.isFinite(hammerCorner)) {
    metrics.push({
      key: 'hammerstadCorner',
      label: 'Skin depth equals the RMS height at',
      value: hammerCorner,
      unit: 'Hz',
      sig: 3,
    });
  }
  if (Number.isFinite(hurayCorner)) {
    metrics.push({
      key: 'hurayCorner',
      label: 'Skin depth equals the nodule radius at',
      value: hurayCorner,
      unit: 'Hz',
      sig: 3,
    });
  }

  const traces = isLoss
    ? [
        { key: 'smooth', label: 'Smooth copper', color: semantic.ideal },
        { key: 'hammerstad', label: 'Hammerstad', color: CONDUCTOR },
        { key: 'huray', label: 'Huray', color: semantic.measured },
      ]
    : [
        { key: 'hammerstad', label: 'Hammerstad K', color: CONDUCTOR },
        { key: 'huray', label: 'Huray K', color: semantic.measured },
        {
          key: 'hammerstadIm',
          label: 'Hammerstad, 1 + causal imaginary part',
          color: CONDUCTOR,
          dash: [6, 3],
        },
        { key: 'hurayIm', label: 'Huray, 1 + causal imaginary part', color: semantic.measured, dash: [6, 3] },
      ];

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', log: true, target: r.nyquist },
      y: isLoss
        ? { scale: yScale, unit: 'dB', title: '|S21|, conductor loss only' }
        : { scale: yScale, unit: '1', title: 'Roughness factor' },
      traces,
      caption: isLoss
        ? 'Conductor-only insertion loss of the same route with smooth copper and with each roughness model, at the RMS height, nodule radius and surface ratio in the channel panel.'
        : 'The two roughness factors against frequency, with one plus the imaginary part each one needs to be causal; the dotted vertical lines are where the skin depth equals the roughness length of each model.',
      metrics,
      grid: 'auto',
      legend: isLoss ? 'bl' : 'tl',
      readout: 'none',
      notes: isLoss ? ['Between 50 ohm reference ports, dielectric loss and vias removed.'] : [],
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        drawVLine(sf, r.nyquist, xScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.8 });
        if (isLoss) {
          drawXY(sf, r.freq, smooth, xScale, yScale, { color: semantic.ideal, width: 1.5 });
          drawXY(sf, r.freq, hammer, xScale, yScale, { color: CONDUCTOR, width: 1.5 });
          drawXY(sf, r.freq, huray, xScale, yScale, { color: semantic.measured, width: 1.5 });
        } else {
          drawVLine(sf, hammerCorner, xScale, { color: CONDUCTOR, width: 1, dash: [1, 3], alpha: 0.7 });
          drawVLine(sf, hurayCorner, xScale, {
            color: semantic.measured,
            width: 1,
            dash: [1, 3],
            alpha: 0.7,
          });
          drawHLine(sf, 1, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
          drawXY(sf, r.freq, r.kHammerstad, xScale, yScale, { color: CONDUCTOR, width: 1.5 });
          drawXY(sf, r.freq, r.kHuray, xScale, yScale, { color: semantic.measured, width: 1.5 });
          // The imaginary parts are drawn from 1, the smooth-copper reference, so a
          // reader compares like with like: K - 1 is what roughness adds to the loss,
          // Im K_c is what it adds to the reactance.
          const offset = (y: Float64Array): Float64Array => y.map((v) => 1 + v);
          drawXY(sf, r.freq, offset(r.kHammerstadIm), xScale, yScale, {
            color: CONDUCTOR,
            width: 1.25,
            dash: [6, 3],
          });
          drawXY(sf, r.freq, offset(r.kHurayIm), xScale, yScale, {
            color: semantic.measured,
            width: 1.25,
            dash: [6, 3],
          });
        }
      },
    };
  };
}

/* ----------------------------------------------------------------- dielectric */

export interface DielectricOptions {
  quantity: 'permittivity' | 'lossTangent';
  enabled: boolean;
  /** The two stated values and the frequency they are stated at. */
  er: number;
  lossTangent: number;
  referenceFreq: number;
}

/**
 * The wideband Debye laminate: what one pair of numbers on a datasheet implies at
 * every other frequency. Both curves pass through the stated point exactly, and the
 * metric holds the figure to that.
 */
export function dielectricRender(r: LossyResult, o: DielectricOptions): (s: Surface) => PlotRender {
  const perm = o.quantity === 'permittivity';
  const y = perm ? r.epsReal : r.lossTangent;
  const [lo, hi] = extent([y]);
  const span = Math.max(hi - lo, perm ? 0.05 : 1e-4);
  const domain = niceDomain(perm ? [lo - 0.1 * span, hi + 0.1 * span] : [0, hi + 0.1 * span], 6);
  const stated = perm ? o.er : o.lossTangent;
  const unitLabel = perm ? 'Real relative permittivity' : 'Loss tangent';

  const metrics: MetricSpec[] = [
    {
      key: 'reference',
      label: `${unitLabel} at the stated frequency`,
      value: valueAt(r.freq, y, o.referenceFreq),
      unit: '1',
      sig: 4,
      target: o.enabled || perm ? stated : 0,
      note: `stated at ${formatEng(o.referenceFreq, 'Hz', 3)}`,
    },
    {
      key: 'nyquist',
      label: `${unitLabel} at Nyquist`,
      value: valueAt(r.freq, y, r.nyquist),
      unit: '1',
      sig: 4,
    },
    {
      key: 'low',
      label: `${unitLabel} at the lowest frequency shown`,
      value: y[0],
      unit: '1',
      sig: 4,
    },
  ];

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', log: true, target: o.referenceFreq },
      y: { scale: yScale, unit: '1', title: unitLabel },
      traces: [{ key: 'model', label: 'Wideband Debye fit', color: DIELECTRIC }],
      caption: `${unitLabel} of the laminate against frequency, fitted to ${o.er} and ${o.lossTangent} at ${formatEng(o.referenceFreq, 'Hz', 3)}; the vertical line marks that frequency.`,
      metrics,
      grid: 'auto',
      legend: 'none',
      readout: 'none',
      notes: o.enabled ? [] : ['Dielectric loss is switched off: the permittivity is the constant er.'],
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        drawVLine(sf, o.referenceFreq, xScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.8 });
        drawXY(sf, r.freq, y, xScale, yScale, { color: DIELECTRIC, width: 1.75 });
      },
    };
  };
}

/* ------------------------------------------------------------- S21 and S11 */

/** |S21| and |S11| together: loss and match, the two things a channel sweep is read for. */
export function sParamRender(r: LossyResult): (s: Surface) => PlotRender {
  const s21 = negated(r.ilTotal);
  const s11 = negated(r.returnLoss);
  const [lo] = extent([s21, s11]);
  const domain = niceDomain([Math.max(lo, -RETURN_LOSS_CAP_DB), 0], 6);
  const capped = r.returnLoss.some((v) => v >= RETURN_LOSS_CAP_DB);

  const metrics: MetricSpec[] = [
    { key: 'il', label: 'Insertion loss at Nyquist', value: r.ilNyquist, unit: 'dB', sig: 4 },
    {
      key: 'rl',
      label: 'Return loss at Nyquist',
      value: r.returnLossNyquist,
      unit: 'dB',
      sig: 3,
      note: 'larger is a better match',
    },
    { key: 'dc', label: '|S21| at DC', value: r.dcGain, unit: '1', sig: 6, note: 'the series resistance' },
  ];
  const notes = ['Between 50 ohm reference ports.'];
  if (capped) notes.push(`Return loss is drawn no lower than -${RETURN_LOSS_CAP_DB} dB.`);

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', log: true, target: r.nyquist },
      y: { scale: yScale, unit: 'dB', title: 'Magnitude' },
      traces: [
        { key: 's21', label: '|S21|, transmission', color: TOTAL },
        { key: 's11', label: '|S11|, reflection', color: CONDUCTOR },
      ],
      caption:
        'Transmission and reflection of the route in 50 ohm ports: the loss the far end sees, and how much of the launched wave comes back.',
      metrics,
      grid: 'auto',
      legend: 'bl',
      readout: 'none',
      notes,
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        drawVLine(sf, r.nyquist, xScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.8 });
        drawXY(sf, r.freq, s11, xScale, yScale, { color: CONDUCTOR, width: 1.25 });
        drawXY(sf, r.freq, s21, xScale, yScale, { color: TOTAL, width: 1.75 });
      },
    };
  };
}

/* --------------------------------------------------------------- group delay */

/**
 * Group delay against frequency, between the two bounds causality sets: nothing
 * faster than the permittivity at infinite frequency allows, and, for a loss-free
 * copy of the line, exactly l sqrt(er) / c.
 */
export function groupDelayRender(r: LossyResult): (s: Surface) => PlotRender {
  const [lo, hi] = extent([r.groupDelay, [r.earliestArrival, r.losslessDelay]]);
  const span = Math.max(hi - lo, 1e-3 * hi);
  const domain = niceDomain([lo - 0.1 * span, hi + 0.1 * span], 6);

  const metrics: MetricSpec[] = [
    { key: 'gd', label: 'Group delay at Nyquist', value: r.groupDelayNyquist, unit: 's', sig: 4 },
    {
      key: 'lossless',
      label: 'Delay with the dielectric loss-free',
      value: r.losslessDelay,
      unit: 's',
      sig: 4,
      note: 'l sqrt(er) / c',
    },
    {
      key: 'earliest',
      label: 'Earliest possible arrival',
      value: r.earliestArrival,
      unit: 's',
      sig: 4,
      note: 'l sqrt(eps_inf) / c; group delay is not bounded by it, the signal front is',
    },
    {
      key: 'dispersion',
      label: 'Group delay spread across the plot',
      value: extent([r.groupDelay])[1] - extent([r.groupDelay])[0],
      unit: 's',
      sig: 3,
      note: 'slower at low frequency, where permittivity and internal inductance are higher',
    },
  ];

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', log: true, target: r.nyquist },
      y: { scale: yScale, unit: 's', title: 'Group delay' },
      traces: [
        { key: 'gd', label: 'Group delay of S21', color: TOTAL },
        { key: 'lossless', label: 'Loss-free dielectric', color: semantic.ideal, dash: [6, 3] },
        { key: 'earliest', label: 'Earliest arrival', color: CONDUCTOR, dash: [2, 3] },
      ],
      caption:
        'Group delay of the route against frequency, with the delay of a loss-free copy of it and the earliest arrival causality allows.',
      metrics,
      grid: 'auto',
      legend: 'tr',
      readout: 'none',
      notes: [],
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        drawHLine(sf, r.losslessDelay, yScale, { color: semantic.ideal, width: 1.25, dash: [6, 3] });
        drawHLine(sf, r.earliestArrival, yScale, { color: CONDUCTOR, width: 1.25, dash: [2, 3] });
        drawXY(sf, r.freq, r.groupDelay, xScale, yScale, { color: TOTAL, width: 1.75 });
      },
    };
  };
}

/* ---------------------------------------------------------- pulse and step */

export interface PulseOptions {
  view: 'pulse' | 'step';
  /** UIs of record shown after the main cursor. */
  uisAfter: number;
}

/** Time of sample i, seconds, with t = 0 at the leading edge of the launched pulse. */
function timeOf(r: LossyResult, i: number): number {
  return (i - r.startIndex) * r.dt;
}

/**
 * The launched one-UI pulse and what arrives, or the same for a step.
 *
 * The pulse view marks the cursors, one UI apart through the main cursor: every
 * one but the main cursor is energy that belongs to this bit and lands on a
 * neighbour. The step view is what a scope with a TDT-style step shows, and settles
 * to the DC gain.
 */
export function pulseRender(r: LossyResult, o: PulseOptions): (s: Surface) => PlotRender {
  const step = o.view === 'step';
  const input = step ? r.stepIn : r.pulseIn;
  const output = step ? r.stepOut : r.pulseOut;
  const spu = r.samplesPerUi;
  const mainIndex = plateauCentre(r.pulseOut);
  const first = Math.max(0, r.startIndex - 2 * spu);
  const last = Math.min(r.pulseOut.length - 1, mainIndex + Math.max(2, Math.floor(o.uisAfter)) * spu);
  const [lo, hi] = extent([input, output], first, last + 1);
  const domain = niceDomain([Math.min(lo, 0) - 0.05, Math.max(hi, 1) + 0.05], 6);

  const cursorT: number[] = [];
  const cursorY: number[] = [];
  for (let k = 0; k < r.cursors.length; k++) {
    const j = mainIndex + (k - PRE_CURSORS) * spu;
    if (j >= first && j <= last) {
      cursorT.push(timeOf(r, j));
      cursorY.push(r.cursors[k]);
    }
  }

  const metrics: MetricSpec[] = step
    ? [
        {
          key: 'dc',
          label: 'Level the step settles to',
          value: r.stepOut[r.stepOut.length - 1],
          unit: '1',
          sig: 5,
          target: r.dcGain,
          note: 'target is |S21| at DC, the series resistance between the ports',
        },
        {
          key: 'delay',
          label: 'Delay, 50% to 50%',
          value: r.pulseDelay,
          unit: 's',
          sig: 4,
        },
        { key: 'earliest', label: 'Earliest possible arrival', value: r.earliestArrival, unit: 's', sig: 4 },
      ]
    : [
        {
          key: 'main',
          label: 'Main cursor',
          value: r.mainCursor,
          unit: '1',
          sig: 4,
          note: 'far-end pulse peak over launched pulse height',
        },
        {
          key: 'delay',
          label: 'Delay, 50% to 50% of the step',
          value: r.pulseDelay,
          unit: 's',
          sig: 4,
        },
        {
          key: 'isi',
          label: 'Sum of every other cursor',
          value: r.isiSum,
          unit: '1',
          sig: 3,
          note: 'relative to the main cursor',
        },
        {
          key: 'pde',
          label: 'Worst-case inner eye, by peak distortion',
          value: r.peakDistortionEye,
          unit: '1',
          sig: 3,
          note: 'main cursor minus every other cursor, of the launched height; below zero the eye is shut for some pattern',
        },
        {
          key: 'precursor',
          label: 'Largest value before the earliest arrival',
          value: r.precursorLeak,
          unit: '1',
          format: 'exp',
          sig: 2,
          note: 'relative to the main cursor; a causal model leaves only the record wrap',
        },
      ];

  const notes: string[] = [];
  if (r.recordTruncated) notes.push('The record hit the sample ceiling; the tail is cut short.');
  if (r.tailResidual > 1e-3) {
    notes.push(`The pulse has not died away by the end of the record (${r.tailResidual.toExponential(1)}).`);
  }

  return (s: Surface): PlotRender => {
    const xScale = linearScale([timeOf(r, first), timeOf(r, last)], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time, from the launched edge', target: 0 },
      y: { scale: yScale, unit: '1', title: step ? 'Step, of launched height' : 'Pulse, of launched height' },
      traces: [
        { key: 'in', label: step ? 'Launched step' : 'Launched pulse', color: semantic.ideal },
        { key: 'out', label: step ? 'Far-end step' : 'Far-end pulse', color: semantic.measured },
        { key: 'earliest', label: 'Earliest arrival', color: CONDUCTOR, dash: [2, 3] },
        { key: 'cursors', label: 'Cursors, one UI apart', color: semantic.cursor, hidden: step },
      ],
      caption: step
        ? `A unit step launched into the route and what reaches the far end ${formatEng(r.pulseDelay, 's', 3)} later.`
        : `A one-UI pulse launched into the route and what reaches the far end, sampled one UI apart through its peak.`,
      metrics,
      grid: 'auto',
      legend: 'tr',
      readout: 'none',
      notes,
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        const range: [number, number] = [first, last + 1];
        const t0 = timeOf(r, 0);
        drawHLine(sf, 0, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        if (step) drawHLine(sf, r.dcGain, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        drawVLine(sf, r.earliestArrival, xScale, { color: CONDUCTOR, width: 1.25, dash: [2, 3] });
        drawUniformTrace(sf, input, t0, r.dt, xScale, yScale, { color: semantic.ideal, width: 1.5 }, range);
        drawUniformTrace(
          sf,
          output,
          t0,
          r.dt,
          xScale,
          yScale,
          { color: semantic.measured, width: 1.75 },
          range,
        );
        if (!step) drawSamples(sf, cursorT, cursorY, xScale, yScale, semantic.cursor, 3);
      },
    };
  };
}

/* ----------------------------------------------------------------- precursor */

/**
 * The start of the far-end pulse, magnified, with causal roughness and with the real
 * factor. The real factor has a flat phase where the causal one has the reactance
 * the loss requires, and the difference is signal arriving before any wave could.
 */
export function precursorRender(causal: LossyResult, real: LossyResult): (s: Surface) => PlotRender {
  const ui = causal.samplesPerUi * causal.dt;
  const tFrom = -2 * ui;
  const tTo = causal.earliestArrival + 1.5 * ui;
  const first = Math.max(0, causal.startIndex + Math.floor(tFrom / causal.dt));
  const last = Math.min(causal.pulseOut.length - 1, causal.startIndex + Math.ceil(tTo / causal.dt));
  const peak = Math.max(causal.precursorLeak * causal.mainCursor, real.precursorLeak * real.mainCursor, 1e-4);
  const domain = niceDomain([-4 * peak, 4 * peak], 6);

  const metrics: MetricSpec[] = [
    {
      key: 'causal',
      label: 'Before the earliest arrival, causal roughness',
      value: causal.precursorLeak,
      unit: '1',
      format: 'exp',
      sig: 2,
      note: 'of the main cursor',
    },
    {
      key: 'real',
      label: 'Before the earliest arrival, real roughness factor',
      value: real.precursorLeak,
      unit: '1',
      format: 'exp',
      sig: 2,
      note: 'of the main cursor',
    },
    { key: 'earliest', label: 'Earliest possible arrival', value: causal.earliestArrival, unit: 's', sig: 4 },
  ];

  return (s: Surface): PlotRender => {
    const xScale = linearScale(
      [timeOf(causal, first), timeOf(causal, last)],
      [s.plot.x, s.plot.x + s.plot.width],
    );
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time, from the launched edge' },
      y: { scale: yScale, unit: '1', title: 'Far-end pulse, of launched height' },
      traces: [
        { key: 'real', label: 'Real roughness factor', color: signal.ch4 },
        { key: 'causal', label: 'Causal roughness', color: semantic.measured },
        { key: 'earliest', label: 'Earliest arrival', color: CONDUCTOR, dash: [2, 3] },
      ],
      caption:
        'The leading edge of the far-end pulse magnified until the part before the earliest causal arrival is visible, with roughness applied as a real factor and in its causal form.',
      metrics,
      grid: 'auto',
      legend: 'tl',
      readout: 'none',
      notes: ['Vertical scale magnified; the pulse itself runs off the top.'],
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        const range: [number, number] = [first, last + 1];
        drawHLine(sf, 0, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        drawVLine(sf, causal.earliestArrival, xScale, { color: CONDUCTOR, width: 1.25, dash: [2, 3] });
        drawUniformTrace(
          sf,
          real.pulseOut,
          timeOf(real, 0),
          real.dt,
          xScale,
          yScale,
          { color: signal.ch4, width: 1.5 },
          range,
        );
        drawUniformTrace(
          sf,
          causal.pulseOut,
          timeOf(causal, 0),
          causal.dt,
          xScale,
          yScale,
          { color: semantic.measured, width: 1.75 },
          range,
        );
      },
    };
  };
}

/* ---------------------------------------------------------------- bit stream */

/**
 * Worst sampled level at the centre of each UI, as a fraction of the launched
 * level, sign-corrected for the bit sent. 1 is a perfect sample; below 0 a slicer at
 * zero would decide the bit wrongly.
 */
export function worstCentreLevel(r: LossyResult, level: number): number {
  const spu = r.samplesPerUi;
  let worst = Infinity;
  for (let b = 0; b < r.bits.length; b++) {
    const i = b * spu + (spu >> 1);
    if (i >= r.streamOut.length) break;
    const sign = r.bits[b] ? 1 : -1;
    worst = Math.min(worst, (sign * r.streamOut[i]) / level);
  }
  return Number.isFinite(worst) ? worst : NaN;
}

export interface StreamOptions {
  /** The Scenario's open-circuit swing, volts peak to peak. The launched level is `launchedLevel` of it. */
  amplitude: number;
}

/** The launched bit stream and what arrives, with the delay taken out so they overlay. */
export function streamRender(r: LossyResult, o: StreamOptions): (s: Surface) => PlotRender {
  const spu = r.samplesPerUi;
  const level = launchedLevel(o.amplitude);
  const [lo, hi] = extent([r.streamIn, r.streamOut]);
  const bound = Math.max(Math.abs(lo), Math.abs(hi), level) * 1.1;
  const domain = niceDomain([-bound, bound], 6);
  const worst = worstCentreLevel(r, level);

  const metrics: MetricSpec[] = [
    {
      key: 'worst',
      label: 'Worst level at a UI centre',
      value: worst,
      unit: '1',
      sig: 3,
      note: 'of the launched level, signed for the bit sent; below zero a slicer at 0 V errs',
    },
    {
      key: 'main',
      label: 'Main cursor',
      value: r.mainCursor,
      unit: '1',
      sig: 4,
    },
    {
      key: 'delay',
      label: 'Delay removed from the far end',
      value: Math.round(r.pulseDelay / r.dt) * r.dt,
      unit: 's',
      sig: 4,
      note: 'the 50% delay, rounded to a whole sample',
    },
  ];

  return (s: Surface): PlotRender => {
    const xScale = linearScale([0, r.bits.length], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'UI', title: 'Time' },
      y: { scale: yScale, unit: 'V', title: 'Voltage' },
      traces: [
        { key: 'in', label: 'Launched', color: semantic.ideal },
        { key: 'out', label: 'Far end, delay removed', color: semantic.measured },
      ],
      caption: `${r.bits.length} bits of the source pattern as launched into the route and as they arrive, shifted back by ${formatEng(Math.round(r.pulseDelay / r.dt) * r.dt, 's', 3)} so each bit sits over the bit that was sent.`,
      metrics,
      grid: 'auto',
      legend: 'tr',
      readout: 'none',
      notes: ['Built by superposing one far-end pulse per bit, which is exact for a linear route.'],
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        const d = 1 / spu;
        drawHLine(sf, 0, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        drawUniformTrace(sf, r.streamIn, 0, d, xScale, yScale, { color: semantic.ideal, width: 1.25 });
        drawUniformTrace(sf, r.streamOut, 0, d, xScale, yScale, { color: semantic.measured, width: 1.75 });
      },
    };
  };
}
