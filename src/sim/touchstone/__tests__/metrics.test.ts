/**
 * ILD and ICN against closed forms: a loss that is exactly the fitted form leaves
 * no deviation, a sinusoidal ripple leaves its own RMS, and flat coupling of a
 * random NRZ aggressor gives k L less the known tail of sinc squared.
 */

import { describe, expect, it } from 'vitest';
import { linearSweep } from '../examples';
import { crosstalkDensity, insertionLossDeviation, integratedCrosstalkNoise, powerSum } from '../metrics';

describe('insertionLossDeviation', () => {
  const freq = linearSweep(10e6, 2000);
  const smooth = freq.map((f) => {
    const g = f / 1e9;
    return 0.3 + 0.8 * Math.sqrt(g) + 0.45 * g + 0.004 * g * g;
  });

  it('recovers the coefficients of a loss of exactly the fitted form', () => {
    const fit = insertionLossDeviation(freq, smooth, 0.05e9, 20e9);
    const [a0, a1, a2, a3] = fit.coefficients;
    expect(a0).toBeCloseTo(0.3, 8);
    expect(a1).toBeCloseTo(0.8, 8);
    expect(a2).toBeCloseTo(0.45, 8);
    expect(a3).toBeCloseTo(0.004, 9);
    expect(fit.rms).toBeLessThan(1e-9);
  });

  it('leaves a ripple of amplitude A with RMS A / sqrt 2 and peak A', () => {
    const a = 0.25;
    const ripple = smooth.map((v, k) => v + a * Math.sin((2 * Math.PI * freq[k]) / 0.4e9));
    const fit = insertionLossDeviation(freq, ripple, 0.05e9, 20e9);
    expect(fit.rms).toBeCloseTo(a / Math.SQRT2, 2);
    expect(fit.peak).toBeCloseTo(a, 1);
  });

  it('refuses a band with too few samples', () => {
    expect(() => insertionLossDeviation(freq, smooth, 1e9, 1.02e9)).toThrow(/four/);
  });
});

describe('integratedCrosstalkNoise', () => {
  const T = 1 / 6.4e9;
  const L = 0.3;
  const k = 0.02;

  it('gives k L for flat coupling, less the sinc squared tail beyond the band', () => {
    // The tail is 1 / (pi^2 F T) up to a term that oscillates with F and vanishes, to
    // order (F T)^-3, where F is a whole multiple of the symbol rate.
    for (const F of [4 / T, 16 / T]) {
      const freq = linearSweep(1.6e6, Math.round(F / 1.6e6));
      const flat = new Float64Array(freq.length).fill(k);
      const sigma = integratedCrosstalkNoise(freq, flat, { level: L, symbolTime: T });
      const expected = k * L * Math.sqrt(1 - 1 / (Math.PI * Math.PI * F * T));
      expect(sigma / expected).toBeCloseTo(1, 3);
    }
  });

  it('is reduced by the receiver bandwidth and by the edge, never increased', () => {
    const freq = linearSweep(5e6, 8000);
    const flat = new Float64Array(freq.length).fill(k);
    const bare = integratedCrosstalkNoise(freq, flat, { level: L, symbolTime: T });
    const rx = integratedCrosstalkNoise(freq, flat, { level: L, symbolTime: T, rxBandwidth: 0.75 / T });
    const edge = integratedCrosstalkNoise(freq, flat, {
      level: L,
      symbolTime: T,
      rxBandwidth: 0.75 / T,
      edge: { type: 'gaussian', bw: 5e9 },
    });
    expect(rx).toBeLessThan(bare);
    expect(edge).toBeLessThan(rx);
    expect(crosstalkDensity(0.75 / T, k, { level: L, symbolTime: T, rxBandwidth: 0.75 / T })).toBeCloseTo(
      0.5 * crosstalkDensity(0.75 / T, k, { level: L, symbolTime: T }),
      15,
    );
  });

  it('adds independent aggressors in power', () => {
    expect(powerSum([3, 4])).toBe(5);
  });
});
