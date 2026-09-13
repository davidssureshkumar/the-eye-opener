import { describe, it, expect } from 'vitest';
import { Rng, deriveSeed, subStream, invNormCdf, normCdf, erfc, qFunction, dualDiracN } from '../random';

describe('Rng determinism', () => {
  it('reproduces the same stream from the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('produces different streams from different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) if (a.nextUint32() === b.nextUint32()) same++;
    expect(same).toBeLessThan(5);
  });

  it('save and restore state resumes the identical stream', () => {
    const a = new Rng(99);
    for (let i = 0; i < 100; i++) a.nextUint32();
    const st = a.saveState();
    const first = Array.from({ length: 50 }, () => a.nextUint32());
    a.restoreState(st);
    const second = Array.from({ length: 50 }, () => a.nextUint32());
    expect(second).toEqual(first);
  });

  it('never returns to the all-zero absorbing state', () => {
    const r = new Rng(0);
    let allZero = 0;
    for (let i = 0; i < 10000; i++) if (r.nextUint32() === 0) allZero++;
    // A handful of zero outputs is expected; a stuck generator gives thousands.
    expect(allZero).toBeLessThan(10);
  });
});

describe('Rng uniformity', () => {
  it('stays within [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 20000; i++) {
      const v = r.next53();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('fills 16 bins roughly evenly', () => {
    const r = new Rng(1234);
    const bins = new Int32Array(16);
    const n = 160000;
    for (let i = 0; i < n; i++) bins[Math.floor(r.next53() * 16)]++;
    const expected = n / 16;
    for (let i = 0; i < 16; i++) {
      // 4 sigma of a binomial count is about 4*sqrt(n*p*(1-p)) = 4*97 = 387.
      expect(Math.abs(bins[i] - expected)).toBeLessThan(500);
    }
  });

  it('int(n) is unbiased over a small range', () => {
    const r = new Rng(555);
    const bins = new Int32Array(6);
    const n = 120000;
    for (let i = 0; i < n; i++) bins[r.int(6)]++;
    for (let i = 0; i < 6; i++) expect(Math.abs(bins[i] - n / 6)).toBeLessThan(700);
  });
});

describe('Gaussian generation', () => {
  // The brief requires this explicitly: injected jitter must actually have the
  // sigma that was asked for, or every jitter number downstream is fiction.
  it('produces the requested sigma and mean over large N', () => {
    const r = new Rng(2024);
    const n = 2_000_000;
    const sigma = 3.7;
    const mean = -1.25;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = r.gaussian(mean, sigma);
      sum += v;
      sumSq += v * v;
    }
    const m = sum / n;
    const s = Math.sqrt(sumSq / n - m * m);
    // Standard error of the mean is sigma/sqrt(n) = 0.0026; allow 5 of them.
    expect(Math.abs(m - mean)).toBeLessThan(0.015);
    // Standard error of sigma is sigma/sqrt(2n) = 0.0018; allow generous margin.
    expect(Math.abs(s - sigma) / sigma).toBeLessThan(0.005);
  });

  it('has the correct tail probabilities', () => {
    const r = new Rng(4096);
    const n = 1_000_000;
    let beyond1 = 0;
    let beyond2 = 0;
    let beyond3 = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(r.normal());
      if (v > 1) beyond1++;
      if (v > 2) beyond2++;
      if (v > 3) beyond3++;
    }
    expect(beyond1 / n).toBeCloseTo(0.3173, 2);
    expect(beyond2 / n).toBeCloseTo(0.0455, 3);
    expect(beyond3 / n).toBeCloseTo(0.0027, 3);
  });

  it('fillGaussian writes the whole array', () => {
    const r = new Rng(11);
    const out = new Float64Array(1000);
    r.fillGaussian(out, 2);
    let nonZero = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== 0) nonZero++;
    expect(nonZero).toBe(1000);
  });
});

describe('seed derivation', () => {
  it('gives different seeds for different labels', () => {
    const s1 = deriveSeed(42, 'rj');
    const s2 = deriveSeed(42, 'noise');
    const s3 = deriveSeed(42, 'crosstalk');
    expect(new Set([s1, s2, s3]).size).toBe(3);
  });

  it('is stable across calls, so a permalink reproduces the same eye', () => {
    expect(deriveSeed(7, 'rj')).toBe(deriveSeed(7, 'rj'));
    const a = subStream(7, 'rj');
    const b = subStream(7, 'rj');
    expect(a.nextUint32()).toBe(b.nextUint32());
  });
});

describe('error function and normal CDF', () => {
  it('erfc matches known values', () => {
    expect(erfc(0)).toBeCloseTo(1, 6);
    expect(erfc(0.5)).toBeCloseTo(0.4795001222, 6);
    expect(erfc(1)).toBeCloseTo(0.1572992071, 6);
    expect(erfc(2)).toBeCloseTo(0.0046777349, 8);
    expect(erfc(-1)).toBeCloseTo(1.8427007929, 6);
  });

  it('normCdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 8);
    expect(normCdf(1)).toBeCloseTo(0.8413447461, 6);
    expect(normCdf(-1.96)).toBeCloseTo(0.0249978952, 7);
  });

  it('qFunction is the upper tail', () => {
    expect(qFunction(0)).toBeCloseTo(0.5, 8);
    expect(qFunction(1)).toBeCloseTo(0.1586552539, 6);
    // Q(7.034) is the classic 1e-12 BER operating point.
    expect(qFunction(7.0345)).toBeCloseTo(1e-12, 13);
  });

  it('invNormCdf inverts normCdf', () => {
    for (const p of [1e-12, 1e-9, 1e-6, 0.001, 0.01, 0.025, 0.1, 0.5, 0.9, 0.975, 0.999]) {
      const x = invNormCdf(p);
      expect(normCdf(x)).toBeCloseTo(p, Math.min(12, Math.max(6, -Math.log10(p) + 2)));
    }
  });

  it('invNormCdf matches textbook quantiles', () => {
    expect(invNormCdf(0.5)).toBeCloseTo(0, 10);
    expect(invNormCdf(0.975)).toBeCloseTo(1.959963985, 6);
    expect(invNormCdf(0.9)).toBeCloseTo(1.281551566, 6);
    expect(invNormCdf(0.01)).toBeCloseTo(-2.326347874, 6);
  });
});

describe('dual-Dirac multiplier', () => {
  // TJ(BER) = DJ + n(BER) * RJ_rms. These are the multipliers quoted in every
  // jitter budget spreadsheet, and getting them wrong silently scales every
  // extrapolated total-jitter number in the site.
  it('matches the standard table', () => {
    expect(dualDiracN(1e-12)).toBeCloseTo(14.069, 2);
    expect(dualDiracN(1e-10)).toBeCloseTo(12.723, 2);
    expect(dualDiracN(1e-9)).toBeCloseTo(11.996, 2);
    expect(dualDiracN(1e-6)).toBeCloseTo(9.507, 2);
  });

  it('grows monotonically as BER falls', () => {
    let prev = 0;
    for (const ber of [1e-3, 1e-6, 1e-9, 1e-12, 1e-15, 1e-16]) {
      const n = dualDiracN(ber);
      expect(n).toBeGreaterThan(prev);
      prev = n;
    }
  });
});
