import { describe, it, expect } from 'vitest';
import {
  buildHash,
  decodeScenario,
  diffScenarios,
  encodeScenario,
  numToStr,
  parseHash,
  permalinkFor,
  withPatch,
} from '../url-codec';
import {
  aggressorSchema,
  bitsPerSymbol,
  cloneScenario,
  defaultScenario,
  nyquist,
  parseScenario,
  timeStep,
  unitInterval,
  SCENARIO_VERSION,
  type Scenario,
} from '../scenario';

/** Every leaf of a Scenario, as dotted path -> value, for exhaustive comparison. */
function leaves(v: unknown, path = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(v)) {
    out[`${path}.length`] = v.length;
    v.forEach((e, i) => leaves(e, `${path}.${i}`, out));
    return out;
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      leaves(x, path === '' ? k : `${path}.${k}`, out);
    }
    return out;
  }
  out[path] = v;
  return out;
}

function roundTrip(s: Scenario): Scenario {
  const r = decodeScenario(encodeScenario(s));
  expect(r.warnings).toEqual([]);
  return r.scenario;
}

describe('number formatting', () => {
  it('round trips exactly for values across the range a scenario uses', () => {
    const values = [
      0,
      -0,
      1,
      -1,
      0.5,
      6.4e9,
      25e-12,
      1e-12,
      0.707,
      5.8e7,
      1e-16,
      1 / 3,
      Math.PI,
      1.7976931348623157e308,
      5e-324,
      0.1 + 0.2,
    ];
    // Object.is, not ===, so that -0 has to come back as -0 rather than +0.
    for (const v of values) expect(Object.is(Number(numToStr(v)), v)).toBe(true);
  });

  it('prefers whichever spelling is shorter', () => {
    expect(numToStr(25e-12)).toBe('2.5e-11');
    expect(numToStr(0.5)).toBe('0.5');
    expect(numToStr(64)).toBe('64');
    // A round gigahertz is shorter in exponential form than written out.
    expect(numToStr(6.4e9).length).toBeLessThan('6400000000'.length);
  });

  it('keeps the sign of negative zero', () => {
    expect(numToStr(-0)).toBe('-0');
    expect(Object.is(Number(numToStr(-0)), -0)).toBe(true);
  });
});

describe('encoding is sparse', () => {
  it('a default scenario encodes to the version tag alone', () => {
    expect(encodeScenario(defaultScenario())).toBe(`v${SCENARIO_VERSION}`);
  });

  it('one changed slider produces one key', () => {
    const s = withPatch(defaultScenario(), { 'source.riseTime': 12e-12 });
    expect(encodeScenario(s)).toBe(`v${SCENARIO_VERSION}~source.riseTime:1.2e-11`);
  });

  it('keys are sorted, so the same scenario always gives the same link', () => {
    const a = withPatch(defaultScenario(), {
      'source.riseTime': 12e-12,
      'impairments.noiseRms': 5e-3,
    });
    const b = withPatch(defaultScenario(), {
      'impairments.noiseRms': 5e-3,
      'source.riseTime': 12e-12,
    });
    expect(encodeScenario(a)).toBe(encodeScenario(b));
    const keys = encodeScenario(a).split('~').slice(1);
    expect(keys).toEqual([...keys].sort());
  });

  it('a realistic link stays short enough to paste into a chat window', () => {
    const s = withPatch(defaultScenario(), {
      'source.symbolRate': 8e9,
      'source.riseTime': 18e-12,
      'channel.lossy.length': 0.25,
      'impairments.randomJitterRms': 0.9e-12,
      'analysis.bits': 50000,
      'eq.ctleEnabled': true,
    });
    expect(encodeScenario(s).length).toBeLessThan(160);
  });
});

describe('lossless round trip', () => {
  it('preserves an untouched scenario', () => {
    const s = defaultScenario();
    expect(leaves(roundTrip(s))).toEqual(leaves(s));
  });

  it('preserves every scalar field that has been moved off its default', () => {
    // Touch one field of every sub-object, including the awkward types.
    const s = withPatch(defaultScenario(), {
      'source.symbolRate': 9.6e9,
      'source.levels': 'pam4',
      'source.edgeShape': 'bessel',
      'source.riseTime': 7.5e-12,
      'source.pattern.kind': 'walking-one',
      'source.pattern.prbs': 'prbs31',
      'source.pattern.custom': '1100101110',
      'source.pattern.invert': true,
      'channel.kind': 'touchstone',
      'channel.touchstone.name': 'ddr_ch3.s4p',
      'channel.touchstone.ports': 4,
      'channel.lossy.roughnessRms': 1.5e-6,
      'channel.tline.loadZ': 1e9,
      'impairments.seed': 424242,
      'impairments.periodicJitterAmp': 1.4e-12,
      'impairments.dcdFraction': -0.03,
      'crosstalk.enabled': true,
      'crosstalk.ssoCount': 15,
      'eq.ffeEnabled': true,
      'eq.ffeTaps': [-0.05, 1, -0.31, 0.02],
      'eq.dfeTaps': [0.25],
      'cdr.type': 'first-order',
      'cdr.loopBandwidth': 4e6,
      'sampling.samplesPerUi': 128,
      'sampling.strobePhase': 0.47,
      'analysis.engine': 'statistical',
      'analysis.bits': 250000,
      'analysis.targetBer': 1e-16,
      'scope.enabled': true,
      'scope.fftWindow': 'flat-top',
      'scope.adcBits': 12,
      'view.spanUi': 48,
      'view.cursorsT': [0.25, 0.75],
      'view.cursorsV': [-0.12, 0.12],
    });
    expect(leaves(roundTrip(s))).toEqual(leaves(s));
  });

  it('preserves an empty number array, which is not the same as an absent one', () => {
    const withCursors = withPatch(defaultScenario(), { 'view.cursorsT': [0.5] });
    expect(roundTrip(withCursors).view.cursorsT).toEqual([0.5]);
    const cleared = withPatch(withCursors, { 'view.cursorsT': [] });
    expect(encodeScenario(cleared)).toBe(`v${SCENARIO_VERSION}`);
    expect(roundTrip(cleared).view.cursorsT).toEqual([]);
  });

  it('preserves negative and fractional array entries', () => {
    const s = withPatch(defaultScenario(), { 'eq.ffeTaps': [-0.0625, 1, -0.1875, 0.03125] });
    expect(roundTrip(s).eq.ffeTaps).toEqual([-0.0625, 1, -0.1875, 0.03125]);
  });

  it('preserves an array of aggressor objects, and only encodes what differs', () => {
    const base = defaultScenario();
    const a0 = aggressorSchema.parse({});
    const a1 = aggressorSchema.parse({ end: 'near', kb: 0.06, skew: 5e-12 });
    const s = parseScenario({
      ...cloneScenario(base),
      crosstalk: { ...base.crosstalk, enabled: true, aggressors: [a0, a1] },
    });

    const encoded = encodeScenario(s);
    // The first aggressor sits entirely at its defaults, so only the length key
    // and the three edited fields of the second should appear.
    expect(encoded).toContain('crosstalk.aggressors.n:2');
    expect(encoded).not.toContain('crosstalk.aggressors.0.');
    expect(encoded).toContain('crosstalk.aggressors.1.kb:0.06');
    expect(encoded).toContain('crosstalk.aggressors.1.end:near');

    expect(leaves(roundTrip(s))).toEqual(leaves(s));
  });

  it('shrinking the aggressor list back to empty round trips', () => {
    const base = defaultScenario();
    const s = parseScenario({
      ...cloneScenario(base),
      crosstalk: { ...base.crosstalk, aggressors: [aggressorSchema.parse({ kb: 0.09 })] },
    });
    expect(roundTrip(s).crosstalk.aggressors).toHaveLength(1);
    const cleared = parseScenario({ ...cloneScenario(s), crosstalk: { ...s.crosstalk, aggressors: [] } });
    expect(roundTrip(cleared).crosstalk.aggressors).toEqual([]);
  });

  it('encodes a nested aggressor pattern', () => {
    const base = defaultScenario();
    const s = parseScenario({
      ...cloneScenario(base),
      crosstalk: {
        ...base.crosstalk,
        aggressors: [aggressorSchema.parse({ pattern: { kind: 'clock', divN: 4 } })],
      },
    });
    const back = roundTrip(s);
    expect(back.crosstalk.aggressors[0].pattern.kind).toBe('clock');
    expect(back.crosstalk.aggressors[0].pattern.divN).toBe(4);
  });
});

describe('strings survive the separators', () => {
  it('escapes a custom pattern containing the delimiters', () => {
    const nasty = 'a~b:c,d%e&f?g#h i';
    const s = withPatch(defaultScenario(), { 'source.pattern.custom': nasty });
    const encoded = encodeScenario(s);
    // Exactly one key, so no separator leaked into the value.
    expect(encoded.split('~')).toHaveLength(2);
    expect(roundTrip(s).source.pattern.custom).toBe(nasty);
  });

  it('escapes a Touchstone file name with spaces and unicode', () => {
    const name = 'DDR5 channel — rev 2 (Ω).s4p';
    const s = withPatch(defaultScenario(), { 'channel.touchstone.name': name });
    expect(roundTrip(s).channel.touchstone.name).toBe(name);
  });
});

describe('decoding is forgiving but never unsafe', () => {
  it('an empty or missing payload gives the defaults', () => {
    for (const input of ['', null, undefined, '~~']) {
      const r = decodeScenario(input);
      expect(leaves(r.scenario)).toEqual(leaves(defaultScenario()));
    }
  });

  it('unknown settings are dropped with a warning, and the rest still applies', () => {
    const r = decodeScenario(`v${SCENARIO_VERSION}~source.warpDrive:9~source.riseTime:1e-11`);
    expect(r.scenario.source.riseTime).toBe(1e-11);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('warpDrive');
  });

  it('a future format tag still opens, with a warning', () => {
    const r = decodeScenario(`v99~source.riseTime:1e-11`);
    expect(r.scenario.source.riseTime).toBe(1e-11);
    expect(r.warnings.join(' ')).toContain('v99');
  });

  it('a malformed entry is skipped rather than throwing', () => {
    const r = decodeScenario(`v${SCENARIO_VERSION}~notakeyvaluepair~view.spanUi:32`);
    expect(r.scenario.view.spanUi).toBe(32);
    expect(r.warnings.join(' ')).toContain('malformed');
  });

  it('a non-numeric value for a numeric field is refused', () => {
    const r = decodeScenario(`v${SCENARIO_VERSION}~source.symbolRate:fast`);
    expect(r.scenario.source.symbolRate).toBe(defaultScenario().source.symbolRate);
    expect(r.warnings.join(' ')).toContain('symbolRate');
  });

  it('an out-of-range hand-edited value falls back rather than reaching the DSP', () => {
    // A negative symbol rate would divide by zero downstream; zod refuses it.
    const r = decodeScenario(`v${SCENARIO_VERSION}~source.symbolRate:-1e9`);
    expect(r.scenario.source.symbolRate).toBeGreaterThan(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('an enum outside its set is refused', () => {
    const r = decodeScenario(`v${SCENARIO_VERSION}~source.levels:pam8`);
    expect(r.scenario.source.levels).toBe('nrz');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('a silly bit count cannot be smuggled in through the URL', () => {
    const r = decodeScenario(`v${SCENARIO_VERSION}~analysis.bits:1e12`);
    expect(r.scenario.analysis.bits).toBeLessThanOrEqual(10_000_000);
  });

  it('an absurd aggressor count is clamped before any allocation happens', () => {
    const r = decodeScenario(`v${SCENARIO_VERSION}~crosstalk.aggressors.n:100000`);
    expect(r.scenario.crosstalk.aggressors.length).toBeLessThanOrEqual(8);
  });

  it('accepts booleans written the obvious ways', () => {
    for (const t of ['T', '1', 'true']) {
      expect(decodeScenario(`v${SCENARIO_VERSION}~scope.enabled:${t}`).scenario.scope.enabled).toBe(true);
    }
    for (const f of ['F', '0', 'false']) {
      expect(decodeScenario(`v${SCENARIO_VERSION}~view.showGrid:${f}`).scenario.view.showGrid).toBe(false);
    }
  });

  it('a payload with no version tag is read as the current format, with a warning', () => {
    const r = decodeScenario('view.spanUi:8');
    expect(r.scenario.view.spanUi).toBe(8);
    expect(r.warnings.join(' ')).toContain('no format tag');
  });
});

describe('hash routing', () => {
  it('parses module, section and payload', () => {
    const r = parseHash('#/m5/eye?s=v1~view.spanUi:8');
    expect(r).toEqual({ module: 'm5', section: 'eye', payload: 'v1~view.spanUi:8' });
  });

  it('tolerates the many shapes a hash arrives in', () => {
    expect(parseHash('').module).toBe('');
    expect(parseHash('#').module).toBe('');
    expect(parseHash('#/').module).toBe('');
    expect(parseHash('#/m1').module).toBe('m1');
    expect(parseHash('m1/intro').section).toBe('intro');
    expect(parseHash('#/m1?s=v1').payload).toBe('v1');
  });

  it('builds a hash that parses back to what went in', () => {
    for (const route of [
      { module: 'm1', section: '', payload: '' },
      { module: 'm7', section: 'dfe', payload: 'v1~eq.dfeEnabled:T' },
      { module: '', section: '', payload: '' },
    ]) {
      expect(parseHash(buildHash(route))).toEqual(route);
    }
  });

  it('a default scenario gets a clean link with no payload', () => {
    const link = permalinkFor('m2', '', defaultScenario(), 'https://example.org', '/eye/');
    expect(link).toBe('https://example.org/eye/#/m2');
  });

  it('a modified scenario carries its payload, and the link reopens it', () => {
    const s = withPatch(defaultScenario(), { 'sampling.strobePhase': 0.42 });
    const link = permalinkFor('m5', 'strobe', s, 'https://example.org', '/eye/');
    const route = parseHash(link.slice(link.indexOf('#')));
    expect(route.module).toBe('m5');
    expect(route.section).toBe('strobe');
    expect(decodeScenario(route.payload).scenario.sampling.strobePhase).toBe(0.42);
  });
});

describe('patching and diffing', () => {
  it('withPatch does not mutate its input', () => {
    const s = defaultScenario();
    const before = leaves(s);
    withPatch(s, { 'view.spanUi': 99 });
    expect(leaves(s)).toEqual(before);
  });

  it('withPatch validates, so a control cannot push a bad value into state', () => {
    expect(() => withPatch(defaultScenario(), { 'sampling.strobePhase': 5 })).toThrow();
  });

  it('diff lists exactly the paths that moved', () => {
    const a = defaultScenario();
    const b = withPatch(a, { 'view.spanUi': 32, 'scope.enabled': true });
    expect(diffScenarios(a, b)).toEqual(['scope.enabled', 'view.spanUi']);
    expect(diffScenarios(a, a)).toEqual([]);
  });

  it('diff notices a changed array, which it reports as one path', () => {
    // A tap list is a single quantity, so it diffs as a whole rather than element by
    // element. Arrays of objects are the ones that get indexed paths and a length key.
    const a = defaultScenario();
    const b = withPatch(a, { 'eq.ffeTaps': [1] });
    expect(diffScenarios(a, b)).toEqual(['eq.ffeTaps']);

    const withAggressor = parseScenario({
      ...cloneScenario(a),
      crosstalk: { ...a.crosstalk, aggressors: [aggressorSchema.parse({})] },
    });
    expect(diffScenarios(a, withAggressor)).toContain('crosstalk.aggressors.n');
  });
});

describe('derived quantities', () => {
  it('the unit interval is the reciprocal of the symbol rate', () => {
    const s = withPatch(defaultScenario(), { 'source.symbolRate': 6.4e9 });
    expect(unitInterval(s)).toBeCloseTo(156.25e-12, 18);
    expect(nyquist(s)).toBe(3.2e9);
  });

  it('the time step divides the UI by the oversampling factor', () => {
    const s = withPatch(defaultScenario(), {
      'source.symbolRate': 1e9,
      'sampling.samplesPerUi': 64,
    });
    expect(timeStep(s)).toBeCloseTo(1e-9 / 64, 18);
  });

  it('PAM4 carries two bits per symbol', () => {
    expect(bitsPerSymbol(defaultScenario())).toBe(1);
    expect(bitsPerSymbol(withPatch(defaultScenario(), { 'source.levels': 'pam4' }))).toBe(2);
  });
});
