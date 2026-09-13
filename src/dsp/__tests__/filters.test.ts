import { describe, it, expect } from 'vitest';
import {
  transferAt,
  cAbs,
  riseTimeBandwidthProduct,
  rlcCharacteristics,
  rlcStepResponse,
  rcStepResponse,
  groupDelay,
  toDb,
  fromDb,
  sampleResponse,
  cascadedPoleRiseTime,
  type ResponseType,
} from '../filters';

const RESPONSES: ResponseType[] = ['brickwall', 'rc', 'butterworth', 'bessel', 'gaussian'];

describe('transfer function normalisation', () => {
  it('every response has unity gain at DC', () => {
    for (const type of RESPONSES) {
      for (const order of [1, 2, 4, 6]) {
        const h = transferAt({ type, bw: 5e9, order }, 0);
        expect(cAbs(h)).toBeCloseTo(1, 9);
      }
    }
  });

  it('every response is -3 dB at its stated bandwidth', () => {
    const target = 1 / Math.SQRT2;
    for (const type of RESPONSES) {
      if (type === 'brickwall') continue; // unity right up to the cutoff by definition
      for (const order of [1, 2, 3, 4, 5, 6, 8]) {
        const h = transferAt({ type, bw: 5e9, order }, 5e9);
        expect(cAbs(h)).toBeCloseTo(target, 6);
      }
    }
  });

  it('Butterworth magnitude matches the closed form 1/sqrt(1 + w^2n)', () => {
    for (const order of [1, 2, 3, 4, 5, 8]) {
      for (const w of [0.1, 0.5, 1, 2, 5]) {
        const h = transferAt({ type: 'butterworth', bw: 1, order }, w);
        const expected = 1 / Math.sqrt(1 + Math.pow(w, 2 * order));
        expect(cAbs(h)).toBeCloseTo(expected, 9);
      }
    }
  });

  it('first-order Butterworth is identical to a single-pole RC', () => {
    for (const w of [0.1, 0.7, 1, 3, 10]) {
      const a = transferAt({ type: 'butterworth', bw: 1, order: 1 }, w);
      const b = transferAt({ type: 'rc', bw: 1 }, w);
      expect(a.re).toBeCloseTo(b.re, 10);
      expect(a.im).toBeCloseTo(b.im, 10);
    }
  });

  it('brick wall is exactly unity in band and zero out of band', () => {
    expect(cAbs(transferAt({ type: 'brickwall', bw: 1 }, 0.99))).toBe(1);
    expect(cAbs(transferAt({ type: 'brickwall', bw: 1 }, 1.01))).toBe(0);
  });

  it('sampleResponse fills both arrays over a frequency vector', () => {
    const f = Float64Array.from([0, 1e9, 2e9, 5e9]);
    const r = sampleResponse({ type: 'rc', bw: 2e9 }, f);
    expect(r.re.length).toBe(4);
    expect(r.re[0]).toBeCloseTo(1, 10);
    expect(Math.hypot(r.re[2], r.im[2])).toBeCloseTo(1 / Math.SQRT2, 9);
  });
});

describe('rise-time bandwidth product', () => {
  it('single-pole RC is ln(9)/(2 pi) = 0.3496992', () => {
    expect(riseTimeBandwidthProduct({ type: 'rc', bw: 1 })).toBeCloseTo(Math.log(9) / (2 * Math.PI), 12);
    expect(riseTimeBandwidthProduct({ type: 'rc', bw: 1 })).toBeCloseTo(0.3496992, 7);
  });

  it('Gaussian is 2 z90 sqrt(ln2) / (2 pi) = 0.3396244', () => {
    // z90 = 1.2815515655 is the 90th percentile of N(0,1); sigma_t = sqrt(ln2)/(2 pi BW)
    // follows from |H(BW)| = 1/sqrt(2) for H(f) = exp(-2 pi^2 sigma_t^2 f^2).
    const z90 = 1.2815515655446004;
    const closed = (2 * z90 * Math.sqrt(Math.LN2)) / (2 * Math.PI);
    expect(riseTimeBandwidthProduct({ type: 'gaussian', bw: 1 })).toBeCloseTo(closed, 12);
    expect(riseTimeBandwidthProduct({ type: 'gaussian', bw: 1 })).toBeCloseTo(0.3396244, 7);
  });

  it('shows exactly when the 0.35 rule of thumb is safe and when it is not', () => {
    // The rule is a Bessel-shaped assumption in disguise. A well-damped
    // multi-pole channel sits within a percent or so of 0.35; a sharp-cutoff
    // response does not, and neither does a high-order Butterworth.
    const bessel4 = riseTimeBandwidthProduct({ type: 'bessel', bw: 1, order: 4 });
    expect(Math.abs(bessel4 - 0.35) / 0.35).toBeLessThan(0.01);

    const rc = riseTimeBandwidthProduct({ type: 'rc', bw: 1 });
    const gauss = riseTimeBandwidthProduct({ type: 'gaussian', bw: 1 });
    expect(Math.abs(rc - 0.35) / 0.35).toBeLessThan(0.01);
    expect(Math.abs(gauss - 0.35) / 0.35).toBeLessThan(0.04);

    // A brick wall is more than 25% off: estimating bandwidth from rise time on a
    // sharply band-limited signal underestimates it badly.
    const brick = riseTimeBandwidthProduct({ type: 'brickwall', bw: 1 });
    expect(brick / 0.35 - 1).toBeGreaterThan(0.25);

    // And an 8th-order Butterworth is over 30% off in the same direction.
    const bw8 = riseTimeBandwidthProduct({ type: 'butterworth', bw: 1, order: 8 });
    expect(bw8 / 0.35 - 1).toBeGreaterThan(0.3);
  });

  it('the Bessel product barely moves with order, which is why it is the scope shape', () => {
    const ks = [2, 3, 4, 6, 8].map((order) => riseTimeBandwidthProduct({ type: 'bessel', bw: 1, order }));
    for (const k of ks) expect(Math.abs(k - 0.35)).toBeLessThan(0.01);
    // Butterworth, by contrast, walks steadily upward as order rises.
    const b2 = riseTimeBandwidthProduct({ type: 'butterworth', bw: 1, order: 2 });
    const b8 = riseTimeBandwidthProduct({ type: 'butterworth', bw: 1, order: 8 });
    expect(b8 - b2).toBeGreaterThan(0.1);
  });

  it('the numerical solver reproduces the closed-form RC result via Butterworth order 1', () => {
    // Butterworth order 1 IS a single-pole RC, but it takes the numerical path.
    // Agreement between the two therefore validates the step-response solver itself.
    const numeric = riseTimeBandwidthProduct({ type: 'butterworth', bw: 1, order: 1 });
    const closed = Math.log(9) / (2 * Math.PI);
    expect(numeric).toBeCloseTo(closed, 3);
  });

  it('lands in the physically sensible 0.28 to 0.45 band for every shape', () => {
    for (const type of RESPONSES) {
      for (const order of [1, 2, 4, 6]) {
        const k = riseTimeBandwidthProduct({ type, bw: 1, order });
        expect(Number.isFinite(k)).toBe(true);
        expect(k).toBeGreaterThan(0.27);
        expect(k).toBeLessThan(0.46);
      }
    }
  });

  it('Bessel group-delay flatness keeps its product nearly order-independent', () => {
    const k4 = riseTimeBandwidthProduct({ type: 'bessel', bw: 1, order: 4 });
    const k8 = riseTimeBandwidthProduct({ type: 'bessel', bw: 1, order: 8 });
    expect(Math.abs(k4 - k8)).toBeLessThan(0.02);
  });
});

describe('RLC characteristics', () => {
  it('identifies the damping regime from R relative to 2*sqrt(L/C)', () => {
    const l = 1e-9;
    const c = 1e-12;
    const z0 = Math.sqrt(l / c); // 31.62 ohm
    expect(rlcCharacteristics({ r: 2 * z0, l, c }).regime).toBe('critically damped');
    expect(rlcCharacteristics({ r: 0.5 * z0, l, c }).regime).toBe('underdamped');
    expect(rlcCharacteristics({ r: 6 * z0, l, c }).regime).toBe('overdamped');
  });

  it('computes zeta, natural frequency and characteristic impedance', () => {
    const p = { r: 10, l: 1e-9, c: 1e-12 };
    const ch = rlcCharacteristics(p);
    expect(ch.z0).toBeCloseTo(31.6227766, 6);
    expect(ch.zeta).toBeCloseTo(5 * Math.sqrt(1e-12 / 1e-9), 12);
    expect(ch.fn).toBeCloseTo(1 / (2 * Math.PI * Math.sqrt(1e-9 * 1e-12)), 3);
  });

  it('overshoot follows exp(-pi zeta / sqrt(1 - zeta^2))', () => {
    for (const zeta of [0.1, 0.3, 0.5, 0.707, 0.9]) {
      const l = 1e-9;
      const c = 1e-12;
      const r = 2 * zeta * Math.sqrt(l / c);
      const ch = rlcCharacteristics({ r, l, c });
      const expected = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
      expect(ch.zeta).toBeCloseTo(zeta, 10);
      expect(ch.overshoot).toBeCloseTo(expected, 10);
    }
  });

  it('zeta = 0.707 gives the familiar 4.3% overshoot', () => {
    const l = 1e-9;
    const c = 1e-12;
    const zeta = Math.SQRT1_2;
    const ch = rlcCharacteristics({ r: 2 * zeta * Math.sqrt(l / c), l, c });
    expect(ch.overshoot).toBeCloseTo(0.0432139, 6);
  });
});

describe('RLC step response', () => {
  it('the simulated peak matches the analytic overshoot formula', () => {
    const l = 1e-9;
    const c = 1e-12;
    for (const zeta of [0.2, 0.4, 0.6]) {
      const r = 2 * zeta * Math.sqrt(l / c);
      const ch = rlcCharacteristics({ r, l, c });
      const t = new Float64Array(20000);
      for (let i = 0; i < t.length; i++) t[i] = (i * 5 * ch.timeToPeak) / t.length;
      const y = rlcStepResponse({ r, l, c }, t);
      let peak = -Infinity;
      for (let i = 0; i < y.length; i++) peak = Math.max(peak, y[i]);
      expect(peak - 1).toBeCloseTo(ch.overshoot, 4);
    }
  });

  it('settles to unity', () => {
    const p = { r: 30, l: 1e-9, c: 1e-12 };
    const t = new Float64Array(10);
    for (let i = 0; i < 10; i++) t[i] = 1e-8 + i * 1e-9;
    const y = rlcStepResponse(p, t);
    for (let i = 0; i < y.length; i++) expect(y[i]).toBeCloseTo(1, 6);
  });

  it('starts from zero with zero slope, as an LC network must', () => {
    const p = { r: 10, l: 1e-9, c: 1e-12 };
    const t = Float64Array.from([0, 1e-15]);
    const y = rlcStepResponse(p, t);
    expect(y[0]).toBeCloseTo(0, 12);
    expect(y[1]).toBeLessThan(1e-6);
  });

  it('critically damped case is continuous with the underdamped limit', () => {
    const l = 1e-9;
    const c = 1e-12;
    const rc = 2 * Math.sqrt(l / c);
    const t = Float64Array.from([1e-11, 5e-11, 1e-10]);
    const yCrit = rlcStepResponse({ r: rc, l, c }, t);
    const yNear = rlcStepResponse({ r: rc * (1 - 1e-6), l, c }, t);
    for (let i = 0; i < t.length; i++) expect(yCrit[i]).toBeCloseTo(yNear[i], 5);
  });
});

describe('RC step response', () => {
  it('reaches 1 - 1/e at one time constant', () => {
    const tau = 1e-9;
    const y = rcStepResponse(tau, Float64Array.from([tau]));
    expect(y[0]).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  it('10-90% rise time is ln(9) time constants', () => {
    const tau = 2e-9;
    const n = 200000;
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = (i * 10 * tau) / n;
    const y = rcStepResponse(tau, t);
    let t10 = 0;
    let t90 = 0;
    for (let i = 1; i < n; i++) {
      if (y[i - 1] < 0.1 && y[i] >= 0.1) t10 = t[i];
      if (y[i - 1] < 0.9 && y[i] >= 0.9) {
        t90 = t[i];
        break;
      }
    }
    expect((t90 - t10) / tau).toBeCloseTo(Math.log(9), 3);
  });
});

describe('group delay', () => {
  it('a pure delay has constant group delay equal to that delay', () => {
    const n = 200;
    const f = new Float64Array(n);
    const ph = new Float64Array(n);
    const delay = 1.7e-9;
    for (let i = 0; i < n; i++) {
      f[i] = (i * 10e9) / n;
      ph[i] = -2 * Math.PI * f[i] * delay;
    }
    const gd = groupDelay(f, ph);
    for (let i = 1; i < n - 1; i++) expect(gd[i]).toBeCloseTo(delay, 15);
  });
});

describe('dB conversion', () => {
  it('round trips', () => {
    for (const v of [1, 0.5, 0.1, 0.001, 2]) expect(fromDb(toDb(v))).toBeCloseTo(v, 10);
  });

  it('uses the 20 log10 voltage convention', () => {
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 4);
    expect(toDb(0.1)).toBeCloseTo(-20, 10);
    expect(toDb(1 / Math.SQRT2)).toBeCloseTo(-3.0103, 4);
  });

  it('floors rather than returning -Infinity', () => {
    expect(toDb(0)).toBe(-300);
  });
});

describe('cascaded identical poles', () => {
  it('reduces to the single-pole product for n = 1', () => {
    // ln((1-lo)/(1-hi)) / 2pi, which is what riseTimeBandwidthProduct returns for
    // type 'rc'. One function solved numerically, one in closed form, same answer.
    for (const [lo, hi] of [
      [0.1, 0.9],
      [0.2, 0.8],
      [0.05, 0.95],
    ] as const) {
      const closed = riseTimeBandwidthProduct({ type: 'rc', bw: 1 }, lo, hi);
      expect(cascadedPoleRiseTime(1, 1, lo, hi)).toBeCloseTo(closed, 12);
    }
  });

  it('scales inversely with the bandwidth of each pole', () => {
    expect(cascadedPoleRiseTime(3, 2e9)).toBeCloseTo(cascadedPoleRiseTime(3, 1e9) / 2, 21);
  });

  it('matches the closed-form solution for two poles', () => {
    // s_2(x) = 1 - (1+x)e^{-x}. Solving (1+x)e^{-x} = 0.9 and = 0.1 gives
    // x = 0.5318116084 and x = 3.8897201699, a span of 3.3579085615 time
    // constants, computed to 30 digits and rounded here.
    const tr = cascadedPoleRiseTime(2, 1);
    expect(tr).toBeCloseTo(3.3579085615 / (2 * Math.PI), 10);
    expect(tr).toBeCloseTo(0.5344277460097901, 12);
  });

  it('shows that the quadrature rule underestimates a cascade of poles', () => {
    // The RSS rule is exact only for Gaussians. Two identical poles are the
    // smallest counterexample, and the error is in the optimistic direction: the
    // estimate says the edge is faster than it is.
    const one = cascadedPoleRiseTime(1, 1);
    const two = cascadedPoleRiseTime(2, 1);
    const rss = Math.SQRT2 * one;
    expect(rss).toBeLessThan(two);
    expect((rss - two) / two).toBeCloseTo(-0.0746189957, 9);
  });

  it('grows monotonically with the number of poles', () => {
    let previous = 0;
    for (const n of [1, 2, 3, 5, 8, 16]) {
      const tr = cascadedPoleRiseTime(n, 1);
      expect(tr).toBeGreaterThan(previous);
      previous = tr;
    }
  });

  it('rejects levels that are not a proper pair', () => {
    expect(() => cascadedPoleRiseTime(2, 1, 0.9, 0.1)).toThrow(/levels/);
    expect(() => cascadedPoleRiseTime(2, 1, 0, 0.9)).toThrow(/levels/);
    expect(cascadedPoleRiseTime(2, 0)).toBeNaN();
  });
});
