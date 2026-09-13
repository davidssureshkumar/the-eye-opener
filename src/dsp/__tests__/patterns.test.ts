import { describe, it, expect } from 'vitest';
import {
  generateBits,
  describePattern,
  worstCaseIsiPattern,
  bitsToNrz,
  bitsToPam4,
  PATTERN_MENU,
  type PatternSpec,
} from '../patterns';
import { longestRun, onesDensity } from '../prbs';

describe('pattern generation basics', () => {
  it('always returns exactly the requested length', () => {
    for (const spec of PATTERN_MENU) {
      for (const n of [1, 7, 100, 1000]) {
        expect(generateBits(spec, n).length).toBe(n);
      }
    }
  });

  it('only ever emits 0 or 1', () => {
    for (const spec of PATTERN_MENU) {
      const b = generateBits(spec, 500);
      for (let i = 0; i < b.length; i++) expect(b[i] === 0 || b[i] === 1).toBe(true);
    }
  });

  it('clock is 1010', () => {
    expect(Array.from(generateBits({ kind: 'clock' }, 8))).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('clock-div-n produces n ones then n zeros', () => {
    expect(Array.from(generateBits({ kind: 'clock-div-n', divN: 2 }, 8))).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
    expect(Array.from(generateBits({ kind: 'clock-div-n', divN: 3 }, 12))).toEqual([
      1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0,
    ]);
  });

  it('lone-one puts a single 1 in each frame', () => {
    const b = generateBits({ kind: 'lone-one', frame: 8 }, 32);
    let ones = 0;
    for (let i = 0; i < b.length; i++) ones += b[i];
    expect(ones).toBe(4);
  });

  it('lone-zero is the complement of lone-one', () => {
    const one = generateBits({ kind: 'lone-one', frame: 8 }, 32);
    const zero = generateBits({ kind: 'lone-zero', frame: 8 }, 32);
    for (let i = 0; i < 32; i++) expect(zero[i]).toBe(one[i] ^ 1);
  });

  it('walking-one lights each position of the frame exactly once', () => {
    const frame = 5;
    const b = generateBits({ kind: 'walking-one', frame }, frame * frame);
    for (let row = 0; row < frame; row++) {
      for (let col = 0; col < frame; col++) {
        expect(b[row * frame + col]).toBe(row === col ? 1 : 0);
      }
    }
  });

  it('invert flips the whole stream', () => {
    const spec: PatternSpec = { kind: 'prbs', prbs: 'prbs7', seed: 0x7f };
    const a = generateBits(spec, 200);
    const b = generateBits({ ...spec, invert: true }, 200);
    for (let i = 0; i < 200; i++) expect(b[i]).toBe(a[i] ^ 1);
  });

  it('custom repeats the given string and ignores stray characters', () => {
    expect(Array.from(generateBits({ kind: 'custom', custom: '110' }, 7))).toEqual([1, 1, 0, 1, 1, 0, 1]);
    expect(Array.from(generateBits({ kind: 'custom', custom: '1 1-0' }, 6))).toEqual([1, 1, 0, 1, 1, 0]);
  });

  it('all-ones and all-zeros are DC', () => {
    expect(onesDensity(generateBits({ kind: 'all-ones' }, 100))).toBe(1);
    expect(onesDensity(generateBits({ kind: 'all-zeros' }, 100))).toBe(0);
  });

  it('a PRBS stream is reproducible from its seed', () => {
    const spec: PatternSpec = { kind: 'prbs', prbs: 'prbs15', seed: 0x1234 };
    expect(Array.from(generateBits(spec, 300))).toEqual(Array.from(generateBits(spec, 300)));
  });

  it('longer PRBS orders give longer worst-case runs', () => {
    const r7 = longestRun(generateBits({ kind: 'prbs', prbs: 'prbs7' }, 2000));
    const r13 = longestRun(generateBits({ kind: 'prbs', prbs: 'prbs13' }, 40000));
    expect(r7).toBe(7);
    expect(r13).toBe(13);
  });
});

describe('worst-case ISI pattern (peak distortion analysis)', () => {
  it('matches a hand-computed three-tap example', () => {
    // taps = [pre=-0.1, cursor=1.0, post=+0.3], cursor at index 1.
    //   tap m=+1 (h=+0.3) is driven by the bit BEFORE the cursor -> must be 0
    //   tap m=-1 (h=-0.1) is driven by the bit AFTER the cursor  -> must be 1
    const taps = Float64Array.from([-0.1, 1.0, 0.3]);
    const r = worstCaseIsiPattern(taps, 1, 1);
    expect(Array.from(r.bits)).toEqual([0, 1, 1]);
    expect(r.totalIsi).toBeCloseTo(0.4, 12);
    expect(r.worstLevel).toBeCloseTo(1.0 - 0.4, 12);
  });

  it('the worst level equals h0 minus the sum of ISI magnitudes', () => {
    const taps = Float64Array.from([0.05, -0.12, 0.9, 0.25, -0.08, 0.03]);
    const r = worstCaseIsiPattern(taps, 2, 1);
    const expectedIsi = 0.05 + 0.12 + 0.25 + 0.08 + 0.03;
    expect(r.totalIsi).toBeCloseTo(expectedIsi, 12);
    expect(r.worstLevel).toBeCloseTo(0.9 - expectedIsi, 12);
  });

  it('actually produces the worst level when convolved back through the taps', () => {
    // The decisive test: drive the constructed pattern through the pulse response
    // and confirm the sampled cursor really is the predicted minimum.
    const taps = Float64Array.from([0.04, -0.09, 0.85, 0.22, -0.06]);
    const cursorIdx = 2;
    const r = worstCaseIsiPattern(taps, cursorIdx, 1);
    const sym = bitsToNrz(r.bits);

    // Sampled value at the cursor of bit `cursorIdx`:
    //   sum over taps m of a[cursorIdx - m] * h[cursorIdx + m]
    let y = 0;
    for (let i = 0; i < taps.length; i++) {
      const m = i - cursorIdx;
      const k = cursorIdx - m;
      if (k >= 0 && k < sym.length) y += sym[k] * taps[i];
    }
    expect(y).toBeCloseTo(r.worstLevel, 12);

    // No other assignment of the non-cursor bits does worse.
    const n = taps.length;
    for (let mask = 0; mask < 1 << n; mask++) {
      const trial = new Float64Array(n);
      for (let k = 0; k < n; k++) trial[k] = (mask >> k) & 1 ? 1 : -1;
      if (trial[cursorIdx] !== 1) continue;
      let v = 0;
      for (let i = 0; i < n; i++) {
        const m = i - cursorIdx;
        const k = cursorIdx - m;
        if (k >= 0 && k < n) v += trial[k] * taps[i];
      }
      expect(v).toBeGreaterThanOrEqual(r.worstLevel - 1e-12);
    }
  });

  it('attacking the zero level is the mirror image', () => {
    const taps = Float64Array.from([-0.1, 1.0, 0.3]);
    const one = worstCaseIsiPattern(taps, 1, 1);
    const zero = worstCaseIsiPattern(taps, 1, 0);
    for (let i = 0; i < 3; i++) expect(zero.bits[i]).toBe(one.bits[i] ^ 1);
    expect(zero.worstLevel).toBeCloseTo(-one.worstLevel, 12);
  });

  it('closes the eye further than a PRBS of practical length', () => {
    // The whole justification for having this pattern at all.
    const taps = Float64Array.from([0.03, -0.07, 0.8, 0.28, 0.1, -0.05]);
    const cursorIdx = 2;
    const wc = worstCaseIsiPattern(taps, cursorIdx, 1);

    const prbs = generateBits({ kind: 'prbs', prbs: 'prbs7' }, 127);
    const sym = bitsToNrz(prbs);
    let minOne = Infinity;
    for (let c = 10; c < prbs.length - 10; c++) {
      if (prbs[c] !== 1) continue;
      let v = 0;
      for (let i = 0; i < taps.length; i++) {
        const m = i - cursorIdx;
        v += sym[c - m] * taps[i];
      }
      minOne = Math.min(minOne, v);
    }
    expect(wc.worstLevel).toBeLessThanOrEqual(minOne + 1e-12);
  });

  it('rejects an out-of-range cursor', () => {
    expect(() => worstCaseIsiPattern(Float64Array.from([1, 2]), 5)).toThrow();
  });

  it('generateBits falls back to a clock when no pulse response is supplied', () => {
    const b = generateBits({ kind: 'worst-case-isi' }, 8);
    expect(Array.from(b)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it('generateBits uses the supplied pulse response when it is available', () => {
    const taps = Float64Array.from([-0.1, 1.0, 0.3]);
    const b = generateBits({ kind: 'worst-case-isi' }, 6, { cursorTaps: taps, cursorIndex: 1 });
    expect(Array.from(b)).toEqual([0, 1, 1, 0, 1, 1]);
  });
});

describe('symbol mapping', () => {
  it('NRZ maps 1 to +1 and 0 to -1', () => {
    expect(Array.from(bitsToNrz(Uint8Array.from([1, 0, 1, 1, 0])))).toEqual([1, -1, 1, 1, -1]);
  });

  it('PAM4 uses a Gray map so adjacent levels differ in one bit', () => {
    const bits = Uint8Array.from([0, 0, 0, 1, 1, 1, 1, 0]);
    const sym = bitsToPam4(bits);
    expect(sym.length).toBe(4);
    expect(sym[0]).toBeCloseTo(-1, 12);
    expect(sym[1]).toBeCloseTo(-1 / 3, 12);
    expect(sym[2]).toBeCloseTo(1 / 3, 12);
    expect(sym[3]).toBeCloseTo(1, 12);
  });

  it('PAM4 levels are evenly spaced, which is where the 9.5 dB SNR penalty comes from', () => {
    const sym = bitsToPam4(Uint8Array.from([0, 0, 0, 1, 1, 1, 1, 0]));
    const d1 = sym[1] - sym[0];
    const d2 = sym[2] - sym[1];
    const d3 = sym[3] - sym[2];
    expect(d1).toBeCloseTo(d2, 12);
    expect(d2).toBeCloseTo(d3, 12);
    // Eye height is one third of NRZ: 20*log10(3) = 9.54 dB.
    expect(20 * Math.log10(2 / d1)).toBeCloseTo(9.542, 3);
  });
});

describe('pattern descriptions', () => {
  it('every menu entry has a label, and a purpose that is not boilerplate', () => {
    for (const spec of PATTERN_MENU) {
      const info = describePattern(spec);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.purpose.length).toBeGreaterThan(30);
    }
  });

  it('reports the correct PRBS period', () => {
    expect(describePattern({ kind: 'prbs', prbs: 'prbs7' }).period).toBe(127);
    expect(describePattern({ kind: 'prbs', prbs: 'prbs31' }).period).toBe(2147483647);
  });
});
