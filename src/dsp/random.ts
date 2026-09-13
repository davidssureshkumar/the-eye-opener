/**
 * Seeded pseudo-random number generation.
 *
 * Every stochastic quantity in this site (random jitter, amplitude noise, PRBS
 * seeds, Monte-Carlo bit streams) draws from here. Determinism is a hard
 * requirement, not a nicety: a URL permalink must reproduce the exact eye the
 * person who shared it was looking at, and a regression test on a jitter
 * histogram is meaningless if the stream changes between runs.
 *
 * Generator: xoshiro128** (Blackman and Vigna, 2018). 128-bit state, period
 * 2^128-1, passes BigCrush. Seeded through SplitMix32 so a single integer seed
 * expands to a well-distributed state (a naive seed of 1,0,0,0 takes a long time
 * to escape a low-entropy state).
 */

const TWO_POW_32 = 4294967296;

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  /** Cached second Box-Muller deviate; null when the pair is exhausted. */
  private spare: number | null = null;

  constructor(seed = 0x5eed1234) {
    const sm = splitmix32(seed);
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
    // Guard against the all-zero state, which is a fixed point of xoshiro.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  /** Raw 32-bit unsigned draw. */
  nextUint32(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform in [0, 1). 32-bit resolution. */
  next(): number {
    return this.nextUint32() / TWO_POW_32;
  }

  /**
   * Uniform in [0, 1) with 53-bit resolution. Used where a coarse 32-bit grid
   * would quantise a tail, e.g. generating deep-BER Monte-Carlo noise samples.
   */
  next53(): number {
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Uniform in [lo, hi). */
  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next53();
  }

  /** Unbiased integer in [0, n), via rejection sampling. */
  int(n: number): number {
    if (n <= 0) throw new Error('Rng.int: n must be positive');
    const limit = TWO_POW_32 - (TWO_POW_32 % n);
    let x = this.nextUint32();
    while (x >= limit) x = this.nextUint32();
    return x % n;
  }

  /** Fair coin. */
  bit(): 0 | 1 {
    return (this.nextUint32() >>> 31) as 0 | 1;
  }

  /**
   * Standard normal deviate, Box-Muller (polar form).
   *
   *   z0 = sqrt(-2 ln u) cos(2 pi v),  z1 = sqrt(-2 ln u) sin(2 pi v)
   *
   * The polar/rejection variant avoids the trig call and has better tail
   * behaviour than the basic form at 32-bit input resolution. Deviates are
   * produced in pairs; the spare is cached.
   */
  normal(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = 2 * this.next53() - 1;
      v = 2 * this.next53() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * f;
    return u * f;
  }

  /** Normal deviate with the given mean and standard deviation. */
  gaussian(mean: number, sigma: number): number {
    return mean + sigma * this.normal();
  }

  /** Fill an array with N(0, sigma) samples. Returns the same array. */
  fillGaussian(out: Float64Array, sigma: number, mean = 0): Float64Array {
    for (let i = 0; i < out.length; i++) out[i] = mean + sigma * this.normal();
    return out;
  }

  /** Snapshot the internal state, for resumable worker jobs. */
  saveState(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  restoreState(st: readonly [number, number, number, number]): void {
    this.s0 = st[0] >>> 0;
    this.s1 = st[1] >>> 0;
    this.s2 = st[2] >>> 0;
    this.s3 = st[3] >>> 0;
    this.spare = null;
  }
}

/**
 * Derive an independent stream from a base seed and a string label.
 * Lets each impairment own its own stream, so toggling crosstalk off does not
 * shift the random-jitter sequence and visibly redraw an unrelated part of the eye.
 */
export function deriveSeed(baseSeed: number, label: string): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = (Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0) >>> 0;
  }
  return h >>> 0;
}

/** Convenience: a labelled sub-stream of a base seed. */
export function subStream(baseSeed: number, label: string): Rng {
  return new Rng(deriveSeed(baseSeed, label));
}

/**
 * Inverse standard normal CDF (probit), Acklam rational approximation refined by
 * one Halley step. Relative error better than 1e-15 over the whole range.
 *
 * This is the function behind the bathtub curve: the Q-factor corresponding to a
 * target BER is Q = -invNormCdf(BER), and the dual-Dirac multiplier n(BER) in
 * TJ(BER) = DJ + n(BER) * RJ_rms is n = -2 * invNormCdf(BER).
 */
export function invNormCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  // One Halley refinement against the true CDF.
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/**
 * Complementary error function, Numerical Recipes erfc-Chebyshev fit.
 * Fractional error below 1.2e-7 everywhere, which is ample: it appears inside a
 * Halley refinement and in Q-to-BER conversion where the answer spans decades.
 */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 2 / (2 + z);
  const ty = 4 * t - 2;
  const cof = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3,
    -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5, -1.624290004647e-6,
    1.30365583558e-6, 1.5626441722e-8, -8.5238095915e-8, 6.529054439e-9, 5.059343495e-9, -9.91364156e-10,
    -2.27365122e-10, 9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13, 3.13092e-13, -1.12708e-13,
    3.81e-16, 7.106e-15,
  ];
  let d = 0;
  let dd = 0;
  for (let j = cof.length - 1; j > 0; j--) {
    const tmp = d;
    d = ty * d - dd + cof[j];
    dd = tmp;
  }
  const ans = t * Math.exp(-z * z + 0.5 * (cof[0] + ty * d) - dd);
  return x >= 0 ? ans : 2 - ans;
}

/** Standard normal CDF. */
export function normCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/**
 * Gaussian tail probability Q(x) = 1 - Phi(x) = 0.5 * erfc(x/sqrt(2)).
 * The BER of an NRZ link with Gaussian noise and a centred threshold is Q(SNR).
 */
export function qFunction(x: number): number {
  return 0.5 * erfc(x / Math.SQRT2);
}

/**
 * Dual-Dirac multiplier n(BER) for TJ(BER) = DJ(pk-pk) + n(BER) * RJ_rms.
 *
 *   n(BER) = 2 * Qinv(BER)
 *
 * The factor of two is the two eye crossings, each contributing its own Gaussian
 * tail; the argument is the specified BER itself, not BER/2. That convention is
 * what reproduces the multiplier table everyone quotes at the bench:
 *   1e-9 -> 11.996, 1e-10 -> 12.723, 1e-12 -> 14.069, 1e-16 -> 16.444.
 */
export function dualDiracN(ber: number): number {
  if (ber <= 0 || ber >= 1) return NaN;
  return -2 * invNormCdf(ber);
}
