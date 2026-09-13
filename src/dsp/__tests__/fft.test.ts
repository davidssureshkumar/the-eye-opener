import { describe, it, expect } from 'vitest';
import { fft, ifft, fftOf, dftNaive, rfft, irfft, isPow2, nextPow2, magnitude, unwrap } from '../fft';
import { Rng } from '../random';

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function randomVector(n: number, seed: number): Float64Array {
  const rng = new Rng(seed);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = rng.uniform(-1, 1);
  return v;
}

describe('nextPow2 / isPow2', () => {
  it('classifies powers of two', () => {
    expect(isPow2(1)).toBe(true);
    expect(isPow2(1024)).toBe(true);
    expect(isPow2(0)).toBe(false);
    expect(isPow2(1000)).toBe(false);
  });

  it('rounds up to the next power of two', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(1000)).toBe(1024);
    expect(nextPow2(1024)).toBe(1024);
    expect(nextPow2(1025)).toBe(2048);
  });
});

describe('FFT against the naive DFT', () => {
  // Power-of-two lengths exercise the radix-2 path; the rest force Bluestein.
  for (const n of [2, 4, 8, 16, 64, 256, 3, 5, 6, 7, 12, 100, 127, 210]) {
    it(`matches dftNaive for N = ${n}`, () => {
      const re = randomVector(n, 1000 + n);
      const im = randomVector(n, 2000 + n);
      const ref = dftNaive(re, im, -1);
      const got = fftOf(re, im);
      // Scale tolerance with the magnitude of the transform, which grows as N.
      const tol = 1e-10 * Math.max(1, n);
      expect(maxAbsDiff(got.re, ref.re)).toBeLessThan(tol);
      expect(maxAbsDiff(got.im, ref.im)).toBeLessThan(tol);
    });
  }
});

describe('FFT analytic transforms', () => {
  it('transforms a unit delta at n=0 to a flat spectrum of ones', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re[0] = 1;
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(1, 12);
      expect(im[k]).toBeCloseTo(0, 12);
    }
  });

  it('transforms a shifted delta to a pure linear phase ramp', () => {
    const n = 64;
    const shift = 5;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re[shift] = 1;
    fft(re, im);
    for (let k = 0; k < n; k++) {
      // |X[k]| = 1 everywhere, arg X[k] = -2 pi k * shift / N
      expect(Math.hypot(re[k], im[k])).toBeCloseTo(1, 12);
      const expected = (-2 * Math.PI * k * shift) / n;
      const got = Math.atan2(im[k], re[k]);
      const err = Math.abs(((got - expected + Math.PI) % (2 * Math.PI)) - Math.PI);
      expect(Math.min(err, 2 * Math.PI - err)).toBeLessThan(1e-10);
    }
  });

  it('transforms a rectangle to the Dirichlet kernel', () => {
    // A rectangle of M ones has |X[k]| = |sin(pi k M / N) / sin(pi k / N)|.
    const n = 128;
    const m = 16;
    const x = new Float64Array(n);
    x.fill(1, 0, m);
    const mag = magnitude(fftOf(x));
    for (let k = 1; k < n; k++) {
      const expected = Math.abs(Math.sin((Math.PI * k * m) / n) / Math.sin((Math.PI * k) / n));
      expect(mag[k]).toBeCloseTo(expected, 9);
    }
    expect(mag[0]).toBeCloseTo(m, 10);
  });

  it('transforms a bin-centred sinusoid to exactly two spikes', () => {
    const n = 256;
    const k0 = 17;
    const amp = 1.7;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = amp * Math.cos((2 * Math.PI * k0 * i) / n);
    const mag = magnitude(fftOf(x));
    // A real cosine at bin k0 splits its energy between k0 and N-k0, each N*amp/2.
    expect(mag[k0]).toBeCloseTo((n * amp) / 2, 8);
    expect(mag[n - k0]).toBeCloseTo((n * amp) / 2, 8);
    for (let k = 0; k < n; k++) {
      if (k === k0 || k === n - k0) continue;
      expect(mag[k]).toBeLessThan(1e-9);
    }
  });
});

describe('FFT round trips', () => {
  for (const n of [8, 256, 1024, 5, 100, 127]) {
    it(`fft then ifft is the identity for N = ${n}`, () => {
      const re0 = randomVector(n, 31 + n);
      const im0 = randomVector(n, 61 + n);
      const re = Float64Array.from(re0);
      const im = Float64Array.from(im0);
      fft(re, im);
      ifft(re, im);
      expect(maxAbsDiff(re, re0)).toBeLessThan(1e-12);
      expect(maxAbsDiff(im, im0)).toBeLessThan(1e-12);
    });
  }

  for (const n of [8, 64, 1024, 100]) {
    it(`rfft then irfft is the identity for N = ${n}`, () => {
      const x = randomVector(n, 777 + n);
      const half = rfft(x);
      const back = irfft(half.re, half.im, n);
      expect(maxAbsDiff(back, x)).toBeLessThan(1e-12);
    });
  }

  it('rfft agrees with the first half of the full fft', () => {
    const n = 128;
    const x = randomVector(n, 4242);
    const full = fftOf(x);
    const half = rfft(x);
    for (let k = 0; k < half.re.length; k++) {
      expect(half.re[k]).toBeCloseTo(full.re[k], 11);
      expect(half.im[k]).toBeCloseTo(full.im[k], 11);
    }
  });
});

describe('Parseval energy conservation', () => {
  it('preserves energy to within floating point', () => {
    const n = 512;
    const x = randomVector(n, 9090);
    let timeEnergy = 0;
    for (let i = 0; i < n; i++) timeEnergy += x[i] * x[i];
    const X = fftOf(x);
    let freqEnergy = 0;
    for (let k = 0; k < n; k++) freqEnergy += X.re[k] * X.re[k] + X.im[k] * X.im[k];
    expect(freqEnergy / n).toBeCloseTo(timeEnergy, 8);
  });
});

describe('unwrap', () => {
  it('removes 2 pi discontinuities from a linear ramp', () => {
    const n = 100;
    const wrapped = new Float64Array(n);
    const truth = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = -0.4 * i;
      truth[i] = p;
      wrapped[i] = Math.atan2(Math.sin(p), Math.cos(p));
    }
    const un = unwrap(wrapped);
    // Unwrapping recovers the ramp up to a constant multiple of 2 pi.
    const offset = un[0] - truth[0];
    for (let i = 0; i < n; i++) expect(un[i] - offset).toBeCloseTo(truth[i], 10);
  });
});
