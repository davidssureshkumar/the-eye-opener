/**
 * M4's measured-channel figures, checked against the job and the closed forms.
 *
 * Built from real `runJob('measured', ...)` results over every source, both views
 * and each corruption. Where a figure prints a number the assertion is against the
 * closed form of the synthetic network it came from: a lossless skewed pair has
 * |Scd21| = |sin(pi f tau)| and a null at 1 / (2 tau), the weave drawing averages
 * to the glass fractions the model uses, and so on.
 */

import { describe, expect, it } from 'vitest';
import { runJob } from '../../../dsp/jobs';
import type { MeasuredParams, MeasuredResult } from '../../../dsp/jobs/measured-job';
import { validateChrome } from '../../../plots/chrome';
import { recorder, surfaceOf } from '../../../plots/__tests__/recorder';
import {
  COUPLING_DEFAULTS,
  WEAVE_DEFAULTS,
  coupledPairNetwork,
  linearSweep,
  meanGlassFraction,
  weaveLegs,
  type WeaveSpec,
} from '../../../sim/touchstone/examples';
import { parseTouchstone, writeTouchstone } from '../../../sim/touchstone/parser';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import {
  causalityRender,
  crosstalkRender,
  glassFractionAt,
  halfIndex,
  ildRender,
  linearAt,
  mixedModeRender,
  passivityRender,
  skewRender,
  weaveRender,
} from '../measured-plots';
import { streamRender } from '../plots';

type Lossy = Scenario['channel']['lossy'];
type Touch = Scenario['channel']['touchstone'];

function scenarioWith(line: Partial<Lossy> = {}, touch: Partial<Touch> = {}): Scenario {
  const s = defaultScenario();
  return {
    ...s,
    channel: {
      ...s.channel,
      lossy: { ...s.channel.lossy, ...line },
      touchstone: { ...s.channel.touchstone, ...touch },
    },
  };
}

const LOSSLESS: Partial<Lossy> = {
  z0: 50,
  length: 0.2,
  conductorLossEnabled: false,
  dielectricLossEnabled: false,
  viaCount: 0,
};

function surface(): ReturnType<typeof surfaceOf> {
  return surfaceOf(recorder());
}

function metric(spec: { metrics: readonly { key: string; value: number }[] }, key: string): number {
  return spec.metrics.find((m) => m.key === key)?.value ?? NaN;
}

const couplingFile = (() => {
  const s = scenarioWith({ length: 0.1 });
  const net = coupledPairNetwork(s.channel.lossy, COUPLING_DEFAULTS, linearSweep(20e6, 600));
  return parseTouchstone(writeTouchstone(net), 'coupled.s4p').network;
})();

const CASES: [string, Scenario, Partial<MeasuredParams>][] = [
  [
    'lossless woven pair',
    scenarioWith(LOSSLESS, { mixedMode: true }),
    { source: 'weave', minimumPhase: true },
  ],
  ['default woven pair', scenarioWith({}, { mixedMode: true }), { source: 'weave' }],
  [
    'woven pair at an angle',
    scenarioWith({}, { mixedMode: true }),
    { source: 'weave', weave: { ...WEAVE_DEFAULTS, angleDeg: 10 } },
  ],
  ['single-ended view', scenarioWith({ length: 0.1 }, { mixedMode: false }), { source: 'weave' }],
  ['coupled lines', scenarioWith({ length: 0.1 }, { mixedMode: false }), { source: 'coupled' }],
  [
    'a loaded file',
    scenarioWith({ length: 0.1 }, { mixedMode: false }),
    { source: 'file', network: couplingFile },
  ],
  ['gain', scenarioWith({ length: 0.1 }, { mixedMode: false }), { source: 'weave', corruption: 'gain' }],
  [
    'conjugate',
    scenarioWith({ length: 0.1 }, { mixedMode: true }),
    { source: 'weave', corruption: 'conjugate' },
  ],
  [
    'magnitude only',
    scenarioWith({ length: 0.1 }, { mixedMode: true }),
    { source: 'weave', corruption: 'magnitude', minimumPhase: true },
  ],
];

const cache = new Map<string, MeasuredResult>();
function job(name: string): MeasuredResult {
  let r = cache.get(name);
  if (r === undefined) {
    const [, s, params] = CASES.find((c) => c[0] === name)!;
    r = runJob('measured', s, params);
    cache.set(name, r);
  }
  return r;
}

function specsOf(r: MeasuredResult, amplitude: number) {
  return [
    mixedModeRender(r)(surface()).spec,
    skewRender(r, { closedFormSkew: r.weaveLegs?.skew })(surface()).spec,
    ildRender(r, { view: 'fit' })(surface()).spec,
    ildRender(r, { view: 'deviation' })(surface()).spec,
    crosstalkRender(r)(surface()).spec,
    passivityRender(r)(surface()).spec,
    causalityRender(r, { uisAfter: 6 })(surface()).spec,
    streamRender(r, { amplitude })(surface()).spec,
  ];
}

describe('every measured-channel figure declares a valid plot', () => {
  it.each(CASES.map((c) => [c[0]]))('%s', (name) => {
    const r = job(name);
    const s = CASES.find((c) => c[0] === name)![1];
    for (const spec of specsOf(r, s.source.amplitude)) expect(validateChrome(spec)).toEqual([]);
  });

  it('an ILD band too narrow to fit', () => {
    const r = { ...job('default woven pair'), ildValid: false };
    for (const view of ['fit', 'deviation'] as const) {
      const spec = ildRender(r, { view })(surface()).spec;
      expect(validateChrome(spec)).toEqual([]);
      expect(spec.notes?.some((n) => /Too few/.test(n))).toBe(true);
    }
  });

  it.each([0, 7, 45])('the weave at %d degrees', (angleDeg) => {
    const weave = { ...WEAVE_DEFAULTS, angleDeg, offset: 60e-6 };
    const line = defaultScenario().channel.lossy;
    const legs = weaveLegs(weave, line);
    const rec = recorder();
    const out = weaveRender({ weave, legs, length: line.length, traceWidth: line.traceWidth })(
      surfaceOf(rec),
    );
    expect(validateChrome(out.spec)).toEqual([]);
    out.drawTraces(surfaceOf(rec));
  });
});

/* ----------------------------------------------------------------- helpers */

describe('helpers', () => {
  it('interpolates linearly and clamps at the ends', () => {
    const x = new Float64Array([1, 2, 4, 8]);
    const y = x.map((v) => 3 * v - 2);
    expect(linearAt(x, y, 3)).toBeCloseTo(7, 12);
    expect(linearAt(x, y, 7.5)).toBeCloseTo(20.5, 12);
    expect(linearAt(x, y, 0)).toBe(1);
    expect(linearAt(x, y, 9)).toBe(22);
    expect(linearAt(new Float64Array(0), new Float64Array(0), 1)).toBeNaN();
  });

  it('finds the half crossing of a ramp, rising or falling', () => {
    const ramp = Float64Array.from({ length: 21 }, (_, i) => Math.min(1, Math.max(0, (i - 5) / 10)));
    expect(halfIndex(ramp)).toBeCloseTo(10, 12);
    expect(halfIndex(ramp.map((v) => -2 * v))).toBeCloseTo(10, 12);
    expect(halfIndex(new Float64Array(8))).toBeNaN();
  });

  it('draws a glass fraction that averages to the one the model uses', () => {
    const weave: WeaveSpec = { ...WEAVE_DEFAULTS, angleDeg: 3, offset: 70e-6 };
    const length = 0.05;
    const width = 120e-6;
    const drift = length * Math.sin((weave.angleDeg * Math.PI) / 180);
    // Midpoint rule over the route and the trace width; the integrand is smooth and periodic.
    const ns = 4000;
    const ny = 64;
    let sum = 0;
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < ny; j++) {
        const s = (length * (i + 0.5)) / ns;
        const y = weave.offset - width / 2 + (width * (j + 0.5)) / ny;
        sum += glassFractionAt(weave, s, y);
      }
    }
    expect(sum / (ns * ny)).toBeCloseTo(meanGlassFraction(weave, weave.offset, width, drift), 5);
  });
});

/* ----------------------------------------------------------------- numbers */

describe('the numbers the figures print', () => {
  it('a lossless skewed pair converts |sin(pi f tau)| of its signal, and nulls at 1 / (2 tau)', () => {
    const r = job('lossless woven pair');
    const tau = r.weaveLegs!.skew;
    const spec = mixedModeRender(r)(surface()).spec;
    expect(metric(spec, 'il')).toBe(r.ilNyquist);
    expect(metric(spec, 'null')).toBeCloseTo(1 / (2 * Math.abs(tau)), 0);
    const fN = r.nyquist;
    expect(metric(spec, 'conversion')).toBeCloseTo(
      20 * Math.log10(Math.abs(Math.sin(Math.PI * fN * tau))),
      3,
    );
    expect(metric(spec, 'il')).toBeCloseTo(-20 * Math.log10(Math.abs(Math.cos(Math.PI * fN * tau))), 3);
    expect(metric(spec, 'rl')).toBeGreaterThan(60);
    expect(metric(spec, 'coverage')).toBeCloseTo(r.fMax / fN, 12);
  });

  it('the single-ended view has no pair traces or pair metrics', () => {
    const spec = mixedModeRender(job('single-ended view'))(surface()).spec;
    expect(spec.traces.filter((t) => !t.hidden).map((t) => t.key)).toEqual(['thru', 'reflection']);
    expect(metric(spec, 'conversion')).toBeNaN();
    expect(metric(spec, 'null')).toBeNaN();
  });

  it('the weave figure prints the legs of the model, and skew per inch', () => {
    const line = defaultScenario().channel.lossy;
    const weave = { ...WEAVE_DEFAULTS, offset: 40e-6 };
    const legs = weaveLegs(weave, line);
    const spec = weaveRender({ weave, legs, length: line.length, traceWidth: line.traceWidth })(
      surface(),
    ).spec;
    expect(metric(spec, 'glassP')).toBe(legs.glassP);
    expect(metric(spec, 'dkN')).toBe(legs.dkN);
    expect(metric(spec, 'skew')).toBe(legs.skew);
    expect(metric(spec, 'skewPerInch')).toBeCloseTo((legs.skew * 0.0254) / line.length, 20);
  });

  it('the skew figure measures the closed-form skew, and a common-mode step of about half of it per rise', () => {
    const r = job('lossless woven pair');
    const spec = skewRender(r, { closedFormSkew: r.weaveLegs!.skew })(surface()).spec;
    const m = spec.metrics.find((x) => x.key === 'skew')!;
    expect(m.target).toBe(r.weaveLegs!.skew);
    expect(Math.abs(m.value - (m.target as number))).toBeLessThan(0.5e-12);
    expect(metric(spec, 'skewUi')).toBeCloseTo((Math.abs(r.measuredSkew) * r.nyquist * 2) / 1, 9);
    const common = metric(spec, 'common');
    expect(common).toBeGreaterThan(0);
    expect(common).toBeLessThanOrEqual(1);
  });

  it('the ILD figure prints the job fit', () => {
    const r = job('default woven pair');
    const spec = ildRender(r, { view: 'deviation' })(surface()).spec;
    expect(metric(spec, 'rms')).toBe(r.ildRms);
    expect(metric(spec, 'peak')).toBe(r.ildPeak);
    expect(metric(spec, 'band')).toBe(r.ildHi);
  });

  it('the crosstalk figure totals its aggressors in quadrature and names each', () => {
    const r = job('coupled lines');
    const spec = crosstalkRender(r)(surface()).spec;
    expect(r.aggressors.length).toBe(2);
    expect(metric(spec, 'total')).toBeCloseTo(Math.hypot(metric(spec, 'next'), metric(spec, 'fext')), 15);
    expect(spec.traces.map((t) => t.label).slice(1)).toEqual([
      expect.stringMatching(/^Far-end from port 3/),
      expect.stringMatching(/^Near-end from port 4/),
    ]);
    const file = crosstalkRender(job('a loaded file'))(surface()).spec;
    expect(file.traces.length).toBe(3);
  });

  it('the passivity figure fails the gain and passes the clean line', () => {
    const bad = passivityRender(job('gain'))(surface()).spec.metrics.find((m) => m.key === 'sigma')!;
    const good = passivityRender(job('single-ended view'))(surface()).spec.metrics.find(
      (m) => m.key === 'sigma',
    )!;
    expect(bad.status).toBe('fail');
    expect(good.status).toBe('pass');
    expect(bad.value).toBeCloseTo(1.1 * good.value, 9);
  });

  it('the causality figure tells a causal, a conjugated and a magnitude-only transfer apart', () => {
    const ratio = (name: string) =>
      metric(causalityRender(job(name), { uisAfter: 6 })(surface()).spec, 'ratio');
    expect(ratio('default woven pair')).toBeLessThan(1e-3);
    expect(ratio('conjugate')).toBeGreaterThan(1);
    expect(ratio('magnitude only')).toBeGreaterThan(0.3);
    expect(ratio('magnitude only')).toBeLessThan(3);
    const conj = causalityRender(job('conjugate'), { uisAfter: 6 })(surface()).spec;
    expect(conj.notes?.some((n) => /flags/.test(n))).toBe(true);
    const mp = causalityRender(job('lossless woven pair'), { uisAfter: 6 })(surface()).spec;
    expect(Math.abs(metric(mp, 'minPhaseDelay'))).toBeLessThan(0.1 * metric(mp, 'delay'));
  });
});
