/**
 * Jobs are pure functions, and these are the tests that claim is worth making.
 *
 * Three kinds of assertion here. Contract tests that apply to every job, driven
 * off the registry, so a job added later cannot quietly skip them. Physics tests
 * that pin a job's numbers to a closed form or a known limit - the Wilbraham-Gibbs
 * constant, the rise-time-bandwidth product, the sinc nulls of a held symbol -
 * rather than to whatever the code happened to produce first. And purity tests,
 * because a job that reads a clock or a global would pass every other test here
 * and still break the permalink.
 */

import { describe, expect, it } from 'vitest';
import {
  JOBS,
  JOB_KINDS,
  isJobKind,
  runJob,
  transferablesOf,
  type JobKind,
  type JobProgress,
} from '../index';
import { edgeResponseOf, patternSpecOf, sampleRateOf, EDGE_REFERENCE_LEVELS } from '../adapt';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import { GIBBS_OVERSHOOT_OF_JUMP } from '../../fourier';
import { riseTimeBandwidthProduct } from '../../filters';

/** A Scenario with the named fields overridden, still fully valid. */
function withSource(over: Partial<Scenario['source']>): Scenario {
  const s = defaultScenario();
  return { ...s, source: { ...s.source, ...over } };
}

function collectProgress(): { report: (p: JobProgress) => void; ticks: JobProgress[] } {
  const ticks: JobProgress[] = [];
  return { report: (p) => ticks.push(p), ticks };
}

/* --------------------------------------------------------------- the registry */

describe('the job registry', () => {
  it('names every job once, and the key matches the job', () => {
    for (const kind of JOB_KINDS) {
      expect(JOBS[kind].kind).toBe(kind);
    }
    expect(new Set(JOB_KINDS).size).toBe(JOB_KINDS.length);
  });

  it('recognises its own kinds and nothing else', () => {
    for (const kind of JOB_KINDS) expect(isJobKind(kind)).toBe(true);
    expect(isJobKind('eye-diagram')).toBe(false);
    expect(isJobKind('')).toBe(false);
    // Not fooled by inherited properties: a message could name any string.
    expect(isJobKind('toString')).toBe(false);
    expect(isJobKind('constructor')).toBe(false);
  });

  it('runs every job on the default Scenario without throwing', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      expect(() => runJob(kind, s, smallParams(kind))).not.toThrow();
    }
  });

  it('gives every job defaults that are enough to run it', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      // No params at all: the defaults alone must be a complete input. The
      // spectrum and waveform defaults are large, so those two are exercised at
      // their real size only here.
      expect(() => runJob(kind, s, {})).not.toThrow();
    }
  });
});

/** Parameters small enough to run every job in a loop without a slow test. */
function smallParams(kind: JobKind): Record<string, unknown> {
  switch (kind) {
    case 'fourier':
      return { samples: 512, maxN: 15 };
    case 'waveform':
      return { uis: 8 };
    case 'spectrum':
      return { uis: 8 };
    case 'pattern':
      return { bits: 256 };
    case 'edge':
      return { samples: 512 };
    default:
      return {};
  }
}

/* -------------------------------------------------------------------- purity */

describe('jobs are pure functions', () => {
  it('returns equal results for equal inputs', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      const a = runJob(kind, s, smallParams(kind));
      const b = runJob(kind, s, smallParams(kind));
      expect(a).toEqual(b);
    }
  });

  it('does not mutate the Scenario it was given', () => {
    const s = defaultScenario();
    const before = JSON.stringify(s);
    for (const kind of JOB_KINDS) runJob(kind, s, smallParams(kind));
    expect(JSON.stringify(s)).toBe(before);
  });

  it('produces only finite numbers', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      const result = runJob(kind, s, smallParams(kind)) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(result)) {
        if (value instanceof Float64Array) {
          const bad = [...value].findIndex((v) => !Number.isFinite(v));
          expect(bad, `${kind}.${key}[${bad}]`).toBe(-1);
        }
      }
    }
  });
});

/* ------------------------------------------------------------- transferables */

describe('transfer lists', () => {
  it('lists only buffers that are actually in the result', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      const result = runJob(kind, s, smallParams(kind)) as unknown as Record<string, unknown>;
      const owned = new Set(
        Object.values(result)
          .filter((v): v is ArrayBufferView => ArrayBuffer.isView(v))
          .map((v) => v.buffer),
      );
      // Arrays of arrays, like the per-harmonic traces, count too.
      for (const v of Object.values(result)) {
        if (Array.isArray(v)) {
          for (const item of v) if (ArrayBuffer.isView(item)) owned.add(item.buffer);
        }
      }
      for (const buffer of transferablesOf(kind, result as never)) {
        expect(owned.has(buffer), `${kind} transfers a buffer it does not own`).toBe(true);
      }
    }
  });

  it('never lists the same buffer twice, which would throw on postMessage', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      const result = runJob(kind, s, smallParams(kind));
      const list = transferablesOf(kind, result as never);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

/* ------------------------------------------------------------------ progress */

describe('progress reporting', () => {
  it('is optional: every job runs without a callback', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) expect(() => runJob(kind, s, smallParams(kind))).not.toThrow();
  });

  it('never goes backwards, even across a job that calls another job', () => {
    // The one rule of the progress contract: done/total is non-decreasing over a
    // run. The spectrum job generates its own waveform, and forwarding that
    // child's ticks verbatim would restart the bar partway through - which is
    // what this catches.
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      const { report, ticks } = collectProgress();
      runJob(kind, s, smallParams(kind), report);
      let last = -Infinity;
      for (const t of ticks) {
        expect(t.total, `${kind} reported a total of ${t.total}`).toBeGreaterThan(0);
        expect(t.done).toBeGreaterThanOrEqual(0);
        expect(t.done).toBeLessThanOrEqual(t.total);
        expect(t.label.length).toBeGreaterThan(0);
        const fraction = t.done / t.total;
        expect(fraction, `${kind} went backwards at "${t.label}"`).toBeGreaterThanOrEqual(last);
        last = fraction;
      }
    }
  });

  it('reaches the end of the bar when the job finishes', () => {
    const s = defaultScenario();
    for (const kind of JOB_KINDS) {
      const { report, ticks } = collectProgress();
      runJob(kind, s, smallParams(kind), report);
      if (ticks.length === 0) continue; // a job fast enough not to bother
      const final = ticks[ticks.length - 1];
      expect(final.done / final.total, kind).toBeGreaterThan(0.9);
    }
  });

  it('stays coarse: a long job does not report per sample', () => {
    const { report, ticks } = collectProgress();
    runJob('spectrum', defaultScenario(), { uis: 64 }, report);
    expect(ticks.length).toBeLessThan(200);
  });
});

/* ------------------------------------------------------------- fourier (M1) */

describe('the fourier job', () => {
  const s = defaultScenario();

  it('numbers harmonics against the fundamental of a 1010 stream, f_s/2', () => {
    const r = runJob('fourier', s, { samples: 1024, maxN: 9 });
    expect(r.f0).toBeCloseTo(s.source.symbolRate / 2, 6);
    expect(r.terms[0].frequency).toBeCloseTo(r.f0, 6);
    expect(r.highestFrequency).toBeCloseTo(9 * r.f0, 6);
  });

  it('spans exactly one period of the fundamental', () => {
    const r = runJob('fourier', s, { samples: 1024 });
    const dt = r.t[1] - r.t[0];
    expect(r.t[r.t.length - 1] + dt).toBeCloseTo(1 / r.f0, 15);
  });

  it('gives a square wave odd harmonics rolling off at 1/n', () => {
    const r = runJob('fourier', s, { shape: 'square', maxN: 9, samples: 512 });
    expect(r.terms.map((h) => h.n)).toEqual([1, 3, 5, 7, 9]);
    // -20 dB/decade: the third harmonic is 20*log10(3) below the first.
    expect(r.terms[1].relativeDb).toBeCloseTo(-20 * Math.log10(3), 12);
    expect(r.terms[0].relativeDb).toBe(0);
  });

  it('measures the overshoot that does not go away', () => {
    const coarse = runJob('fourier', s, { maxN: 11, samples: 8192 });
    const fine = runJob('fourier', s, { maxN: 101, samples: 8192 });
    // Both within a whisker of the Wilbraham-Gibbs limit, and neither smaller
    // than the other in any way that matters. This is the point of M1.
    expect(coarse.overshoot.fractionOfJump).toBeCloseTo(GIBBS_OVERSHOOT_OF_JUMP, 2);
    expect(fine.overshoot.fractionOfJump).toBeCloseTo(GIBBS_OVERSHOOT_OF_JUMP, 3);
    expect(fine.gibbsLimit).toBe(GIBBS_OVERSHOOT_OF_JUMP);
  });

  it('shows the RMS error falling even though the overshoot does not', () => {
    const coarse = runJob('fourier', s, { maxN: 5, samples: 4096 });
    const fine = runJob('fourier', s, { maxN: 51, samples: 4096 });
    expect(fine.rmsError).toBeLessThan(coarse.rmsError);
    // Convergence in the mean: the lobe narrows, so it carries less energy.
    expect(fine.rmsError).toBeLessThan(0.5 * coarse.rmsError);
  });

  it('migrates the overshoot peak toward the edge as harmonics are added', () => {
    const coarse = runJob('fourier', s, { maxN: 5, samples: 4096 });
    const fine = runJob('fourier', s, { maxN: 51, samples: 4096 });
    expect(fine.overshoot.peakIndex).toBeLessThan(coarse.overshoot.peakIndex);
  });

  it('sums the per-harmonic traces to the same partial sum', () => {
    const flat = runJob('fourier', s, { maxN: 9, samples: 256, perHarmonic: false });
    const split = runJob('fourier', s, { maxN: 9, samples: 256, perHarmonic: true });
    expect(split.each.length).toBe(split.terms.length);
    for (let i = 0; i < flat.y.length; i++) {
      expect(split.y[i]).toBeCloseTo(flat.y[i], 12);
    }
  });

  it('reduces a 50% pulse to the square wave, term for term', () => {
    const square = runJob('fourier', s, { shape: 'square', maxN: 15, samples: 512 });
    const pulse = runJob('fourier', s, { shape: 'pulse', duty: 0.5, maxN: 15, samples: 512 });
    for (let i = 0; i < square.y.length; i++) {
      expect(pulse.y[i]).toBeCloseTo(square.y[i], 10);
    }
  });

  it('compares the partial sum against the midpoint value at a jump', () => {
    // Dirichlet: the series converges to the midpoint, so the ideal is 0 there
    // and the error metric is not dominated by a discontinuity forever.
    const r = runJob('fourier', s, { shape: 'square', maxN: 31, samples: 512 });
    expect(r.ideal[0]).toBe(0);
    expect(r.ideal[256]).toBe(0);
    expect(r.ideal[128]).toBe(1);
    expect(r.ideal[384]).toBe(-1);
  });
});

/* ------------------------------------------------------------------ patterns */

describe('the pattern job', () => {
  it('measures a 1010 clock as fully transitioning and perfectly balanced', () => {
    const s = defaultScenario();
    s.source.pattern = { ...s.source.pattern, kind: 'clock', divN: 1 };
    const r = runJob('pattern', s, { bits: 1024 });
    expect(r.transitionDensity).toBeCloseTo(1, 12);
    expect(r.onesDensity).toBeCloseTo(0.5, 12);
    expect(r.longestRun).toBe(1);
    expect(Math.abs(r.maxDisparity)).toBeLessThanOrEqual(1);
  });

  it('measures a divided clock as half the transitions and twice the run', () => {
    const s = defaultScenario();
    s.source.pattern = { ...s.source.pattern, kind: 'clock-div-n', divN: 4 };
    const r = runJob('pattern', s, { bits: 1024 });
    expect(r.longestRun).toBe(4);
    expect(r.transitionDensity).toBeCloseTo(0.25, 2);
  });

  it('finds the longest run of a PRBS at its order, as the theory says', () => {
    const s = defaultScenario();
    s.source.pattern = { ...s.source.pattern, kind: 'prbs', prbs: 'prbs7', seed: 1 };
    // A maximal-length PRBS-n contains exactly one run of n ones and none longer.
    const r = runJob('pattern', s, { bits: 127 });
    expect(r.longestRun).toBe(7);
    expect(r.onesDensity).toBeCloseTo(64 / 127, 12);
  });

  it('reports the DC wander a long run produces', () => {
    const s = defaultScenario();
    s.source.pattern = { ...s.source.pattern, kind: 'all-ones' };
    const r = runJob('pattern', s, { bits: 64 });
    expect(r.maxDisparity).toBe(64);
    expect(r.transitionDensity).toBe(0);
    expect(r.longestRun).toBe(64);
  });

  it('maps NRZ bits to plus and minus one, and nothing between', () => {
    const r = runJob('pattern', defaultScenario(), { bits: 128 });
    expect(r.symbols.length).toBe(r.bits.length);
    for (const v of r.symbols) expect(Math.abs(v)).toBe(1);
  });

  it('maps PAM4 bit pairs to four levels, halving the symbol count', () => {
    const s = defaultScenario();
    s.source.levels = 'pam4';
    const r = runJob('pattern', s, { bits: 128 });
    expect(r.symbols.length).toBe(64);
    for (const v of r.symbols) expect([-1, -1 / 3, 1 / 3, 1]).toContainEqual(v);
  });

  it('accounts for every bit in the run-length histogram', () => {
    const r = runJob('pattern', defaultScenario(), { bits: 512 });
    const total = r.runLengths.reduce((acc, row) => acc + row.length * row.count, 0);
    expect(total).toBe(512);
    expect(r.runLengths.map((row) => row.length)).toEqual(
      [...r.runLengths.map((row) => row.length)].sort((a, b) => a - b),
    );
  });

  it('skips the quadratic autocorrelation unless asked', () => {
    const s = defaultScenario();
    expect(runJob('pattern', s, { bits: 128 }).autocorrelation.length).toBe(0);
    expect(runJob('pattern', s, { bits: 128, autocorrelation: true }).autocorrelation.length).toBe(128);
  });

  it('carries the pattern description through, so the UI states what it is', () => {
    const s = defaultScenario();
    s.source.pattern = { ...s.source.pattern, kind: 'lone-one', frame: 32 };
    const r = runJob('pattern', s, { bits: 256 });
    expect(r.info.label.length).toBeGreaterThan(0);
    expect(r.info.purpose.length).toBeGreaterThan(0);
    expect(r.info.period).toBe(32);
  });
});

/* ----------------------------------------------------------------- waveforms */

describe('the waveform job', () => {
  const s = defaultScenario();

  it('holds each symbol for exactly one unit interval', () => {
    const r = runJob('waveform', s, { uis: 8, shapeEdges: false });
    expect(r.sps).toBe(s.sampling.samplesPerUi);
    expect(r.ideal.length).toBe(8 * r.sps);
    for (let sym = 0; sym < 8; sym++) {
      const first = r.ideal[sym * r.sps];
      for (let k = 1; k < r.sps; k++) {
        expect(r.ideal[sym * r.sps + k]).toBe(first);
      }
    }
  });

  it('puts the symbols at the driver levels, peak-to-peak', () => {
    const r = runJob('waveform', s, { uis: 16, shapeEdges: false });
    const half = s.source.amplitude / 2;
    for (const v of r.ideal) expect(Math.abs(v - s.source.dcOffset)).toBeCloseTo(half, 12);
  });

  it('honours a DC offset without changing the swing', () => {
    const offset = withSource({ dcOffset: 0.3 });
    const r = runJob('waveform', offset, { uis: 16, shapeEdges: false });
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of r.ideal) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeCloseTo(offset.source.amplitude, 12);
    expect((hi + lo) / 2).toBeCloseTo(0.3, 12);
  });

  it('samples at the rate the Scenario implies', () => {
    const r = runJob('waveform', s, { uis: 4 });
    expect(r.sampleRate).toBe(sampleRateOf(s));
    expect(r.ui).toBeCloseTo(1 / s.source.symbolRate, 18);
    expect(r.t[1] - r.t[0]).toBeCloseTo(1 / r.sampleRate, 18);
  });

  it('leaves the ideal stream alone when edge shaping is off', () => {
    const r = runJob('waveform', s, { uis: 8, shapeEdges: false });
    for (let i = 0; i < r.ideal.length; i++) expect(r.shaped[i]).toBe(r.ideal[i]);
  });

  it('rounds the edges without moving the levels when shaping is on', () => {
    const r = runJob('waveform', s, { uis: 32, shapeEdges: true });
    // A settled bit in the middle of a run reaches its level; a transition does not.
    let differs = 0;
    for (let i = 0; i < r.ideal.length; i++) if (Math.abs(r.shaped[i] - r.ideal[i]) > 1e-6) differs++;
    expect(differs).toBeGreaterThan(0);
    expect(differs).toBeLessThan(r.ideal.length);
  });

  it('reports the bandwidth its edge corresponds to', () => {
    const r = runJob('waveform', s, { uis: 4 });
    expect(r.edgeBandwidth).toBeCloseTo(edgeResponseOf(s.source).bw, 6);
    expect(r.edgeBandwidth).toBeGreaterThan(0);
  });

  it('generates two bits per symbol for PAM4', () => {
    const pam4 = { ...s, source: { ...s.source, levels: 'pam4' as const } };
    const r = runJob('waveform', pam4, { uis: 8, shapeEdges: false });
    expect(r.bits.length).toBe(16);
    expect(r.symbols.length).toBe(8);
  });
});

/* ------------------------------------------------------------------ spectrum */

describe('the spectrum job', () => {
  const s = defaultScenario();

  it('nulls a held-symbol stream at every multiple of the symbol rate', () => {
    const r = runJob('spectrum', s, { uis: 256, source: 'ideal' });
    expect(r.nullFrequencies.length).toBeGreaterThan(0);
    expect(r.nullFrequencies[0]).toBeCloseTo(s.source.symbolRate, 6);
    expect(r.nullFrequencies[1]).toBeCloseTo(2 * s.source.symbolRate, 6);
    // Every null is inside the transformed band.
    for (const f of r.nullFrequencies) expect(f).toBeLessThanOrEqual(r.sampleRate / 2);
  });

  it('finds a deep notch at the first sinc null', () => {
    const s2 = defaultScenario();
    s2.scope.fftWindow = 'blackman-harris';
    const r = runJob('spectrum', s2, { uis: 512, source: 'ideal' });
    const df = r.resolutionBandwidth;
    const nullBin = Math.round(s2.source.symbolRate / df);
    // Averaged over a few bins either side, so the test does not depend on a
    // random bit sequence putting energy in one particular bin.
    const near = average(r.magDb, nullBin - 2, nullBin + 2);
    const inBand = average(r.magDb, 4, Math.round(nullBin / 4));
    expect(near).toBeLessThan(inBand - 10);
  });

  it('puts most of the power in the first lobe', () => {
    const r = runJob('spectrum', s, { uis: 256, source: 'ideal' });
    expect(r.powerInFirstLobe).toBeGreaterThan(0.85);
    expect(r.powerInFirstLobe).toBeLessThanOrEqual(1);
  });

  it('puts a 1010 clock at one line, at Nyquist', () => {
    const clock = defaultScenario();
    clock.source.pattern = { ...clock.source.pattern, kind: 'clock', divN: 1 };
    const r = runJob('spectrum', clock, { uis: 256, source: 'ideal' });
    expect(r.peakFrequency).toBeCloseTo(clock.source.symbolRate / 2, -6);
    // And that line is the peak, so a normalised display reads 0 dB there.
    expect(r.levelAtNyquist).toBeCloseTo(0, 6);
  });

  it('states the resolution bandwidth the record length bought', () => {
    const short = runJob('spectrum', s, { uis: 64, source: 'ideal' });
    const long = runJob('spectrum', s, { uis: 512, source: 'ideal' });
    expect(long.resolutionBandwidth).toBeLessThan(short.resolutionBandwidth);
    expect(short.resolutionBandwidth).toBeCloseTo(short.sampleRate / short.fftSize, 6);
  });

  it('reports the window it used and what that window costs', () => {
    const s2 = defaultScenario();
    s2.scope.fftWindow = 'flat-top';
    const r = runJob('spectrum', s2, { uis: 32 });
    expect(r.window).toBe('flat-top');
    expect(r.windowInfo.sidelobeDb).toBeLessThan(0);
    // ENBW is at least one bin for any window, and more than one for any taper.
    expect(r.enbw).toBeGreaterThan(r.resolutionBandwidth);
  });

  it('leaks less with a tapered window than with none', () => {
    const rect = defaultScenario();
    rect.scope.fftWindow = 'rectangular';
    rect.source.pattern = { ...rect.source.pattern, kind: 'clock', divN: 1 };
    const taper = { ...rect, scope: { ...rect.scope, fftWindow: 'blackman-harris' as const } };

    // Away from the single 1010 line, whatever is on screen is leakage.
    const a = runJob('spectrum', rect, { uis: 101, source: 'ideal' });
    const b = runJob('spectrum', taper, { uis: 101, source: 'ideal' });
    const floorA = average(a.magDb, 8, Math.round(a.magDb.length / 8));
    const floorB = average(b.magDb, 8, Math.round(b.magDb.length / 8));
    expect(floorB).toBeLessThan(floorA);
  });

  it('shows a shaped edge rolling off above the band the ideal one does not', () => {
    const ideal = runJob('spectrum', s, { uis: 128, source: 'ideal' });
    const shaped = runJob('spectrum', s, { uis: 128, source: 'shaped' });
    const top = Math.round(ideal.magDb.length * 0.8);
    const end = ideal.magDb.length - 1;
    expect(average(shaped.magDb, top, end)).toBeLessThan(average(ideal.magDb, top, end));
  });

  it('normalises to 0 dB at the peak, or reports the real level when told not to', () => {
    const norm = runJob('spectrum', s, { uis: 64, source: 'ideal', normalize: true });
    const raw = runJob('spectrum', s, { uis: 64, source: 'ideal', normalize: false });
    expect(norm.peakDb).toBe(0);
    expect(Math.max(...norm.magDb)).toBeCloseTo(0, 9);
    expect(raw.peakDb).toBeGreaterThan(-200);
    expect(Math.max(...raw.magDb)).toBeCloseTo(raw.peakDb, 9);
  });

  it('transforms a supplied signal instead of generating one', () => {
    const wf = runJob('waveform', s, { uis: 64, shapeEdges: false });
    const supplied = runJob('spectrum', s, {
      signal: wf.ideal,
      sampleRate: wf.sampleRate,
    });
    const generated = runJob('spectrum', s, { uis: 64, source: 'ideal' });
    expect(supplied.fftSize).toBe(generated.fftSize);
    for (let i = 0; i < supplied.magDb.length; i++) {
      expect(supplied.magDb[i]).toBeCloseTo(generated.magDb[i], 9);
    }
  });

  it('does not detach the signal it was handed', () => {
    const wf = runJob('waveform', s, { uis: 16, shapeEdges: false });
    const before = wf.ideal[0];
    runJob('spectrum', s, { signal: wf.ideal, sampleRate: wf.sampleRate });
    expect(wf.ideal.length).toBeGreaterThan(0);
    expect(wf.ideal[0]).toBe(before);
  });
});

function average(x: Float64Array, from: number, to: number): number {
  const lo = Math.max(0, from);
  const hi = Math.min(x.length - 1, to);
  let acc = 0;
  for (let i = lo; i <= hi; i++) acc += x[i];
  return acc / Math.max(1, hi - lo + 1);
}

/* ---------------------------------------------------------------------- edge */

describe('the edge job', () => {
  const s = defaultScenario();

  it('reproduces the rise time it was asked for', () => {
    const r = runJob('edge', s, { samples: 8192, spanInRiseTimes: 20 });
    // Within 2%: the record is finite and the measurement is interpolated, the
    // same two sources of error a scope has.
    expect(r.rise2080).toBeCloseTo(s.source.riseTime, 13);
    expect(Math.abs(r.rise2080 / s.source.riseTime - 1)).toBeLessThan(0.02);
  });

  it('reads the same edge differently under the two conventions', () => {
    const r = runJob('edge', s, { samples: 8192, spanInRiseTimes: 20 });
    expect(r.rise1090).toBeGreaterThan(r.rise2080);
    // 20-80% reads roughly 0.6x the 10-90% figure; quoting one as the other is a
    // real and common error, so the ratio is reported rather than assumed.
    expect(r.conventionRatio).toBeGreaterThan(0.5);
    expect(r.conventionRatio).toBeLessThan(0.8);
  });

  it('agrees with the closed-form rise-time-bandwidth product of its shape', () => {
    for (const shape of ['rc', 'gaussian', 'bessel'] as const) {
      const scenario = withSource({ edgeShape: shape });
      const r = runJob('edge', scenario, { samples: 16384, spanInRiseTimes: 24 });
      const expected = riseTimeBandwidthProduct(r.response) / r.response.bw;
      expect(Math.abs(r.rise1090 / expected - 1), shape).toBeLessThan(0.03);
    }
  });

  it('gives a single pole no overshoot and a brick wall a great deal', () => {
    const rc = runJob('edge', withSource({ edgeShape: 'rc' }), { samples: 8192 });
    const brick = runJob('edge', withSource({ edgeShape: 'brickwall' }), { samples: 8192 });
    expect(rc.overshoot).toBeLessThan(1e-3);
    // The same 8.9% Gibbs overshoot as M1, arriving from a filter this time.
    expect(brick.overshoot).toBeGreaterThan(0.05);
    expect(brick.settling2pct).toBeGreaterThan(rc.settling2pct);
  });

  it('keeps a Bessel edge nearly free of overshoot, which is why scopes use it', () => {
    const r = runJob('edge', withSource({ edgeShape: 'bessel' }), { samples: 8192 });
    expect(r.overshoot).toBeLessThan(0.02);
  });

  it('puts the transition at t = 0 and shows what came before it', () => {
    const r = runJob('edge', s, { samples: 1024 });
    expect(r.t[0]).toBeLessThan(0);
    expect(r.t[r.t.length - 1]).toBeGreaterThan(0);
    const atZero = r.t.findIndex((v) => v >= 0);
    expect(r.y[atZero]).toBeGreaterThan(r.y[0]);
  });

  it('states the knee frequency of the edge, not the bandwidth of the filter', () => {
    const r = runJob('edge', s, { samples: 8192, spanInRiseTimes: 20 });
    expect(r.kneeFrequency).toBeCloseTo(0.5 / r.rise1090, 3);
    // The two are related but not equal, and conflating them is the error the
    // separate readouts exist to prevent.
    expect(r.kneeFrequency).not.toBeCloseTo(r.bandwidth, -8);
  });

  it('slows the edge when the scope is put in series with it', () => {
    const slow = { ...s, scope: { ...s.scope, bandwidth: 8e9, responseShape: 'bessel' as const } };
    const r = runJob('edge', slow, { samples: 8192, spanInRiseTimes: 24, includeScope: true });
    expect(r.scopeLimited).toBeGreaterThan(r.rise2080);
    // Rise times add roughly in quadrature, so the measured edge is longer than
    // either contribution but shorter than their sum.
    const scopeRise =
      riseTimeBandwidthProduct({ type: 'bessel', bw: 8e9, order: 4 }, ...EDGE_REFERENCE_LEVELS) / 8e9;
    expect(r.scopeLimited).toBeLessThan(r.rise2080 + scopeRise);
    expect(r.scopeLimited).toBeGreaterThan(Math.max(r.rise2080, scopeRise));
  });

  it('leaves the measurement untouched when the scope is not in the path', () => {
    const r = runJob('edge', s, { samples: 1024, includeScope: false });
    expect(r.scopeLimited).toBeNull();
    for (let i = 0; i < r.y.length; i++) expect(r.measured[i]).toBe(r.y[i]);
  });
});

/* ------------------------------------------------------------------ adapters */

describe('scenario adapters', () => {
  it('carries every pattern field through to the generator', () => {
    const s = defaultScenario();
    s.source.pattern = {
      kind: 'custom',
      prbs: 'prbs15',
      seed: 7,
      divN: 3,
      frame: 24,
      burst: 5,
      custom: '1100',
      invert: true,
    };
    expect(patternSpecOf(s.source.pattern)).toEqual({
      kind: 'custom',
      prbs: 'prbs15',
      seed: 7,
      divN: 3,
      frame: 24,
      burst: 5,
      custom: '1100',
      invert: true,
    });
  });

  it('converts the 20-80% rise time to a bandwidth of the right shape', () => {
    for (const shape of ['rc', 'gaussian', 'bessel', 'brickwall'] as const) {
      const spec = edgeResponseOf(withSource({ edgeShape: shape, riseTime: 30e-12 }).source);
      expect(spec.type).toBe(shape);
      const [lo, hi] = EDGE_REFERENCE_LEVELS;
      expect(spec.bw).toBeCloseTo(riseTimeBandwidthProduct(spec, lo, hi) / 30e-12, 0);
    }
  });

  it('maps a linear ramp to the response that most resembles one', () => {
    // 'linear' is a ramp, not a filter: it has no transfer function, so it is
    // mapped rather than modelled, and the mapping is stated rather than implied.
    expect(edgeResponseOf(withSource({ edgeShape: 'linear' }).source).type).toBe('bessel');
  });

  it('halves the bandwidth when the rise time doubles', () => {
    const fast = edgeResponseOf(withSource({ riseTime: 20e-12 }).source);
    const slow = edgeResponseOf(withSource({ riseTime: 40e-12 }).source);
    expect(slow.bw).toBeCloseTo(fast.bw / 2, 6);
  });

  it('derives the simulation sample rate from the symbol rate and oversampling', () => {
    const s = defaultScenario();
    expect(sampleRateOf(s)).toBe(s.source.symbolRate * s.sampling.samplesPerUi);
  });
});
