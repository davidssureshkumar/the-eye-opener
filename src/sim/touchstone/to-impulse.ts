/**
 * From a transfer function sampled where an analyser happened to sweep, to one the
 * time-domain simulator can use at every bin of its own FFT grid.
 *
 * A measured S21 is known at a few hundred or a few thousand frequencies, from
 * some lowest one that is never zero to a highest one that is often below the
 * simulator's Nyquist frequency. Three gaps have to be filled, and each is filled in
 * the plainest way that is physically defensible, with what it cost reported:
 *
 *   - Between samples: magnitude and unwrapped phase are interpolated linearly, not
 *     real and imaginary parts, because a delayed thru rotates many times between
 *     samples and interpolating the rotating parts shrinks its magnitude. The phase
 *     unwraps only if it moves less than pi between samples. A sweep too coarse for
 *     the delay rotates by a large step at every sample, so the median step is what
 *     is flagged, above pi/2. The largest step is reported too, but it is no test:
 *     a real zero of the transfer, such as the null of a skewed pair, is a genuine
 *     jump of pi, and two samples cannot tell it from a rotation of nearly pi.
 *   - Below the first sample, to DC: the phase is extended with the slope of the
 *     first two samples, and the whole unwrapped phase is moved by the multiple of
 *     2 pi that brings that extension nearest zero at DC, where a real network's
 *     phase must be 0 (or pi, for an inverting path). What is left over is reported.
 *     The magnitude is extended linearly and never below zero.
 *   - Above the last sample: a sweep that stops at f_max says nothing beyond, and a
 *     hard stop rings in time. The magnitude is rolled off with a raised cosine from
 *     f_max to f_max (1 + taper), and zero after. The phase continues with the slope
 *     of the last two samples, so the delay of what survives is right.
 *
 * Causality is screened, not proven. An impulse response computed from the data on
 * its own grid is inspected for energy before t = 0, beyond a guard band a few
 * widths of the smoothing kernel wide, because band-limiting alone smears a causal
 * response slightly into negative time. The same is measured after +guard. A causal
 * response puts almost nothing before and nearly everything after; a response
 * with its phase thrown away is symmetric, and one with its phase conjugated is the
 * mirror image. The transfer is flagged when the energy before exceeds
 * CAUSALITY_FLOOR of the whole and CAUSALITY_SYMMETRY of the energy after. A causal
 * lossy line sits near 1e-8 before; a magnitude-only copy of a 5 cm route sampled
 * to 40 GHz sits near 1e-4, with as much after. A response shorter than the band's
 * own resolution, a few millimetres of line, cannot be judged either way, and the
 * page says so.
 *
 * Physics: PHYSICS.md section 14.5.
 */

import type { Complex } from '../../dsp/complex';
import { irfft, nextPow2 } from '../../dsp/fft';

/** Energy before -guard, as a fraction of the whole, below which a transfer is never flagged. */
export const CAUSALITY_FLOOR = 1e-6;

/** Energy before -guard over energy after +guard, above which (and above the floor) a transfer is flagged. */
export const CAUSALITY_SYMMETRY = 0.05;

/** A median phase step between adjacent samples above this, radians, is flagged as coarse. */
export const COARSE_PHASE_STEP = Math.PI / 2;

export interface InterpolantOptions {
  /** Width of the raised-cosine roll-off above the last sample, as a fraction of it. */
  taper?: number;
}

export interface TransferInterpolant {
  /** The transfer at any frequency, Hz, with the gaps filled as above. */
  at(f: number): Complex;
  /** Lowest and highest measured frequency, Hz. */
  fMin: number;
  fMax: number;
  /** Frequency above which the transfer is zero, Hz. */
  fStop: number;
  /** Phase at DC after choosing the branch, radians: how far the data is from 0 or pi. */
  dcPhaseResidual: number;
  /** Whether DC is taken as an inverting path, phase pi. */
  inverting: boolean;
  /** Largest phase change between adjacent samples, radians. */
  maxPhaseStep: number;
  /** Median phase change between adjacent samples, radians. */
  medianPhaseStep: number;
  /** Delay implied by the phase slope over the whole sweep, seconds. */
  sweepDelay: number;
}

/** Unwrapped phase of a sampled complex sequence. */
export function unwrappedPhase(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { phase: Float64Array; maxStep: number; medianStep: number } {
  const n = re.length;
  const phase = new Float64Array(n);
  const steps = new Float64Array(Math.max(0, n - 1));
  let maxStep = 0;
  if (n === 0) return { phase, maxStep, medianStep: 0 };
  phase[0] = Math.atan2(im[0], re[0]);
  for (let k = 1; k < n; k++) {
    // The step is the argument of the ratio of adjacent samples, in (-pi, pi].
    const r = re[k] * re[k - 1] + im[k] * im[k - 1];
    const i = im[k] * re[k - 1] - re[k] * im[k - 1];
    const step = r === 0 && i === 0 ? 0 : Math.atan2(i, r);
    maxStep = Math.max(maxStep, Math.abs(step));
    steps[k - 1] = Math.abs(step);
    phase[k] = phase[k - 1] + step;
  }
  steps.sort();
  const m = steps.length;
  const medianStep = m === 0 ? 0 : m % 2 === 1 ? steps[(m - 1) / 2] : 0.5 * (steps[m / 2 - 1] + steps[m / 2]);
  return { phase, maxStep, medianStep };
}

/** Index of the last sample at or below f, clamped to [0, n - 2]. */
function segment(freq: ArrayLike<number>, f: number): number {
  let lo = 0;
  let hi = freq.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (freq[mid] <= f) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function transferInterpolant(
  freq: ArrayLike<number>,
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  options: InterpolantOptions = {},
): TransferInterpolant {
  const n = freq.length;
  if (n < 2) throw new Error('transferInterpolant: need at least two frequencies');
  const taper = Math.max(1e-3, options.taper ?? 0.1);
  const mag = new Float64Array(n);
  for (let k = 0; k < n; k++) mag[k] = Math.hypot(re[k], im[k]);
  const { phase, maxStep, medianStep } = unwrappedPhase(re, im);

  // Phase at DC by the first two samples' slope, and the branch nearest 0 or pi.
  const slopeLow = (phase[1] - phase[0]) / (freq[1] - freq[0]);
  const atDc = phase[0] - slopeLow * freq[0];
  const turns = Math.round(atDc / (2 * Math.PI));
  let shifted = atDc - 2 * Math.PI * turns;
  for (let k = 0; k < n; k++) phase[k] -= 2 * Math.PI * turns;
  const inverting = Math.abs(shifted) > Math.PI / 2;
  const dcTarget = inverting ? Math.sign(shifted) * Math.PI : 0;
  const dcPhaseResidual = shifted - dcTarget;
  shifted = dcTarget;
  const magDc = Math.max(0, mag[0] - ((mag[1] - mag[0]) / (freq[1] - freq[0])) * freq[0]);

  const fMin = freq[0];
  const fMax = freq[n - 1];
  const fStop = fMax * (1 + taper);
  const slopeHigh = (phase[n - 1] - phase[n - 2]) / (fMax - freq[n - 2]);
  const sweepDelay = fMax > fMin ? -(phase[n - 1] - phase[0]) / (2 * Math.PI * (fMax - fMin)) : 0;

  const at = (fIn: number): Complex => {
    const f = Math.abs(fIn);
    let m: number;
    let p: number;
    if (f <= fMin) {
      const u = fMin > 0 ? f / fMin : 1;
      m = magDc + (mag[0] - magDc) * u;
      p = shifted + (phase[0] - shifted) * u;
    } else if (f <= fMax) {
      const s = segment(freq, f);
      const u = (f - freq[s]) / (freq[s + 1] - freq[s]);
      m = mag[s] + (mag[s + 1] - mag[s]) * u;
      p = phase[s] + (phase[s + 1] - phase[s]) * u;
    } else if (f < fStop) {
      const u = (f - fMax) / (fStop - fMax);
      m = mag[n - 1] * 0.5 * (1 + Math.cos(Math.PI * u));
      p = phase[n - 1] + slopeHigh * (f - fMax);
    } else {
      return { re: 0, im: 0 };
    }
    // A real impulse response has H(-f) = conj H(f).
    const sign = fIn < 0 ? -1 : 1;
    return { re: m * Math.cos(p), im: sign * m * Math.sin(p) };
  };

  return {
    at,
    fMin,
    fMax,
    fStop,
    dcPhaseResidual,
    inverting,
    maxPhaseStep: maxStep,
    medianPhaseStep: medianStep,
    sweepDelay,
  };
}

export interface ImpulseResult {
  /** Sample interval, seconds. */
  dt: number;
  /** Impulse response samples, t = 0 at index 0; the last quarter is negative time. */
  h: Float64Array;
  /** Energy before -guard as a fraction of all the energy. */
  preResponseEnergy: number;
  /** Energy after +guard as a fraction of all the energy. */
  postResponseEnergy: number;
  /** Largest |h| before -guard, relative to the largest |h| anywhere. */
  preResponsePeak: number;
  /** Whether the screen flags the transfer as not causal. */
  acausal: boolean;
  /** Guard band, seconds. */
  guard: number;
}

/**
 * The impulse response of an interpolated transfer, on a grid chosen so the record
 * holds the sweep's delay several times over, and its pre-response energy.
 *
 * The impulse is smoothed by a cos^2 window over the full band before inversion, so
 * the kernel that smears it into negative time decays fast and a short guard
 * suffices. The window changes the shape of the response, not whether it is causal.
 */
export function impulseOf(t: TransferInterpolant, maxSamples = 1 << 16): ImpulseResult {
  const band = t.fStop;
  const dt = 1 / (2 * band);
  const kernelWidth = 2 / band;
  const span = Math.max(8 * Math.abs(t.sweepDelay), 400 * kernelWidth, 1 / t.fMin);
  const n = Math.min(maxSamples, nextPow2(Math.ceil(span / dt)));
  const half = (n >> 1) + 1;
  const re = new Float64Array(half);
  const im = new Float64Array(half);
  const df = 1 / (n * dt);
  for (let k = 0; k < half; k++) {
    const f = k * df;
    const w = f < band ? Math.cos((Math.PI * f) / (2 * band)) ** 2 : 0;
    const v = t.at(f);
    re[k] = (v.re * w) / dt;
    im[k] = (v.im * w) / dt;
  }
  if (n % 2 === 0) im[half - 1] = 0;
  const h = irfft(re, im, n);

  const guard = 6 * kernelWidth;
  const guardSamples = Math.ceil(guard / dt);
  const negativeStart = n - (n >> 2);
  let total = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    total += h[i] * h[i];
    peak = Math.max(peak, Math.abs(h[i]));
  }
  let pre = 0;
  let prePeak = 0;
  for (let i = negativeStart; i < n - guardSamples; i++) {
    pre += h[i] * h[i];
    prePeak = Math.max(prePeak, Math.abs(h[i]));
  }
  let post = 0;
  for (let i = guardSamples; i < negativeStart; i++) post += h[i] * h[i];
  const preResponseEnergy = total > 0 ? pre / total : 0;
  const postResponseEnergy = total > 0 ? post / total : 0;
  return {
    dt,
    h,
    preResponseEnergy,
    postResponseEnergy,
    preResponsePeak: peak > 0 ? prePeak / peak : 0,
    acausal:
      preResponseEnergy > CAUSALITY_FLOOR && preResponseEnergy > CAUSALITY_SYMMETRY * postResponseEnergy,
    guard,
  };
}
