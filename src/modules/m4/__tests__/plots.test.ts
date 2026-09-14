/**
 * M4's figures, checked against the job and the line model they claim to show.
 *
 * Built from real `runJob('lossy', ...)` results, as M1 to M3 are. Where a figure
 * prints a number, the assertion is against the closed form, or against
 * `src/sim/channel/lossy.ts` evaluated directly at the same frequency.
 */

import { describe, expect, it } from 'vitest';
import { runJob } from '../../../dsp/jobs';
import { launchedLevel } from '../../../dsp/jobs/lossy-job';
import { PRE_CURSORS, type LossyResult } from '../../../dsp/jobs/lossy-job';
import { validateChrome } from '../../../plots/chrome';
import { colorSequence, recorder, surfaceOf } from '../../../plots/__tests__/recorder';
import { skinDepth } from '../../../sim/channel/lossy';
import { SPEED_OF_LIGHT } from '../../../sim/channel/tline';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import {
  dielectricRender,
  groupDelayRender,
  lossRender,
  precursorRender,
  pulseRender,
  roughnessCorner,
  roughnessRender,
  sParamRender,
  streamRender,
  valueAt,
  worstCentreLevel,
  type DielectricOptions,
  type RoughnessOptions,
} from '../plots';

type Lossy = Scenario['channel']['lossy'];

function scenario(line: Partial<Lossy> = {}): Scenario {
  const s = defaultScenario();
  return { ...s, channel: { ...s.channel, lossy: { ...s.channel.lossy, ...line } } };
}

const cache = new Map<string, LossyResult>();
function job(s: Scenario, causalRoughness = true): LossyResult {
  const key = JSON.stringify([s.channel.lossy, causalRoughness]);
  let r = cache.get(key);
  if (r === undefined) {
    r = runJob('lossy', s, { causalRoughness });
    cache.set(key, r);
  }
  return r;
}

function surface(): ReturnType<typeof surfaceOf> {
  return surfaceOf(recorder());
}

function metric(spec: { metrics: readonly { key: string; value: number }[] }, key: string): number {
  return spec.metrics.find((m) => m.key === key)?.value ?? NaN;
}

function enabled(s: Scenario): { conductorEnabled: boolean; dielectricEnabled: boolean } {
  return {
    conductorEnabled: s.channel.lossy.conductorLossEnabled,
    dielectricEnabled: s.channel.lossy.dielectricLossEnabled,
  };
}

function roughnessOptions(s: Scenario, view: RoughnessOptions['view']): RoughnessOptions {
  const l = s.channel.lossy;
  return {
    view,
    conductivity: l.conductivity,
    roughnessRms: l.roughnessRms,
    hurayRadius: l.hurayRadius,
    hurayRatio: l.hurayRatio,
  };
}

function dielectricOptions(s: Scenario, quantity: DielectricOptions['quantity']): DielectricOptions {
  const l = s.channel.lossy;
  return {
    quantity,
    enabled: l.dielectricLossEnabled,
    er: l.er,
    lossTangent: l.lossTangent,
    referenceFreq: l.referenceFreq,
  };
}

const LOSSLESS: Partial<Lossy> = { conductorLossEnabled: false, dielectricLossEnabled: false, viaCount: 0 };

const CASES: [string, Partial<Lossy>][] = [
  ['default route', {}],
  ['lossless and matched', LOSSLESS],
  ['conductor loss only', { dielectricLossEnabled: false, viaCount: 0 }],
  ['dielectric loss only', { conductorLossEnabled: false }],
  ['Huray roughness', { roughnessModel: 'huray' }],
  ['smooth copper', { roughnessEnabled: false }],
  ['a long low-loss route', { length: 1, lossTangent: 0.004, viaCount: 4 }],
];

describe('every M4 figure declares a valid plot', () => {
  it.each(CASES)('%s', (_name, line) => {
    const s = scenario(line);
    const r = job(s);
    const specs = [
      lossRender(r, { normalise: 'total', showApprox: true, ...enabled(s) })(surface()).spec,
      lossRender(r, { normalise: 'perInch', showApprox: false, ...enabled(s) })(surface()).spec,
      roughnessRender(r, roughnessOptions(s, 'loss'))(surface()).spec,
      roughnessRender(r, roughnessOptions(s, 'factor'))(surface()).spec,
      dielectricRender(r, dielectricOptions(s, 'permittivity'))(surface()).spec,
      dielectricRender(r, dielectricOptions(s, 'lossTangent'))(surface()).spec,
      sParamRender(r)(surface()).spec,
      groupDelayRender(r)(surface()).spec,
      pulseRender(r, { view: 'pulse', uisAfter: 8 })(surface()).spec,
      pulseRender(r, { view: 'step', uisAfter: 8 })(surface()).spec,
      streamRender(r, { amplitude: s.source.amplitude })(surface()).spec,
    ];
    for (const spec of specs) expect(validateChrome(spec)).toEqual([]);
  });

  it('the precursor comparison', () => {
    const s = scenario();
    const spec = precursorRender(job(s), job(s, false))(surface()).spec;
    expect(validateChrome(spec)).toEqual([]);
  });
});

/* ----------------------------------------------------------------- helpers */

describe('helpers', () => {
  it('interpolates in log frequency, exactly on the grid and for y linear in log f', () => {
    const f = new Float64Array([1e6, 1e7, 1e8, 1e9]);
    const y = f.map((v) => 3 * Math.log10(v) - 2);
    expect(valueAt(f, y, 1e7)).toBeCloseTo(19, 12);
    expect(valueAt(f, y, 10 ** 8.37)).toBeCloseTo(3 * 8.37 - 2, 12);
    expect(valueAt(f, y, 1)).toBe(y[0]);
    expect(valueAt(f, y, 1e12)).toBe(y[3]);
  });

  it('puts the roughness corner where the skin depth equals the roughness length', () => {
    const fc = roughnessCorner(0.8e-6, 5.8e7);
    expect(skinDepth(fc, 5.8e7) / 0.8e-6).toBeCloseTo(1, 12);
    expect(roughnessCorner(0, 5.8e7)).toBe(Infinity);
  });
});

/* -------------------------------------------------------------- breakdown */

describe('loss breakdown', () => {
  it('prints the job’s Nyquist figures and holds the low-loss formula to the exact loss', () => {
    const s = scenario();
    const r = job(s);
    const { spec } = lossRender(r, { normalise: 'total', showApprox: true, ...enabled(s) })(surface());
    expect(metric(spec, 'il')).toBe(r.ilNyquist);
    expect(metric(spec, 'perInch')).toBe(r.ilNyquistPerInch);
    expect(spec.metrics.find((m) => m.key === 'approx')).toMatchObject({ target: r.ilNyquist });
    expect(metric(spec, 'skin')).toBeCloseTo(skinDepth(r.nyquist, 5.8e7) / 1, 15);
  });

  it('finds the frequency where conductor and dielectric loss are equal', () => {
    const s = scenario({ viaCount: 0 });
    const r = job(s);
    const { spec } = lossRender(r, { normalise: 'total', showApprox: false, ...enabled(s) })(surface());
    const fx = metric(spec, 'crossover');
    expect(fx).toBeGreaterThan(r.freq[0]);
    const c = valueAt(r.freq, r.ilConductor, fx);
    const d = valueAt(r.freq, r.ilDielectric, fx);
    expect(Math.abs(c - d) / c).toBeLessThan(1e-2);
  });

  it('divides every curve by the length in inches when asked', () => {
    const s = scenario();
    const r = job(s);
    const total = lossRender(r, { normalise: 'total', showApprox: false, ...enabled(s) })(surface()).spec;
    const inch = lossRender(r, { normalise: 'perInch', showApprox: false, ...enabled(s) })(surface()).spec;
    expect(inch.y.unit).toBe('dB/in');
    expect(inch.y.scale.domain[0]).toBeGreaterThan(total.y.scale.domain[0]);
  });

  it('draws the mechanisms under the route, and the formula only when asked', () => {
    const s = scenario();
    const r = job(s);
    for (const showApprox of [false, true]) {
      const rec = recorder();
      const sf = surfaceOf(rec);
      lossRender(r, { normalise: 'total', showApprox, ...enabled(s) })(sf).drawTraces(sf);
      const expected = ['#8B98A5', '#5AA9E6', '#3DDC97', ...(showApprox ? ['#E6EDF3'] : []), '#F2C14E'];
      expect(colorSequence(rec)).toEqual(expected);
    }
  });

  it('says when a mechanism is switched off', () => {
    const s = scenario({ dielectricLossEnabled: false });
    const r = job(s);
    const { spec } = lossRender(r, { normalise: 'total', showApprox: false, ...enabled(s) })(surface());
    expect(spec.notes?.some((n) => /Dielectric loss is switched off/.test(n))).toBe(true);
    // The curve still shows what the laminate would add, and the route does not include it.
    expect(metric(spec, 'dielectric')).toBeGreaterThan(0);
    expect(r.ilNyquist).toBeLessThan(r.conductorNyquist + 0.5 * r.dielectricNyquist);
  });
});

/* -------------------------------------------------------------- roughness */

describe('roughness figure', () => {
  it('reports what each model adds at Nyquist, never negative', () => {
    const s = scenario();
    const r = job(s);
    const { spec } = roughnessRender(r, roughnessOptions(s, 'loss'))(surface());
    expect(metric(spec, 'hammerstadExtra')).toBeGreaterThan(0);
    expect(metric(spec, 'hurayExtra')).toBeGreaterThan(0);
    expect(metric(spec, 'smooth')).toBeCloseTo(valueAt(r.freq, r.ilSmooth, r.nyquist), 12);
  });

  it('keeps the Hammerstad factor under 2 and the Huray factor under 1 + S', () => {
    const s = scenario({ hurayRatio: 2.2 });
    const r = job(s);
    const { spec } = roughnessRender(r, roughnessOptions(s, 'factor'))(surface());
    expect(metric(spec, 'kHammerstad')).toBeLessThan(2);
    expect(metric(spec, 'kHuray')).toBeLessThan(3.2);
    expect(spec.y.scale.domain[1]).toBeGreaterThanOrEqual(Math.max(...r.kHuray));
    expect(metric(spec, 'hurayCorner')).toBeCloseTo(roughnessCorner(s.channel.lossy.hurayRadius, 5.8e7), 0);
  });
});

/* ------------------------------------------------------------- dielectric */

describe('dielectric figure', () => {
  it.each(['permittivity', 'lossTangent'] as const)('passes through the stated %s', (quantity) => {
    const s = scenario();
    const { spec } = dielectricRender(job(s), dielectricOptions(s, quantity))(surface());
    const m = spec.metrics.find((x) => x.key === 'reference');
    expect(m?.target).toBeDefined();
    expect(Math.abs((m?.value ?? NaN) - (m?.target ?? NaN)) / (m?.target ?? 1)).toBeLessThan(1e-3);
  });

  it('shows a lossless laminate as a constant permittivity with a zero loss tangent', () => {
    const s = scenario({ dielectricLossEnabled: false });
    const r = job(s);
    const perm = dielectricRender(r, dielectricOptions(s, 'permittivity'))(surface()).spec;
    const tan = dielectricRender(r, dielectricOptions(s, 'lossTangent'))(surface()).spec;
    expect(metric(perm, 'nyquist')).toBeCloseTo(s.channel.lossy.er, 12);
    expect(metric(tan, 'nyquist')).toBe(0);
    expect(tan.metrics.find((m) => m.key === 'reference')?.target).toBe(0);
    expect(perm.notes?.some((n) => /switched off/.test(n))).toBe(true);
  });

  it('has permittivity falling and never rising with frequency', () => {
    const r = job(scenario());
    for (let i = 1; i < r.epsReal.length; i++) expect(r.epsReal[i]).toBeLessThanOrEqual(r.epsReal[i - 1]);
  });
});

/* ---------------------------------------------------------- S-parameters */

describe('S-parameter figure', () => {
  it('reads |S21| at DC as the job’s series-resistor gain, and return loss at Nyquist', () => {
    const r = job(scenario());
    const { spec } = sParamRender(r)(surface());
    expect(metric(spec, 'dc')).toBe(r.dcGain);
    expect(metric(spec, 'rl')).toBe(r.returnLossNyquist);
  });

  it('notes the return-loss floor on a matched line', () => {
    const r = job(scenario(LOSSLESS));
    const { spec } = sParamRender(r)(surface());
    expect(spec.notes?.some((n) => /no lower than/.test(n))).toBe(true);
  });
});

/* ----------------------------------------------------------- group delay */

describe('group delay figure', () => {
  it('is flat at l sqrt(er) / c on a lossless line', () => {
    const s = scenario(LOSSLESS);
    const r = job(s);
    const { spec } = groupDelayRender(r)(surface());
    const td = (s.channel.lossy.length * Math.sqrt(s.channel.lossy.er)) / SPEED_OF_LIGHT;
    expect(Math.abs(metric(spec, 'gd') - td) / td).toBeLessThan(1e-6);
    expect(metric(spec, 'lossless')).toBeCloseTo(td, 15);
    expect(metric(spec, 'dispersion')).toBeLessThan(1e-6 * td);
  });

  it('spreads on a lossy line, slower at low frequency', () => {
    const r = job(scenario({ viaCount: 0 }));
    const { spec } = groupDelayRender(r)(surface());
    expect(metric(spec, 'dispersion')).toBeGreaterThan(0);
    expect(r.groupDelay[0]).toBeGreaterThan(r.groupDelay[r.groupDelay.length - 1]);
  });
});

/* ------------------------------------------------------ pulse and step */

describe('pulse figure', () => {
  it('prints the job’s cursor figures and marks every cursor inside the window', () => {
    const r = job(scenario());
    const rec = recorder();
    const sf = surfaceOf(rec);
    const { spec, drawTraces } = pulseRender(r, { view: 'pulse', uisAfter: 8 })(sf);
    expect(metric(spec, 'main')).toBe(r.mainCursor);
    expect(metric(spec, 'isi')).toBe(r.isiSum);
    expect(metric(spec, 'precursor')).toBe(r.precursorLeak);
    drawTraces(sf);
    expect(rec.calls.filter((c) => c === 'arc')).toHaveLength(r.cursors.length);
    expect(r.cursors[PRE_CURSORS]).toBeCloseTo(r.mainCursor, 12);
  });

  it('holds the settled step to the DC gain', () => {
    const r = job(scenario({ dielectricLossEnabled: false }));
    const { spec } = pulseRender(r, { view: 'step', uisAfter: 8 })(surface());
    const m = spec.metrics.find((x) => x.key === 'dc');
    expect(m?.target).toBe(r.dcGain);
    expect(Math.abs((m?.value ?? NaN) - r.dcGain)).toBeLessThan(1e-3);
    expect(spec.traces.find((t) => t.key === 'cursors')?.hidden).toBe(true);
  });
});

describe('precursor figure', () => {
  it('shows the real factor leaking far more than the causal one', () => {
    const s = scenario({ dielectricLossEnabled: false, viaCount: 0 });
    const { spec } = precursorRender(job(s), job(s, false))(surface());
    expect(metric(spec, 'real')).toBeGreaterThan(10 * metric(spec, 'causal'));
  });
});

/* ------------------------------------------------------------ bit stream */

describe('bit stream figure', () => {
  it('samples every UI centre at the launched level through a lossless line, less through a lossy one', () => {
    const s = scenario(LOSSLESS);
    const lossless = job(s);
    const level = launchedLevel(s.source.amplitude);
    // Through a matched lossless line only the fraction of a sample the delay
    // rounding removes, and the launched edge's own tails, keep this off 1.
    expect(worstCentreLevel(lossless, level)).toBeGreaterThan(0.95);
    expect(worstCentreLevel(lossless, level)).toBeLessThanOrEqual(1 + 1e-6);
    const lossy = job(scenario({ length: 1 }));
    expect(worstCentreLevel(lossy, level)).toBeLessThan(worstCentreLevel(lossless, level));
    const { spec } = streamRender(lossy, { amplitude: s.source.amplitude })(surface());
    expect(metric(spec, 'worst')).toBe(worstCentreLevel(lossy, level));
  });
});
