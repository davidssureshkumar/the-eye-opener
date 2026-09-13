import { describe, expect, it } from 'vitest';
import {
  accumulate,
  bestSamplingPoint,
  binToUi,
  binToVoltage,
  clearEyeHistogram,
  eyeHeightAt,
  eyeToRgba,
  eyeWidthAt,
  horizontalSlice,
  makeEyeHistogram,
  mergeEyeHistogram,
  verticalSlice,
  type EyeHistogram,
} from '../density-eye';

/**
 * An ideal trapezoidal NRZ waveform: the reference case where every measurement has
 * a closed-form answer. Amplitude +/-0.5 V, a linear edge of `riseUi` unit intervals
 * centred on each symbol boundary.
 */
function trapezoid(bits: number[], samplesPerUi: number, riseUi: number, amp = 0.5): Float64Array {
  const n = bits.length * samplesPerUi;
  const y = new Float64Array(n);
  const half = (riseUi * samplesPerUi) / 2;
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / samplesPerUi);
    const level = bits[k] ? amp : -amp;
    const into = i - k * samplesPerUi;
    if (into < half && k > 0) {
      const prev = bits[k - 1] ? amp : -amp;
      // Edge centred on the boundary: the second half of the transition.
      const t = (into + half) / (2 * half);
      y[i] = prev + (level - prev) * t;
    } else if (into >= samplesPerUi - half && k < bits.length - 1) {
      const nextLevel = bits[k + 1] ? amp : -amp;
      const t = (into - (samplesPerUi - half)) / (2 * half);
      y[i] = level + (nextLevel - level) * t;
    } else {
      y[i] = level;
    }
  }
  return y;
}

function alternating(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i % 2);
}

function totalHits(h: EyeHistogram): number {
  let sum = 0;
  for (let i = 0; i < h.counts.length; i++) sum += h.counts[i];
  return sum;
}

describe('histogram geometry', () => {
  it('allocates one bin per cell and starts empty', () => {
    const h = makeEyeHistogram(64, 32, 2, -1, 1);
    expect(h.counts.length).toBe(64 * 32);
    expect(totalHits(h)).toBe(0);
    expect(h.peak).toBe(0);
    expect(h.total).toBe(0);
  });

  it('maps bin rows to voltages with row 0 at the top', () => {
    const h = makeEyeHistogram(10, 101, 2, -1, 1);
    expect(binToVoltage(h, 0)).toBeCloseTo(1, 12);
    expect(binToVoltage(h, 50)).toBeCloseTo(0, 12);
    expect(binToVoltage(h, 100)).toBeCloseTo(-1, 12);
  });

  it('maps bin columns to unit intervals across the folded window', () => {
    const h = makeEyeHistogram(100, 10, 2, -1, 1);
    expect(binToUi(h, 0)).toBe(0);
    expect(binToUi(h, 50)).toBe(1);
  });

  it('clears back to empty', () => {
    const h = makeEyeHistogram(16, 16, 2, -1, 1);
    accumulate(h, new Float64Array(64).fill(0.2), 8);
    expect(totalHits(h)).toBeGreaterThan(0);
    clearEyeHistogram(h);
    expect(totalHits(h)).toBe(0);
    expect(h.peak).toBe(0);
  });
});

describe('accumulation', () => {
  it('puts a DC level in exactly one row', () => {
    const h = makeEyeHistogram(32, 101, 2, -1, 1);
    accumulate(h, new Float64Array(320).fill(0), 16);
    for (let iy = 0; iy < h.ny; iy++) {
      let row = 0;
      for (let ix = 0; ix < h.nx; ix++) row += h.counts[iy * h.nx + ix];
      // Row 50 is 0 V; everything else must be untouched.
      if (iy === 50) expect(row).toBeGreaterThan(0);
      else expect(row).toBe(0);
    }
  });

  it('counts one accumulated sample per input sample', () => {
    const h = makeEyeHistogram(32, 33, 2, -1, 1);
    accumulate(h, new Float64Array(256).fill(0.25), 16);
    expect(h.total).toBe(256);
  });

  it('tracks the peak bin count', () => {
    const h = makeEyeHistogram(32, 33, 2, -1, 1);
    accumulate(h, new Float64Array(320).fill(0), 16);
    let peak = 0;
    for (let i = 0; i < h.counts.length; i++) peak = Math.max(peak, h.counts[i]);
    expect(h.peak).toBe(peak);
    expect(h.peak).toBeGreaterThan(1);
  });

  it('ignores non-finite samples', () => {
    const h = makeEyeHistogram(32, 33, 2, -1, 1);
    const y = new Float64Array(64).fill(0);
    y[10] = Number.NaN;
    accumulate(h, y, 16);
    expect(h.total).toBe(63);
  });

  it('does nothing useful with a degenerate voltage window rather than crashing', () => {
    const h = makeEyeHistogram(32, 33, 2, 0, 0);
    accumulate(h, new Float64Array(64).fill(0), 16);
    expect(totalHits(h)).toBe(0);
  });

  /**
   * The fold boundary. A sample that wraps back to the left edge of the window is a
   * new trace starting, not a transition: joining across it would draw a line all the
   * way back across the eye and fill the opening with hits that never happened.
   */
  it('does not draw a segment across the fold boundary', () => {
    const h = makeEyeHistogram(64, 101, 2, -1, 1);
    // A ramp from -0.9 to +0.9 over exactly one window, so the wrap is a big jump.
    const samplesPerUi = 32;
    const n = samplesPerUi * 4;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) y[i] = -0.9 + (1.8 * (i % (samplesPerUi * 2))) / (samplesPerUi * 2);
    accumulate(h, y, samplesPerUi);
    // Column 0 is where the wrap lands. If a segment were drawn across the fold it
    // would deposit hits down the whole height of that column.
    let col0 = 0;
    for (let iy = 0; iy < h.ny; iy++) if (h.counts[iy * h.nx] > 0) col0++;
    expect(col0).toBeLessThan(5);
  });

  it('joins consecutive samples so a fast edge has no gaps', () => {
    const h = makeEyeHistogram(64, 201, 2, -1, 1);
    // Two samples, far apart vertically, adjacent in time: a near-vertical edge.
    const y = new Float64Array([-0.9, 0.9, 0.9, 0.9]);
    accumulate(h, y, 2);
    // Every row between the two levels must have been visited by the joining segment.
    let visited = 0;
    for (let iy = 0; iy < h.ny; iy++) {
      for (let ix = 0; ix < h.nx; ix++) {
        if (h.counts[iy * h.nx + ix] > 0) {
          visited++;
          break;
        }
      }
    }
    // -0.9 V to +0.9 V over a 201-bin span of 2 V is 181 rows, all of which the
    // segment must touch. Without the join there would be a handful.
    expect(visited).toBeGreaterThan(150);
  });

  it('shifts the eye horizontally with phase, without regenerating the waveform', () => {
    const bits = alternating(64);
    const y = trapezoid(bits, 16, 0.2);
    const a = makeEyeHistogram(64, 65, 2, -1, 1);
    const b = makeEyeHistogram(64, 65, 2, -1, 1);
    accumulate(a, y, 16, 0);
    accumulate(b, y, 16, 0.5);
    // The same total hits, redistributed: a phase shift moves the picture, it does
    // not create or destroy samples.
    expect(b.total).toBe(a.total);
    expect(Array.from(b.counts)).not.toEqual(Array.from(a.counts));
  });

  it('merges partial histograms from parallel workers', () => {
    const y = trapezoid(alternating(32), 16, 0.2);
    const whole = makeEyeHistogram(32, 65, 2, -1, 1);
    const p1 = makeEyeHistogram(32, 65, 2, -1, 1);
    const p2 = makeEyeHistogram(32, 65, 2, -1, 1);
    accumulate(whole, y, 16);
    accumulate(p1, y, 16);
    accumulate(p2, y, 16);
    mergeEyeHistogram(p1, p2);
    expect(p1.total).toBe(whole.total * 2);
    expect(p1.peak).toBe(whole.peak * 2);
  });

  it('refuses to merge histograms of different geometry', () => {
    const a = makeEyeHistogram(32, 32, 2, -1, 1);
    const b = makeEyeHistogram(16, 32, 2, -1, 1);
    expect(() => mergeEyeHistogram(a, b)).toThrow(/geometry/);
  });
});

describe('slices', () => {
  it('takes a vertical slice of the right length', () => {
    const h = makeEyeHistogram(32, 65, 2, -1, 1);
    accumulate(h, new Float64Array(320).fill(0.5), 16);
    const slice = verticalSlice(h, 1);
    expect(slice.length).toBe(65);
    expect(slice.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('takes a horizontal slice of the right length', () => {
    const h = makeEyeHistogram(32, 65, 2, -1, 1);
    accumulate(h, new Float64Array(320).fill(0), 16);
    const slice = horizontalSlice(h, 0);
    expect(slice.length).toBe(32);
    expect(slice.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('clamps a slice request outside the window to the edge', () => {
    const h = makeEyeHistogram(32, 65, 2, -1, 1);
    expect(verticalSlice(h, 99).length).toBe(65);
    expect(horizontalSlice(h, 99).length).toBe(32);
  });
});

describe('eye measurements on an ideal waveform', () => {
  /**
   * A jitter-free trapezoidal NRZ signal, where every measurement has a closed-form
   * answer:
   *
   *  - Eye height at the centre is the full peak-to-peak swing, because there is no
   *    noise and both rails are flat.
   *  - Eye width at the threshold voltage is one FULL unit interval. That surprises
   *    people who expect 1 UI minus the rise time, but the width at the threshold is
   *    set by the spread of the threshold crossings, and with no jitter every edge
   *    crosses at exactly the same instant. Rise time closes the eye vertically at a
   *    given horizontal offset; it does not move the crossings. What opens the
   *    crossing region up is jitter, and that is the point of the measurement.
   */
  const samplesPerUi = 64;
  const riseUi = 0.2;
  const amp = 0.5;

  /** Deterministic pseudo-random data, so every column of the eye sees both rails. */
  function randomBits(count: number, seed = 2024): number[] {
    let s = seed;
    return Array.from({ length: count }, () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return (s >> 16) & 1;
    });
  }

  function idealEye(): EyeHistogram {
    const h = makeEyeHistogram(256, 257, 2, -0.75, 0.75);
    // Phase 0 puts the symbol boundaries at the window edges and at its centre, so
    // the two eye openings straddle the half-UI points: the conventional view.
    accumulate(h, trapezoid(randomBits(400), samplesPerUi, riseUi, amp), samplesPerUi, 0);
    return h;
  }

  it('measures an eye height equal to the full swing', () => {
    const h = idealEye();
    const best = bestSamplingPoint(h, 0);
    expect(best).not.toBeNull();
    if (!best) return;
    const binV = (h.vMax - h.vMin) / (h.ny - 1);
    // The opening is bounded by the outermost occupied bins, so it falls short of the
    // full 1.0 V swing by at most a bin at each rail.
    expect(best.opening.height).toBeGreaterThan(2 * amp - 4 * binV);
    expect(best.opening.height).toBeLessThanOrEqual(2 * amp);
  });

  it('centres the opening on the rails, symmetric about the threshold', () => {
    const h = idealEye();
    const best = bestSamplingPoint(h, 0);
    expect(best).not.toBeNull();
    if (!best) return;
    expect(best.opening.vTop).toBeCloseTo(amp, 1);
    expect(best.opening.vBottom).toBeCloseTo(-amp, 1);
  });

  it('places the widest opening at the half-UI point', () => {
    const h = idealEye();
    const best = bestSamplingPoint(h, 0);
    expect(best).not.toBeNull();
    if (!best) return;
    // The window spans 2 UI, so the two openings sit at 0.5 and 1.5.
    expect(Math.abs((best.uiPosition % 1) - 0.5)).toBeLessThan(0.1);
  });

  it('measures a full unit interval of eye width with no jitter present', () => {
    const h = idealEye();
    const w = eyeWidthAt(h, 0);
    expect(w).not.toBeNull();
    if (!w) return;
    // One UI to within a bin or two. See the note above: this is a jitter measurement,
    // not a rise-time measurement.
    expect(w.ui).toBeGreaterThan(0.97);
    expect(w.ui).toBeLessThanOrEqual(1.02);
  });

  it('narrows the crossing region measurement when jitter is added', () => {
    // The same signal, but each symbol boundary displaced by a deterministic dither.
    // Spreading the crossings is precisely what closes an eye horizontally.
    const clean = idealEye();
    const jittered = makeEyeHistogram(256, 257, 2, -0.75, 0.75);
    const bits = randomBits(400);
    let s = 99;
    for (let pass = 0; pass < 8; pass++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const shift = (s / 0x7fffffff - 0.5) * 0.25; // +/- 0.125 UI of jitter
      accumulate(jittered, trapezoid(bits, samplesPerUi, riseUi, amp), samplesPerUi, shift);
    }
    const before = eyeWidthAt(clean, 0);
    const after = eyeWidthAt(jittered, 0);
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (!before || !after) return;
    expect(after.ui).toBeLessThan(before.ui - 0.05);
  });

  it('reports no opening at a threshold that sits on a signal level', () => {
    const h = idealEye();
    // The high rail itself is dense with hits, so there is no vertical gap there.
    expect(eyeHeightAt(h, 1, amp)).toBeNull();
  });

  it('refuses to report an opening that runs off the top of the window', () => {
    // A window far larger than the signal: the "opening" above the high rail reaches
    // the edge of the plot, which measures the window, not the eye.
    const h = makeEyeHistogram(128, 129, 2, -5, 5);
    accumulate(h, trapezoid(randomBits(200), samplesPerUi, riseUi, amp), samplesPerUi, 0);
    expect(eyeHeightAt(h, 0.5, 4)).toBeNull();
  });

  it('finds no eye at all in a closed eye', () => {
    // Uniform noise filling the whole window: every bin is hit, nothing is open.
    const h = makeEyeHistogram(64, 65, 2, -1, 1);
    let seed = 7;
    const n = 64 * 400;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      y[i] = (seed / 0x7fffffff) * 1.8 - 0.9;
    }
    accumulate(h, y, 64);
    expect(eyeHeightAt(h, 1, 0)).toBeNull();
  });
});

describe('folding a periodic pattern', () => {
  /**
   * A trap worth encoding as a test, because it bites people at the bench too. An
   * alternating (clock) pattern has a period of exactly 2 UI. Fold it over a 2 UI
   * window and every trace lands on top of itself: what appears is one period of the
   * waveform, not an eye. Fold the same data over 1 UI and the two bits overlay,
   * and a real eye appears. This is why scopes default their eye display to 1 UI
   * unless the pattern is known to be aperiodic.
   */
  const samplesPerUi = 64;
  const clock = Array.from({ length: 200 }, (_, i) => i % 2);

  it('shows only one trace per column when the window matches the pattern period', () => {
    const h = makeEyeHistogram(256, 257, 2, -0.75, 0.75);
    accumulate(h, trapezoid(clock, samplesPerUi, 0.2, 0.5), samplesPerUi, 0);
    // Mid-bit columns carry exactly one occupied row: a single level, no overlay.
    const slice = verticalSlice(h, 0.5);
    const occupied = Array.from(slice).filter((c) => c > 0).length;
    expect(occupied).toBe(1);
  });

  it('produces a real eye when the same data is folded over one unit interval', () => {
    const h = makeEyeHistogram(256, 257, 1, -0.75, 0.75);
    accumulate(h, trapezoid(clock, samplesPerUi, 0.2, 0.5), samplesPerUi, 0);
    const slice = verticalSlice(h, 0.5);
    const occupied = Array.from(slice).filter((c) => c > 0).length;
    // Both rails now land in the same column.
    expect(occupied).toBe(2);
    const opening = eyeHeightAt(h, 0.5, 0);
    expect(opening).not.toBeNull();
    expect(opening?.height ?? 0).toBeGreaterThan(0.9);
  });
});

describe('rendering to pixels', () => {
  it('emits one RGBA quad per bin', () => {
    const h = makeEyeHistogram(16, 8, 2, -1, 1);
    expect(eyeToRgba(h).length).toBe(16 * 8 * 4);
  });

  it('leaves empty bins fully transparent so the graticule shows through', () => {
    const h = makeEyeHistogram(4, 4, 2, -1, 1);
    h.counts[0] = 10;
    h.peak = 10;
    const rgba = eyeToRgba(h);
    expect(rgba[3]).toBeGreaterThan(0);
    for (let i = 1; i < 16; i++) expect(rgba[i * 4 + 3]).toBe(0);
  });

  /**
   * Log scaling is the default for a reason: the rare outer skirts of an eye are
   * several decades below the core, and on a linear scale they render as nothing.
   * That is exactly where the bit errors live.
   */
  it('lifts a rare bin far more under log scaling than linear', () => {
    const h = makeEyeHistogram(2, 1, 2, -1, 1);
    h.counts[0] = 100000;
    h.counts[1] = 3;
    h.peak = 100000;
    const linear = eyeToRgba(h, { scaling: 'linear' });
    const log = eyeToRgba(h, { scaling: 'log' });
    expect(linear[4 + 3]).toBe(0);
    expect(log[4 + 3]).toBeGreaterThan(60);
  });

  it('drops bins at or below the floor', () => {
    const h = makeEyeHistogram(2, 1, 2, -1, 1);
    h.counts[0] = 50;
    h.counts[1] = 1;
    h.peak = 50;
    const rgba = eyeToRgba(h, { floor: 1 });
    expect(rgba[3]).toBeGreaterThan(0);
    expect(rgba[4 + 3]).toBe(0);
  });
});
