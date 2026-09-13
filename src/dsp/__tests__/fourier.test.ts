import { describe, it, expect } from 'vitest';
import {
  harmonics,
  synthesize,
  synthesizeEach,
  measureOvershoot,
  sineIntegral,
  kneeFrequency,
  nyquistFrequency,
  harmonicEnvelope,
  secondHarmonicRatio,
  dutyFromSecondHarmonic,
  GIBBS_OVERSHOOT_OF_JUMP,
  GIBBS_OVERSHOOT_OF_AMPLITUDE,
  GIBBS_PEAK,
} from '../fourier';

describe('sine integral', () => {
  it('matches known values', () => {
    expect(sineIntegral(0)).toBeCloseTo(0, 12);
    expect(sineIntegral(1)).toBeCloseTo(0.9460830704, 8);
    expect(sineIntegral(Math.PI)).toBeCloseTo(1.851937, 6);
    expect(sineIntegral(2 * Math.PI)).toBeCloseTo(1.4181516, 6);
    expect(sineIntegral(10)).toBeCloseTo(1.6583476, 6);
    expect(sineIntegral(-Math.PI)).toBeCloseTo(-1.851937, 6);
  });

  it('approaches pi/2 only as 1/x, because the integrand keeps oscillating', () => {
    // Si(x) = pi/2 - cos(x)/x - sin(x)/x^2 + O(1/x^3). At x = 1000 that residual
    // is still 5.6e-4, so a naive "close to pi/2" assertion would be wrong.
    for (const x of [100, 1000, 10000]) {
      expect(Math.abs(sineIntegral(x) - Math.PI / 2)).toBeLessThan(1.1 / x);
    }
    // Si(x) = pi/2 - f(x)cos(x) - g(x)sin(x), f ~ 1/x, g ~ 1/x^2.
    expect(sineIntegral(1000)).toBeCloseTo(Math.PI / 2 - Math.cos(1000) / 1000 - Math.sin(1000) / 1e6, 8);
    expect(sineIntegral(1e7)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('Gibbs constants are derived, not asserted', () => {
  it('the published constants equal (2/pi) Si(pi) - 1', () => {
    const derived = (2 / Math.PI) * sineIntegral(Math.PI) - 1;
    expect(GIBBS_OVERSHOOT_OF_AMPLITUDE).toBeCloseTo(derived, 7);
    expect(GIBBS_OVERSHOOT_OF_JUMP).toBeCloseTo(derived / 2, 7);
    expect(GIBBS_PEAK).toBeCloseTo(1 + derived, 7);
  });

  it('the jump-referenced overshoot is the familiar ~8.95%, not ~18%', () => {
    expect(GIBBS_OVERSHOOT_OF_JUMP).toBeCloseTo(0.08949, 5);
    expect(GIBBS_OVERSHOOT_OF_AMPLITUDE).toBeCloseTo(0.17898, 5);
  });
});

describe('square wave harmonic series', () => {
  it('contains only odd harmonics with amplitude 4/(n pi)', () => {
    const h = harmonics('square', 11);
    expect(h.map((t) => t.n)).toEqual([1, 3, 5, 7, 9, 11]);
    for (const t of h) expect(t.amplitude).toBeCloseTo(4 / (t.n * Math.PI), 12);
  });

  it('the fundamental of a square wave exceeds its own amplitude', () => {
    // 4/pi = 1.273: the first harmonic alone overshoots the square it builds.
    expect(harmonics('square', 1)[0].amplitude).toBeCloseTo(1.2732395, 6);
  });

  it('rolls off at 1/n, i.e. -20 dB/decade', () => {
    const h = harmonics('square', 101);
    const a1 = h[0].amplitude;
    const a11 = h.find((t) => t.n === 11)!.amplitude;
    const a101 = h.find((t) => t.n === 101)!.amplitude;
    expect(20 * Math.log10(a11 / a1)).toBeCloseTo(-20.83, 1);
    expect(20 * Math.log10(a101 / a11)).toBeCloseTo(-19.26, 1);
  });
});

describe('Fourier reconstruction and the Gibbs phenomenon', () => {
  // The headline verification from the brief: the overshoot must converge to the
  // Gibbs constant, not to zero.
  it('overshoot converges to 8.949% of the jump as N grows', () => {
    const samples = 200000;
    const results: number[] = [];
    for (const maxN of [21, 51, 101, 199]) {
      const y = synthesize(harmonics('square', maxN), samples);
      results.push(measureOvershoot(y, 1).fractionOfJump);
    }
    // Every partial sum overshoots by close to the constant already.
    for (const r of results) expect(r).toBeCloseTo(GIBBS_OVERSHOOT_OF_JUMP, 3);
    // And it converges from above rather than decaying toward zero.
    expect(results[results.length - 1]).toBeGreaterThan(0.088);
    expect(results[results.length - 1]).toBeLessThan(0.0896);
  });

  it('the overshoot does NOT decrease materially with more harmonics', () => {
    const samples = 200000;
    const low = measureOvershoot(synthesize(harmonics('square', 21), samples), 1);
    const high = measureOvershoot(synthesize(harmonics('square', 499), samples), 1);
    // Less than a tenth of a percent of the jump separates 21 harmonics from 499.
    expect(Math.abs(high.fractionOfJump - low.fractionOfJump)).toBeLessThan(0.001);
  });

  it('the overshoot peak migrates toward the discontinuity as N grows', () => {
    // Height stays put; position moves. The sine-basis square wave rises through
    // zero at index 0 and falls at the half period, so the discontinuities are at
    // 0, samples/2 and samples.
    const samples = 200000;
    const distance = (idx: number): number => Math.min(idx, Math.abs(idx - samples / 2), samples - idx);

    const d = [21, 51, 201, 501].map((n) =>
      distance(measureOvershoot(synthesize(harmonics('square', n), samples), 1).peakIndex),
    );
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);

    // It closes in like half the period of the highest harmonic: samples/(2(N+1)).
    expect(d[0]).toBeCloseTo(samples / (2 * 22), -1);
    expect(d[2]).toBeCloseTo(samples / (2 * 202), -1);
  });

  it('the partial sum approaches the correct flat-top level away from the edges', () => {
    const samples = 20000;
    const y = synthesize(harmonics('square', 301), samples);
    // Quarter period: as far from either discontinuity as it is possible to be.
    expect(y[samples / 4]).toBeCloseTo(1, 2);
    expect(y[(3 * samples) / 4]).toBeCloseTo(-1, 2);
  });

  it('synthesizeEach sums to the same waveform as synthesize', () => {
    const samples = 512;
    const terms = harmonics('square', 15);
    const total = synthesize(terms, samples);
    const each = synthesizeEach(terms, samples);
    for (let i = 0; i < samples; i++) {
      let s = 0;
      for (const e of each) s += e[i];
      expect(s).toBeCloseTo(total[i], 12);
    }
  });
});

describe('other waveform shapes', () => {
  it('triangle rolls off at 1/n^2, so it survives band limiting far better', () => {
    const h = harmonics('triangle', 9);
    expect(h.map((t) => t.n)).toEqual([1, 3, 5, 7, 9]);
    expect(Math.abs(h[0].amplitude)).toBeCloseTo(8 / (Math.PI * Math.PI), 10);
    expect(Math.abs(h[1].amplitude)).toBeCloseTo(8 / (9 * Math.PI * Math.PI), 10);
    // Third harmonic is 1/9 of the fundamental, not 1/3 as for a square.
    expect(Math.abs(h[1].amplitude / h[0].amplitude)).toBeCloseTo(1 / 9, 10);
  });

  it('sawtooth contains every harmonic', () => {
    const h = harmonics('sawtooth', 6);
    expect(h.map((t) => t.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('a 50% duty pulse has no DC term and odd harmonics of magnitude 4/(n pi)', () => {
    const pulse = harmonics('pulse', 9, 0.5);
    expect(pulse.map((t) => t.n)).toEqual([1, 3, 5, 7, 9]);
    for (const t of pulse) expect(Math.abs(t.amplitude)).toBeCloseTo(4 / (t.n * Math.PI), 10);
    // Signs alternate because the coefficients are taken about the pulse centre;
    // the accompanying phase puts the rising edge back at t = 0.
    expect(pulse[0].amplitude).toBeGreaterThan(0);
    expect(pulse[1].amplitude).toBeLessThan(0);
    expect(pulse[2].amplitude).toBeGreaterThan(0);
  });

  it('a 50% duty pulse synthesises to exactly the square wave', () => {
    // The real check on the phase convention: same waveform, term for term.
    const samples = 2048;
    const sq = synthesize(harmonics('square', 101), samples);
    const pulse = synthesize(harmonics('pulse', 101, 0.5), samples);
    for (let i = 0; i < samples; i++) expect(pulse[i]).toBeCloseTo(sq[i], 10);
  });

  it('an off-duty pulse carries a DC term equal to its mean', () => {
    const pulse = harmonics('pulse', 12, 0.25);
    const dc = pulse.find((t) => t.n === 0);
    expect(dc).toBeDefined();
    // Bipolar pulse: +1 for a quarter of the period, -1 for the rest.
    expect(dc!.amplitude).toBeCloseTo(2 * 0.25 - 1, 12);

    const samples = 4096;
    const y = synthesize(harmonics('pulse', 601, 0.25), samples);
    let mean = 0;
    for (let i = 0; i < samples; i++) mean += y[i];
    expect(mean / samples).toBeCloseTo(-0.5, 3);
  });

  it('a 25% duty pulse spends a quarter of its period high', () => {
    const samples = 4000;
    const y = synthesize(harmonics('pulse', 801, 0.25), samples);
    let high = 0;
    for (let i = 0; i < samples; i++) if (y[i] > 0) high++;
    expect(high / samples).toBeCloseTo(0.25, 2);
  });

  it('a 25% duty pulse nulls every fourth harmonic', () => {
    // sin(n pi d) = 0 at n d integer: the spectral nulls that make duty cycle
    // visible on a spectrum analyser without ever looking at the time domain.
    const pulse = harmonics('pulse', 12, 0.25);
    expect(pulse.some((t) => t.n === 4)).toBe(false);
    expect(pulse.some((t) => t.n === 8)).toBe(false);
    expect(pulse.some((t) => t.n === 12)).toBe(false);
    expect(pulse.some((t) => t.n === 3)).toBe(true);
  });
});

describe('frequency relationships', () => {
  it('knee frequency is 0.5 / rise time', () => {
    // A 50 ps edge has a knee at 10 GHz.
    expect(kneeFrequency(50e-12)).toBeCloseTo(10e9, 3);
  });

  it('Nyquist frequency of a 6400 MT/s link is 3.2 GHz', () => {
    expect(nyquistFrequency(6.4e9)).toBeCloseTo(3.2e9, 3);
  });
});

describe('duty cycle from the second harmonic', () => {
  it('agrees with the pulse coefficients it was derived from', () => {
    // The claim is |a2|/|a1| = |cos(pi d)|. Check it against the coefficients
    // themselves rather than against the algebra, at duties either side of 50%.
    for (const d of [0.1, 0.25, 0.35, 0.45, 0.5, 0.55, 0.7, 0.9]) {
      const terms = harmonics('pulse', 2, d);
      const a1 = terms.find((t) => t.n === 1)?.amplitude ?? 0;
      const a2 = terms.find((t) => t.n === 2)?.amplitude ?? 0;
      expect(Math.abs(a2 / a1)).toBeCloseTo(secondHarmonicRatio(d), 12);
    }
  });

  it('puts a null on the second harmonic at exactly 50%', () => {
    expect(secondHarmonicRatio(0.5)).toBeCloseTo(0, 15);
    // And `harmonics` agrees by omitting the term altogether.
    expect(harmonics('pulse', 4, 0.5).some((t) => t.n === 2)).toBe(false);
  });

  it('inverts back to the duty that produced it, on the lower branch', () => {
    for (const d of [0.02, 0.1, 0.25, 0.4, 0.499, 0.5]) {
      expect(dutyFromSecondHarmonic(secondHarmonicRatio(d))).toBeCloseTo(d, 10);
    }
  });

  it('is two-to-one: d and 1 - d are the same waveform inverted', () => {
    expect(secondHarmonicRatio(0.3)).toBeCloseTo(secondHarmonicRatio(0.7), 12);
    expect(dutyFromSecondHarmonic(secondHarmonicRatio(0.7))).toBeCloseTo(0.3, 10);
  });

  it('linearises to pi times the duty error near 50%, which is the bench rule', () => {
    // 1% duty error -> second harmonic about 30 dB below the fundamental.
    const r = secondHarmonicRatio(0.51);
    // The exact value is sin(pi*0.01); the linearisation is off by 5e-6 here,
    // which is why the implementation does not use it.
    expect(r).toBeCloseTo(Math.PI * 0.01, 4);
    expect(20 * Math.log10(r)).toBeCloseTo(-30.06, 1);
  });

  it('clamps a ratio outside [0, 1] rather than returning NaN', () => {
    expect(dutyFromSecondHarmonic(1.4)).toBe(0);
    expect(dutyFromSecondHarmonic(-0.2)).toBeCloseTo(0.5, 12);
    expect(dutyFromSecondHarmonic(NaN)).toBeNaN();
  });
});

describe('harmonic envelope', () => {
  const shapes = [
    { shape: 'square' as const, duty: 0.5 },
    { shape: 'triangle' as const, duty: 0.5 },
    { shape: 'sawtooth' as const, duty: 0.5 },
    { shape: 'pulse' as const, duty: 0.3 },
    { shape: 'pulse' as const, duty: 0.5 },
  ];

  it.each(shapes)('passes through every term of $shape (duty $duty)', ({ shape, duty }) => {
    // The envelope is only worth drawing if it is the same algebra as the terms.
    // Comparing it against them is the whole check.
    for (const term of harmonics(shape, 21, duty)) {
      if (term.n === 0) continue;
      expect(harmonicEnvelope(shape, term.n, duty)).toBeCloseTo(Math.abs(term.amplitude), 12);
    }
  });

  it('bounds the harmonics a square wave does not have', () => {
    // No even term exists, and the envelope sits strictly above zero there.
    expect(harmonics('square', 8).some((t) => t.n === 4)).toBe(false);
    expect(harmonicEnvelope('square', 4)).toBeGreaterThan(0);
  });

  it('rolls off at -20 dB/decade for a square wave and -40 for a triangle', () => {
    const slope = (shape: 'square' | 'triangle'): number =>
      (20 * Math.log10(harmonicEnvelope(shape, 10) / harmonicEnvelope(shape, 1))) / Math.log10(10);
    expect(slope('square')).toBeCloseTo(-20, 9);
    expect(slope('triangle')).toBeCloseTo(-40, 9);
  });

  it('nulls a pulse envelope wherever nu*d is a whole number', () => {
    expect(harmonicEnvelope('pulse', 4, 0.25)).toBeCloseTo(0, 12);
    expect(harmonicEnvelope('pulse', 2, 0.5)).toBeCloseTo(0, 12);
    expect(harmonicEnvelope('pulse', 3, 0.25)).toBeGreaterThan(0);
  });

  it('is finite at DC for a pulse and unbounded for the rest', () => {
    expect(harmonicEnvelope('pulse', 0, 0.25)).toBeCloseTo(1, 12);
    expect(harmonicEnvelope('square', 0)).toBe(Infinity);
  });

  it('rejects a negative or non-finite frequency rather than returning a number', () => {
    expect(harmonicEnvelope('square', -1)).toBeNaN();
    expect(harmonicEnvelope('square', NaN)).toBeNaN();
  });
});
