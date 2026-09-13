/**
 * M2's figures, checked against the physics they claim to show.
 *
 * The edge figure is built from a real `runJob('edge', ...)` result for the same
 * reason M1's is: a fixture would let the figure and the job drift apart silently.
 * The damping figure has no job behind it, so its assertions are against the closed
 * forms directly - if the plot says the overshoot is 48.6% then
 * `exp(-pi*zeta/sqrt(1-zeta^2))` had better agree, because that is the formula the
 * module prints beside it.
 */

import { describe, expect, it } from 'vitest';
import { runJob, type EdgeResult } from '../../../dsp/jobs';
import { rlcCharacteristics } from '../../../dsp/filters';
import { validateChrome } from '../../../plots/chrome';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import { colorSequence, recorder, surfaceOf } from '../../../plots/__tests__/recorder';
import { dampingRender, edgeRender } from '../plots';

type EdgeShape = Scenario['source']['edgeShape'];

const SHAPES: EdgeShape[] = ['linear', 'rc', 'gaussian', 'bessel', 'brickwall'];

function scenarioWith(edgeShape: EdgeShape): Scenario {
  const s = defaultScenario();
  return { ...s, source: { ...s.source, edgeShape } };
}

function edge(edgeShape: EdgeShape, includeScope = false): EdgeResult {
  return runJob('edge', scenarioWith(edgeShape), { samples: 4096, spanInRiseTimes: 12, includeScope });
}

function levelsOf(s: Scenario): { low: number; high: number } {
  return {
    low: s.source.dcOffset - s.source.amplitude / 2,
    high: s.source.dcOffset + s.source.amplitude / 2,
  };
}

function surface(): ReturnType<typeof surfaceOf> {
  return surfaceOf(recorder());
}

/* -------------------------------------------------------------------- edge */

describe('edge figure', () => {
  it.each(SHAPES)('declares a valid plot for a %s edge', (shape) => {
    const s = scenarioWith(shape);
    const { spec } = edgeRender(edge(shape), { ...levelsOf(s), showScope: false })(surface());
    expect(validateChrome(spec)).toEqual([]);
  });

  it('reproduces the commanded 20-80% rise time, which is what the Scenario states', () => {
    // The bandwidth was chosen from the 20-80% rise-time-bandwidth product of this
    // very response, so the measurement is a round trip through that constant. If it
    // ever stops closing, either the product or the measurement is wrong.
    const s = scenarioWith('rc');
    const r = edge('rc');
    const { spec } = edgeRender(r, { ...levelsOf(s), showScope: false })(surface());
    const tr = spec.metrics.find((m) => m.key === 'tr2080')?.value ?? NaN;
    expect(tr / s.source.riseTime).toBeCloseTo(1, 2);
  });

  it('reports the single-pole convention ratio as ln4/ln9', () => {
    const s = scenarioWith('rc');
    const { spec } = edgeRender(edge('rc'), { ...levelsOf(s), showScope: false })(surface());
    const ratio = spec.metrics.find((m) => m.key === 'ratio')?.value ?? NaN;
    expect(ratio).toBeCloseTo(Math.LN2 / Math.log(3), 2); // ln4/ln9 = ln2/ln3 = 0.63093
  });

  it('gives a single pole no overshoot and a brick wall the Gibbs amount', () => {
    const overshootOf = (shape: EdgeShape): number => {
      const s = scenarioWith(shape);
      const { spec } = edgeRender(edge(shape), { ...levelsOf(s), showScope: false })(surface());
      return spec.metrics.find((m) => m.key === 'overshoot')?.value ?? NaN;
    };
    // A first-order step is 1 - exp(-t/tau): monotone, so it cannot exceed its final
    // value. Anything above numerical noise here would be a bug in applyResponse.
    expect(overshootOf('rc')).toBeLessThan(0.005);
    // The brick wall is M1's truncation seen in the time domain, so it overshoots by
    // the Wilbraham-Gibbs fraction of the step: 8.95%.
    expect(overshootOf('brickwall')).toBeGreaterThan(0.08);
    expect(overshootOf('brickwall')).toBeLessThan(0.1);
  });

  it('derives the knee frequency from the 10-90% edge, not the 20-80% one', () => {
    const s = scenarioWith('gaussian');
    const r = edge('gaussian');
    const { spec } = edgeRender(r, { ...levelsOf(s), showScope: false })(surface());
    const knee = spec.metrics.find((m) => m.key === 'knee')?.value ?? NaN;
    expect(knee).toBeCloseTo(0.5 / r.rise1090, 6);
    expect(knee).not.toBeCloseTo(0.5 / r.rise2080, 6);
  });

  it('hides the scope trace, and says nothing about it, when no scope is in the path', () => {
    const s = scenarioWith('gaussian');
    const { spec } = edgeRender(edge('gaussian', false), { ...levelsOf(s), showScope: true })(surface());
    expect(spec.traces.find((t) => t.key === 'scope')?.hidden).toBe(true);
    expect(spec.metrics.find((m) => m.key === 'scope')).toBeUndefined();
    expect(validateChrome(spec)).toEqual([]);
  });

  it('reports a slower edge through the scope than at the pin', () => {
    const s = scenarioWith('gaussian');
    const r = edge('gaussian', true);
    const { spec } = edgeRender(r, { ...levelsOf(s), showScope: true })(surface());
    const through = spec.metrics.find((m) => m.key === 'scope')?.value ?? NaN;
    const at = spec.metrics.find((m) => m.key === 'tr2080')?.value ?? NaN;
    expect(through).toBeGreaterThan(at);
    expect(validateChrome(spec)).toEqual([]);
  });

  it('draws the reference levels under the edge, not over it', () => {
    const s = scenarioWith('gaussian');
    const rec = recorder();
    const surf = surfaceOf(rec);
    edgeRender(edge('gaussian'), { ...levelsOf(s), showScope: false })(surf).drawTraces(surf);
    // Marker blue for the four threshold lines, then green for the edge itself.
    expect(colorSequence(rec)).toEqual(['#5AA9E6', '#3DDC97']);
  });
});

/* ----------------------------------------------------------------- damping */

const L = 2e-9;
const C = 1e-12;
const R_CRIT = 2 * Math.sqrt(L / C);

describe('damping figure', () => {
  it.each([
    ['underdamped', 20],
    ['critically damped', R_CRIT],
    ['overdamped', 400],
  ] as const)('declares a valid plot when %s', (_regime, r) => {
    const { spec } = dampingRender({ r, l: L, c: C })(surface());
    expect(validateChrome(spec)).toEqual([]);
  });

  it('reports the damping ratio as (R/2) sqrt(C/L)', () => {
    const { spec } = dampingRender({ r: 20, l: L, c: C })(surface());
    const zeta = spec.metrics.find((m) => m.key === 'zeta')?.value ?? NaN;
    expect(zeta).toBeCloseTo((20 / 2) * Math.sqrt(C / L), 12);
    expect(zeta).toBeCloseTo(0.223606797749979, 12);
  });

  it('reports the overshoot the closed form gives, not a measurement of the curve', () => {
    for (const r of [5, 20, 60]) {
      const { spec } = dampingRender({ r, l: L, c: C })(surface());
      const zeta = (r / 2) * Math.sqrt(C / L);
      const expected = Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
      expect(spec.metrics.find((m) => m.key === 'overshoot')?.value).toBeCloseTo(expected, 12);
    }
  });

  it('names the resistance that would critically damp the network it is drawing', () => {
    const { spec } = dampingRender({ r: 20, l: L, c: C })(surface());
    const crit = spec.metrics.find((m) => m.key === 'rcrit');
    expect(crit?.value).toBeCloseTo(R_CRIT, 9);
    expect(crit?.value).toBeCloseTo(89.4427190999916, 9);
    // The target beside it is what is set now, so the reader can see the distance.
    expect(crit?.target).toBe(20);
  });

  it('has nothing to say about a first peak when there is no first peak', () => {
    // timeToPeak is Infinity outside the underdamped case. A non-finite metric would
    // fail validateChrome, which is the point: the figure has to omit it.
    const { spec } = dampingRender({ r: R_CRIT, l: L, c: C })(surface());
    expect(spec.metrics.find((m) => m.key === 'tpeak')).toBeUndefined();
    expect(spec.metrics.find((m) => m.key === 'overshoot')?.value).toBe(0);
    expect(spec.metrics.find((m) => m.key === 'fd')?.value).toBe(0);
    expect(validateChrome(spec)).toEqual([]);
  });

  it('keeps every metric finite in all three regimes', () => {
    for (const r of [1, 20, R_CRIT, 400, 5000]) {
      const { spec } = dampingRender({ r, l: L, c: C })(surface());
      for (const m of spec.metrics) expect(Number.isFinite(m.value)).toBe(true);
    }
  });

  it('shows at least one full ring of a lightly damped network', () => {
    const ch = rlcCharacteristics({ r: 20, l: L, c: C });
    const { spec } = dampingRender({ r: 20, l: L, c: C })(surface());
    expect(spec.x.scale.domain[1]).toBeGreaterThan(2 * ch.timeToPeak);
  });

  it('draws the reference curves under the network as configured', () => {
    const rec = recorder();
    const surf = surfaceOf(rec);
    dampingRender({ r: 20, l: L, c: C })(surf).drawTraces(surf);
    // One pole, then critically damped, then the network as set, on top.
    expect(colorSequence(rec)).toEqual(['#5AA9E6', '#3DDC97', '#F2C14E']);
  });
});
