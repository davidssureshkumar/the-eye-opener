import { describe, it, expect } from 'vitest';
import {
  clamp,
  engParts,
  extentOf,
  formatDb,
  formatDecade,
  formatEng,
  formatPercent,
  formatTicks,
  formatUi,
  linearScale,
  linearTicks,
  logScale,
  logTicks,
  niceDomain,
  niceStep,
} from '../scale';

describe('linear scale', () => {
  it('maps the domain ends onto the range ends', () => {
    const s = linearScale([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(10)).toBe(100);
    expect(s(2.5)).toBe(25);
  });

  it('handles an inverted range, which is every y axis on a canvas', () => {
    // Canvas y grows downward, so a volts axis maps [min, max] onto [bottom, top].
    const s = linearScale([-0.5, 0.5], [300, 20]);
    expect(s(-0.5)).toBe(300);
    expect(s(0.5)).toBe(20);
    expect(s(0)).toBe(160);
  });

  it('inverts exactly', () => {
    const s = linearScale([-1.3e-9, 4.2e-9], [64, 980]);
    for (const px of [64, 100, 512, 980]) {
      expect(s(s.invert(px))).toBeCloseTo(px, 9);
    }
    for (const v of [-1.3e-9, 0, 2e-9, 4.2e-9]) {
      expect(s.invert(s(v))).toBeCloseTo(v, 18);
    }
  });

  it('extrapolates outside the domain rather than clamping', () => {
    // A trace that leaves the window must be clipped by the canvas, not folded back
    // onto the edge, or an overshoot would look like a flat top.
    const s = linearScale([0, 1], [0, 100]);
    expect(s(1.5)).toBe(150);
    expect(s(-0.5)).toBe(-50);
  });

  it('does not produce NaN for a zero-width domain', () => {
    const s = linearScale([5, 5], [0, 100]);
    expect(Number.isFinite(s(5))).toBe(true);
    expect(Number.isFinite(s.invert(50))).toBe(true);
  });

  it('exposes its domain and range', () => {
    const s = linearScale([1, 2], [3, 4]);
    expect(s.domain).toEqual([1, 2]);
    expect(s.range).toEqual([3, 4]);
  });
});

describe('log scale', () => {
  it('puts each decade the same distance apart', () => {
    const s = logScale([1e-12, 1e-3], [0, 900]);
    expect(s(1e-12)).toBeCloseTo(0, 9);
    expect(s(1e-3)).toBeCloseTo(900, 9);
    expect(s(1e-9) - s(1e-10)).toBeCloseTo(s(1e-5) - s(1e-6), 9);
  });

  it('inverts exactly', () => {
    const s = logScale([1e6, 1e11], [0, 600]);
    for (const v of [1e6, 3.2e9, 1e11]) expect(s.invert(s(v)) / v).toBeCloseTo(1, 9);
  });

  it('survives a zero or negative value instead of returning NaN', () => {
    const s = logScale([1e-12, 1], [0, 100]);
    expect(Number.isFinite(s(0))).toBe(true);
    expect(Number.isFinite(s(-1))).toBe(true);
  });
});

describe('nice steps and ticks', () => {
  it('snaps to the 1-2-5 ladder', () => {
    expect(niceStep(0.9)).toBe(1);
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.5)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.013)).toBeCloseTo(0.02, 12);
    expect(niceStep(4.4e-11)).toBeCloseTo(5e-11, 22);
  });

  it('returns a usable step for degenerate input', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });

  it('produces evenly spaced ticks inside the domain', () => {
    const t = linearTicks([0, 1], 5);
    expect(t).toEqual([0, 0.2, 0.4, 0.6000000000000001, 0.8, 1].map((x) => x));
    for (let i = 1; i < t.length; i++) {
      expect(t[i] - t[i - 1]).toBeCloseTo(0.2, 12);
    }
  });

  it('lands exactly on zero rather than on a rounding crumb', () => {
    // Without the snap this produces -1.1e-17, which renders as "-0" on an axis.
    const t = linearTicks([-3e-12, 3e-12], 6);
    expect(t).toContain(0);
    expect(t.some((v) => v !== 0 && Math.abs(v) < 1e-20)).toBe(false);
  });

  it('handles a reversed domain', () => {
    expect(linearTicks([10, 0], 5)).toEqual(linearTicks([0, 10], 5));
  });

  it('returns something sane for a degenerate domain', () => {
    expect(linearTicks([5, 5])).toEqual([5]);
    expect(linearTicks([NaN, 1])).toEqual([]);
  });

  it('gives roughly the requested count over several decades of scale', () => {
    for (const [lo, hi] of [
      [0, 1],
      [0, 156.25e-12],
      [-0.6, 0.6],
      [1e9, 12e9],
      [0, 7],
    ] as Array<[number, number]>) {
      const n = linearTicks([lo, hi], 6).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(13);
    }
  });
});

describe('log ticks', () => {
  it('gives one major tick per decade and eight minors between them', () => {
    const t = logTicks([1, 1000]);
    expect(t.major).toEqual([1, 10, 100, 1000]);
    // 2..9 in each of three full decades, plus nothing above 1000.
    expect(t.minor.filter((v) => v > 1 && v < 10)).toHaveLength(8);
    expect(t.minor.every((v) => v >= 1 && v <= 1000)).toBe(true);
  });

  it('covers the BER range a bathtub actually spans', () => {
    const t = logTicks([1e-16, 0.5]);
    expect(t.major).toContain(1e-12);
    expect(t.major).toContain(1e-16);
    expect(t.major.length).toBe(16);
  });

  it('refuses a non-positive domain instead of returning NaNs', () => {
    expect(logTicks([0, 10])).toEqual({ major: [], minor: [] });
    expect(logTicks([-1, 10])).toEqual({ major: [], minor: [] });
  });
});

describe('nice domains and extents', () => {
  it('rounds a domain outward to whole steps', () => {
    expect(niceDomain([0.3, 9.1], 5)).toEqual([0, 10]);
    expect(niceDomain([-0.47, 0.53], 5)).toEqual([-0.6000000000000001, 0.6000000000000001]);
  });

  it('extent pads a series and never returns a zero-height window', () => {
    const [lo, hi] = extentOf([1, 2, 3], 0.1);
    expect(lo).toBeCloseTo(0.8, 12);
    expect(hi).toBeCloseTo(3.2, 12);

    const flat = extentOf([0.25, 0.25, 0.25]);
    expect(flat[1]).toBeGreaterThan(flat[0]);

    const zeros = extentOf([0, 0, 0]);
    expect(zeros[1]).toBeGreaterThan(zeros[0]);
  });

  it('ignores NaN and infinity in a series', () => {
    // A divide-by-zero in a transfer function must not blank the whole axis.
    const [lo, hi] = extentOf([1, NaN, 2, Infinity, 0], 0);
    expect(lo).toBe(0);
    expect(hi).toBe(2);
  });

  it('falls back to a unit window when there is nothing finite at all', () => {
    expect(extentOf([NaN, Infinity])).toEqual([0, 1]);
    expect(extentOf([])).toEqual([0, 1]);
  });
});

describe('engineering notation', () => {
  it('splits into a mantissa in [1, 1000) and an SI prefix', () => {
    expect(engParts(156.25e-12)).toMatchObject({ prefix: 'p' });
    expect(engParts(156.25e-12).mantissa).toBeCloseTo(156.25, 9);
    expect(engParts(6.4e9)).toMatchObject({ prefix: 'G' });
    expect(engParts(6.4e9).mantissa).toBeCloseTo(6.4, 9);
    // 0.5 V is 500 mV at the bench, so the prefix moves down rather than the
    // mantissa sitting below 1.
    expect(engParts(0.5)).toMatchObject({ prefix: 'm', exp: -3 });
    expect(engParts(0.5).mantissa).toBeCloseTo(500, 9);
    expect(engParts(50)).toMatchObject({ prefix: '', exp: 0 });
    expect(engParts(-2.5e-3).prefix).toBe('m');
    expect(engParts(-2.5e-3).mantissa).toBeCloseTo(-2.5, 12);
  });

  it('formats the numbers this site is actually made of', () => {
    expect(formatEng(156.25e-12, 's', 5)).toBe('156.25 ps');
    expect(formatEng(6.4e9, 'Hz')).toBe('6.4 GHz');
    expect(formatEng(0.5, 'V')).toBe('500 mV');
    expect(formatEng(25e-12, 's')).toBe('25 ps');
    expect(formatEng(50, 'ohm')).toBe('50 ohm');
    expect(formatEng(3e-3, 'V')).toBe('3 mV');
    expect(formatEng(0, 'V')).toBe('0 V');
  });

  it('keeps significant figures rather than decimal places', () => {
    expect(formatEng(1.23456e-9, 's', 3)).toBe('1.23 ns');
    expect(formatEng(123.456e-9, 's', 3)).toBe('123 ns');
    expect(formatEng(12.3456e-9, 's', 4)).toBe('12.35 ns');
  });

  it('handles negatives and non-finite values', () => {
    expect(formatEng(-1.5e-12, 's')).toBe('-1.5 ps');
    expect(formatEng(NaN)).toBe('NaN');
    expect(formatEng(Infinity)).toBe('∞');
  });

  it('falls back to the smallest prefix rather than losing the value', () => {
    // Below a femto, keep femto and let the mantissa go small: "0.001 fs" is still
    // readable, and there is no prefix below f in this table.
    expect(formatEng(1e-18, 's')).toContain('fs');
  });
});

describe('axis tick labels', () => {
  it('uses one prefix for the whole axis', () => {
    // The failure this prevents: "500 ps, 1 ns, 1.5 ns" on a single axis.
    const labels = formatTicks([0, 0.5e-9, 1e-9, 1.5e-9, 2e-9], 's');
    expect(labels).toEqual(['0.0 ns', '0.5 ns', '1.0 ns', '1.5 ns', '2.0 ns']);
  });

  it('uses one decimal count for the whole axis', () => {
    const labels = formatTicks([0, 0.2, 0.4, 0.6, 0.8, 1], 'V');
    for (const l of labels) expect(l).toMatch(/^-?\d\.\d V$/);
  });

  it('drops decimals when the ticks are whole numbers', () => {
    expect(formatTicks([0, 2, 4, 6, 8, 10], 'UI')).toEqual(['0 UI', '2 UI', '4 UI', '6 UI', '8 UI', '10 UI']);
  });

  it('never prints a negative zero', () => {
    const labels = formatTicks([-0.2, -0.1, 0, 0.1, 0.2], 'V');
    expect(labels).toEqual(['-200 mV', '-100 mV', '0 mV', '100 mV', '200 mV']);
    expect(labels.some((l) => l.startsWith('-0'))).toBe(false);
  });

  it('handles a single tick and an empty axis', () => {
    expect(formatTicks([], 'V')).toEqual([]);
    expect(formatTicks([0], 'V')).toEqual(['0 V']);
    expect(formatTicks([3.2e9], 'Hz')).toEqual(['3.2 GHz']);
  });

  it('labels picosecond ticks without exponent soup', () => {
    const labels = formatTicks(linearTicks([0, 156.25e-12], 5), 's');
    expect(labels.every((l) => l.endsWith(' ps'))).toBe(true);
  });
});

describe('the other readout formats', () => {
  it('formats decades for a log axis', () => {
    expect(formatDecade(1e-12)).toBe('10^-12');
    expect(formatDecade(1)).toBe('10^0');
    expect(formatDecade(0)).toBe('');
  });

  it('formats dB with a sign and a fixed decimal', () => {
    expect(formatDb(-12.345)).toBe('-12.3 dB');
    expect(formatDb(0)).toBe('0.0 dB');
    expect(formatDb(9.54, 2)).toBe('9.54 dB');
  });

  it('formats unit intervals', () => {
    expect(formatUi(0.42)).toBe('0.420 UI');
    expect(formatUi(0.5, 2)).toBe('0.50 UI');
  });

  it('formats percentages to significant figures', () => {
    // The Gibbs overshoot, which needs four figures to be the right number.
    expect(formatPercent(0.0894898722360836, 4)).toBe('8.949 %');
    expect(formatPercent(0.5, 3)).toBe('50.0 %');
    expect(formatPercent(0)).toBe('0 %');
  });
});

describe('clamp', () => {
  it('bounds a value both ways', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
