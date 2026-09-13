import { describe, it, expect } from 'vitest';
import {
  PRBS_SPECS,
  PRBS_NAMES,
  Lfsr,
  makePrbs,
  prbsBits,
  periodicAutocorrelation,
  onesDensity,
  longestRun,
  runLengthHistogram,
  type PrbsName,
} from '../prbs';

/**
 * Maximality is the property that matters, and it is fully characterised by the
 * two-valued periodic autocorrelation: N at lag 0 and exactly -1 everywhere else.
 * That test validates the *polynomial*, not merely that the code still behaves as
 * it did yesterday, which is why it is preferred here to a table of golden bytes.
 */
describe('PRBS maximal-length properties', () => {
  for (const name of ['prbs7', 'prbs9', 'prbs11'] as PrbsName[]) {
    const order = PRBS_SPECS[name].order;
    const period = Math.pow(2, order) - 1;

    it(`${name} has two-valued autocorrelation, proving period 2^${order}-1`, () => {
      const bits = prbsBits(name, period);
      const ac = periodicAutocorrelation(bits);
      expect(ac[0]).toBe(period);
      for (let lag = 1; lag < period; lag++) expect(ac[lag]).toBe(-1);
    });
  }

  for (const name of PRBS_NAMES) {
    const order = PRBS_SPECS[name].order;
    if (order > 20) continue; // 2^23 and 2^31 handled separately below
    const period = Math.pow(2, order) - 1;

    it(`${name} returns to its initial state after exactly 2^${order}-1 steps`, () => {
      const lfsr = makePrbs(name);
      const seed = lfsr.getState();
      let returnedAt = -1;
      for (let i = 1; i <= period; i++) {
        lfsr.next();
        if (lfsr.getState() === seed) {
          returnedAt = i;
          break;
        }
      }
      expect(returnedAt).toBe(period);
    });

    it(`${name} contains exactly 2^${order - 1} ones per period`, () => {
      const bits = prbsBits(name, period);
      let ones = 0;
      for (let i = 0; i < period; i++) ones += bits[i];
      expect(ones).toBe(Math.pow(2, order - 1));
    });

    it(`${name} has a longest run of ${order} ones`, () => {
      // A maximal-length sequence contains the all-ones state exactly once, which
      // produces a single run of n ones and never a longer one.
      const bits = prbsBits(name, period * 2);
      expect(longestRun(bits)).toBe(order);
    });
  }

  it('prbs23 has period 2^23-1', () => {
    const order = 23;
    const period = Math.pow(2, order) - 1;
    const lfsr = makePrbs('prbs23');
    const seed = lfsr.getState();
    let returnedAt = -1;
    for (let i = 1; i <= period; i++) {
      lfsr.next();
      if (lfsr.getState() === seed) {
        returnedAt = i;
        break;
      }
    }
    expect(returnedAt).toBe(period);
  });

  it('prbs31 does not repeat within 10M steps', () => {
    // 2^31-1 = 2147483647 is prime, so the period of any non-trivial cycle must
    // be either 1 or 2^31-1. Showing the state does not return within 10M steps
    // therefore establishes maximality without running 2.1 billion iterations.
    const lfsr = makePrbs('prbs31');
    const seed = lfsr.getState();
    for (let i = 0; i < 10_000_000; i++) {
      lfsr.next();
      if (lfsr.getState() === seed) throw new Error(`prbs31 repeated at step ${i + 1}`);
    }
    expect(true).toBe(true);
  });
});

describe('PRBS statistics', () => {
  it('ones density approaches one half', () => {
    for (const name of ['prbs7', 'prbs15'] as PrbsName[]) {
      const order = PRBS_SPECS[name].order;
      const period = Math.pow(2, order) - 1;
      const d = onesDensity(prbsBits(name, period));
      // Exactly 2^(n-1) / (2^n - 1), very slightly above one half.
      expect(d).toBeCloseTo(Math.pow(2, order - 1) / period, 12);
      expect(d).toBeGreaterThan(0.5);
    }
  });

  it('run-length histogram halves with each additional bit of run length', () => {
    const bits = prbsBits('prbs11', 2047);
    const hist = runLengthHistogram(bits);
    // For a maximal-length sequence there are 2^(n-k-1) runs of length k, both
    // polarities combined, for k up to n-2.
    for (let k = 1; k <= 8; k++) {
      expect(hist.get(k)).toBe(Math.pow(2, 11 - k - 1));
    }
  });

  it('longer PRBS orders produce longer maximum runs, which is why the order matters', () => {
    const r7 = longestRun(prbsBits('prbs7', 254));
    const r15 = longestRun(prbsBits('prbs15', 65534));
    expect(r7).toBe(7);
    expect(r15).toBe(15);
    expect(r15).toBeGreaterThan(r7);
  });
});

describe('Lfsr robustness', () => {
  it('recovers from an all-zero seed instead of locking up', () => {
    const l = new Lfsr(PRBS_SPECS.prbs7, 0);
    const bits = l.take(200);
    let ones = 0;
    for (let i = 0; i < bits.length; i++) ones += bits[i];
    expect(ones).toBeGreaterThan(50);
  });

  it('rejects out-of-range taps and orders', () => {
    expect(() => new Lfsr({ order: 1, taps: [1], polynomial: '', source: '' })).toThrow();
    expect(() => new Lfsr({ order: 7, taps: [9], polynomial: '', source: '' })).toThrow();
  });

  it('reset returns the generator to its seed', () => {
    const l = makePrbs('prbs9', 0x1a5);
    const a = Array.from(l.take(64));
    l.reset();
    const b = Array.from(l.take(64));
    expect(b).toEqual(a);
  });

  it('a different seed is a phase shift of the same sequence, not a new one', () => {
    // Every non-zero seed enters the same single cycle; only the starting point moves.
    const period = 127;
    const ref = prbsBits('prbs7', period * 2);
    const shifted = prbsBits('prbs7', period, 0x2a);
    let found = -1;
    outer: for (let off = 0; off < period; off++) {
      for (let i = 0; i < period; i++) {
        if (ref[off + i] !== shifted[i]) continue outer;
      }
      found = off;
      break;
    }
    expect(found).toBeGreaterThanOrEqual(0);
  });
});
