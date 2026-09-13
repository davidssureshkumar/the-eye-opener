/**
 * Stem plots and bars: discrete spectra, histograms, FFE tap weights.
 *
 * A line plot is wrong for a discrete spectrum. The Fourier series of a square wave
 * has energy at 1f, 3f, 5f and nowhere in between, and joining those points with a
 * line draws energy at 2f that does not exist. Stems say "these values, at these
 * frequencies, and nothing between them", which is the truth.
 *
 * Histograms are a separate function because the semantics differ: a histogram bar
 * occupies an interval and its width is meaningful, while a stem is a point sample
 * whose width is only a drawing choice.
 */

import { crisp, type Surface } from './canvas';
import { font, fontSize, surface } from '../design/tokens';
import { formatEng, type Scale } from './scale';

export interface StemStyle {
  color: string;
  /** Stem line width in CSS pixels. */
  width?: number;
  /** Radius of the dot at the tip. Zero to omit. */
  markerRadius?: number;
  alpha?: number;
}

/**
 * Stems from a baseline to each value.
 *
 * `baseline` is in y data units. It is zero for a spectrum and for tap weights, where
 * a negative tap must visibly hang below the axis; for a dB spectrum it should be the
 * bottom of the axis, since -60 dB is a small value, not a negative one.
 */
export function drawStems(
  s: Surface,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  xScale: Scale,
  yScale: Scale,
  style: StemStyle,
  baseline = 0,
): void {
  const n = Math.min(x.length, y.length);
  if (n === 0) return;
  const { ctx, plot } = s;
  const y0 = yScale(baseline);

  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width ?? 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    const px = crisp(xScale(x[i]));
    if (px < plot.x - 1 || px > plot.x + plot.width + 1) continue;
    ctx.moveTo(px, y0);
    ctx.lineTo(px, yScale(y[i]));
  }
  ctx.stroke();

  const r = style.markerRadius ?? 2;
  if (r > 0) {
    ctx.fillStyle = style.color;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
      const px = xScale(x[i]);
      if (px < plot.x - 1 || px > plot.x + plot.width + 1) continue;
      ctx.beginPath();
      ctx.arc(px, yScale(y[i]), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export interface BarStyle {
  color: string;
  /** 0-1 fraction of the slot each bar fills. 0.8 leaves a readable gap. */
  fill?: number;
  alpha?: number;
  /** Outline colour; omit for unstroked bars. */
  stroke?: string;
}

/**
 * Bars at explicit centres. `slotWidth` is in x data units and sets the spacing the
 * bars are drawn to; pass the bin width for a histogram.
 */
export function drawBars(
  s: Surface,
  centres: ArrayLike<number>,
  values: ArrayLike<number>,
  slotWidth: number,
  xScale: Scale,
  yScale: Scale,
  style: BarStyle,
  baseline = 0,
): void {
  const n = Math.min(centres.length, values.length);
  if (n === 0) return;
  const { ctx } = s;
  const fill = style.fill ?? 0.8;
  const y0 = yScale(baseline);

  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.fillStyle = style.color;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v) || !Number.isFinite(centres[i])) continue;
    const left = xScale(centres[i] - (slotWidth * fill) / 2);
    const right = xScale(centres[i] + (slotWidth * fill) / 2);
    const yv = yScale(v);
    // At least one pixel wide and one pixel tall: a bar that rounds away to nothing
    // reads as a missing measurement rather than a small one.
    const w = Math.max(1, Math.abs(right - left));
    const h = Math.max(1, Math.abs(yv - y0));
    ctx.fillRect(Math.min(left, right), Math.min(yv, y0), w, h);
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(left, right), Math.min(yv, y0), w, h);
    }
  }
  ctx.restore();
}

/**
 * Centres of `n` equal bins spanning [lo, hi].
 *
 * Exported and tested on its own because getting it wrong is quiet and believable:
 * using the bin edges as centres shifts an entire distribution by half a bin. In a
 * jitter histogram that is a systematic offset in the reported mean, and nothing
 * downstream would flag it.
 */
export function binCentres(n: number, lo: number, hi: number): Float64Array {
  const centres = new Float64Array(n);
  if (n === 0) return centres;
  const width = (hi - lo) / n;
  for (let i = 0; i < n; i++) centres[i] = lo + width * (i + 0.5);
  return centres;
}

/** Width of one bin when `n` bins span [lo, hi]. */
export function binWidth(n: number, lo: number, hi: number): number {
  return n === 0 ? 0 : (hi - lo) / n;
}

/** A histogram given as counts over equal bins spanning [lo, hi]. */
export function drawHistogram(
  s: Surface,
  counts: ArrayLike<number>,
  lo: number,
  hi: number,
  xScale: Scale,
  yScale: Scale,
  style: BarStyle,
): void {
  const n = counts.length;
  if (n === 0) return;
  const width = binWidth(n, lo, hi);
  drawBars(s, binCentres(n, lo, hi), counts, width, xScale, yScale, { fill: 1, ...style }, 0);
}

/**
 * Label a handful of stems with their values. Used for harmonic amplitudes and tap
 * weights, where the exact number is the point and reading it off an axis is not
 * good enough.
 */
export function labelStems(
  s: Surface,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  xScale: Scale,
  yScale: Scale,
  unit = '',
  maxLabels = 8,
  color: string = surface.textLo,
): void {
  const n = Math.min(x.length, y.length);
  if (n === 0) return;

  // Label the largest by magnitude, not the first n: in a spectrum the interesting
  // lines are the tall ones, and they are not in index order.
  const order = Array.from({ length: n }, (_, i) => i)
    .filter((i) => Number.isFinite(y[i]) && Number.isFinite(x[i]))
    .sort((a, b) => Math.abs(y[b]) - Math.abs(y[a]))
    .slice(0, maxLabels);

  const { ctx, plot } = s;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textAlign = 'center';
  for (const i of order) {
    const px = xScale(x[i]);
    if (px < plot.x || px > plot.x + plot.width) continue;
    const py = yScale(y[i]);
    const above = y[i] >= 0;
    ctx.textBaseline = above ? 'bottom' : 'top';
    ctx.fillText(formatEng(y[i], unit, 3), px, py + (above ? -4 : 4));
  }
  ctx.restore();
}
