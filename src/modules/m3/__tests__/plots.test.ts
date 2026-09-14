/**
 * M3's figures, checked against the lattice arithmetic they claim to show.
 *
 * Built from real `runJob('tline', ...)` results, as M1 and M2 are, so a figure and
 * the job cannot drift apart without a test noticing. Where a figure prints a
 * number, the assertion is against the closed form the module prints beside it.
 */

import { describe, expect, it } from 'vitest';
import { runJob, TDR_REFERENCE_OHMS, type TlineResult } from '../../../dsp/jobs';
import { validateChrome } from '../../../plots/chrome';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import { colorSequence, recorder, surfaceOf } from '../../../plots/__tests__/recorder';
import {
  latticeRender,
  latticeSegments,
  staircaseOf,
  tdrRender,
  waveformRender,
  type TdrOptions,
} from '../plots';

type Tline = Scenario['channel']['tline'];

function scenario(line: Partial<Tline> = {}, source: Partial<Scenario['source']> = {}): Scenario {
  const s = defaultScenario();
  return {
    ...s,
    source: { ...s.source, ...source },
    channel: { ...s.channel, tline: { ...s.channel.tline, ...line } },
  };
}

function job(s: Scenario): TlineResult {
  return runJob('tline', s, { samples: 4096 });
}

function surface(): ReturnType<typeof surfaceOf> {
  return surfaceOf(recorder());
}

function metric(spec: { metrics: readonly { key: string; value: number }[] }, key: string): number {
  return spec.metrics.find((m) => m.key === key)?.value ?? NaN;
}

function tdrOptions(s: Scenario, axis: TdrOptions['axis'] = 'time'): TdrOptions {
  const l = s.channel.tline;
  return {
    velocityFactor: l.velocityFactor,
    z0: l.z0,
    loadZ: l.loadZ,
    loadC: l.loadC,
    axis,
    reference: TDR_REFERENCE_OHMS,
  };
}

/** Termination pairs that exercise every sign of both coefficients. */
const CASES: [string, Partial<Tline>, Partial<Scenario['source']>][] = [
  ['default: 40 ohm driver, open end', {}, {}],
  ['matched both ends', { loadZ: 50 }, { sourceZ: 50 }],
  ['series-terminated', { loadZ: 1e6 }, { sourceZ: 50 }],
  ['parallel-terminated', { loadZ: 50 }, { sourceZ: 10 }],
  ['short-ish load', { loadZ: 5 }, { sourceZ: 25 }],
  ['capacitive load', { loadZ: 50, loadC: 1e-12 }, { sourceZ: 30 }],
  ['75 ohm line', { z0: 75, loadZ: 100 }, {}],
];

describe('every M3 figure declares a valid plot', () => {
  it.each(CASES)('%s', (_name, line, source) => {
    const s = scenario(line, source);
    const r = job(s);
    const l = s.channel.tline;
    const specs = [
      latticeRender(r, { length: l.length, rows: 8, loadC: l.loadC })(surface()).spec,
      waveformRender(r, { showSource: true, showLattice: true, loadC: l.loadC })(surface()).spec,
      waveformRender(r, { showSource: false, showLattice: false, loadC: l.loadC, delays: 6 })(surface()).spec,
      tdrRender(r, tdrOptions(s, 'time'))(surface()).spec,
      tdrRender(r, tdrOptions(s, 'distance'))(surface()).spec,
    ];
    for (const spec of specs) expect(validateChrome(spec)).toEqual([]);
  });
});

/* ----------------------------------------------------------------- lattice */

describe('lattice figure', () => {
  it('alternates direction and multiplies by the coefficient at each end', () => {
    const r = job(scenario());
    const sg = latticeSegments(r, 6);
    expect(sg.map((x) => x.forward)).toEqual([true, false, true, false, true, false]);
    // 5/9 of 0.5 V down; the 1 Mohm load returns (1e6 - 50)/(1e6 + 50) of it, which
    // is 0.9999 and not 1; the 40 ohm driver returns -1/9 of that.
    expect(sg[0].amplitude).toBeCloseTo(0.5 * (5 / 9), 12);
    expect(sg[1].amplitude).toBeCloseTo(sg[0].amplitude * ((1e6 - 50) / (1e6 + 50)), 12);
    expect(sg[2].amplitude).toBeCloseTo(-sg[1].amplitude / 9, 12);
    expect(sg[3].t0).toBeCloseTo(3 * r.delay, 18);
  });

  it('draws one wave and stops when the load is matched', () => {
    const r = job(scenario({ loadZ: 50 }, { sourceZ: 30 }));
    expect(latticeSegments(r, 8)).toHaveLength(1);
    const { spec } = latticeRender(r, { length: 0.15, rows: 8, loadC: 0 })(surface());
    expect(spec.traces.find((t) => t.key === 'backward')?.hidden).toBe(true);
    expect(spec.notes?.some((n) => /zero amplitude/.test(n))).toBe(true);
  });

  it('reports the final level as the resistive divider, and Z0 does not enter it', () => {
    const a = job(scenario({ z0: 50, loadZ: 60 }));
    const b = job(scenario({ z0: 90, loadZ: 60 }));
    const fa = metric(latticeRender(a, { length: 0.15, rows: 8, loadC: 0 })(surface()).spec, 'final');
    const fb = metric(latticeRender(b, { length: 0.15, rows: 8, loadC: 0 })(surface()).spec, 'final');
    expect(fa).toBeCloseTo((0.5 * 60) / (40 + 60), 12);
    expect(fb).toBeCloseTo(fa, 12);
  });

  it('labels every arrival level it draws', () => {
    const rec = recorder();
    const surf = surfaceOf(rec);
    const r = job(scenario());
    latticeRender(r, { length: 0.15, rows: 4, loadC: 0 })(surf).drawTraces(surf);
    // Four wave amplitudes and five levels: the launch plus four arrivals.
    expect(rec.texts).toHaveLength(9);
    expect(rec.texts.filter((t) => t.startsWith('Δ'))).toHaveLength(5);
  });

  it('says the lattice ignores the capacitor when there is one', () => {
    const r = job(scenario({ loadZ: 50, loadC: 1e-12 }));
    const { spec } = latticeRender(r, { length: 0.15, rows: 8, loadC: 1e-12 })(surface());
    expect(spec.notes?.some((n) => /resistance only/.test(n))).toBe(true);
  });
});

/* --------------------------------------------------------------- waveforms */

describe('waveform figure', () => {
  it('reads the near-end shelf at the launch divider', () => {
    const r = job(scenario());
    const { spec } = waveformRender(r, { showSource: false, showLattice: false, loadC: 0 })(surface());
    expect(metric(spec, 'launch')).toBeCloseTo(r.launch, 4);
  });

  it('builds staircases that match the simulation on every plateau', () => {
    const s = scenario({ loadZ: 20 }, { sourceZ: 90 });
    const r = job(s);
    const near = staircaseOf(r, 'near');
    const far = staircaseOf(r, 'far');
    // Mid-plateau: half a delay after each arrival, well clear of any edge.
    for (let k = 0; k < 8; k++) {
      const i = r.stepIndex + Math.round(((k + 0.5) * r.delay) / r.dt);
      expect(r.near[i]).toBeCloseTo(near[i], 4);
      expect(r.far[i]).toBeCloseTo(far[i], 4);
    }
    // And before anything happens, the staircase sits at the starting level.
    expect(near[0]).toBe(r.initialLevel);
  });

  it('draws the lattice under the simulation, and the source under both', () => {
    const rec = recorder();
    const surf = surfaceOf(rec);
    waveformRender(job(scenario()), { showSource: true, showLattice: true, loadC: 0 })(surf).drawTraces(surf);
    // Final-level rule, source, near staircase, far staircase, near, far.
    expect(colorSequence(rec)).toEqual(['#8B98A5', '#5AA9E6', '#3DDC97', '#F2C14E', '#3DDC97', '#F2C14E']);
  });

  it('flags an unsettled far end as a lower bound', () => {
    // A 5 ohm driver and an open end: coefficients -0.818 and +1, which rings for
    // many more round trips than two delays of record.
    const r = runJob('tline', scenario({}, { sourceZ: 5 }), { samples: 4096, delays: 2 });
    expect(r.settled).toBe(false);
    const { spec } = waveformRender(r, { showSource: false, showLattice: false, loadC: 0 })(surface());
    expect(spec.metrics.find((m) => m.key === 'settling') as { note?: string } | undefined).toMatchObject({
      note: expect.stringMatching(/lower bound/),
    });
  });
});

/* --------------------------------------------------------------------- TDR */

describe('TDR figure', () => {
  it('holds the line reading to Z0 as its target', () => {
    const s = scenario({ z0: 42, loadZ: 42 });
    const r = job(s);
    const { spec } = tdrRender(r, tdrOptions(s))(surface());
    expect(metric(spec, 'line')).toBeCloseTo(42, 4);
    expect(spec.metrics.find((m) => m.key === 'line')).toMatchObject({ target: 42 });
  });

  it('infers the physical length from the round trip', () => {
    const s = scenario({ length: 0.2, velocityFactor: 0.55 });
    const { spec } = tdrRender(job(s), tdrOptions(s, 'distance'))(surface());
    expect(metric(spec, 'distance')).toBeCloseTo(0.2, 12);
  });

  it('warns when an open end runs off the top of the scale', () => {
    const s = scenario();
    const { spec } = tdrRender(job(s), tdrOptions(s))(surface());
    expect(spec.notes?.some((n) => /top of the scale/.test(n))).toBe(true);
    expect(spec.y.scale.domain[1]).toBeLessThanOrEqual(250);
  });

  it('gives the load reading no target when the capacitor makes it time-varying', () => {
    const s = scenario({ loadZ: 50, loadC: 1e-12 });
    const { spec } = tdrRender(job(s), tdrOptions(s))(surface());
    expect(spec.metrics.find((m) => m.key === 'load')?.target).toBeUndefined();
  });

  it('declares nothing measured when the TDR was not run', () => {
    const s = scenario();
    const r = runJob('tline', s, { samples: 2048, includeTdr: false });
    const { spec } = tdrRender(r, tdrOptions(s))(surface());
    expect(spec.metrics).toEqual([]);
    expect(spec.traces.find((t) => t.key === 'tdr')?.hidden).toBe(true);
    expect(validateChrome(spec)).toEqual([]);
  });

  it('puts the time and distance traces at the same pixels', () => {
    const s = scenario({ z0: 60, loadZ: 30 });
    const r = job(s);
    const draw = (axis: TdrOptions['axis']): string => {
      const rec = recorder();
      const surf = surfaceOf(rec);
      tdrRender(r, tdrOptions(s, axis))(surf).drawTraces(surf);
      return JSON.stringify(rec.ops.filter((o) => o.op === 'lineTo' || o.op === 'moveTo'));
    };
    expect(draw('distance')).toEqual(draw('time'));
  });
});
