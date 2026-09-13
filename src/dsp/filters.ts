/**
 * Analogue filter responses, evaluated in the frequency domain.
 *
 * The whole site works frequency-first: a channel is a complex transfer function
 * H(f), a scope is a complex transfer function, a CTLE is a complex transfer
 * function, and time-domain waveforms are what you get after multiplying them
 * together and taking an IFFT. Keeping everything as H(f) means a measured
 * Touchstone channel and a synthesised RC network compose in exactly the same way.
 *
 * Rise time and bandwidth are related by the *shape* of the response, not by a
 * universal constant. The familiar BW = 0.35 / t_r is the single-pole result:
 * the coefficient is 0.34945 for one pole and 0.33963 for a true Gaussian, and
 * the maximally-flat responses used in high-bandwidth real-time scopes sit higher
 * still. This module derives the coefficient for each response type - in closed
 * form where one exists, numerically from the step response otherwise - rather
 * than quoting the rule of thumb, and the modules show the difference.
 */

import { irfft, nextPow2, rfft } from './fft';
import { invNormCdf } from './random';

export interface Complex {
  re: number;
  im: number;
}

export function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return { re: 0, im: 0 };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

export function cExp(theta: number): Complex {
  return { re: Math.cos(theta), im: Math.sin(theta) };
}

export type ResponseType = 'brickwall' | 'rc' | 'butterworth' | 'bessel' | 'gaussian';

export interface ResponseSpec {
  type: ResponseType;
  /** -3 dB bandwidth in Hz. */
  bw: number;
  /** Filter order, for Butterworth and Bessel. */
  order?: number;
}

/**
 * Complex transfer function at frequency f (Hz).
 * DC gain is unity for every response type, so they are directly comparable.
 */
export function transferAt(spec: ResponseSpec, f: number): Complex {
  const { type, bw } = spec;
  const order = Math.max(1, Math.min(10, Math.floor(spec.order ?? 4)));
  if (bw <= 0) return { re: 0, im: 0 };
  const w = f / bw; // normalised frequency

  switch (type) {
    case 'brickwall':
      // Zero phase, unity in band, zero out of band. Physically unrealisable -
      // included precisely so the module can show the pre-ringing it produces.
      return Math.abs(f) <= bw ? { re: 1, im: 0 } : { re: 0, im: 0 };

    case 'rc':
      // H(s) = 1/(1 + s/wc), s = j*2*pi*f
      return cDiv({ re: 1, im: 0 }, { re: 1, im: w });

    case 'butterworth':
      return butterworthAt(w, order);

    case 'bessel':
      return besselAt(w * besselNorm(order), order);

    case 'gaussian': {
      // |H(f)| = exp(-a f^2) with a chosen so |H(bw)| = 1/sqrt(2).
      const a = 0.5 * Math.LN2;
      const mag = Math.exp(-a * w * w);
      return { re: mag, im: 0 };
    }
  }
}

/**
 * Butterworth of the given order, normalised so |H| = 1/sqrt(2) at w = 1.
 * H(s) = 1 / prod_k (s - p_k), with p_k = exp(j*pi*(2k + n - 1)/(2n)).
 * The normalised polynomial has unit constant term, so DC gain is exactly 1.
 */
function butterworthAt(w: number, n: number): Complex {
  const s = { re: 0, im: w };
  let den: Complex = { re: 1, im: 0 };
  for (let k = 1; k <= n; k++) {
    const theta = (Math.PI * (2 * k + n - 1)) / (2 * n);
    const p = cExp(theta);
    den = cMul(den, { re: s.re - p.re, im: s.im - p.im });
  }
  return cDiv({ re: 1, im: 0 }, den);
}

/**
 * Reverse Bessel polynomial coefficients:
 *   theta_n(s) = sum_{k=0}^{n} a_k s^k,  a_k = (2n-k)! / (2^(n-k) * k! * (n-k)!)
 * H(s) = a_0 / theta_n(s), which is maximally flat in *group delay* rather than
 * in magnitude. That is why it is the response of choice when edge shape matters
 * more than brick-wall selectivity - and it is the response several scope vendors
 * use for their lower-bandwidth channels, because it does not add overshoot to a
 * step that did not have any.
 */
function besselCoeffs(n: number): Float64Array {
  const a = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    a[k] = factorial(2 * n - k) / (Math.pow(2, n - k) * factorial(k) * factorial(n - k));
  }
  return a;
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function besselAt(w: number, n: number): Complex {
  const a = besselCoeffs(n);
  // Evaluate theta_n(j*w). Powers of j cycle 1, j, -1, -j.
  let re = 0;
  let im = 0;
  let pw = 1;
  for (let k = 0; k <= n; k++) {
    const term = a[k] * pw;
    switch (k & 3) {
      case 0:
        re += term;
        break;
      case 1:
        im += term;
        break;
      case 2:
        re -= term;
        break;
      case 3:
        im -= term;
        break;
    }
    pw *= w;
  }
  return cDiv({ re: a[0], im: 0 }, { re, im });
}

/**
 * Frequency scale that puts the Bessel -3 dB point at w = 1.
 * The delay-normalised Bessel polynomial is not bandwidth-normalised, so this is
 * solved numerically once per order and cached.
 */
const besselNormCache = new Map<number, number>();
function besselNorm(n: number): number {
  const hit = besselNormCache.get(n);
  if (hit !== undefined) return hit;
  const target = 1 / Math.SQRT2;
  let lo = 0.1;
  let hi = 10;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (cAbs(besselAt(mid, n)) > target) lo = mid;
    else hi = mid;
  }
  const v = 0.5 * (lo + hi);
  besselNormCache.set(n, v);
  return v;
}

/**
 * Rise-time-bandwidth product, t_r * BW, for a given response shape.
 *
 * This is the honest version of the BW = 0.35 / t_r rule of thumb. Two cases
 * have closed forms and are returned exactly; the rest are solved numerically
 * from the actual step response, because quoting a remembered table here is
 * precisely the kind of invented number this project is not allowed to contain.
 *
 * Closed forms, for reference levels `lo` and `hi` as fractions of the final value:
 *   Single-pole RC: t_r = ln((1-lo)/(1-hi)) / (2*pi*BW)
 *                   => 0.3496992 at 10-90%, 0.2206356 at 20-80%
 *   Gaussian:       t_r = (z_hi - z_lo)*sqrt(ln2) / (2*pi*BW)
 *                   => 0.3396244 at 10-90%, 0.2230434 at 20-80%
 *                   where z_p is the p-th percentile of N(0,1), using
 *                   sigma_t = sqrt(ln2)/(2*pi*BW) from |H(BW)| = 1/sqrt(2).
 *
 * The default levels are 10-90%, which is the convention behind the familiar
 * 0.35 figure. Datasheets for fast interfaces increasingly quote 20-80% instead,
 * and on the same edge that reads about 0.6x the 10-90% number; the two are not
 * interchangeable and the levels are therefore explicit rather than assumed.
 *
 * Results are cached per (type, order, levels).
 */
export function riseTimeBandwidthProduct(spec: ResponseSpec, lo = 0.1, hi = 0.9): number {
  const order = Math.max(1, Math.min(10, Math.floor(spec.order ?? 4)));
  if (!(lo > 0 && hi < 1 && lo < hi)) {
    throw new Error('riseTimeBandwidthProduct: levels must satisfy 0 < lo < hi < 1');
  }
  switch (spec.type) {
    case 'rc':
      return Math.log((1 - lo) / (1 - hi)) / (2 * Math.PI);
    case 'gaussian': {
      const z = invNormCdf(hi) - invNormCdf(lo);
      return (z * Math.sqrt(Math.LN2)) / (2 * Math.PI);
    }
    default: {
      const key = `${spec.type}:${order}:${lo}:${hi}`;
      const hit = trBwCache.get(key);
      if (hit !== undefined) return hit;
      const v = solveTrBw({ type: spec.type, bw: 1, order }, lo, hi);
      trBwCache.set(key, v);
      return v;
    }
  }
}

const trBwCache = new Map<string, number>();

/**
 * Numerically integrate the impulse response of a unit-bandwidth filter into its
 * step response and measure the 10-90% transition.
 *
 * A linear-phase delay of T/8 is inserted before the IFFT so that zero-phase
 * responses (brick wall, Gaussian), whose impulse responses are non-causal and
 * centred on t = 0, do not wrap around the record. The measured quantity is a
 * time *difference*, so the added delay cancels out.
 *
 * `lo` and `hi` are the reference levels as fractions of the final value.
 */
function solveTrBw(spec: ResponseSpec, lo: number, hi: number): number {
  const N = 1 << 16;
  const fs = 128; // 64x the unit bandwidth, so out-of-band energy is negligible
  const dt = 1 / fs;
  const half = (N >> 1) + 1;
  const t0 = (N * dt) / 8;

  const re = new Float64Array(half);
  const im = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const f = (k * fs) / N;
    const h = transferAt(spec, f);
    const d = cExp(-2 * Math.PI * f * t0);
    const p = cMul(h, d);
    re[k] = p.re;
    im[k] = p.im;
  }
  // Nyquist bin of a real signal must be real.
  im[half - 1] = 0;

  const h = irfft(re, im, N);

  // Step response is the running integral of the impulse response, scaled so the
  // final value is 1 (guards against small quadrature error in the DC bin).
  const step = new Float64Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += h[i];
    step[i] = acc;
  }
  const final = step[N - 1];
  if (final === 0 || !isFinite(final)) return NaN;
  for (let i = 0; i < N; i++) step[i] /= final;

  const tLo = firstCrossTime(step, lo, dt);
  const tHi = firstCrossTime(step, hi, dt);
  return isFinite(tLo) && isFinite(tHi) ? tHi - tLo : NaN;
}

function firstCrossTime(y: Float64Array, level: number, dt: number): number {
  for (let i = 1; i < y.length; i++) {
    if (y[i - 1] < level && y[i] >= level) {
      const f = (level - y[i - 1]) / (y[i] - y[i - 1]);
      return (i - 1 + f) * dt;
    }
  }
  return NaN;
}

/**
 * Sample a response onto a frequency vector.
 * Returns separate real and imaginary arrays so the result can be handed to a
 * worker as transferable buffers.
 */
export function sampleResponse(
  spec: ResponseSpec,
  freqs: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = freqs.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = transferAt(spec, freqs[i]);
    re[i] = h.re;
    im[i] = h.im;
  }
  return { re, im };
}

/**
 * Series RLC step response parameters.
 *
 * For a series R-L-C driven by a step and measured across C:
 *   w_n = 1/sqrt(L*C)            undamped natural frequency, rad/s
 *   zeta = (R/2) * sqrt(C/L)     damping ratio
 *   w_d = w_n * sqrt(1 - zeta^2) damped ringing frequency (underdamped only)
 *   overshoot = exp(-pi*zeta/sqrt(1-zeta^2))
 *
 * This is exactly the network formed by package and via inductance working
 * against receiver input capacitance, which is why M2 is built on it.
 */
export interface RlcParams {
  /** Series resistance, ohm. */
  r: number;
  /** Series inductance, H. */
  l: number;
  /** Shunt capacitance, F. */
  c: number;
}

export interface RlcCharacteristics {
  /** Undamped natural frequency, Hz. */
  fn: number;
  /** Damping ratio, dimensionless. */
  zeta: number;
  /** Damped ringing frequency, Hz. Zero when not underdamped. */
  fd: number;
  /** Fractional first-peak overshoot, 0 when not underdamped. */
  overshoot: number;
  /** Time of the first peak, s. Infinity when not underdamped. */
  timeToPeak: number;
  /** 2% settling time estimate, s. */
  settling2pct: number;
  regime: 'underdamped' | 'critically damped' | 'overdamped';
  /** Characteristic impedance of the LC pair, ohm. R = 2*Z0 is critical damping. */
  z0: number;
}

export function rlcCharacteristics(p: RlcParams): RlcCharacteristics {
  const { r, l, c } = p;
  const wn = 1 / Math.sqrt(l * c);
  const zeta = (r / 2) * Math.sqrt(c / l);
  const z0 = Math.sqrt(l / c);
  const fn = wn / (2 * Math.PI);

  let regime: RlcCharacteristics['regime'];
  if (zeta < 1 - 1e-9) regime = 'underdamped';
  else if (zeta <= 1 + 1e-9) regime = 'critically damped';
  else regime = 'overdamped';

  if (regime !== 'underdamped') {
    return {
      fn,
      zeta,
      fd: 0,
      overshoot: 0,
      timeToPeak: Infinity,
      settling2pct: zeta > 1 ? 4 / (zeta * wn) : 5.834 / wn,
      regime,
      z0,
    };
  }

  const root = Math.sqrt(1 - zeta * zeta);
  const wd = wn * root;
  return {
    fn,
    zeta,
    fd: wd / (2 * Math.PI),
    overshoot: Math.exp((-Math.PI * zeta) / root),
    timeToPeak: Math.PI / wd,
    settling2pct: 4 / (zeta * wn),
    regime,
    z0,
  };
}

/**
 * Step response of a series RLC measured across the capacitor, evaluated
 * analytically. Returned as a sampled vector so it can be plotted directly and
 * compared against the FFT-based path in the test suite.
 */
export function rlcStepResponse(p: RlcParams, t: Float64Array): Float64Array {
  const { l, c } = p;
  const wn = 1 / Math.sqrt(l * c);
  const zeta = (p.r / 2) * Math.sqrt(c / l);
  const out = new Float64Array(t.length);

  if (Math.abs(zeta - 1) < 1e-9) {
    for (let i = 0; i < t.length; i++) {
      const x = wn * t[i];
      out[i] = 1 - Math.exp(-x) * (1 + x);
    }
  } else if (zeta < 1) {
    const root = Math.sqrt(1 - zeta * zeta);
    const wd = wn * root;
    for (let i = 0; i < t.length; i++) {
      const ti = t[i];
      out[i] = 1 - (Math.exp(-zeta * wn * ti) / root) * Math.sin(wd * ti + Math.acos(zeta));
    }
  } else {
    const root = Math.sqrt(zeta * zeta - 1);
    const s1 = -wn * (zeta - root);
    const s2 = -wn * (zeta + root);
    for (let i = 0; i < t.length; i++) {
      const ti = t[i];
      out[i] = 1 - (s1 * Math.exp(s2 * ti) - s2 * Math.exp(s1 * ti)) / (s1 - s2);
    }
  }
  return out;
}

/** First-order RC step response, 1 - exp(-t/tau). */
export function rcStepResponse(tau: number, t: Float64Array): Float64Array {
  const out = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = 1 - Math.exp(-t[i] / tau);
  return out;
}

/**
 * Group delay from an unwrapped phase vector: tau_g = -d(phi)/d(omega).
 * Central differences, with one-sided differences at the ends. Group delay
 * variation across the band is what turns a clean edge into a smeared one even
 * when the magnitude response looks acceptable.
 */
export function groupDelay(freqs: ArrayLike<number>, unwrappedPhase: ArrayLike<number>): Float64Array {
  const n = freqs.length;
  const out = new Float64Array(n);
  if (n < 2) return out;
  const twoPi = 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const i0 = i === 0 ? 0 : i - 1;
    const i1 = i === n - 1 ? n - 1 : i + 1;
    const dw = twoPi * (freqs[i1] - freqs[i0]);
    out[i] = dw === 0 ? 0 : -(unwrappedPhase[i1] - unwrappedPhase[i0]) / dw;
  }
  return out;
}

/** Convert a linear magnitude to dB (20 log10). Floors at -300 dB rather than -Infinity. */
export function toDb(mag: number): number {
  return mag <= 1e-15 ? -300 : 20 * Math.log10(mag);
}

/** Convert dB to a linear magnitude. */
export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Apply a response to a real signal, by multiplication in the frequency domain.
 *
 * Frequency-domain filtering rather than an FIR convolution, for two reasons.
 * The responses here are defined analytically as H(f) - there is no difference
 * equation to run - and several of them (brick wall, Gaussian) are zero-phase,
 * with impulse responses that extend symmetrically in both directions and cannot
 * be realised causally at all. Multiplying the spectrum applies them exactly,
 * which is what makes the pictures in M2 comparable: the only difference between
 * two edge shapes on screen is the shape, not the implementation.
 *
 * The DFT treats the record as periodic, so the end of the signal convolves into
 * the beginning. To keep that out of the result the signal is placed inside a
 * longer buffer: a guard band of the leading value before it, and a raised-cosine
 * blend from the trailing value back to the leading one after it, so the buffer
 * is genuinely periodic and the filter sees no step that is not in the data. The
 * guard is then cropped away.
 *
 * Assumptions this makes, stated because they are the ones that fail first on a
 * real driver: the response is linear and time-invariant. There is no slew-rate
 * limit, no output compression, and rise and fall are the same shape. A driver
 * that is slew-limited does not obey this model and its edges will not scale with
 * amplitude the way these do.
 *
 * @param guardSeconds length of the guard band. Defaults to 8 time constants of
 *        the response, which puts the wrap-around error below the arithmetic.
 */
export function applyResponse(
  x: ArrayLike<number>,
  sampleRate: number,
  spec: ResponseSpec,
  guardSeconds = 8 / Math.max(spec.bw, Number.MIN_VALUE),
): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (!(sampleRate > 0) || !(spec.bw > 0)) {
    for (let i = 0; i < n; i++) out[i] = x[i];
    return out;
  }

  const guard = Math.max(16, Math.min(4 * n, Math.ceil(guardSeconds * sampleRate)));
  const N = nextPow2(n + 3 * guard);

  const buf = new Float64Array(N);
  const first = x[0];
  const last = x[n - 1];
  for (let i = 0; i < guard; i++) buf[i] = first;
  for (let i = 0; i < n; i++) buf[guard + i] = x[i];
  const tail = N - guard - n;
  for (let i = 0; i < tail; i++) {
    // Raised cosine from the trailing value back to the leading one: smooth in
    // value and in slope at both ends, so the periodic extension has no edge.
    const w = 0.5 * (1 - Math.cos((Math.PI * (i + 1)) / tail));
    buf[guard + n + i] = last + (first - last) * w;
  }

  const half = (N >> 1) + 1;
  const spectrum = rfft(buf);
  for (let k = 0; k < half; k++) {
    const f = (k * sampleRate) / N;
    const h = transferAt(spec, f);
    const re = spectrum.re[k] * h.re - spectrum.im[k] * h.im;
    const im = spectrum.re[k] * h.im + spectrum.im[k] * h.re;
    spectrum.re[k] = re;
    spectrum.im[k] = im;
  }
  // The Nyquist bin of a real signal is real; a complex value there would make
  // the inverse transform non-real.
  spectrum.im[half - 1] = 0;

  const filtered = irfft(spectrum.re, spectrum.im, N);
  for (let i = 0; i < n; i++) out[i] = filtered[guard + i];
  return out;
}

/**
 * Rise time of `n` identical single poles in cascade, seconds.
 *
 * The step response of one pole is 1 - e^{-x} with x = t/tau. Cascading n of them
 * convolves n identical exponentials, and the result is the Erlang cumulative
 * distribution:
 *
 *     s_n(x) = 1 - e^{-x} * sum_{k=0}^{n-1} x^k / k!,    x = t / tau
 *
 * which is monotone from 0 to 1 for every n, so the transition levels are crossed
 * exactly once and a bisection is both safe and exact to machine precision. Each
 * pole has -3 dB bandwidth `bwPole`, so tau = 1 / (2*pi*bwPole).
 *
 * This exists to make one specific claim checkable. Rise times are routinely
 * combined in quadrature - t_total = sqrt(sum of t_i^2) - and that rule is exact
 * only for Gaussian responses, because only Gaussians convolve to a Gaussian whose
 * width is the quadrature sum. For two identical poles the true 10-90% rise time is
 * 0.5344278/bwPole against an RSS estimate of 0.4945493/bwPole: the estimate is
 * 7.46% low, and it is low in the optimistic direction.
 *
 * For n = 1 it reduces to ln((1-lo)/(1-hi)) / (2*pi*bwPole), which is
 * `riseTimeBandwidthProduct` for type 'rc' and is asserted as such in the tests.
 *
 * @param n     number of identical poles in cascade, n >= 1
 * @param bwPole -3 dB bandwidth of each pole, Hz
 * @param lo    lower reference level as a fraction of the step
 * @param hi    upper reference level as a fraction of the step
 */
export function cascadedPoleRiseTime(n: number, bwPole: number, lo = 0.1, hi = 0.9): number {
  const poles = Math.max(1, Math.floor(n));
  if (!(lo > 0 && hi < 1 && lo < hi)) {
    throw new Error('cascadedPoleRiseTime: levels must satisfy 0 < lo < hi < 1');
  }
  if (!(bwPole > 0)) return NaN;

  // s_n(x), evaluated with a running term so no factorial is ever formed.
  const step = (x: number): number => {
    let term = 1;
    let sum = 1;
    for (let k = 1; k < poles; k++) {
      term *= x / k;
      sum += term;
    }
    return 1 - Math.exp(-x) * sum;
  };

  const solve = (level: number): number => {
    let a = 0;
    // s_n grows without bound in x; double until the level is bracketed. n poles
    // need roughly n times the excursion of one, so this terminates in a few steps.
    let b = 1;
    while (step(b) < level && b < 1e6) b *= 2;
    for (let i = 0; i < 200; i++) {
      const m = 0.5 * (a + b);
      if (step(m) < level) a = m;
      else b = m;
    }
    return 0.5 * (a + b);
  };

  const tau = 1 / (2 * Math.PI * bwPole);
  return (solve(hi) - solve(lo)) * tau;
}
