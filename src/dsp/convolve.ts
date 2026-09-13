/**
 * Convolution and correlation.
 *
 * The channel is linear and time-invariant, so everything the channel does to a
 * bit stream is one convolution with its impulse response. These routines are the
 * hottest path in the site: a 100k-bit eye at 64 samples/UI is a 6.4M-point
 * convolution, which is why the FFT path and the block-based overlap-add path
 * both exist.
 */

import { fft, ifft, nextPow2 } from './fft';

/**
 * Direct linear convolution, O(N*M). Correct for any length and exact to within
 * floating-point accumulation; used as the reference the FFT path is tested against
 * and chosen automatically when one operand is short.
 */
export function convolveDirect(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return new Float64Array(0);
  const out = new Float64Array(n + m - 1);
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    for (let j = 0; j < m; j++) out[i + j] += ai * b[j];
  }
  return out;
}

/**
 * Linear convolution through the frequency domain, O(K log K).
 * Both operands are zero-padded to a power of two at least n+m-1 long, so the
 * circular wrap of the FFT lands entirely in the zero padding.
 */
export function convolveFft(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return new Float64Array(0);
  const outLen = n + m - 1;
  const k = nextPow2(outLen);

  const ar = new Float64Array(k);
  const ai = new Float64Array(k);
  const br = new Float64Array(k);
  const bi = new Float64Array(k);
  for (let i = 0; i < n; i++) ar[i] = a[i];
  for (let i = 0; i < m; i++) br[i] = b[i];

  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < k; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const q = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = q;
  }
  ifft(ar, ai);

  return ar.slice(0, outLen);
}

/** Crossover point at which the FFT path beats the direct path, empirically. */
const FFT_CROSSOVER = 64;

/** Linear convolution, choosing the cheaper implementation. */
export function convolve(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const short = Math.min(a.length, b.length);
  return short < FFT_CROSSOVER ? convolveDirect(a, b) : convolveFft(a, b);
}

/**
 * Circular (periodic) convolution of two equal-length sequences.
 * This is what you get if you multiply spectra without zero padding - shown
 * explicitly in the module material because time-domain aliasing from an
 * under-padded IFFT is one of the easiest ways to fake a plausible but wrong
 * channel response.
 */
export function circularConvolve(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const n = a.length;
  if (n !== b.length) throw new Error('circularConvolve: length mismatch');
  const ar = Float64Array.from(a);
  const ai = new Float64Array(n);
  const br = Float64Array.from(b);
  const bi = new Float64Array(n);
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const q = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = q;
  }
  ifft(ar, ai);
  return ar;
}

/**
 * Overlap-add block convolution.
 *
 * Used when a long bit stream is driven through a comparatively short channel
 * impulse response, which is the normal case for eye building. Keeps peak memory
 * bounded by the block size rather than by the stream length, and lets a worker
 * report progress and honour cancellation between blocks.
 *
 * @param onBlock optional progress callback; return false to abort.
 */
export function overlapAdd(
  x: ArrayLike<number>,
  h: ArrayLike<number>,
  blockSize?: number,
  onBlock?: (done: number, total: number) => boolean | void,
): Float64Array {
  const n = x.length;
  const m = h.length;
  if (n === 0 || m === 0) return new Float64Array(0);

  const bs = blockSize ?? Math.max(1024, nextPow2(4 * m));
  const fftLen = nextPow2(bs + m - 1);

  const hr = new Float64Array(fftLen);
  const hi = new Float64Array(fftLen);
  for (let i = 0; i < m; i++) hr[i] = h[i];
  fft(hr, hi);

  const out = new Float64Array(n + m - 1);
  const xr = new Float64Array(fftLen);
  const xi = new Float64Array(fftLen);
  const nBlocks = Math.ceil(n / bs);

  for (let blk = 0; blk < nBlocks; blk++) {
    const start = blk * bs;
    const end = Math.min(start + bs, n);
    xr.fill(0);
    xi.fill(0);
    for (let i = start; i < end; i++) xr[i - start] = x[i];

    fft(xr, xi);
    for (let i = 0; i < fftLen; i++) {
      const r = xr[i] * hr[i] - xi[i] * hi[i];
      const q = xr[i] * hi[i] + xi[i] * hr[i];
      xr[i] = r;
      xi[i] = q;
    }
    ifft(xr, xi);

    const len = end - start + m - 1;
    for (let i = 0; i < len; i++) {
      const t = start + i;
      if (t < out.length) out[t] += xr[i];
    }

    if (onBlock && onBlock(blk + 1, nBlocks) === false) break;
  }
  return out;
}

/**
 * Cross-correlation r[k] = sum_n a[n] * b[n+k], returned for lags
 * -(m-1) .. (n-1) with the zero lag at index m-1.
 *
 * Used for alignment: finding the cursor of a pulse response, aligning a
 * recovered bit stream against the transmitted one before counting errors, and
 * searching for the aggressor timing that maximally closes a victim eye.
 */
export function correlate(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const m = b.length;
  const rev = new Float64Array(m);
  for (let i = 0; i < m; i++) rev[i] = b[m - 1 - i];
  return convolve(a, rev);
}

/** Index of the zero lag within the output of `correlate`. */
export function correlateZeroLag(b: ArrayLike<number>): number {
  return b.length - 1;
}

/** Index of the maximum absolute value - the usual way to find a pulse cursor. */
export function argMaxAbs(x: ArrayLike<number>): number {
  let best = 0;
  let bestV = -Infinity;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}
