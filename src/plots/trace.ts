/**
 * Waveform traces.
 *
 * The one algorithm that matters here is min/max decimation. A record can easily
 * hold a million samples while the plot is 900 pixels wide. Drawing every sample is
 * a million lineTo calls for a picture that can hold at most 1800 distinct points,
 * and - worse than slow - subsampling instead would drop the narrow spikes that are
 * the entire reason anyone is looking. Taking the minimum and maximum of the samples
 * that fall in each pixel column and drawing a vertical span between them keeps every
 * excursion visible at any zoom, which is exactly what a scope's own display does.
 */

import { crisp, type Surface } from './canvas';
import type { Scale } from './scale';

export interface TraceStyle {
  color: string;
  /** Line width in CSS pixels. */
  width?: number;
  /** Dash pattern in CSS pixels; omit for solid. */
  dash?: number[];
  /** 0-1. Used for ghost traces and per-harmonic overlays. */
  alpha?: number;
}

export interface DecimatedColumn {
  x: number;
  min: number;
  max: number;
  /** Value of the first sample in this column, for a faithful single-sample column. */
  first: number;
  /** Value of the last sample, so consecutive columns join where the signal joins. */
  last: number;
}

/**
 * Reduce a series to at most one column per pixel.
 *
 * `i0` and `i1` are the sample index range to draw (i1 exclusive), which is how
 * horizontal pan and zoom are implemented: the window moves, the data does not.
 * Non-finite samples are skipped rather than poisoning a column's min and max.
 */
export function decimate(
  y: ArrayLike<number>,
  i0: number,
  i1: number,
  pixelWidth: number,
): DecimatedColumn[] {
  const lo = Math.max(0, Math.floor(i0));
  const hi = Math.min(y.length, Math.ceil(i1));
  const n = hi - lo;
  if (n <= 0 || pixelWidth <= 0) return [];

  const columns = Math.max(1, Math.floor(pixelWidth));
  const out: DecimatedColumn[] = [];

  if (n <= columns) {
    // Fewer samples than pixels: no decimation to do, every sample is its own column.
    for (let i = lo; i < hi; i++) {
      const v = y[i];
      if (!Number.isFinite(v)) continue;
      out.push({ x: i - i0, min: v, max: v, first: v, last: v });
    }
    return out;
  }

  const perColumn = n / columns;
  for (let c = 0; c < columns; c++) {
    const a = lo + Math.floor(c * perColumn);
    const b = c === columns - 1 ? hi : lo + Math.floor((c + 1) * perColumn);
    let mn = Infinity;
    let mx = -Infinity;
    let first = NaN;
    let last = NaN;
    for (let i = a; i < b; i++) {
      const v = y[i];
      if (!Number.isFinite(v)) continue;
      if (Number.isNaN(first)) first = v;
      last = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === Infinity) continue;
    out.push({ x: a - i0, min: mn, max: mx, first, last });
  }
  return out;
}

function applyStyle(s: Surface, style: TraceStyle): void {
  const { ctx } = s;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width ?? 1.5;
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.setLineDash(style.dash ?? []);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
}

function clearStyle(s: Surface): void {
  s.ctx.globalAlpha = 1;
  s.ctx.setLineDash([]);
}

/**
 * Draw a series against x and y scales.
 *
 * `xOf` maps a sample index to a data x value. Passing an index-to-time function
 * rather than a parallel x array keeps a million-point record to one array.
 */
export function drawTrace(
  s: Surface,
  y: ArrayLike<number>,
  xOf: (index: number) => number,
  xScale: Scale,
  yScale: Scale,
  style: TraceStyle,
  range?: readonly [number, number],
): void {
  const [i0, i1] = range ?? [0, y.length];
  const cols = decimate(y, i0, i1, s.plot.width);
  if (cols.length === 0) return;

  const { ctx } = s;
  applyStyle(s, style);
  ctx.beginPath();

  let started = false;
  for (const c of cols) {
    const px = xScale(xOf(i0 + c.x));
    if (c.min === c.max) {
      const py = yScale(c.min);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
      continue;
    }
    // A column spanning a range: enter at the first sample, sweep the full extent,
    // leave at the last, so the trace stays connected to its neighbours.
    if (!started) {
      ctx.moveTo(px, yScale(c.first));
      started = true;
    } else {
      ctx.lineTo(px, yScale(c.first));
    }
    ctx.lineTo(px, yScale(c.max));
    ctx.lineTo(px, yScale(c.min));
    ctx.lineTo(px, yScale(c.last));
  }
  ctx.stroke();
  clearStyle(s);
}

/**
 * Draw a series sampled on a uniform time grid. The common case: a waveform with a
 * fixed dt, which is every time-domain plot on this site.
 */
export function drawUniformTrace(
  s: Surface,
  y: ArrayLike<number>,
  t0: number,
  dt: number,
  xScale: Scale,
  yScale: Scale,
  style: TraceStyle,
  range?: readonly [number, number],
): void {
  drawTrace(s, y, (i) => t0 + i * dt, xScale, yScale, style, range);
}

/** Draw an explicit list of (x, y) points, for transfer functions and bathtubs. */
export function drawXY(
  s: Surface,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  xScale: Scale,
  yScale: Scale,
  style: TraceStyle,
): void {
  const n = Math.min(x.length, y.length);
  if (n === 0) return;
  const { ctx } = s;
  applyStyle(s, style);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < n; i++) {
    const xv = x[i];
    const yv = y[i];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
      // A gap in the data is a gap in the line, not a straight jump across it.
      started = false;
      continue;
    }
    const px = xScale(xv);
    const py = yScale(yv);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  clearStyle(s);
}

/** Fill the band between two series. Used for eye masks and tolerance envelopes. */
export function fillBand(
  s: Surface,
  x: ArrayLike<number>,
  yLow: ArrayLike<number>,
  yHigh: ArrayLike<number>,
  xScale: Scale,
  yScale: Scale,
  fill: string,
  alpha = 0.15,
): void {
  const n = Math.min(x.length, yLow.length, yHigh.length);
  if (n === 0) return;
  const { ctx } = s;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(xScale(x[0]), yScale(yHigh[0]));
  for (let i = 1; i < n; i++) ctx.lineTo(xScale(x[i]), yScale(yHigh[i]));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(xScale(x[i]), yScale(yLow[i]));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A horizontal reference line: a threshold, a zero line, a spec limit. */
export function drawHLine(s: Surface, value: number, yScale: Scale, style: TraceStyle): void {
  const { ctx, plot } = s;
  const py = crisp(yScale(value));
  if (py < plot.y - 1 || py > plot.y + plot.height + 1) return;
  applyStyle(s, { width: 1, ...style });
  ctx.beginPath();
  ctx.moveTo(plot.x, py);
  ctx.lineTo(plot.x + plot.width, py);
  ctx.stroke();
  clearStyle(s);
}

/** A vertical reference line: a strobe position, a Nyquist frequency, a UI boundary. */
export function drawVLine(s: Surface, value: number, xScale: Scale, style: TraceStyle): void {
  const { ctx, plot } = s;
  const px = crisp(xScale(value));
  if (px < plot.x - 1 || px > plot.x + plot.width + 1) return;
  applyStyle(s, { width: 1, ...style });
  ctx.beginPath();
  ctx.moveTo(px, plot.y);
  ctx.lineTo(px, plot.y + plot.height);
  ctx.stroke();
  clearStyle(s);
}

/** Individual sample dots, for showing where a sampler actually landed. */
export function drawSamples(
  s: Surface,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  xScale: Scale,
  yScale: Scale,
  color: string,
  radius = 2.5,
): void {
  const n = Math.min(x.length, y.length);
  const { ctx } = s;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    ctx.beginPath();
    ctx.arc(xScale(x[i]), yScale(y[i]), radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
