/**
 * Hilbert transform and the analytic signal.
 *
 * Three uses in this project:
 *
 *  - Envelope detection on a ringing edge (M2) and on a crosstalk pulse (M6),
 *    so the decay of the ringing can be measured rather than eyeballed.
 *  - The minimum-phase construction in M4. A passive channel with a known
 *    magnitude response has a *unique* causal minimum-phase counterpart, and its
 *    phase is the Hilbert transform of the log magnitude. This is how a
 *    magnitude-only loss model (skin effect + dielectric) gets a physically
 *    correct phase instead of an assumed linear one - and getting that wrong is
 *    the classic way to produce an acausal impulse response that responds before
 *    it is excited.
 *  - Complex baseband representation in M9, where the wireless view of the same
 *    channel wants I and Q rather than a real passband waveform.
 */

import { fft, ifft } from './fft';

/**
 * Analytic signal x + j*H{x}.
 *
 * Implemented the standard way: zero the negative-frequency half of the
 * spectrum and double the positive half, leaving DC and Nyquist alone.
 */
export function analyticSignal(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  if (n === 0) return { re, im };

  fft(re, im);

  const half = n >> 1;
  if (n % 2 === 0) {
    // Bins 1..half-1 doubled; DC and Nyquist untouched; half+1..n-1 zeroed.
    for (let k = 1; k < half; k++) {
      re[k] *= 2;
      im[k] *= 2;
    }
    for (let k = half + 1; k < n; k++) {
      re[k] = 0;
      im[k] = 0;
    }
  } else {
    for (let k = 1; k <= half; k++) {
      re[k] *= 2;
      im[k] *= 2;
    }
    for (let k = half + 1; k < n; k++) {
      re[k] = 0;
      im[k] = 0;
    }
  }

  ifft(re, im);
  return { re, im };
}

/** Hilbert transform of a real sequence: the imaginary part of the analytic signal. */
export function hilbert(x: ArrayLike<number>): Float64Array {
  return analyticSignal(x).im;
}

/** Instantaneous amplitude envelope, |x + j*H{x}|. */
export function envelope(x: ArrayLike<number>): Float64Array {
  const a = analyticSignal(x);
  const out = new Float64Array(a.re.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(a.re[i], a.im[i]);
  return out;
}

/** Instantaneous phase in radians, wrapped to -pi..pi. */
export function instantaneousPhase(x: ArrayLike<number>): Float64Array {
  const a = analyticSignal(x);
  const out = new Float64Array(a.re.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.atan2(a.im[i], a.re[i]);
  return out;
}

/**
 * Minimum-phase reconstruction from a magnitude-only frequency response.
 *
 * For a causal, stable, minimum-phase system the log magnitude and the phase form
 * a Hilbert transform pair:
 *
 *   phi(w) = -H{ ln|H(w)| }
 *
 * Computed here via the real cepstrum: take the IFFT of ln|H|, apply the causal
 * fold (double the positive-quefrency half, keep the zeroth term, zero the
 * negative half), then FFT back and exponentiate. The result is the unique causal
 * response with the requested magnitude and the minimum possible group delay.
 *
 * @param magFull Magnitude response over the full DFT grid, 0..fs, length N.
 *        Must be strictly positive; a floor is applied to protect the logarithm
 *        at deep nulls, which is unavoidable and is why a channel with a true
 *        transmission zero needs measured phase rather than this construction.
 * @param floorDb Magnitude floor relative to the peak, in dB.
 */
export function minimumPhaseFromMagnitude(
  magFull: ArrayLike<number>,
  floorDb = -200,
): { re: Float64Array; im: Float64Array } {
  const n = magFull.length;
  let peak = 0;
  for (let i = 0; i < n; i++) if (magFull[i] > peak) peak = magFull[i];
  const floor = peak * Math.pow(10, floorDb / 20);

  // ln|H| on the full grid.
  const logRe = new Float64Array(n);
  const logIm = new Float64Array(n);
  for (let i = 0; i < n; i++) logRe[i] = Math.log(Math.max(magFull[i], floor));

  // Real cepstrum.
  ifft(logRe, logIm);

  // Causal fold: keep c[0], double 1..N/2-1, zero the rest (Nyquist term kept as is).
  const half = n >> 1;
  for (let i = 1; i < half; i++) {
    logRe[i] *= 2;
    logIm[i] *= 2;
  }
  for (let i = half + 1; i < n; i++) {
    logRe[i] = 0;
    logIm[i] = 0;
  }

  // Back to the frequency domain: this is ln|H| + j*phi_min.
  fft(logRe, logIm);

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = Math.exp(logRe[i]);
    re[i] = m * Math.cos(logIm[i]);
    im[i] = m * Math.sin(logIm[i]);
  }
  return { re, im };
}
