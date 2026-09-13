/**
 * Interpolation, resampling and edge-timing extraction.
 *
 * Two jobs here, and they are not the same job.
 *
 * 1. Resampling a simulated waveform for display, or converting between the
 *    simulation sample rate and the channel model sample rate.
 * 2. Measuring an edge crossing to sub-sample resolution. This one is
 *    measurement, not cosmetics: every jitter number in the site comes from a
 *    threshold crossing time, and if that crossing is quantised to the sample
 *    grid then the reported RJ is dominated by the grid, not by the physics.
 *    The same trap exists on a real scope - a 20 GSa/s capture has 50 ps between
 *    samples, and a 2 ps jitter measurement only exists because the scope
 *    interpolates. That is why the site runs at 32-64 samples/UI and still
 *    interpolates crossings.
 */

/** Linear interpolation at fractional index. Clamps at the ends. */
export function lerpAt(x: ArrayLike<number>, idx: number): number {
  const n = x.length;
  if (n === 0) return 0;
  if (idx <= 0) return x[0];
  if (idx >= n - 1) return x[n - 1];
  const i = Math.floor(idx);
  const f = idx - i;
  return x[i] * (1 - f) + x[i + 1] * f;
}

/**
 * Catmull-Rom cubic interpolation at fractional index.
 * C1 continuous and passes through the samples. Good for drawing a smooth trace
 * from a coarse simulation grid without the overshoot a plain cubic spline adds.
 */
export function cubicAt(x: ArrayLike<number>, idx: number): number {
  const n = x.length;
  if (n === 0) return 0;
  if (n < 4) return lerpAt(x, idx);
  // Clamp the *sample* indices at the ends rather than sliding the segment, so
  // the interpolation parameter always stays in [0, 1]. Sliding the segment makes
  // the first and last samples extrapolate, which is how a boundary artefact ends
  // up in the middle of a measurement.
  const t = Math.max(0, Math.min(n - 1, idx));
  const i = Math.min(n - 2, Math.floor(t));
  const f = t - i;
  const at = (k: number): number => x[k < 0 ? 0 : k > n - 1 ? n - 1 : k];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  const a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3;
  const b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3;
  const c = -0.5 * p0 + 0.5 * p2;
  return ((a * f + b) * f + c) * f + p1;
}

/**
 * Band-limited (Whittaker-Shannon sinc) interpolation at fractional index.
 *
 * This is what a real-time scope means by "sin(x)/x interpolation", and the
 * reason the sample-rate-to-bandwidth ratio matters: sinc reconstruction is exact
 * only for a signal already band-limited below Nyquist. Apply it to an
 * under-sampled edge and it invents ringing that was never on the wire - a real
 * and common measurement artefact worth showing in M10.
 *
 * @param halfWidth number of samples used either side; cost is O(2*halfWidth).
 */
export function sincAt(x: ArrayLike<number>, idx: number, halfWidth = 16): number {
  const n = x.length;
  if (n === 0) return 0;
  const centre = Math.round(idx);
  let acc = 0;
  for (let k = centre - halfWidth; k <= centre + halfWidth; k++) {
    if (k < 0 || k >= n) continue;
    const d = idx - k;
    acc += x[k] * sinc(d) * lanczosTaper(d, halfWidth);
  }
  return acc;
}

/** Normalised sinc: sin(pi*x)/(pi*x), with the removable singularity handled. */
export function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Lanczos taper, which truncates the sinc kernel without a hard edge. */
function lanczosTaper(d: number, a: number): number {
  if (d === 0) return 1;
  if (Math.abs(d) >= a) return 0;
  return sinc(d / a);
}

export type InterpKind = 'linear' | 'cubic' | 'sinc';

export function interpAt(x: ArrayLike<number>, idx: number, kind: InterpKind = 'cubic'): number {
  switch (kind) {
    case 'linear':
      return lerpAt(x, idx);
    case 'cubic':
      return cubicAt(x, idx);
    case 'sinc':
      return sincAt(x, idx);
  }
}

/**
 * Resample a uniformly sampled signal to a new length, preserving the span.
 * Used for display decimation and for matching a Touchstone-derived impulse
 * response to the simulation grid.
 */
export function resample(x: ArrayLike<number>, outLen: number, kind: InterpKind = 'cubic'): Float64Array {
  const out = new Float64Array(outLen);
  const n = x.length;
  if (n === 0 || outLen === 0) return out;
  if (outLen === 1) {
    out[0] = x[0];
    return out;
  }
  const scale = (n - 1) / (outLen - 1);
  for (let i = 0; i < outLen; i++) out[i] = interpAt(x, i * scale, kind);
  return out;
}

/** Integer-factor upsample by zero stuffing. The caller must low-pass afterwards. */
export function zeroStuff(x: ArrayLike<number>, factor: number): Float64Array {
  const out = new Float64Array(x.length * factor);
  for (let i = 0; i < x.length; i++) out[i * factor] = x[i];
  return out;
}

/** Integer-factor decimation without filtering. Aliases unless the input is already band-limited. */
export function decimate(x: ArrayLike<number>, factor: number): Float64Array {
  const n = Math.ceil(x.length / factor);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i * factor];
  return out;
}

export type EdgeDirection = 'rising' | 'falling' | 'both';

export interface Crossing {
  /** Fractional sample index of the threshold crossing. */
  index: number;
  /** Direction of the crossing. */
  rising: boolean;
}

/**
 * Find threshold crossings with sub-sample resolution.
 *
 * Linear interpolation between the bracketing samples is used deliberately. At
 * 32+ samples per UI the edge is locally very close to straight, and linear
 * interpolation cannot introduce the ringing that a higher-order fit can invent
 * near a noisy sample - a bias that would show up directly in the jitter
 * histogram. Scopes make the same trade for the same reason.
 *
 * @param hysteresis fraction of full scale the signal must depart before another
 *        crossing is accepted; suppresses double-counting on a noisy edge, exactly
 *        as a scope trigger hysteresis band does.
 */
export function findCrossings(
  x: ArrayLike<number>,
  threshold: number,
  direction: EdgeDirection = 'both',
  hysteresis = 0,
): Crossing[] {
  const out: Crossing[] = [];
  const n = x.length;
  if (n < 2) return out;

  let armedRise = x[0] <= threshold - hysteresis;
  let armedFall = x[0] >= threshold + hysteresis;

  for (let i = 1; i < n; i++) {
    const a = x[i - 1];
    const b = x[i];

    if (b > threshold + hysteresis) armedFall = true;
    if (b < threshold - hysteresis) armedRise = true;

    if (a <= threshold && b > threshold && armedRise) {
      if (direction !== 'falling') {
        out.push({ index: i - 1 + fractionalCross(a, b, threshold), rising: true });
      }
      armedRise = false;
    } else if (a >= threshold && b < threshold && armedFall) {
      if (direction !== 'rising') {
        out.push({ index: i - 1 + fractionalCross(a, b, threshold), rising: false });
      }
      armedFall = false;
    }
  }
  return out;
}

function fractionalCross(a: number, b: number, threshold: number): number {
  const d = b - a;
  if (d === 0) return 0;
  const f = (threshold - a) / d;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Rise time between two amplitude fractions on a monotonic-ish edge.
 *
 * Returns the interval in samples between the low and high crossings, or NaN if
 * the edge does not reach both levels. The caller supplies the low and high
 * reference levels, so both the 10-90% and 20-80% conventions are available -
 * a distinction that matters, because 20-80% on the same edge reads roughly
 * 0.6x the 10-90% number and the two are quoted interchangeably in datasheets.
 */
export function edgeTransitionSamples(
  x: ArrayLike<number>,
  startIdx: number,
  lowLevel: number,
  highLevel: number,
  rising: boolean,
): number {
  const n = x.length;
  const dir = rising ? 1 : -1;
  let lowIdx = NaN;
  let highIdx = NaN;

  for (let i = Math.max(1, Math.floor(startIdx)); i < n; i++) {
    const a = x[i - 1];
    const b = x[i];
    if (isNaN(lowIdx) && dir * (b - lowLevel) > 0 && dir * (a - lowLevel) <= 0) {
      lowIdx = i - 1 + fractionalCross(a, b, lowLevel);
    }
    if (!isNaN(lowIdx) && dir * (b - highLevel) > 0 && dir * (a - highLevel) <= 0) {
      highIdx = i - 1 + fractionalCross(a, b, highLevel);
      break;
    }
  }
  return isNaN(lowIdx) || isNaN(highIdx) ? NaN : highIdx - lowIdx;
}

/**
 * Detect a non-monotonic segment on an edge.
 *
 * Returns the sample indices where the signal reverses direction while traversing
 * between the two reference levels. A non-monotonic rising edge is a genuine
 * failure mode, not a cosmetic one: a receiver that samples during the reversal
 * can register the wrong level, and strobe-based capture schemes that assume a
 * single crossing per edge lose their timing reference.
 *
 * @param tolerance reversal magnitude, in signal units, below which a wiggle is
 *        treated as noise rather than a violation.
 */
export function findMonotonicityViolations(
  x: ArrayLike<number>,
  startIdx: number,
  endIdx: number,
  rising: boolean,
  tolerance = 0,
): number[] {
  const out: number[] = [];
  const dir = rising ? 1 : -1;
  const lo = Math.max(1, Math.floor(startIdx));
  const hi = Math.min(x.length - 1, Math.ceil(endIdx));
  let runStart = -1;
  let runDepth = 0;

  for (let i = lo; i <= hi; i++) {
    const d = dir * (x[i] - x[i - 1]);
    if (d < 0) {
      if (runStart < 0) runStart = i;
      runDepth += -d;
    } else {
      if (runStart >= 0 && runDepth > tolerance) out.push(runStart);
      runStart = -1;
      runDepth = 0;
    }
  }
  if (runStart >= 0 && runDepth > tolerance) out.push(runStart);
  return out;
}
