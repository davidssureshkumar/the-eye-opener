/**
 * FFT / IFFT.
 *
 * Conventions (also recorded in PHYSICS.md):
 *   Forward:  X[k] = sum_{n=0}^{N-1} x[n] * exp(-2*pi*i*k*n/N)      (unnormalised)
 *   Inverse:  x[n] = (1/N) * sum_{k=0}^{N-1} X[k] * exp(+2*pi*i*k*n/N)
 *
 * Radix-2 Cooley-Tukey (decimation in time, in-place) for power-of-two lengths.
 * Bluestein chirp-z for every other length, so the public API accepts arbitrary N.
 * Twiddle factors come from a cached, directly-evaluated table rather than
 * recurrent rotation: recurrence accumulates phase error at the ~1e-10 level for
 * N = 2^16, which is enough to corrupt a deep bathtub curve.
 */

export interface ComplexArray {
  re: Float64Array;
  im: Float64Array;
}

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  return 1 << (32 - Math.clz32(n - 1));
}

/** Cached forward twiddles: w[k] = exp(-2*pi*i*k/n) for k in [0, n/2). */
const twiddleCache = new Map<number, ComplexArray>();

function twiddles(n: number): ComplexArray {
  const hit = twiddleCache.get(n);
  if (hit) return hit;
  const half = n >> 1;
  const re = new Float64Array(half);
  const im = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const a = (-2 * Math.PI * k) / n;
    re[k] = Math.cos(a);
    im[k] = Math.sin(a);
  }
  const t = { re, im };
  // Bound the cache: only a handful of sizes are used in practice.
  if (twiddleCache.size > 24) twiddleCache.clear();
  twiddleCache.set(n, t);
  return t;
}

function bitReverse(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
}

/** In-place radix-2 FFT. re.length must be a power of two. conj selects the inverse kernel. */
function fftRadix2(re: Float64Array, im: Float64Array, conj: boolean): void {
  const n = re.length;
  if (n <= 1) return;
  bitReverse(re, im);
  const w = twiddles(n);
  const sgn = conj ? -1 : 1;

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let base = 0; base < n; base += len) {
      for (let j = 0, tw = 0; j < half; j++, tw += step) {
        const wr = w.re[tw];
        const wi = sgn * w.im[tw];
        const i0 = base + j;
        const i1 = i0 + half;
        const xr = re[i1];
        const xi = im[i1];
        const vr = xr * wr - xi * wi;
        const vi = xr * wi + xi * wr;
        const ur = re[i0];
        const ui = im[i0];
        re[i0] = ur + vr;
        im[i0] = ui + vi;
        re[i1] = ur - vr;
        im[i1] = ui - vi;
      }
    }
  }
}

/**
 * Bluestein chirp-z transform for arbitrary N.
 *
 *   X[k] = exp(-i*pi*k^2/N) * sum_n ( x[n] exp(-i*pi*n^2/N) ) * exp(+i*pi*(k-n)^2/N)
 *
 * The inner sum is a linear convolution, evaluated with a power-of-two FFT of
 * length M >= 2N-1. Squared indices are reduced mod 2N before scaling by pi/N,
 * which keeps the cos/sin argument small and the phase accurate for large N.
 */
function fftBluestein(re: Float64Array, im: Float64Array, conj: boolean): void {
  const n = re.length;
  const m = nextPow2(2 * n - 1);
  const sgn = conj ? 1 : -1;

  const chirpRe = new Float64Array(n);
  const chirpIm = new Float64Array(n);
  const twoN = 2 * n;
  for (let i = 0; i < n; i++) {
    // (i*i) mod 2N, so the angle stays small and exact for realistic n.
    const j = (i * i) % twoN;
    const a = (sgn * Math.PI * j) / n;
    chirpRe[i] = Math.cos(a);
    chirpIm[i] = Math.sin(a);
  }

  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    ar[i] = re[i] * chirpRe[i] - im[i] * chirpIm[i];
    ai[i] = re[i] * chirpIm[i] + im[i] * chirpRe[i];
  }

  // b[i] = conj(chirp[i]), mirrored about m so the cyclic convolution is linear.
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  br[0] = chirpRe[0];
  bi[0] = -chirpIm[0];
  for (let i = 1; i < n; i++) {
    br[i] = chirpRe[i];
    bi[i] = -chirpIm[i];
    br[m - i] = chirpRe[i];
    bi[m - i] = -chirpIm[i];
  }

  fftRadix2(ar, ai, false);
  fftRadix2(br, bi, false);
  for (let i = 0; i < m; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const q = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = q;
  }
  fftRadix2(ar, ai, true);
  const inv = 1 / m;
  for (let i = 0; i < m; i++) {
    ar[i] *= inv;
    ai[i] *= inv;
  }

  for (let k = 0; k < n; k++) {
    re[k] = ar[k] * chirpRe[k] - ai[k] * chirpIm[k];
    im[k] = ar[k] * chirpIm[k] + ai[k] * chirpRe[k];
  }
}

/** In-place forward FFT for any length. */
export function fft(re: Float64Array, im: Float64Array): void {
  if (re.length !== im.length) throw new Error('fft: re/im length mismatch');
  const n = re.length;
  if (n <= 1) return;
  if (isPow2(n)) fftRadix2(re, im, false);
  else fftBluestein(re, im, false);
}

/** In-place inverse FFT for any length, including the 1/N scaling. */
export function ifft(re: Float64Array, im: Float64Array): void {
  if (re.length !== im.length) throw new Error('ifft: re/im length mismatch');
  const n = re.length;
  if (n <= 1) return;
  if (isPow2(n)) fftRadix2(re, im, true);
  else fftBluestein(re, im, true);
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    re[i] *= inv;
    im[i] *= inv;
  }
}

/** Non-mutating forward FFT. im defaults to zeros (real input). */
export function fftOf(re: ArrayLike<number>, im?: ArrayLike<number>): ComplexArray {
  const r = Float64Array.from(re);
  const i = im ? Float64Array.from(im) : new Float64Array(r.length);
  fft(r, i);
  return { re: r, im: i };
}

/** Non-mutating inverse FFT. */
export function ifftOf(re: ArrayLike<number>, im: ArrayLike<number>): ComplexArray {
  const r = Float64Array.from(re);
  const i = Float64Array.from(im);
  ifft(r, i);
  return { re: r, im: i };
}

/**
 * Real-input FFT. Returns the non-redundant half spectrum, length floor(N/2)+1,
 * i.e. DC through Nyquist inclusive. This is the form the channel engine uses:
 * a real impulse response has a Hermitian spectrum, so storing both halves
 * doubles memory for no information.
 */
export function rfft(x: ArrayLike<number>): ComplexArray {
  const full = fftOf(x);
  const n = full.re.length;
  const half = (n >> 1) + 1;
  return { re: full.re.slice(0, half), im: full.im.slice(0, half) };
}

/**
 * Inverse of rfft. n is the original real signal length, needed because
 * floor(N/2)+1 bins map to both an even and an odd N.
 */
export function irfft(re: ArrayLike<number>, im: ArrayLike<number>, n: number): Float64Array {
  const half = re.length;
  if (half !== (n >> 1) + 1) throw new Error('irfft: half-spectrum length does not match n');
  const fr = new Float64Array(n);
  const fi = new Float64Array(n);
  for (let k = 0; k < half; k++) {
    fr[k] = re[k];
    fi[k] = im[k];
  }
  // Hermitian mirror: X[N-k] = conj(X[k]).
  for (let k = 1; k < n - half + 1; k++) {
    fr[n - k] = re[k];
    fi[n - k] = -im[k];
  }
  ifft(fr, fi);
  return fr;
}

/**
 * Naive O(N^2) DFT. Reference implementation used only by the test suite to
 * validate the fast paths; never call this on a hot path.
 * sign is -1 for forward, +1 for inverse (the inverse here is still unnormalised).
 */
export function dftNaive(re: ArrayLike<number>, im: ArrayLike<number>, sign: -1 | 1 = -1): ComplexArray {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (sign * 2 * Math.PI * k * t) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      sr += re[t] * c - im[t] * s;
      si += re[t] * s + im[t] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

/** Magnitude spectrum helper. */
export function magnitude(c: ComplexArray): Float64Array {
  const out = new Float64Array(c.re.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(c.re[i], c.im[i]);
  return out;
}

/** Raw wrapped phase in radians, -pi..pi. */
export function phase(c: ComplexArray): Float64Array {
  const out = new Float64Array(c.re.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.atan2(c.im[i], c.re[i]);
  return out;
}

/** Unwrap a phase vector, removing 2*pi discontinuities. Returns a new array. */
export function unwrap(ph: ArrayLike<number>): Float64Array {
  const out = new Float64Array(ph.length);
  if (ph.length === 0) return out;
  out[0] = ph[0];
  let offset = 0;
  for (let i = 1; i < ph.length; i++) {
    const d = ph[i] - ph[i - 1];
    if (d > Math.PI) offset -= 2 * Math.PI;
    else if (d < -Math.PI) offset += 2 * Math.PI;
    out[i] = ph[i] + offset;
  }
  return out;
}
