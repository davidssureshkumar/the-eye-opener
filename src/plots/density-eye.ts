/**
 * Eye diagrams as a density histogram.
 *
 * A real-time scope does not draw an eye by stroking thousands of overlapping lines.
 * It accumulates hits into a 2D histogram - one bin per screen pixel - and colours
 * each bin by how many waveforms passed through it. That is the difference between
 * a picture that saturates into a solid blob after a few hundred waveforms and one
 * where the density gradient itself is the information: the bright core is where the
 * signal usually is, and the faint outer skirts are the rare excursions that set the
 * bit error rate. On a scope this is the "intensity graded" or "colour graded"
 * display, and the same accumulation feeds the persistence and mask-test features.
 *
 * Accumulation here is deliberately separate from drawing, for three reasons:
 * it is pure arithmetic and therefore testable without a canvas, it is the expensive
 * part and therefore belongs in a worker, and the same histogram answers questions
 * (eye height, eye width, the vertical slice at the sampling instant) that have
 * nothing to do with pixels.
 */

import type { Surface } from './canvas';
import { buildAlphaLut, type ColormapName } from './colormaps';

export interface EyeHistogram {
  /** Hit counts, row-major, length nx * ny. Row 0 is the TOP of the plot. */
  counts: Uint32Array;
  /** Bins across, spanning `uiSpan` unit intervals. */
  nx: number;
  /** Bins down, spanning [vMin, vMax]. */
  ny: number;
  /** Horizontal span in unit intervals. Two is conventional: one full eye, centred. */
  uiSpan: number;
  vMin: number;
  vMax: number;
  /** Total samples accumulated, for normalising to a hit probability. */
  total: number;
  /** Largest count in any single bin, for scaling the colour map. */
  peak: number;
}

export function makeEyeHistogram(
  nx: number,
  ny: number,
  uiSpan: number,
  vMin: number,
  vMax: number,
): EyeHistogram {
  return {
    counts: new Uint32Array(nx * ny),
    nx,
    ny,
    uiSpan,
    vMin,
    vMax,
    total: 0,
    peak: 0,
  };
}

export function clearEyeHistogram(h: EyeHistogram): void {
  h.counts.fill(0);
  h.total = 0;
  h.peak = 0;
}

/**
 * Fold a waveform into the histogram.
 *
 * `samplesPerUi` must be the same number the waveform was generated at. `phase` is a
 * fractional-UI offset applied before folding, which is how the eye is re-centred
 * without regenerating the waveform - exactly what the horizontal position knob does
 * to a scope's eye.
 *
 * Each consecutive pair of samples is joined by a short line in bin space rather than
 * each sample being deposited alone. Without that, a fast edge crossing the screen in
 * two samples leaves two isolated dots and the eye appears to have gaps in its
 * transitions where in reality the signal swept continuously through.
 */
export function accumulate(
  h: EyeHistogram,
  y: ArrayLike<number>,
  samplesPerUi: number,
  phase = 0,
  startIndex = 0,
): void {
  const n = y.length;
  if (n < 2 || samplesPerUi <= 0) return;

  const binsPerUi = h.nx / h.uiSpan;
  const vSpan = h.vMax - h.vMin;
  if (vSpan <= 0) return;
  const yScale = (h.ny - 1) / vSpan;

  let prevX = NaN;
  let prevY = NaN;

  for (let i = startIndex; i < n; i++) {
    const v = y[i];
    if (!Number.isFinite(v)) {
      prevX = NaN;
      continue;
    }

    // Position within the folded window, in bins. The window is centred, so a sample
    // exactly on a symbol boundary lands at the middle of the plot when phase is 0.
    const ui = (i / samplesPerUi + phase) % h.uiSpan;
    const bx = (ui < 0 ? ui + h.uiSpan : ui) * binsPerUi;
    const by = h.ny - 1 - (v - h.vMin) * yScale;

    if (Number.isFinite(prevX)) {
      // A wrap back to the start of the window is a fold boundary, not a real
      // transition: joining across it would draw a spurious line back across the eye.
      if (bx >= prevX) {
        drawSegment(h, prevX, prevY, bx, by);
      } else {
        deposit(h, bx, by);
      }
    } else {
      deposit(h, bx, by);
    }
    prevX = bx;
    prevY = by;
    h.total++;
  }

  recomputePeak(h);
}

function deposit(h: EyeHistogram, bx: number, by: number): void {
  const ix = Math.round(bx);
  const iy = Math.round(by);
  if (ix < 0 || ix >= h.nx || iy < 0 || iy >= h.ny) return;
  h.counts[iy * h.nx + ix]++;
}

/**
 * Join two consecutive samples with a line in bin space.
 *
 * Bresenham-style stepping along whichever axis moves further, so a near-vertical
 * edge deposits one hit per row rather than one per column. The vertical case is the
 * one that matters: that is a signal transition, and it is where the eye's crossing
 * region comes from.
 */
function drawSegment(h: EyeHistogram, x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  // A pathological step (a discontinuity across the whole screen) would otherwise
  // cost tens of thousands of deposits for one sample pair.
  const capped = Math.min(steps, h.ny * 2);
  for (let k = 1; k <= capped; k++) {
    deposit(h, x0 + (dx * k) / capped, y0 + (dy * k) / capped);
  }
}

function recomputePeak(h: EyeHistogram): void {
  let peak = 0;
  const c = h.counts;
  for (let i = 0; i < c.length; i++) if (c[i] > peak) peak = c[i];
  h.peak = peak;
}

/** Merge a worker's partial histogram into an accumulating one. */
export function mergeEyeHistogram(into: EyeHistogram, part: EyeHistogram): void {
  if (into.counts.length !== part.counts.length) {
    throw new Error('eye histograms must have identical geometry to merge');
  }
  for (let i = 0; i < into.counts.length; i++) into.counts[i] += part.counts[i];
  into.total += part.total;
  recomputePeak(into);
}

export type DensityScaling = 'linear' | 'log' | 'sqrt';

export interface EyeRenderOptions {
  colormap?: ColormapName;
  /**
   * How counts map to colour. Log is the default and it is the right default: the
   * interesting structure of an eye spans several decades of hit count, and on a
   * linear scale the rare outer skirts - the ones that set the BER - vanish.
   */
  scaling?: DensityScaling;
  /** Override the count mapped to the top of the colormap. Defaults to the peak. */
  peak?: number;
  /** Bins with fewer hits than this are left transparent. */
  floor?: number;
}

/**
 * Convert the histogram to RGBA pixels, one pixel per bin.
 *
 * Pure, so the mapping can be tested directly, and so the expensive part can run in
 * a worker and post back a transferable buffer.
 */
export function eyeToRgba(h: EyeHistogram, opts: EyeRenderOptions = {}): Uint8ClampedArray {
  const lut = buildAlphaLut(opts.colormap ?? 'inferno');
  const scaling = opts.scaling ?? 'log';
  const peak = Math.max(1, opts.peak ?? h.peak);
  const floor = opts.floor ?? 0;
  const out = new Uint8ClampedArray(h.nx * h.ny * 4);
  const logPeak = Math.log1p(peak);

  for (let i = 0; i < h.counts.length; i++) {
    const c = h.counts[i];
    if (c <= floor) continue;
    let t: number;
    if (scaling === 'log') t = Math.log1p(c) / logPeak;
    else if (scaling === 'sqrt') t = Math.sqrt(c / peak);
    else t = c / peak;
    const idx = Math.min(255, Math.max(0, Math.round(t * 255))) * 4;
    const o = i * 4;
    out[o] = lut[idx];
    out[o + 1] = lut[idx + 1];
    out[o + 2] = lut[idx + 2];
    out[o + 3] = lut[idx + 3];
  }
  return out;
}

/**
 * Paint the histogram over the plot area.
 *
 * Smoothing is off: each bin is a bin, and a blurred eye reads as a measurement it
 * is not. The histogram is normally allocated at the plot's pixel size anyway, so
 * there is nothing to interpolate.
 */
export function drawEye(s: Surface, h: EyeHistogram, opts: EyeRenderOptions = {}): void {
  if (h.nx < 1 || h.ny < 1) return;
  const { ctx, plot } = s;
  const rgba = eyeToRgba(h, opts);
  const image = ctx.createImageData(h.nx, h.ny);
  image.data.set(rgba);

  const stage = document.createElement('canvas');
  stage.width = h.nx;
  stage.height = h.ny;
  const sctx = stage.getContext('2d');
  if (!sctx) return;
  sctx.putImageData(image, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(stage, plot.x, plot.y, plot.width, plot.height);
  ctx.restore();
}

/* --------------------------------------------------- measurements on the eye */

/**
 * The vertical histogram at one horizontal position: the slice a scope takes when
 * you ask it for eye height, and the same slice a receiver sees at its strobe.
 *
 * `uiPosition` is in unit intervals from the left edge of the folded window.
 */
export function verticalSlice(h: EyeHistogram, uiPosition: number): Uint32Array {
  const ix = Math.min(h.nx - 1, Math.max(0, Math.round((uiPosition / h.uiSpan) * h.nx)));
  const out = new Uint32Array(h.ny);
  for (let iy = 0; iy < h.ny; iy++) out[iy] = h.counts[iy * h.nx + ix];
  return out;
}

/** The horizontal histogram at one voltage: the slice that measures eye width. */
export function horizontalSlice(h: EyeHistogram, voltage: number): Uint32Array {
  const iy = Math.min(
    h.ny - 1,
    Math.max(0, Math.round((h.ny - 1) * (1 - (voltage - h.vMin) / (h.vMax - h.vMin)))),
  );
  return h.counts.slice(iy * h.nx, iy * h.nx + h.nx) as Uint32Array;
}

/** Convert a bin row index back to a voltage, at the centre of the bin. */
export function binToVoltage(h: EyeHistogram, iy: number): number {
  return h.vMax - ((h.vMax - h.vMin) * iy) / (h.ny - 1);
}

/** Convert a bin column index back to a position in unit intervals. */
export function binToUi(h: EyeHistogram, ix: number): number {
  return (ix / h.nx) * h.uiSpan;
}

export interface EyeOpening {
  /** Vertical opening in volts at the measured position. */
  height: number;
  /** Voltage of the top of the opening. */
  vTop: number;
  /** Voltage of the bottom of the opening. */
  vBottom: number;
  /** Bin column the measurement was taken at. */
  ix: number;
}

/**
 * Eye height at a horizontal position: the empty vertical gap straddling `threshold`.
 *
 * "Empty" means bins with a hit count at or below `floor`. With floor = 0 this is the
 * opening as drawn, which corresponds to a scope measuring an eye from a finite
 * number of waveforms. It is NOT an extrapolated opening at a target BER - a rare
 * excursion that simply did not occur in the captured record leaves the drawn eye
 * looking more open than it is. That extrapolation is a statistical-eye calculation,
 * and it belongs with the bathtub work, not here.
 */
export function eyeHeightAt(
  h: EyeHistogram,
  uiPosition: number,
  threshold = 0,
  floor = 0,
): EyeOpening | null {
  const ix = Math.min(h.nx - 1, Math.max(0, Math.round((uiPosition / h.uiSpan) * h.nx)));
  const slice = verticalSlice(h, uiPosition);
  const iyThreshold = Math.min(
    h.ny - 1,
    Math.max(0, Math.round((h.ny - 1) * (1 - (threshold - h.vMin) / (h.vMax - h.vMin)))),
  );
  if (slice[iyThreshold] > floor) return null;

  let top = iyThreshold;
  while (top > 0 && slice[top - 1] <= floor) top--;
  let bottom = iyThreshold;
  while (bottom < h.ny - 1 && slice[bottom + 1] <= floor) bottom++;

  // An opening that runs to the edge of the vertical window is not a measurement of
  // the eye, it is a measurement of the window being too small.
  if (top === 0 || bottom === h.ny - 1) return null;

  const vTop = binToVoltage(h, top);
  const vBottom = binToVoltage(h, bottom);
  return { height: vTop - vBottom, vTop, vBottom, ix };
}

export interface EyeWidth {
  /** Horizontal opening in unit intervals. */
  ui: number;
  /** Left edge, in unit intervals from the window's left edge. */
  leftUi: number;
  rightUi: number;
}

/**
 * Eye width at a threshold voltage: the widest empty horizontal run in that row.
 *
 * Measured as a run of empty bins rather than as a difference of crossing times, so
 * it reports what is actually on the screen. Same caveat as eye height: this is the
 * opening in the captured record, not an extrapolation to a target BER.
 */
export function eyeWidthAt(h: EyeHistogram, threshold = 0, floor = 0): EyeWidth | null {
  const row = horizontalSlice(h, threshold);
  let best = { start: -1, length: 0 };
  let start = -1;
  for (let ix = 0; ix <= h.nx; ix++) {
    const empty = ix < h.nx && row[ix] <= floor;
    if (empty && start < 0) start = ix;
    if (!empty && start >= 0) {
      if (ix - start > best.length) best = { start, length: ix - start };
      start = -1;
    }
  }
  if (best.length === 0) return null;
  // A run touching either edge is cut off by the fold, not by the signal.
  if (best.start === 0 || best.start + best.length === h.nx) return null;
  return {
    ui: (best.length / h.nx) * h.uiSpan,
    leftUi: binToUi(h, best.start),
    rightUi: binToUi(h, best.start + best.length),
  };
}

/**
 * The horizontal position a receiver's strobe should sit at, and what an autoset or
 * a training routine searches for.
 *
 * Not simply the first column with the largest opening. A clean eye has a flat top:
 * every column between the transitions has the same full-swing opening, so the
 * maximum is a plateau, not a point, and returning its first column would put the
 * strobe right at the edge of the plateau with no margin on one side. Real receiver
 * training centres the strobe in the passing window for exactly this reason, so that
 * is what this returns: the middle of the widest run of columns that are within one
 * voltage bin of the best opening.
 */
export function bestSamplingPoint(
  h: EyeHistogram,
  threshold = 0,
  floor = 0,
): { uiPosition: number; opening: EyeOpening; plateauUi: number } | null {
  const openings: (EyeOpening | null)[] = new Array(h.nx);
  let bestHeight = -Infinity;
  for (let ix = 0; ix < h.nx; ix++) {
    const o = eyeHeightAt(h, binToUi(h, ix), threshold, floor);
    openings[ix] = o;
    if (o && o.height > bestHeight) bestHeight = o.height;
  }
  if (bestHeight === -Infinity) return null;

  // One voltage bin of tolerance: two columns whose openings differ by less than the
  // vertical resolution are not meaningfully different.
  const binV = (h.vMax - h.vMin) / (h.ny - 1);
  const isBest = (ix: number): boolean => {
    const o = openings[ix];
    return o !== null && o !== undefined && o.height >= bestHeight - binV * 1.001;
  };

  let runStart = -1;
  let best = { start: 0, length: 0 };
  for (let ix = 0; ix <= h.nx; ix++) {
    const ok = ix < h.nx && isBest(ix);
    if (ok && runStart < 0) runStart = ix;
    if (!ok && runStart >= 0) {
      if (ix - runStart > best.length) best = { start: runStart, length: ix - runStart };
      runStart = -1;
    }
  }
  if (best.length === 0) return null;

  const centre = best.start + Math.floor((best.length - 1) / 2);
  const opening = openings[centre];
  if (!opening) return null;
  return {
    uiPosition: binToUi(h, centre),
    opening,
    plateauUi: (best.length / h.nx) * h.uiSpan,
  };
}
