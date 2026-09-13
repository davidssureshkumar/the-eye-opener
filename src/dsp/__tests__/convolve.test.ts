import { describe, it, expect } from 'vitest';
import {
  convolve,
  convolveDirect,
  convolveFft,
  circularConvolve,
  overlapAdd,
  correlate,
  correlateZeroLag,
  argMaxAbs,
} from '../convolve';
import { Rng } from '../random';

function randomVector(n: number, seed: number): Float64Array {
  const rng = new Rng(seed);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = rng.uniform(-1, 1);
  return v;
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    m = Math.max(m, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return m;
}

describe('linear convolution', () => {
  it('matches a hand-computed example', () => {
    // [1,2,3] * [4,5] = [4, 13, 22, 15]
    expect(Array.from(convolveDirect([1, 2, 3], [4, 5]))).toEqual([4, 13, 22, 15]);
  });

  it('is the identity against a unit delta', () => {
    const x = randomVector(64, 1);
    const y = convolve(x, [1]);
    expect(maxAbsDiff(x, y)).toBeLessThan(1e-14);
  });

  it('a delayed delta shifts the signal', () => {
    const x = randomVector(32, 2);
    const h = new Float64Array(5);
    h[3] = 1;
    const y = convolve(x, h);
    for (let i = 0; i < x.length; i++) expect(y[i + 3]).toBeCloseTo(x[i], 14);
  });

  for (const [n, m] of [
    [64, 64],
    [256, 31],
    [1000, 257],
    [17, 5],
    [513, 128],
  ]) {
    it(`FFT path matches the direct path for ${n} x ${m}`, () => {
      const a = randomVector(n, 100 + n);
      const b = randomVector(m, 200 + m);
      const direct = convolveDirect(a, b);
      const fast = convolveFft(a, b);
      expect(fast.length).toBe(n + m - 1);
      expect(maxAbsDiff(direct, fast)).toBeLessThan(1e-11);
    });
  }

  it('produces an output of length n + m - 1', () => {
    expect(convolve(new Float64Array(100), new Float64Array(64)).length).toBe(163);
  });

  it('returns an empty result for an empty operand', () => {
    expect(convolve([], [1, 2]).length).toBe(0);
    expect(convolve([1, 2], []).length).toBe(0);
  });
});

describe('circular convolution', () => {
  it('wraps where linear convolution would extend', () => {
    // Circular convolution of length N is the linear result folded modulo N.
    const n = 32;
    const a = randomVector(n, 11);
    const b = randomVector(n, 22);
    const lin = convolveDirect(a, b);
    const circ = circularConvolve(a, b);
    const folded = new Float64Array(n);
    for (let i = 0; i < lin.length; i++) folded[i % n] += lin[i];
    expect(maxAbsDiff(circ, folded)).toBeLessThan(1e-11);
  });

  it('rejects mismatched lengths', () => {
    expect(() => circularConvolve(new Float64Array(8), new Float64Array(16))).toThrow();
  });
});

describe('overlap-add', () => {
  for (const [n, m, bs] of [
    [1000, 64, 256],
    [5000, 129, 512],
    [777, 33, undefined as unknown as number],
  ]) {
    it(`matches direct convolution for ${n} x ${m}`, () => {
      const x = randomVector(n, 300 + n);
      const h = randomVector(m, 400 + m);
      const ref = convolveDirect(x, h);
      const got = overlapAdd(x, h, bs);
      expect(got.length).toBe(ref.length);
      expect(maxAbsDiff(ref, got)).toBeLessThan(1e-10);
    });
  }

  it('reports progress and honours cancellation', () => {
    const x = randomVector(4096, 5);
    const h = randomVector(64, 6);
    const seen: number[] = [];
    overlapAdd(x, h, 256, (done, total) => {
      seen.push(done);
      expect(total).toBeGreaterThan(0);
      return done < 3; // abort after the third block
    });
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('correlation', () => {
  it('peaks at the true lag', () => {
    const n = 256;
    const lag = 37;
    const a = new Float64Array(n);
    const rng = new Rng(8);
    for (let i = 0; i < n; i++) a[i] = rng.uniform(-1, 1);
    const b = new Float64Array(n);
    for (let i = 0; i < n - lag; i++) b[i] = a[i + lag];

    const r = correlate(a, b);
    const zero = correlateZeroLag(b);
    const peak = argMaxAbs(r);
    expect(peak - zero).toBe(lag);
  });

  it('argMaxAbs finds the largest magnitude regardless of sign', () => {
    expect(argMaxAbs([0.1, -5, 2, 4.9])).toBe(1);
  });
});
