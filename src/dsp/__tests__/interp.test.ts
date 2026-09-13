import { describe, it, expect } from 'vitest';
import {
  lerpAt,
  cubicAt,
  sincAt,
  sinc,
  resample,
  zeroStuff,
  decimate,
  findCrossings,
  edgeTransitionSamples,
  findMonotonicityViolations,
} from '../interp';

describe('point interpolation', () => {
  it('linear interpolation is exact on a linear ramp', () => {
    const x = Float64Array.from([0, 1, 2, 3, 4]);
    expect(lerpAt(x, 1.5)).toBeCloseTo(1.5, 14);
    expect(lerpAt(x, 3.25)).toBeCloseTo(3.25, 14);
  });

  it('interpolators reproduce the samples exactly at integer indices', () => {
    const x = Float64Array.from([3, -1, 4, 1, 5, 9, 2, 6]);
    for (let i = 0; i < x.length; i++) {
      expect(lerpAt(x, i)).toBeCloseTo(x[i], 12);
      expect(cubicAt(x, i)).toBeCloseTo(x[i], 10);
    }
  });

  it('cubic interpolation is exact on a quadratic', () => {
    // Catmull-Rom is Keys' cubic convolution with a = -1/2: third-order accurate,
    // which means it reproduces polynomials up to degree 2 exactly. It does NOT
    // reproduce cubics - see the next test.
    const f = (t: number) => 1.5 * t * t - 2 * t + 3;
    const n = 20;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = f(i);
    for (const idx of [5.25, 7.5, 11.75]) {
      expect(cubicAt(x, idx)).toBeCloseTo(f(idx), 8);
    }
  });

  it('its error on a true cubic matches the closed form A h^3 u(2u-1)(u-1)', () => {
    // Keys' kernel turns t^3 into 3u^3 - 3u^2 + u over each segment, so the error
    // is exactly u(2u-1)(u-1) times the leading coefficient and h^3. Note it
    // vanishes at u = 0, 0.5 and 1 - the midpoint is accidentally exact, which is
    // why a midpoint-only check would wrongly suggest cubic reproduction.
    const A = 0.5;
    const f = (t: number) => A * t * t * t - 2 * t * t + t + 3;
    const n = 40;
    for (const h of [1, 0.5, 0.25]) {
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) x[i] = f(i * h);
      for (const u of [0.125, 0.25, 0.4, 0.5, 0.75]) {
        const i = 20;
        const got = cubicAt(x, i + u);
        const exact = f((i + u) * h);
        const predicted = A * h * h * h * u * (2 * u - 1) * (u - 1);
        expect(got - exact).toBeCloseTo(predicted, 10);
      }
    }
  });

  it('that error falls as h^3, so cubic display interpolation is third-order accurate', () => {
    const f = (t: number) => 0.5 * t * t * t - 2 * t * t + t + 3;
    const errAt = (h: number): number => {
      const n = 40;
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) x[i] = f(i * h);
      return Math.abs(cubicAt(x, 20.25) - f(20.25 * h));
    };
    expect(errAt(0.5) / errAt(0.25)).toBeCloseTo(8, 6);
    expect(errAt(0.25) / errAt(0.125)).toBeCloseTo(8, 6);
  });

  it('does not extrapolate at the ends', () => {
    // Clamping the segment instead of the sample indices makes the first and last
    // samples extrapolate wildly. Guard against that regression explicitly.
    const x = Float64Array.from([3, -1, 4, 1, 5, 9, 2, 6]);
    expect(cubicAt(x, 0)).toBeCloseTo(3, 12);
    expect(cubicAt(x, 7)).toBeCloseTo(6, 12);
    expect(cubicAt(x, -4)).toBeCloseTo(3, 12);
    expect(cubicAt(x, 99)).toBeCloseTo(6, 12);
    for (let i = 0; i < x.length; i++) {
      // Never outside the range of the four samples it interpolates between.
      expect(cubicAt(x, i + 0.5)).toBeGreaterThan(-4);
      expect(cubicAt(x, i + 0.5)).toBeLessThan(12);
    }
  });

  it('clamps outside the array', () => {
    const x = Float64Array.from([2, 4, 6]);
    expect(lerpAt(x, -5)).toBe(2);
    expect(lerpAt(x, 99)).toBe(6);
  });

  it('sinc is 1 at zero and 0 at every other integer', () => {
    expect(sinc(0)).toBe(1);
    for (const k of [1, 2, 3, -1, -5]) expect(Math.abs(sinc(k))).toBeLessThan(1e-15);
  });

  it('band-limited interpolation reconstructs a sinusoid well below Nyquist', () => {
    // 8 samples per cycle: comfortably oversampled, so sinc reconstruction is accurate.
    const n = 512;
    const x = new Float64Array(n);
    const period = 8;
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * i) / period);
    for (const idx of [100.3, 187.7, 250.5]) {
      const expected = Math.sin((2 * Math.PI * idx) / period);
      expect(sincAt(x, idx, 24)).toBeCloseTo(expected, 4);
    }
  });
});

describe('resampling', () => {
  it('preserves the endpoints', () => {
    const x = Float64Array.from([1, 5, 2, 8, 3]);
    const y = resample(x, 17);
    expect(y[0]).toBeCloseTo(1, 10);
    expect(y[16]).toBeCloseTo(3, 10);
  });

  it('resampling a ramp to any length stays a ramp', () => {
    const n = 65;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = i;
    const y = resample(x, 200, 'linear');
    for (let i = 0; i < 200; i++) {
      expect(y[i]).toBeCloseTo((i * (n - 1)) / 199, 8);
    }
  });

  it('zeroStuff and decimate are inverses at the sample level', () => {
    const x = Float64Array.from([1, 2, 3, 4]);
    const up = zeroStuff(x, 3);
    expect(up.length).toBe(12);
    expect(Array.from(up)).toEqual([1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0]);
    expect(Array.from(decimate(up, 3))).toEqual([1, 2, 3, 4]);
  });
});

describe('threshold crossing detection', () => {
  it('finds the exact crossing of a linear ramp', () => {
    // y = i - 10 crosses zero at index 10 exactly.
    const n = 30;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = i - 10;
    const c = findCrossings(y, 0, 'rising');
    expect(c.length).toBe(1);
    expect(c[0].index).toBeCloseTo(10, 12);
    expect(c[0].rising).toBe(true);
  });

  it('resolves a crossing to a fraction of a sample', () => {
    // Crossing at index 2.25 by construction.
    const y = Float64Array.from([-2, -1, -0.5, 1.5, 3]);
    const c = findCrossings(y, 0, 'rising');
    expect(c[0].index).toBeCloseTo(2.25, 12);
  });

  it('finds rising and falling crossings of a square wave', () => {
    // Built from the sample index rather than sign(sin(x)): sin() is not exactly
    // zero at multiples of pi, and the resulting stray sample would move an edge.
    // Starts low, so the first transition is rising.
    const n = 400;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = i % 100 < 50 ? -1 : 1;
    expect(findCrossings(y, 0, 'rising').length).toBe(4);
    expect(findCrossings(y, 0, 'falling').length).toBe(3);
    expect(findCrossings(y, 0, 'both').length).toBe(7);
    // Rising crossings sit halfway between the two straddling samples.
    const r = findCrossings(y, 0, 'rising');
    for (let i = 0; i < r.length; i++) expect(r[i].index).toBeCloseTo(49.5 + 100 * i, 12);
  });

  it('hysteresis suppresses double counting on a noisy edge', () => {
    // An edge that wobbles across the threshold three times on the way up.
    const y = Float64Array.from([-1, -0.4, 0.05, -0.05, 0.06, -0.02, 0.8, 1]);
    expect(findCrossings(y, 0, 'rising', 0).length).toBeGreaterThan(1);
    expect(findCrossings(y, 0, 'rising', 0.3).length).toBe(1);
  });

  it('sub-sample resolution is what makes a jitter measurement possible', () => {
    // A slow edge sampled coarsely: the crossing must land between samples.
    const y = Float64Array.from([-1, 0.6]);
    const c = findCrossings(y, 0, 'rising');
    expect(c[0].index).toBeCloseTo(1 / 1.6, 12);
    expect(c[0].index).not.toBe(0);
    expect(c[0].index).not.toBe(1);
  });
});

describe('edge transition measurement', () => {
  it('10-90% of a unit ramp is 80% of its duration', () => {
    // Ramp from 0 to 1 over 100 samples.
    const n = 140;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = Math.min(1, i / 100);
    const t = edgeTransitionSamples(y, 0, 0.1, 0.9, true);
    expect(t).toBeCloseTo(80, 6);
  });

  it('20-80% reads 0.75 of the 10-90% value on a linear ramp', () => {
    const n = 140;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = Math.min(1, i / 100);
    const t1090 = edgeTransitionSamples(y, 0, 0.1, 0.9, true);
    const t2080 = edgeTransitionSamples(y, 0, 0.2, 0.8, true);
    expect(t2080 / t1090).toBeCloseTo(0.75, 6);
  });

  it('returns NaN when the edge never reaches the upper level', () => {
    const y = Float64Array.from([0, 0.1, 0.2, 0.3, 0.3, 0.3]);
    expect(Number.isNaN(edgeTransitionSamples(y, 0, 0.1, 0.9, true))).toBe(true);
  });

  it('measures a falling edge', () => {
    const n = 140;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = Math.max(0, 1 - i / 100);
    const t = edgeTransitionSamples(y, 0, 0.9, 0.1, false);
    expect(t).toBeCloseTo(80, 6);
  });
});

describe('monotonicity violation detection', () => {
  it('reports nothing on a clean monotonic edge', () => {
    const n = 100;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = i / (n - 1);
    expect(findMonotonicityViolations(y, 0, n - 1, true)).toEqual([]);
  });

  it('flags a shelf that reverses direction mid-edge', () => {
    // A rising edge with a genuine dip - the DDR training failure mode.
    const y = Float64Array.from([0, 0.2, 0.4, 0.38, 0.36, 0.5, 0.7, 0.9, 1]);
    const v = findMonotonicityViolations(y, 0, y.length - 1, true, 0.001);
    expect(v.length).toBe(1);
    expect(v[0]).toBe(3);
  });

  it('ignores wiggles below the tolerance, so noise is not reported as a violation', () => {
    const y = Float64Array.from([0, 0.2, 0.4, 0.3999, 0.5, 0.7, 1]);
    expect(findMonotonicityViolations(y, 0, y.length - 1, true, 0.01)).toEqual([]);
    expect(findMonotonicityViolations(y, 0, y.length - 1, true, 1e-9).length).toBe(1);
  });

  it('detects violations on a falling edge too', () => {
    const y = Float64Array.from([1, 0.8, 0.6, 0.65, 0.4, 0.2, 0]);
    const v = findMonotonicityViolations(y, 0, y.length - 1, false, 0.001);
    expect(v.length).toBe(1);
  });

  it('flags ringing that crosses back through the transition region', () => {
    // Underdamped edge: overshoot then undershoot within the measured window.
    const n = 200;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / 20;
      y[i] = 1 - Math.exp(-0.3 * t) * Math.cos(t);
    }
    const v = findMonotonicityViolations(y, 0, n - 1, true, 0.001);
    expect(v.length).toBeGreaterThan(0);
  });
});
