import { describe, expect, it } from 'vitest';
import { decimate } from '../trace';

/**
 * Decimation is the only algorithm in the plotting layer that can silently destroy
 * information. If it drops a narrow spike, the plot lies and nothing else in the
 * system will notice. These tests are about that property above all else.
 */

function ramp(n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = i;
  return y;
}

describe('decimate: degenerate inputs', () => {
  it('returns nothing for an empty range or a zero-width plot', () => {
    expect(decimate(ramp(100), 0, 0, 300)).toEqual([]);
    expect(decimate(ramp(100), 50, 10, 300)).toEqual([]);
    expect(decimate(ramp(100), 0, 100, 0)).toEqual([]);
  });

  it('clamps the requested range to the data', () => {
    const cols = decimate(ramp(10), -5, 500, 100);
    expect(cols.length).toBe(10);
    expect(cols[0].min).toBe(0);
    expect(cols[cols.length - 1].max).toBe(9);
  });
});

describe('decimate: fewer samples than pixels', () => {
  it('passes every sample through untouched', () => {
    const y = [3, 1, 4, 1, 5, 9, 2, 6];
    const cols = decimate(y, 0, y.length, 400);
    expect(cols.length).toBe(y.length);
    cols.forEach((c, i) => {
      expect(c.min).toBe(y[i]);
      expect(c.max).toBe(y[i]);
      expect(c.first).toBe(y[i]);
      expect(c.last).toBe(y[i]);
    });
  });

  it('reports x as an offset from the start of the requested range', () => {
    const cols = decimate(ramp(20), 5, 10, 400);
    expect(cols.map((c) => c.x)).toEqual([0, 1, 2, 3, 4]);
    expect(cols.map((c) => c.min)).toEqual([5, 6, 7, 8, 9]);
  });
});

describe('decimate: more samples than pixels', () => {
  it('produces exactly one column per pixel', () => {
    const cols = decimate(ramp(100000), 0, 100000, 800);
    expect(cols.length).toBe(800);
  });

  it('covers the whole range with no gaps and no overlaps', () => {
    const n = 9973; // prime, so the per-column count never divides evenly
    const cols = decimate(ramp(n), 0, n, 640);
    expect(cols[0].x).toBe(0);
    // Columns must tile the index range: each column starts where the previous ended.
    for (let i = 1; i < cols.length; i++) expect(cols[i].x).toBeGreaterThan(cols[i - 1].x);
    expect(cols[cols.length - 1].max).toBe(n - 1);
  });

  it('is monotone on monotone data, so a ramp still looks like a ramp', () => {
    const cols = decimate(ramp(50000), 0, 50000, 500);
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i].min).toBeGreaterThan(cols[i - 1].max - 1e-9);
    }
  });

  /**
   * The headline property. A single-sample glitch in the middle of a million-sample
   * record must survive to the screen; subsampling would lose it with probability
   * 1 - columns/n, which is where an entire class of "the scope didn't see it"
   * mistakes comes from.
   */
  it('preserves a one-sample spike', () => {
    const n = 1_000_000;
    const y = new Float64Array(n); // flat zero
    y[733_101] = 2.5;
    const cols = decimate(y, 0, n, 900);
    const peak = Math.max(...cols.map((c) => c.max));
    expect(peak).toBe(2.5);
  });

  it('preserves a one-sample negative spike too', () => {
    const n = 200_000;
    const y = new Float64Array(n).fill(1);
    y[12_345] = -3;
    const cols = decimate(y, 0, n, 700);
    expect(Math.min(...cols.map((c) => c.min))).toBe(-3);
  });

  it('preserves the full excursion of a fast oscillation', () => {
    // 100 samples per cycle over 100k samples, drawn into 500 columns: every column
    // contains many whole cycles, so each must span the full peak-to-peak.
    const n = 100_000;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = Math.sin((2 * Math.PI * i) / 100);
    const cols = decimate(y, 0, n, 500);
    for (const c of cols) {
      expect(c.max).toBeGreaterThan(0.99);
      expect(c.min).toBeLessThan(-0.99);
    }
  });

  it('keeps min at or below max and both within the column', () => {
    const n = 33_333;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = Math.sin(i) * Math.cos(i / 7);
    const cols = decimate(y, 0, n, 411);
    for (const c of cols) {
      expect(c.min).toBeLessThanOrEqual(c.max);
      expect(c.first).toBeGreaterThanOrEqual(c.min);
      expect(c.first).toBeLessThanOrEqual(c.max);
      expect(c.last).toBeGreaterThanOrEqual(c.min);
      expect(c.last).toBeLessThanOrEqual(c.max);
    }
  });

  it('records the first and last samples of each column in order', () => {
    // 1000 samples into 10 columns is exactly 100 per column.
    const cols = decimate(ramp(1000), 0, 1000, 10);
    expect(cols.length).toBe(10);
    cols.forEach((c, i) => {
      expect(c.first).toBe(i * 100);
      expect(c.last).toBe(i * 100 + 99);
      expect(c.min).toBe(i * 100);
      expect(c.max).toBe(i * 100 + 99);
    });
  });

  it('windows the data without re-deriving it, which is how pan works', () => {
    const y = ramp(10000);
    const full = decimate(y, 0, 10000, 100);
    const half = decimate(y, 5000, 10000, 100);
    expect(half[0].min).toBe(5000);
    expect(half[half.length - 1].max).toBe(9999);
    // Panning must not change the number of columns drawn.
    expect(half.length).toBe(full.length);
  });
});

describe('decimate: non-finite samples', () => {
  it('skips NaN rather than poisoning a column', () => {
    const n = 5000;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = i % 100 === 0 ? Number.NaN : 1;
    const cols = decimate(y, 0, n, 200);
    for (const c of cols) {
      expect(Number.isNaN(c.min)).toBe(false);
      expect(Number.isNaN(c.max)).toBe(false);
      expect(c.min).toBe(1);
      expect(c.max).toBe(1);
    }
  });

  it('drops a column that holds nothing but NaN', () => {
    const y = new Float64Array(1000).fill(Number.NaN);
    for (let i = 0; i < 100; i++) y[i] = 5;
    const cols = decimate(y, 0, 1000, 100);
    // Only the first tenth of the record has data, so only that many columns survive.
    expect(cols.length).toBe(10);
    for (const c of cols) expect(c.min).toBe(5);
  });

  it('skips a non-finite sample in the sparse path as well', () => {
    const cols = decimate([1, Number.NaN, 3, Infinity, 5], 0, 5, 500);
    expect(cols.map((c) => c.min)).toEqual([1, 3, 5]);
  });
});
