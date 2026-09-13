import { describe, expect, it } from 'vitest';
import { binCentres, binWidth } from '../stem';

describe('histogram binning', () => {
  it('puts centres half a bin in from each edge', () => {
    // Four bins over [0, 4] are [0,1), [1,2), [2,3), [3,4], centred at 0.5, 1.5, ...
    expect(Array.from(binCentres(4, 0, 4))).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  /**
   * The specific mistake this guards: using the edges as centres. That shifts the
   * whole distribution left by half a bin, which in a jitter histogram is a
   * systematic error in the reported mean that nothing downstream would catch.
   */
  it('never places a centre on an edge', () => {
    const n = 7;
    const lo = -0.5;
    const hi = 0.5;
    const centres = binCentres(n, lo, hi);
    const w = binWidth(n, lo, hi);
    for (let i = 0; i < n; i++) {
      const edge = lo + i * w;
      expect(centres[i]).not.toBe(edge);
      expect(centres[i]).toBeCloseTo(edge + w / 2, 12);
    }
  });

  it('spans exactly the requested range, edge to edge', () => {
    const n = 5;
    const centres = binCentres(n, 10, 20);
    const w = binWidth(n, 10, 20);
    expect(centres[0] - w / 2).toBeCloseTo(10, 12);
    expect(centres[n - 1] + w / 2).toBeCloseTo(20, 12);
  });

  it('handles a range straddling zero, which is what a jitter histogram is', () => {
    const centres = binCentres(4, -2e-12, 2e-12);
    const expected = [-1.5e-12, -0.5e-12, 0.5e-12, 1.5e-12];
    // Compared with a tolerance: the centres are accumulated in floating point, so
    // exact equality on picosecond-scale values is not a property worth asserting.
    centres.forEach((c, i) => expect(c).toBeCloseTo(expected[i], 24));
    // An even bin count means no bin is centred on zero. That is correct, and it is
    // why a jitter mean should be computed from the samples, not from the modal bin.
    expect(centres.includes(0)).toBe(false);
  });

  it('puts a bin on zero when the count is odd', () => {
    const centres = binCentres(5, -2.5, 2.5);
    expect(Array.from(centres)).toEqual([-2, -1, 0, 1, 2]);
  });

  it('is uniformly spaced', () => {
    const centres = binCentres(64, -1, 3);
    const w = binWidth(64, -1, 3);
    for (let i = 1; i < centres.length; i++) {
      expect(centres[i] - centres[i - 1]).toBeCloseTo(w, 12);
    }
  });

  it('returns nothing for zero bins rather than dividing by zero', () => {
    expect(binCentres(0, 0, 1).length).toBe(0);
    expect(binWidth(0, 0, 1)).toBe(0);
  });

  it('gives a single bin the whole range, centred', () => {
    expect(Array.from(binCentres(1, 0, 10))).toEqual([5]);
    expect(binWidth(1, 0, 10)).toBe(10);
  });
});
