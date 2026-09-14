/**
 * The figures of M4's measured-channel half, as pure functions of a `measured` job
 * result.
 *
 * Same arrangement as `./plots.ts`: every number a figure prints is declared in its
 * `ChromeSpec`, and `__tests__/measured-plots.test.ts` checks those numbers against
 * the closed forms of the synthetic networks and against the job's own fields.
 *
 * The measured half plots frequency on a linear axis, unlike the lossy half. A VNA
 * sweeps in equal steps, the loss deviation fit assumes equal steps, and a skew null
 * or a resonance is a feature of fixed width in hertz, which a log axis squeezes
 * against its right edge.
 */

import { risingCrossing } from '../../dsp/jobs/lossy-job';
import type { MeasuredResult } from '../../dsp/jobs/measured-job';
import { font, fontSize, semantic, signal, signalMuted, surface as ink } from '../../design/tokens';
import type { Surface } from '../../plots/canvas';
import type { ChromeSpec, MetricSpec, TraceSpec } from '../../plots/chrome';
import { formatEng, linearScale, niceDomain } from '../../plots/scale';
import { drawHLine, drawUniformTrace, drawVLine, drawXY } from '../../plots/trace';
import type { WeaveLegs, WeaveSpec } from '../../sim/touchstone/examples';
import type { PlotRender } from '../../ui';

const THRU = semantic.measured;
const LEG_P = semantic.ideal;
const LEG_N = signal.ch3;
const CONVERSION = semantic.error;
const REFLECTION = ink.textLo;

/** Metres in an inch. */
const INCH = 0.0254;

/** y(x) on an increasing grid, linear between samples, clamped at the ends. NaN for no data. */
export function linearAt(x: ArrayLike<number>, y: ArrayLike<number>, x0: number): number {
  const n = Math.min(x.length, y.length);
  if (n === 0) return NaN;
  if (!(x0 > x[0])) return y[0];
  if (x0 >= x[n - 1]) return y[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= x0) lo = mid;
    else hi = mid;
  }
  return y[lo] + ((y[hi] - y[lo]) * (x0 - x[lo])) / (x[hi] - x[lo]);
}

/** Fractional index at which a step first crosses half its settled level, sign-aware; NaN if never. */
export function halfIndex(step: Float64Array): number {
  const top = step[step.length - 1];
  if (!(Math.abs(top) > 1e-9)) return NaN;
  const x = top > 0 ? step : step.map((v) => -v);
  return risingCrossing(x, 0.5 * Math.abs(top), 0);
}

function extent(arrays: readonly ArrayLike<number>[], from = 0, to?: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of arrays) {
    const end = Math.min(a.length, to ?? a.length);
    for (let i = Math.max(0, from); i < end; i++) {
      const v = a[i];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

function freqScale(r: MeasuredResult, s: Surface) {
  return linearScale([0, r.fMax], [s.plot.x, s.plot.x + s.plot.width]);
}

function timeOf(r: MeasuredResult, i: number): number {
  return (i - r.startIndex) * r.dt;
}

function nyquistLine(sf: Surface, r: MeasuredResult, xScale: ReturnType<typeof freqScale>): void {
  if (r.nyquist <= r.fMax)
    drawVLine(sf, r.nyquist, xScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.8 });
}

/** Touchstone's name for a transfer between 0-based ports: S21, or S11,12 beyond nine ports. */
export function sName(r: Pick<MeasuredResult, 'ports'>, out: number, input: number): string {
  return r.ports > 9 ? `S${out + 1},${input + 1}` : `S${out + 1}${input + 1}`;
}

function sweepNotes(r: MeasuredResult): string[] {
  const notes: string[] = [];
  if (r.source !== 'file') notes.push('Synthetic network built from the lossy line; illustrative values.');
  if (r.nyquistCoverage < 1) {
    notes.push(`The sweep stops at ${formatEng(r.fMax, 'Hz', 3)}, below Nyquist; the rest is extrapolated.`);
  }
  return notes;
}

/* ------------------------------------------------------------ mixed mode */

/**
 * The through transfer with what surrounds it: for a pair, each leg alone and the
 * differential-to-common conversion; in either mode the input reflection. For a
 * skewed pair of otherwise identical legs, |Sdd21| = |S21| |cos(pi f tau)| and
 * |Scd21| = |S21| |sin(pi f tau)|: the null is where the conversion peaks.
 */
export function mixedModeRender(r: MeasuredResult): (s: Surface) => PlotRender {
  const pair = r.mode === 'differential';
  const floor = -60;
  const clip = (y: Float64Array) => y.map((v) => Math.max(floor, v));
  const thru = clip(r.thruDb);
  const reflection = clip(r.reflectionDb);
  const conversion = clip(r.conversionDb);
  const legP = clip(r.legPDb);
  const legN = clip(r.legNDb);
  const [lo] = extent([thru, reflection, conversion, legP, legN]);
  const domain = niceDomain([Math.max(floor, lo), 0], 6);
  // The skew null is a property of the differential transfer; a single leg has none.
  const nullFrequency =
    pair && r.weaveLegs && r.weaveLegs.nullFrequency > 0 ? r.weaveLegs.nullFrequency : NaN;

  const thruName = pair ? '|Sdd21|' : '|S21|';
  const metrics: MetricSpec[] = [
    {
      key: 'il',
      label: `Insertion loss at Nyquist, ${pair ? 'differential' : 'single-ended'}`,
      value: r.ilNyquist,
      unit: 'dB',
      sig: 4,
      note: formatEng(r.nyquist, 'Hz', 3),
    },
    {
      key: 'rl',
      label: 'Return loss at Nyquist',
      value: -linearAt(r.freq, r.reflectionDb, r.nyquist),
      unit: 'dB',
      sig: 3,
      note: 'larger is a better match',
    },
    {
      key: 'coverage',
      label: 'Top of the sweep over Nyquist',
      value: r.nyquistCoverage,
      unit: '1',
      sig: 3,
    },
  ];
  if (pair) {
    metrics.push({
      key: 'conversion',
      label: 'Differential to common conversion at Nyquist',
      value: linearAt(r.freq, r.conversionDb, r.nyquist),
      unit: 'dB',
      sig: 3,
      note: '|Scd21|; lower is a better balanced pair',
    });
  }
  if (Number.isFinite(nullFrequency)) {
    metrics.push({
      key: 'null',
      label: 'First differential null',
      value: nullFrequency,
      unit: 'Hz',
      sig: 4,
      note: '1 / (2 skew)',
    });
  }

  const notes = sweepNotes(r);
  notes.push(
    `Referenced to ${formatEng(r.reference[0], 'ohm', 3)} per port; drawn no lower than ${floor} dB.`,
  );

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const traces: TraceSpec[] = [
      { key: 'thru', label: `${thruName}, through`, color: THRU },
      {
        key: 'legP',
        label: `P leg alone, |${sName(r, r.rxPort, r.txPort)}|`,
        color: LEG_P,
        dash: [6, 3],
        hidden: !pair,
      },
      {
        key: 'legN',
        label: `N leg alone, |${sName(r, r.rxPortN, r.txPortN)}|`,
        color: LEG_N,
        dash: [2, 3],
        hidden: !pair,
      },
      { key: 'conversion', label: '|Scd21|, differential in, common out', color: CONVERSION, hidden: !pair },
      { key: 'reflection', label: pair ? '|Sdd11|, reflection' : '|S11|, reflection', color: REFLECTION },
    ];
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', target: r.nyquist },
      y: { scale: yScale, unit: 'dB', title: 'Magnitude' },
      traces,
      caption: pair
        ? 'Mixed-mode transfers of the pair: the differential through, each leg on its own, the part of the differential signal that leaves as common mode, and the differential reflection.'
        : 'Single-ended through and reflection between the chosen ports.',
      metrics,
      grid: 'auto',
      legend: 'bl',
      readout: 'none',
      notes,
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        nyquistLine(sf, r, xScale);
        if (Number.isFinite(nullFrequency) && nullFrequency <= r.fMax) {
          drawVLine(sf, nullFrequency, xScale, { color: CONVERSION, width: 1, dash: [1, 3], alpha: 0.7 });
        }
        drawXY(sf, r.freq, reflection, xScale, yScale, { color: REFLECTION, width: 1.25 });
        if (pair) {
          drawXY(sf, r.freq, conversion, xScale, yScale, { color: CONVERSION, width: 1.25 });
          drawXY(sf, r.freq, legP, xScale, yScale, { color: LEG_P, width: 1.25, dash: [6, 3] });
          drawXY(sf, r.freq, legN, xScale, yScale, { color: LEG_N, width: 1.25, dash: [2, 3] });
        }
        drawXY(sf, r.freq, thru, xScale, yScale, { color: THRU, width: 1.75 });
      },
    };
  };
}

/* ----------------------------------------------------------------- weave */

export interface WeaveViewOptions {
  weave: WeaveSpec;
  legs: WeaveLegs;
  /** Route length and trace width, metres. */
  length: number;
  traceWidth: number;
}

/** Glass fraction at a point of the laminate, in route coordinates: s along the route, y across it. */
export function glassFractionAt(weave: WeaveSpec, s: number, y: number): number {
  const drift = Math.sin((weave.angleDeg * Math.PI) / 180);
  const phi = weave.glassMean + weave.glassSwing * Math.cos((2 * Math.PI * (y + s * drift)) / weave.pitch);
  return Math.min(1, Math.max(0, phi));
}

/** Hex colour c1 to c2 by u in [0, 1]. */
function mix(c1: string, c2: string, u: number): string {
  const a = parseInt(c1.slice(1), 16);
  const b = parseInt(c2.slice(1), 16);
  const ch = (shift: number) => {
    const x = (a >> shift) & 255;
    const y = (b >> shift) & 255;
    return Math.round(x + (y - x) * u);
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/**
 * A top view of the laminate under the pair, a few weave pitches long: glass-rich
 * bands light, resin-rich dark, with the two traces over them. At zero angle the
 * bands run with the traces, so a trace keeps the mix it starts on for the whole
 * route; rotating the route makes each trace cross the bands and see their average.
 */
export function weaveRender(o: WeaveViewOptions): (s: Surface) => PlotRender {
  const { weave, legs } = o;
  const pitches = 12;
  const along = Math.min(o.length, pitches * weave.pitch);
  const yP = weave.offset;
  const yN = weave.offset + weave.pairPitch;
  const yLo = Math.min(yP, yN) - weave.pitch;
  const yHi = Math.max(yP, yN) + weave.pitch;
  const skewPerInch = (legs.skew / o.length) * INCH;

  const metrics: MetricSpec[] = [
    { key: 'glassP', label: 'Glass fraction under P', value: legs.glassP, unit: '1', sig: 3 },
    { key: 'glassN', label: 'Glass fraction under N', value: legs.glassN, unit: '1', sig: 3 },
    { key: 'dkP', label: 'Dk seen by P', value: legs.dkP, unit: '1', sig: 4 },
    { key: 'dkN', label: 'Dk seen by N', value: legs.dkN, unit: '1', sig: 4 },
    {
      key: 'skew',
      label: 'Intra-pair skew, P minus N',
      value: legs.skew,
      unit: 's',
      sig: 3,
      note: `over ${formatEng(o.length, 'm', 3)}: l (sqrt Dk_P - sqrt Dk_N) / c`,
    },
    { key: 'skewPerInch', label: 'Skew per inch of route', value: skewPerInch, unit: 's', sig: 3 },
    {
      key: 'drift',
      label: 'Drift across the weave over the route',
      value: legs.drift,
      unit: 'm',
      sig: 3,
      note: `${(legs.drift / weave.pitch).toFixed(2)} pitches; a whole number averages the weave out`,
    },
  ];

  return (s: Surface): PlotRender => {
    const xScale = linearScale([0, along], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale([yHi, yLo], [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'm', title: 'Distance along the route' },
      y: { scale: yScale, unit: 'm', title: 'Position across the weave' },
      traces: [
        { key: 'glass', label: 'Glass bundle, lighter is more glass', color: signalMuted.ch3 },
        { key: 'p', label: 'P trace', color: LEG_P },
        { key: 'n', label: 'N trace', color: LEG_N },
      ],
      caption: `Top view of the first ${formatEng(along, 'm', 2)} of the pair over woven glass, at ${weave.angleDeg.toFixed(1)} degrees to the weave: glass fraction ${legs.glassP.toFixed(3)} under P against ${legs.glassN.toFixed(3)} under N, averaged over each trace's width and the whole route.`,
      metrics,
      grid: 'none',
      legend: 'tr',
      readout: 'none',
      notes: ['Illustrative weave; glass fraction modelled as a sinusoid; Dk mixed linearly.'],
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        const { ctx } = sf;
        const cell = 4;
        const cols = Math.max(1, Math.ceil(sf.plot.width / cell));
        const rows = Math.max(1, Math.ceil(sf.plot.height / cell));
        const flat = weave.angleDeg === 0;
        const span = Math.max(1e-12, 2 * weave.glassSwing);
        const right = sf.plot.x + sf.plot.width;
        const bottom = sf.plot.y + sf.plot.height;
        ctx.save();
        for (let rI = 0; rI < rows; rI++) {
          const py = sf.plot.y + rI * cell;
          const y = yLo + ((yHi - yLo) * (rI + 0.5)) / rows;
          for (let cI = 0; cI < (flat ? 1 : cols); cI++) {
            const along0 = (along * (cI + 0.5)) / cols;
            const phi = glassFractionAt(weave, along0, y);
            const u = (phi - (weave.glassMean - weave.glassSwing)) / span;
            ctx.fillStyle = mix(ink.ink800, signalMuted.ch3, Math.min(1, Math.max(0, u)));
            const px = sf.plot.x + cI * cell;
            ctx.fillRect(
              px,
              py,
              flat ? sf.plot.width : Math.min(cell, right - px),
              Math.min(cell, bottom - py),
            );
          }
        }
        for (const [y, color, name] of [
          [yP, LEG_P, 'P'],
          [yN, LEG_N, 'N'],
        ] as const) {
          const edgeA = yScale(y - o.traceWidth / 2);
          const edgeB = yScale(y + o.traceWidth / 2);
          const top = Math.min(edgeA, edgeB);
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = color;
          ctx.fillRect(sf.plot.x, top, sf.plot.width, Math.max(1.5, Math.abs(edgeB - edgeA)));
          ctx.globalAlpha = 1;
          ctx.font = `${fontSize.tick}px ${font.mono}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = color;
          ctx.fillText(name, sf.plot.x + 4, top - 2);
        }
        ctx.restore();
      },
    };
  };
}

/* ------------------------------------------------------------------ skew */

/**
 * The received steps of each leg and of the pair, around their arrival. The legs
 * cross half height apart by the skew; the differential step crosses between them
 * with its edge slowed by the spread; the common-mode step is the difference, a
 * bump as wide as the skew that the receiver's common-mode rejection has to absorb.
 */
export function skewRender(r: MeasuredResult, o: { closedFormSkew?: number }): (s: Surface) => PlotRender {
  const pair = r.mode === 'differential' && r.stepLegP.length > 0;
  const ui = r.samplesPerUi * r.dt;
  const centre = halfIndex(r.stepOut);
  const spread = Math.abs(r.measuredSkew) / r.dt;
  const half = Math.ceil(1.5 * r.samplesPerUi + spread);
  const c = Number.isFinite(centre) ? Math.round(centre) : r.startIndex;
  const first = Math.max(0, c - half);
  const last = Math.min(r.stepOut.length - 1, c + half);
  const arrays = pair ? [r.stepOut, r.stepLegP, r.stepLegN, r.stepConversion] : [r.stepOut];
  const [lo, hi] = extent(arrays, first, last + 1);
  const domain = niceDomain([Math.min(lo, 0) - 0.05, Math.max(hi, 0) + 0.05], 6);

  let conversionPeak = 0;
  if (pair) for (const v of r.stepConversion) conversionPeak = Math.max(conversionPeak, Math.abs(v));

  const metrics: MetricSpec[] = [
    {
      key: 'delay',
      label: pair ? 'Differential delay, 50% to 50%' : 'Delay, 50% to 50%',
      value: r.pulseDelay,
      unit: 's',
      sig: 4,
    },
  ];
  if (pair) {
    metrics.push(
      {
        key: 'skew',
        label: 'Skew between the legs, at half height',
        value: r.measuredSkew,
        unit: 's',
        sig: 3,
        target: o.closedFormSkew,
        note:
          o.closedFormSkew === undefined
            ? 'P crossing minus N crossing'
            : 'P crossing minus N crossing; target is the weave closed form',
      },
      {
        key: 'skewUi',
        label: 'Skew as a fraction of a UI',
        value: Math.abs(r.measuredSkew) / ui,
        unit: 'UI',
        sig: 3,
      },
      {
        key: 'common',
        label: 'Largest common-mode step',
        value: conversionPeak,
        unit: '1',
        sig: 3,
        note: 'of the launched differential height',
      },
    );
  }

  return (s: Surface): PlotRender => {
    const xScale = linearScale([timeOf(r, first), timeOf(r, last)], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time, from the launched edge' },
      y: { scale: yScale, unit: '1', title: 'Step, of launched height' },
      traces: [
        { key: 'diff', label: pair ? 'Differential step' : 'Received step', color: THRU },
        { key: 'p', label: 'P leg alone', color: LEG_P, dash: [6, 3], hidden: !pair },
        { key: 'n', label: 'N leg alone', color: LEG_N, dash: [2, 3], hidden: !pair },
        { key: 'common', label: 'Common mode from the differential step', color: CONVERSION, hidden: !pair },
      ],
      caption: pair
        ? `The received step of each leg, of the pair and of the common mode it converts to, around an arrival ${formatEng(r.pulseDelay, 's', 3)} after launch.`
        : 'The received step around its arrival; the legs of a pair are shown in differential mode.',
      metrics,
      grid: 'auto',
      legend: 'tl',
      readout: 'none',
      notes: sweepNotes(r),
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        const range: [number, number] = [first, last + 1];
        const t0 = timeOf(r, 0);
        drawHLine(sf, 0, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        if (pair) {
          drawUniformTrace(
            sf,
            r.stepConversion,
            t0,
            r.dt,
            xScale,
            yScale,
            { color: CONVERSION, width: 1.25 },
            range,
          );
          drawUniformTrace(
            sf,
            r.stepLegP,
            t0,
            r.dt,
            xScale,
            yScale,
            { color: LEG_P, width: 1.25, dash: [6, 3] },
            range,
          );
          drawUniformTrace(
            sf,
            r.stepLegN,
            t0,
            r.dt,
            xScale,
            yScale,
            { color: LEG_N, width: 1.25, dash: [2, 3] },
            range,
          );
        }
        drawUniformTrace(sf, r.stepOut, t0, r.dt, xScale, yScale, { color: THRU, width: 1.75 }, range);
      },
    };
  };
}

/* ------------------------------------------------------------------- ILD */

export interface IldOptions {
  view: 'fit' | 'deviation';
}

/**
 * Insertion loss and its four-term fit, or the deviation from the fit, over the
 * sweep with the fitted band marked. The fit is extrapolated outside the band and
 * is not meant to hold there.
 */
export function ildRender(r: MeasuredResult, o: IldOptions): (s: Surface) => PlotRender {
  const fitView = o.view === 'fit';
  const inBand = (k: number) => r.freq[k] >= r.ildLo && r.freq[k] <= r.ildHi;
  const bandEnd = (() => {
    let e = 0;
    while (e < r.freq.length && r.freq[e] <= r.ildHi) e++;
    return e;
  })();
  const loss = r.thruDb.map((v) => -v);
  let domain: [number, number];
  if (!r.ildValid) {
    domain = [-1, 1];
  } else if (fitView) {
    const [lo, hi] = extent([loss, r.ilFit], 0, bandEnd);
    domain = niceDomain([Math.min(0, lo), Math.max(hi, 1e-3)], 6);
  } else {
    const [lo, hi] = extent([r.ild], 0, bandEnd);
    const bound = Math.max(Math.abs(lo), Math.abs(hi), 0.05);
    domain = niceDomain([-1.1 * bound, 1.1 * bound], 6);
  }

  const metrics: MetricSpec[] = r.ildValid
    ? [
        { key: 'rms', label: 'ILD, RMS over the band', value: r.ildRms, unit: 'dB', sig: 3 },
        { key: 'peak', label: 'ILD, largest magnitude', value: r.ildPeak, unit: 'dB', sig: 3 },
        {
          key: 'peakFrequency',
          label: 'Where the largest deviation is',
          value: r.ildPeakFrequency,
          unit: 'Hz',
          sig: 3,
        },
        {
          key: 'band',
          label: 'Top of the fitted band',
          value: r.ildHi,
          unit: 'Hz',
          sig: 3,
          note: `from ${formatEng(r.ildLo, 'Hz', 3)}`,
        },
        { key: 'il', label: 'Insertion loss at Nyquist', value: r.ilNyquist, unit: 'dB', sig: 4 },
      ]
    : [];

  const notes = sweepNotes(r);
  if (!r.ildValid) notes.push('Too few frequencies in the band to fit four terms; nothing to show.');
  else
    notes.push(
      'Fit a0 + a1 sqrt f + a2 f + a3 f^2 by least squares over the band; drawn beyond it for reference.',
    );

  const fitted = r.ilFit;
  const deviationInBand = r.ild.map((v, k) => (inBand(k) ? v : NaN));

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', target: r.nyquist },
      y: {
        scale: yScale,
        unit: 'dB',
        title: fitView ? 'Insertion loss, positive' : 'Loss minus fit',
      },
      traces: fitView
        ? [
            { key: 'il', label: 'Insertion loss', color: THRU },
            { key: 'fit', label: 'Four-term fit', color: semantic.ideal, dash: [6, 3] },
          ]
        : [{ key: 'ild', label: 'Deviation inside the band', color: THRU }],
      caption: fitView
        ? `Insertion loss of the through path and the smooth four-term fit to it from ${formatEng(r.ildLo, 'Hz', 2)} to ${formatEng(r.ildHi, 'Hz', 2)}.`
        : 'Insertion loss deviation: what an equaliser fitted to smooth loss cannot remove, inside the fitted band.',
      metrics,
      grid: 'auto',
      legend: fitView ? 'tl' : 'tr',
      readout: 'none',
      notes,
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        if (!r.ildValid) return;
        nyquistLine(sf, r, xScale);
        drawVLine(sf, r.ildHi, xScale, { color: semantic.marker, width: 1, dash: [4, 3], alpha: 0.8 });
        if (fitView) {
          drawXY(sf, r.freq, loss, xScale, yScale, { color: THRU, width: 1.75 });
          drawXY(sf, r.freq, fitted, xScale, yScale, { color: semantic.ideal, width: 1.25, dash: [6, 3] });
        } else {
          drawHLine(sf, 0, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
          drawXY(sf, r.freq, deviationInBand, xScale, yScale, { color: THRU, width: 1.5 });
        }
      },
    };
  };
}

/* ------------------------------------------------------------- crosstalk */

const AGGRESSOR_LOOKS: { color: string; dash?: number[] }[] = [
  { color: semantic.error },
  { color: signal.ch3 },
  { color: semantic.ideal },
  { color: semantic.error, dash: [6, 3] },
  { color: signal.ch3, dash: [6, 3] },
  { color: semantic.ideal, dash: [6, 3] },
  { color: semantic.error, dash: [2, 3] },
  { color: signal.ch3, dash: [2, 3] },
  { color: semantic.ideal, dash: [2, 3] },
  { color: ink.textLo },
];

/** Coupling from every aggressor, with the through path for scale, and the noise each integrates to. */
export function crosstalkRender(r: MeasuredResult): (s: Surface) => PlotRender {
  const floor = -80;
  const clip = (y: Float64Array) => y.map((v) => Math.max(floor, v));
  const curves = r.aggressors.map((a) => clip(a.xtDb));
  const thru = clip(r.thruDb);
  const [lo] = extent([thru, ...curves]);
  const domain = niceDomain([Math.max(floor, lo), 0], 6);
  const name = (kind: string) => (kind === 'next' ? 'Near-end' : 'Far-end');

  const metrics: MetricSpec[] = [
    {
      key: 'total',
      label: 'Integrated crosstalk noise, all aggressors',
      value: r.icnTotal,
      unit: 'V',
      sig: 3,
      note: 'RMS at the victim receiver, aggressors at the victim swing',
    },
    { key: 'next', label: 'Near-end total', value: r.icnNext, unit: 'V', sig: 3 },
    { key: 'fext', label: 'Far-end total', value: r.icnFext, unit: 'V', sig: 3 },
    {
      key: 'fraction',
      label: 'Total as a fraction of the launched level',
      value: r.level > 0 ? r.icnTotal / r.level : 0,
      unit: '1',
      sig: 3,
    },
    { key: 'rx', label: 'Receiver bandwidth assumed', value: r.rxBandwidth, unit: 'Hz', sig: 3 },
  ];
  const notes = sweepNotes(r);
  if (r.aggressors.length === 0) notes.push('No other line in this network couples to the victim.');
  notes.push(`Drawn no lower than ${floor} dB.`);

  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const traces: TraceSpec[] = [
      { key: 'thru', label: 'Victim through, for scale', color: THRU },
      ...r.aggressors.map((a, i) => ({
        key: `xt${i}`,
        label: `${name(a.kind)} from ${a.label}, ${formatEng(a.icn, 'V', 3)} RMS`,
        ...AGGRESSOR_LOOKS[i % AGGRESSOR_LOOKS.length],
      })),
    ];
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency', target: r.nyquist },
      y: { scale: yScale, unit: 'dB', title: 'Coupling to the victim' },
      traces,
      caption: `Coupling from each aggressor into the victim receiver, near end and far end, with the victim's own through path; together ${formatEng(r.icnTotal, 'V', 3)} RMS of crosstalk noise.`,
      metrics,
      grid: 'auto',
      legend: 'br',
      readout: 'none',
      notes,
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        nyquistLine(sf, r, xScale);
        curves.forEach((y, i) => {
          const look = AGGRESSOR_LOOKS[i % AGGRESSOR_LOOKS.length];
          drawXY(sf, r.freq, y, xScale, yScale, { color: look.color, dash: look.dash, width: 1.25 });
        });
        drawXY(sf, r.freq, thru, xScale, yScale, { color: THRU, width: 1.75 });
      },
    };
  };
}

/* ------------------------------------------------------------ passivity */

/** Largest singular value of S against frequency; above 1 the file creates energy. */
export function passivityRender(r: MeasuredResult): (s: Surface) => PlotRender {
  const [lo, hi] = extent([r.sigmaMax]);
  const domain = niceDomain([Math.min(lo, 0.9), Math.max(hi, 1) + 0.02], 6);
  const metrics: MetricSpec[] = [
    {
      key: 'sigma',
      label: 'Largest singular value of S',
      value: r.passivityMax,
      unit: '1',
      sig: 6,
      target: 1,
      status: r.passive ? 'pass' : 'fail',
      note: `at ${formatEng(r.passivityFrequency, 'Hz', 3)}; a passive network never exceeds 1`,
    },
    {
      key: 'reciprocity',
      label: 'Largest |Sij - Sji|',
      value: r.reciprocityMax,
      unit: '1',
      format: 'exp',
      sig: 2,
      note: 'zero for a reciprocal network: no ferrites, no active parts',
    },
  ];
  return (s: Surface): PlotRender => {
    const xScale = freqScale(r, s);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'Hz', title: 'Frequency' },
      y: { scale: yScale, unit: '1', title: 'Largest singular value' },
      traces: [
        { key: 'sigma', label: 'sigma_max of S', color: r.passive ? semantic.pass : semantic.fail },
        { key: 'limit', label: 'Passivity limit', color: ink.textLo, dash: [1, 4] },
      ],
      caption: `Largest singular value of the ${r.ports}-port scattering matrix at ${r.sigmaFreq.length} frequencies: the most power gain any combination of incident waves can see, which a passive network holds at or below 1.`,
      metrics,
      grid: 'auto',
      legend: 'br',
      readout: 'none',
      notes: sweepNotes(r),
    };
    return {
      spec,
      drawTraces(sf: Surface): void {
        drawHLine(sf, 1, yScale, { color: ink.textLo, width: 1, dash: [1, 4] });
        drawXY(sf, r.sigmaFreq, r.sigmaMax, xScale, yScale, {
          color: r.passive ? semantic.pass : semantic.fail,
          width: 1.75,
        });
      },
    };
  };
}

/* ------------------------------------------------------------- causality */

export interface CausalityOptions {
  /** UIs shown after the later arrival. */
  uisAfter: number;
}

/**
 * The launched pulse, what the file's transfer delivers, and, when built, what a
 * transfer with the same magnitude and minimum phase delivers. A causal file
 * delivers nothing before its delay; a conjugated one delivers its pulse before the
 * launch; a magnitude-only reading puts the pulse at the launch, with its delay and
 * its shape both lost.
 */
export function causalityRender(r: MeasuredResult, o: CausalityOptions): (s: Surface) => PlotRender {
  const spu = r.samplesPerUi;
  const ui = spu * r.dt;
  const hasMp = r.pulseMinPhase.length > 0;
  const first = Math.max(0, r.startIndex - 4 * spu);
  const later = Math.max(r.pulseDelay, hasMp ? r.minPhaseDelay : 0, 0);
  const last = Math.min(
    r.pulseOut.length - 1,
    r.startIndex + Math.ceil(later / r.dt) + Math.max(2, Math.floor(o.uisAfter)) * spu,
  );
  const arrays = hasMp ? [r.pulseIn, r.pulseOut, r.pulseMinPhase] : [r.pulseIn, r.pulseOut];
  const [lo, hi] = extent(arrays, first, last + 1);
  const domain = niceDomain([Math.min(lo, 0) - 0.05, Math.max(hi, 1) + 0.05], 6);
  const ratio = r.postResponseEnergy > 0 ? r.preResponseEnergy / r.postResponseEnergy : 0;

  const metrics: MetricSpec[] = [
    {
      key: 'pre',
      label: 'Impulse energy before t = 0',
      value: r.preResponseEnergy,
      unit: '1',
      format: 'exp',
      sig: 2,
      note: `of the whole, beyond the guard band; ${r.acausal ? 'flagged as not causal' : 'passes the screen'}`,
    },
    {
      key: 'ratio',
      label: 'Before over after',
      value: ratio,
      unit: '1',
      format: 'exp',
      sig: 2,
      note: 'near 0 causal, near 1 magnitude-only, above 1 conjugated',
    },
    { key: 'delay', label: 'Delay, 50% to 50%', value: r.pulseDelay, unit: 's', sig: 4 },
    {
      key: 'sweepDelay',
      label: 'Delay from the phase slope',
      value: r.sweepDelay,
      unit: 's',
      sig: 4,
      note: 'over the whole sweep',
    },
    {
      key: 'phaseStep',
      label: 'Median phase step between frequencies',
      value: r.medianPhaseStep,
      unit: '1',
      sig: 3,
      note: `radians; ${r.coarse ? 'too coarse for the delay' : 'fine enough for the delay'}`,
    },
  ];
  if (hasMp) {
    metrics.push({
      key: 'minPhaseDelay',
      label: 'Delay of the minimum-phase copy',
      value: r.minPhaseDelay,
      unit: 's',
      sig: 3,
      note: 'the same magnitude, and none of the delay',
    });
  }

  const notes = sweepNotes(r);
  if (r.acausal) notes.push('The causality screen flags this transfer.');
  if (r.coarse) notes.push('The sweep step is too coarse to unwrap the phase of this delay.');
  if (r.recordTruncated) notes.push('The record hit the sample ceiling; the tail is cut short.');

  return (s: Surface): PlotRender => {
    const xScale = linearScale([timeOf(r, first), timeOf(r, last)], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale(domain, [s.plot.y + s.plot.height, s.plot.y]);
    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time, from the launched edge', target: 0 },
      y: { scale: yScale, unit: '1', title: 'Pulse, of launched height' },
      traces: [
        { key: 'in', label: 'Launched pulse', color: semantic.ideal },
        { key: 'out', label: 'Through the network', color: THRU },
        {
          key: 'mp',
          label: 'Same magnitude, minimum phase',
          color: signal.ch3,
          dash: [6, 3],
          hidden: !hasMp,
        },
      ],
      caption: `A one-UI pulse of ${formatEng(ui, 's', 3)} launched at t = 0 and what the network's through transfer delivers${hasMp ? ', beside what a minimum-phase transfer of the same magnitude delivers' : ''}.`,
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
        drawVLine(sf, 0, xScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        drawUniformTrace(
          sf,
          r.pulseIn,
          t0,
          r.dt,
          xScale,
          yScale,
          { color: semantic.ideal, width: 1.5 },
          range,
        );
        if (hasMp) {
          drawUniformTrace(
            sf,
            r.pulseMinPhase,
            t0,
            r.dt,
            xScale,
            yScale,
            { color: signal.ch3, width: 1.25, dash: [6, 3] },
            range,
          );
        }
        drawUniformTrace(sf, r.pulseOut, t0, r.dt, xScale, yScale, { color: THRU, width: 1.75 }, range);
      },
    };
  };
}
