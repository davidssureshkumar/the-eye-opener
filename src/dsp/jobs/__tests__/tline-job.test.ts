/**
 * The M3 job, against the lattice arithmetic a reader can do on paper.
 *
 * The default Scenario is a 40 ohm driver into 150 mm of 50 ohm line with 1 Mohm
 * at the far end, which is open to four digits. That gives closed forms for every
 * plateau: the launch is 5/9 of the swing, the open end doubles it to 10/9, the
 * driver's -1/9 reflection brings the far end back to 80/81, and so on. The
 * plateau assertions are to three digits for that reason. The job measures these off a simulated,
 * band-limited waveform; the tests check that what it measured is what the
 * arithmetic says, which is a check on the grid, the edge shaping, the offset
 * superposition and the measurement together.
 */

import { describe, expect, it } from 'vitest';
import { runJob, TDR_REFERENCE_OHMS, type TlineResult } from '../index';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import { launchVoltage, propagationDelay, steadyStateVoltage } from '../../../sim/channel/tline';

type Tline = Scenario['channel']['tline'];

function scenario(line: Partial<Tline> = {}, source: Partial<Scenario['source']> = {}): Scenario {
  const s = defaultScenario();
  return {
    ...s,
    source: { ...s.source, ...source },
    channel: { ...s.channel, tline: { ...s.channel.tline, ...line } },
  };
}

/** The value of `y` at time `seconds` after the step. */
function at(r: TlineResult, y: Float64Array, seconds: number): number {
  return y[Math.min(y.length - 1, r.stepIndex + Math.round(seconds / r.dt))];
}

describe('tline job, on the default Scenario', () => {
  const s = scenario();
  const r = runJob('tline', s);
  const swing = s.source.amplitude;
  const td = propagationDelay(s.channel.tline);

  it('makes the delay a whole number of samples and says how close that is', () => {
    expect(Math.abs(r.delayError)).toBeLessThan(1e-9 * td);
    expect(r.delay).toBeCloseTo(td, 18);
    expect(r.samplesPerRise).toBeGreaterThan(4);
  });

  it('launches 5/9 of the swing and holds it until the reflection returns', () => {
    expect(r.launch).toBeCloseTo((5 / 9) * swing, 12);
    expect(at(r, r.near, td) - r.initialLevel).toBeCloseTo(launchVoltage(swing, 40, 50), 6);
  });

  it('shows the far end nothing until the edge has had time to arrive', () => {
    // The launched edge is zero-phase, so it begins a few rise times before its
    // nominal arrival. Earlier than that there is nothing, to rounding.
    const tr = s.source.riseTime;
    for (let i = 0; i < r.t.length && r.t[i] < td - 8 * tr; i++) {
      expect(Math.abs(r.far[i] - r.initialLevel)).toBeLessThan(1e-6 * swing);
    }
  });

  it('puts the far-end plateaus where the lattice says', () => {
    // 10/9 after the first arrival, 80/81 after the second.
    const step = r.finalLevel - r.initialLevel;
    expect((at(r, r.far, 2 * td) - r.initialLevel) / swing).toBeCloseTo(10 / 9, 3);
    expect((at(r, r.far, 4 * td) - r.initialLevel) / swing).toBeCloseTo(80 / 81, 3);
    expect(r.overshoot).toBeCloseTo((10 / 9 - step / swing) / (step / swing), 3);
    expect(r.ringback).toBeCloseTo((step / swing - 80 / 81) / (step / swing), 3);
  });

  it('agrees with its own bounce diagram at every far-end plateau', () => {
    for (const e of r.bounce.events.filter((ev) => ev.end === 'far' && ev.time < 9 * td)) {
      expect(at(r, r.far, e.time + 0.5 * td)).toBeCloseTo(r.initialLevel + e.level, 4);
    }
  });

  it('settles at the resistive divider, which has no Z0 in it', () => {
    expect(r.finalLevel).toBeCloseTo(steadyStateVoltage(s.source.dcOffset + swing / 2, 40, 1e6), 12);
    expect(r.far[r.far.length - 1]).toBeCloseTo(r.finalLevel, 4);
    expect(r.settled).toBe(true);
  });

  it('runs a TDR that reads the line exactly', () => {
    expect(r.tdrZ.length).toBe(r.t.length);
    expect(r.tdrLine).toBeCloseTo(50, 6);
    // Before the step, the instrument sees its own reference.
    expect(r.tdrZ[0]).toBeCloseTo(TDR_REFERENCE_OHMS, 6);
  });
});

describe('tline job, across terminations', () => {
  it('shows no overshoot, no ringback and nothing on the TDR for a matched link', () => {
    const r = runJob('tline', scenario({ loadZ: 50 }, { sourceZ: 50 }));
    expect(r.gammaSource).toBe(0);
    expect(r.gammaLoad).toBe(0);
    expect(r.overshoot).toBeLessThan(1e-6);
    expect(r.ringback).toBeLessThan(1e-6);
    expect(r.tdrLoad).toBeCloseTo(50, 6);
  });

  it('reads a mismatched line exactly and the load behind it through the TDR', () => {
    const r = runJob('tline', scenario({ z0: 50, loadZ: 75 }));
    expect(r.tdrLine).toBeCloseTo(50, 6);
    expect(r.tdrLoad).toBeCloseTo(75, 6);
    const off = runJob('tline', scenario({ z0: 40, loadZ: 75 }));
    // The line is the first discontinuity and reads exactly; see the tline tests
    // for why the load then reads 73.38 rather than 75.
    expect(off.tdrLine).toBeCloseTo(40, 6);
    expect(off.tdrLoad).toBeCloseTo(73.3775, 3);
  });

  it('shows a capacitive load as a notch on the TDR and a slower far-end edge', () => {
    const plain = runJob('tline', scenario({ loadZ: 50, loadC: 0 }, { sourceZ: 50 }));
    const loaded = runJob('tline', scenario({ loadZ: 50, loadC: 2e-12 }, { sourceZ: 50 }));
    const td = plain.delay;
    const window = (r: TlineResult): number => {
      let lo = Infinity;
      for (let i = 0; i < r.t.length; i++)
        if (r.t[i] > 1.8 * td && r.t[i] < 2.5 * td) lo = Math.min(lo, r.tdrZ[i]);
      return lo;
    };
    expect(window(plain)).toBeGreaterThan(49);
    expect(window(loaded)).toBeLessThan(40);
    const mid = (r: TlineResult): number => {
      const half = (r.initialLevel + r.finalLevel) / 2;
      for (let i = 0; i < r.far.length; i++) if (r.far[i] >= half) return r.t[i];
      return NaN;
    };
    expect(mid(loaded)).toBeGreaterThan(mid(plain));
  });

  it('shifts both ends by the divided offset, not by the offset itself', () => {
    const a = runJob('tline', scenario({ loadZ: 60 }, { dcOffset: 0 }));
    const b = runJob('tline', scenario({ loadZ: 60 }, { dcOffset: 0.3 }));
    const shift = steadyStateVoltage(0.3, 40, 60);
    for (const i of [0, 100, 2000, a.t.length - 1]) {
      expect(b.near[i] - a.near[i]).toBeCloseTo(shift, 9);
      expect(b.far[i] - a.far[i]).toBeCloseTo(shift, 9);
    }
  });

  it('covers the whole edge on a line far shorter than it', () => {
    const r = runJob('tline', scenario({ length: 1e-3 }));
    const span = r.t[r.t.length - 1];
    expect(span).toBeGreaterThanOrEqual(39 * defaultScenario().source.riseTime);
    expect(Number.isFinite(r.delayError)).toBe(true);
    expect(r.far[r.far.length - 1]).toBeCloseTo(r.finalLevel, 4);
  });

  it('stays within the sample ceiling for the longest line the Scenario allows', () => {
    const r = runJob('tline', scenario({ length: 100, velocityFactor: 0.1 }));
    expect(r.t.length).toBeLessThanOrEqual(1 << 18);
    for (const v of [r.overshoot, r.ringback, r.settling2pct, r.tdrLine, r.tdrLoad]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('returns an empty TDR when it is not asked for one', () => {
    const r = runJob('tline', scenario(), { includeTdr: false });
    expect(r.tdrZ.length).toBe(0);
  });
});
