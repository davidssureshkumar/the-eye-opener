import { describe, it, expect } from 'vitest';
import {
  CONTROLS,
  GROUPS,
  PANELS,
  controlFor,
  controlsIn,
  groupsIn,
  orderedPaths,
  valueAtPath,
  isVisible,
  quantize,
  normalize,
  denormalize,
  type ControlSpec,
  type PanelId,
} from '../controls';
import { CONTROL_HELP, NON_CONTROL_PATHS, controlPaths, canonicalPath } from '../help';
import { scenarioSchema, aggressorSchema, defaultScenario, type Scenario } from '../../state/scenario';

/* ------------------------------------------------------------ zod reflection */

/**
 * The registry claims a range; the schema owns the range. These helpers read the
 * schema's own definition so the assertions below compare the two rather than
 * comparing the registry with a second copy of itself.
 */
interface ZodDef {
  typeName: string;
  innerType?: unknown;
  type?: unknown;
  shape?: () => Record<string, unknown>;
  values?: readonly string[];
  checks?: ReadonlyArray<{ kind: string; value?: number }>;
}

function defOf(schema: unknown): ZodDef {
  return (schema as { _def: ZodDef })._def;
}

/** Strip ZodDefault / ZodOptional wrappers down to the thing itself. */
function unwrap(schema: unknown): unknown {
  let s = schema;
  for (;;) {
    const d = defOf(s);
    if (d.typeName === 'ZodDefault' || d.typeName === 'ZodOptional' || d.typeName === 'ZodNullable') {
      s = d.innerType;
      continue;
    }
    return s;
  }
}

/** The schema at a canonical path. `[]` descends into an array's element type. */
function schemaAt(path: string): unknown {
  let s: unknown = scenarioSchema;
  for (const seg of path.split('.')) {
    const d = defOf(unwrap(s));
    if (seg === '[]') {
      s = d.type;
      continue;
    }
    const shape = d.shape;
    if (shape === undefined) throw new Error(`${path}: "${seg}" is not inside an object`);
    const next = shape()[seg];
    if (next === undefined) throw new Error(`${path}: no schema field "${seg}"`);
    s = next;
  }
  return unwrap(s);
}

function typeNameAt(path: string): string {
  return defOf(schemaAt(path)).typeName;
}

function isIntegerInSchema(path: string): boolean {
  const d = defOf(schemaAt(path));
  return (d.checks ?? []).some((c) => c.kind === 'int');
}

/* ------------------------------------------------------------ scenario tools */

/** A Scenario with one aggressor present, so `[]` paths are reachable. */
function fullScenario(): Scenario {
  const s = defaultScenario();
  return { ...s, crosstalk: { ...s.crosstalk, aggressors: [aggressorSchema.parse({})] } };
}

/** Set a canonical path on a cloned Scenario-shaped object; `[]` means index 0. */
function withValue(root: Scenario, path: string, value: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
  const segs = path.split('.');
  let cur: Record<string, unknown> | unknown[] = clone;
  for (const seg of segs.slice(0, -1)) {
    cur = (seg === '[]' ? (cur as unknown[])[0] : (cur as Record<string, unknown>)[seg]) as
      Record<string, unknown> | unknown[];
  }
  const last = segs[segs.length - 1]!;
  if (last === '[]') (cur as unknown[])[0] = value;
  else (cur as Record<string, unknown>)[last] = value;
  return clone;
}

function acceptsValue(path: string, value: unknown): boolean {
  return scenarioSchema.safeParse(withValue(fullScenario(), path, value)).success;
}

/** The values a control must be able to emit, at its extremes. */
function extremeValues(spec: ControlSpec): unknown[] {
  if (spec.min === undefined || spec.max === undefined) return [];
  if (spec.ui === 'list') {
    const fill = (v: number): number[] => Array.from({ length: spec.maxItems ?? 1 }, () => v);
    return [[], [spec.min], [spec.max], fill(spec.min), fill(spec.max)];
  }
  return [spec.min, spec.max];
}

const entries = Object.entries(CONTROLS);

/* ------------------------------------------------------------------- tests */

describe('coverage', () => {
  it('registers a control for every Scenario path that has help', () => {
    // `help.ts` also explains the two read-only Touchstone fields, which are set by
    // the file loader and never by the reader. Everything else it explains is a
    // control, and must be registered as one.
    const missing = Object.keys(CONTROL_HELP).filter(
      (p) => !NON_CONTROL_PATHS.has(p) && CONTROLS[p] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('has no control for a path that is not a live Scenario field', () => {
    const live = new Set(controlPaths(fullScenario()).map(canonicalPath));
    const orphans = Object.keys(CONTROLS).filter((p) => !live.has(p));
    expect(orphans).toEqual([]);
  });

  it('covers every Scenario path that is not explicitly excluded', () => {
    const missing = controlPaths(fullScenario())
      .map(canonicalPath)
      .filter((p) => !NON_CONTROL_PATHS.has(p) && CONTROLS[p] === undefined);
    expect(missing).toEqual([]);
  });

  it('does not offer a control for a path excluded from the panel', () => {
    for (const p of NON_CONTROL_PATHS) expect(CONTROLS[p], p).toBeUndefined();
  });

  it('covers more than eighty controls', () => {
    expect(entries.length).toBeGreaterThan(80);
  });
});

describe('ui kind matches the schema type', () => {
  const expected: Record<string, readonly string[]> = {
    slider: ['ZodNumber'],
    'log-slider': ['ZodNumber'],
    select: ['ZodEnum'],
    toggle: ['ZodBoolean'],
    text: ['ZodString'],
    list: ['ZodArray'],
  };

  it.each(entries)('%s', (path, spec) => {
    expect(expected[spec.ui], `${path} (${spec.ui})`).toContain(typeNameAt(path));
  });
});

describe('select options', () => {
  const selects = entries.filter(([, s]) => s.ui === 'select');

  it('exist', () => {
    expect(selects.length).toBeGreaterThan(8);
  });

  it.each(selects)('%s offers exactly the schema members, in order', (path, spec) => {
    expect(spec.options).toBeDefined();
    expect([...(spec.options ?? [])]).toEqual([...(defOf(schemaAt(path)).values ?? [])]);
  });
});

describe('control range lies inside the schema range', () => {
  const ranged = entries.filter(([, s]) => s.min !== undefined || s.max !== undefined);

  it('covers every slider and list', () => {
    const unranged = entries.filter(
      ([, s]) => (s.ui === 'slider' || s.ui === 'log-slider' || s.ui === 'list') && s.min === undefined,
    );
    // `crosstalk.aggressors` is a list of objects: its bound is a length, not a value.
    expect(unranged.map(([p]) => p)).toEqual(['crosstalk.aggressors']);
  });

  it.each(ranged)('%s accepts its own extremes', (path, spec) => {
    expect(spec.min).toBeDefined();
    expect(spec.max).toBeDefined();
    expect(spec.min!).toBeLessThan(spec.max!);
    for (const v of extremeValues(spec)) {
      expect(acceptsValue(path, v), `${path} = ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it('a list never offers more elements than the schema allows', () => {
    for (const [path, spec] of entries) {
      if (spec.ui !== 'list') continue;
      expect(spec.maxItems, path).toBeDefined();
      const filler: unknown = path === 'crosstalk.aggressors' ? aggressorSchema.parse({}) : (spec.min ?? 0);
      const full = Array.from({ length: spec.maxItems! }, () => filler);
      expect(acceptsValue(path, full), `${path} at ${spec.maxItems} items`).toBe(true);
    }
  });
});

describe('defaults sit inside the control range', () => {
  const ranged = entries.filter(([, s]) => s.min !== undefined && s.ui !== 'list');

  it.each(ranged)('%s', (path, spec) => {
    const v = valueAtPath(fullScenario(), path);
    expect(typeof v, path).toBe('number');
    expect(v as number).toBeGreaterThanOrEqual(spec.min!);
    expect(v as number).toBeLessThanOrEqual(spec.max!);
  });

  it('every default list element is inside its element range', () => {
    const s = fullScenario();
    for (const [path, spec] of entries) {
      if (spec.ui !== 'list' || spec.min === undefined) continue;
      const list = valueAtPath(s, path);
      expect(Array.isArray(list), path).toBe(true);
      for (const v of list as number[]) {
        expect(v, `${path} element`).toBeGreaterThanOrEqual(spec.min);
        expect(v, `${path} element`).toBeLessThanOrEqual(spec.max!);
      }
    }
  });
});

describe('stepping', () => {
  const stepped = entries.filter(([, s]) => s.step !== undefined);

  it.each(stepped)('%s divides its range into a usable number of steps', (path, spec) => {
    expect(spec.step!, path).toBeGreaterThan(0);
    const span =
      spec.ui === 'log-slider' ? Math.log10(spec.max!) - Math.log10(spec.min!) : spec.max! - spec.min!;
    const steps = span / spec.step!;
    expect(steps, `${path}: ${steps} steps`).toBeGreaterThanOrEqual(4);
    expect(steps, `${path}: ${steps} steps`).toBeLessThanOrEqual(1e6);
  });

  it('every slider and list declares a step', () => {
    const missing = entries.filter(([, s]) => s.min !== undefined && s.step === undefined).map(([p]) => p);
    expect(missing).toEqual([]);
  });
});

describe('logarithmic controls', () => {
  const logs = entries.filter(([, s]) => s.ui === 'log-slider');

  it('exist', () => {
    expect(logs.length).toBeGreaterThan(10);
  });

  it.each(logs)('%s starts above zero', (path, spec) => {
    expect(spec.min!, path).toBeGreaterThan(0);
  });
});

describe('integer controls', () => {
  it.each(entries)('%s agrees with the schema about being an integer', (path, spec) => {
    if (spec.ui !== 'slider' && spec.ui !== 'log-slider') return;
    expect(spec.integer === true, `${path}: registry`).toBe(isIntegerInSchema(path));
  });

  it('integer controls have integer bounds and steps', () => {
    for (const [path, spec] of entries) {
      if (spec.integer !== true) continue;
      expect(Number.isInteger(spec.min), `${path} min`).toBe(true);
      expect(Number.isInteger(spec.max), `${path} max`).toBe(true);
      // A log control steps in decades, so its step is not in field units.
      if (spec.ui !== 'log-slider') {
        expect(Number.isInteger(spec.step), `${path} step`).toBe(true);
      }
      for (const p of spec.snapPoints ?? []) {
        expect(Number.isInteger(p), `${path} snap ${p}`).toBe(true);
      }
    }
  });
});

describe('snap points', () => {
  const snapped = entries.filter(([, s]) => s.snapPoints !== undefined);

  it('exist', () => {
    expect(snapped.length).toBeGreaterThan(10);
  });

  it.each(snapped)('%s snaps only to values it can reach', (path, spec) => {
    const points = spec.snapPoints!;
    expect(points.length, path).toBeGreaterThan(0);
    for (const p of points) {
      expect(p, `${path} snap ${p}`).toBeGreaterThanOrEqual(spec.min!);
      expect(p, `${path} snap ${p}`).toBeLessThanOrEqual(spec.max!);
    }
    const sorted = [...points].sort((a, b) => a - b);
    expect(points, `${path} snap points are not ascending`).toEqual(sorted);
    expect(new Set(points).size, `${path} duplicate snap point`).toBe(points.length);
  });
});

describe('text controls', () => {
  it('declare a length the schema accepts', () => {
    const texts = entries.filter(([, s]) => s.ui === 'text');
    expect(texts.length).toBeGreaterThan(0);
    for (const [path, spec] of texts) {
      expect(spec.maxLength, path).toBeDefined();
      expect(acceptsValue(path, '0'.repeat(spec.maxLength!)), path).toBe(true);
    }
  });
});

describe('visibility conditions', () => {
  const conditional = entries.filter(([, s]) => s.showWhen !== undefined);

  it('exist', () => {
    expect(conditional.length).toBeGreaterThan(20);
  });

  it.each(conditional)('%s depends on a real control', (path, spec) => {
    const dep = spec.showWhen!;
    expect(dep.path, `${path} depends on itself`).not.toBe(path);
    const target = CONTROLS[dep.path];
    expect(target, `${path} depends on unknown control ${dep.path}`).toBeDefined();
    expect(dep.equals.length, `${path} has no trigger values`).toBeGreaterThan(0);

    if (target!.ui === 'select') {
      for (const v of dep.equals) {
        expect(target!.options, `${dep.path}`).toContain(v);
      }
    } else if (target!.ui === 'toggle') {
      for (const v of dep.equals) expect(typeof v, `${dep.path}`).toBe('boolean');
    }
  });

  it("an aggressor depends on its own settings, not the first aggressor's", () => {
    const s = fullScenario();
    const two: Scenario = {
      ...s,
      crosstalk: {
        ...s.crosstalk,
        aggressors: [aggressorSchema.parse({ end: 'near' }), aggressorSchema.parse({ end: 'far' })],
      },
    };
    expect(isVisible(two, 'crosstalk.aggressors.[].kb', 0)).toBe(true);
    expect(isVisible(two, 'crosstalk.aggressors.[].kb', 1)).toBe(false);
    expect(isVisible(two, 'crosstalk.aggressors.[].kf', 1)).toBe(true);
  });

  it('hides channel models that are not selected', () => {
    const s = defaultScenario();
    expect(s.channel.kind).toBe('lossy');
    expect(isVisible(s, 'channel.lossy.er')).toBe(true);
    expect(isVisible(s, 'channel.rlc.l')).toBe(false);
    expect(isVisible(s, 'channel.terminationZ')).toBe(true);
  });

  it('treats an unconditional control as always visible', () => {
    expect(isVisible(defaultScenario(), 'source.symbolRate')).toBe(true);
    expect(isVisible(defaultScenario(), 'nonexistent.path')).toBe(true);
  });
});

describe('panels and groups', () => {
  it('every control belongs to a declared group of its own panel', () => {
    const known = new Set(GROUPS.map((g) => `${g.panel}.${g.id}`));
    const stray = entries
      .filter(([, s]) => !known.has(`${s.panel}.${s.group}`))
      .map(([p, s]) => `${p} -> ${s.panel}.${s.group}`);
    expect(stray).toEqual([]);
  });

  it('every declared group holds at least one control', () => {
    const used = new Set(entries.map(([, s]) => `${s.panel}.${s.group}`));
    const empty = GROUPS.filter((g) => !used.has(`${g.panel}.${g.id}`)).map((g) => g.id);
    expect(empty).toEqual([]);
  });

  it('every declared panel holds at least one group', () => {
    const used = new Set(GROUPS.map((g) => g.panel));
    expect(PANELS.filter((p) => !used.has(p.id)).map((p) => p.id)).toEqual([]);
  });

  it('every group names a declared panel', () => {
    const known = new Set(PANELS.map((p) => p.id));
    expect(GROUPS.filter((g) => !known.has(g.panel)).map((g) => g.id)).toEqual([]);
  });

  it('panel order is unique', () => {
    const orders = PANELS.map((p) => p.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('group order is unique within a panel', () => {
    for (const panel of PANELS) {
      const orders = GROUPS.filter((g) => g.panel === panel.id).map((g) => g.order);
      expect(new Set(orders).size, panel.id).toBe(orders.length);
    }
  });

  it('control order is unique within a group', () => {
    const seen = new Map<string, Set<number>>();
    for (const [path, spec] of entries) {
      const key = `${spec.panel}.${spec.group}`;
      const set = seen.get(key) ?? new Set<number>();
      expect(set.has(spec.order), `${path}: order ${spec.order} is taken in ${key}`).toBe(false);
      set.add(spec.order);
      seen.set(key, set);
    }
  });

  it('panels and groups carry human titles', () => {
    for (const p of PANELS) {
      expect(p.title.trim().length, p.id).toBeGreaterThan(2);
      expect(p.summary.trim().length, p.id).toBeGreaterThan(20);
    }
    for (const g of GROUPS) expect(g.title.trim().length, g.id).toBeGreaterThan(2);
  });
});

describe('ordering and lookup', () => {
  it('orders every control, panel by panel', () => {
    const ordered = orderedPaths();
    expect(ordered.length).toBe(entries.length);
    expect(new Set(ordered).size).toBe(ordered.length);
    const panelSequence = ordered.map((p) => CONTROLS[p]!.panel);
    const firstSeen = [...new Set(panelSequence)];
    expect(firstSeen).toEqual(PANELS.map((p) => p.id));
  });

  it('never interleaves two groups of the same panel', () => {
    const byPanel = new Map<PanelId, string[]>();
    for (const p of orderedPaths()) {
      const spec = CONTROLS[p]!;
      byPanel.set(spec.panel, [...(byPanel.get(spec.panel) ?? []), spec.group]);
    }
    for (const [panel, groups] of byPanel) {
      const runs = groups.filter((g, i) => g !== groups[i - 1]);
      expect(new Set(runs).size, panel).toBe(runs.length);
    }
  });

  it('filters by panel and by group', () => {
    expect(controlsIn('view')).toContain('view.spanUi');
    expect(controlsIn('view', 'cursors')).toEqual(['view.cursorsT', 'view.cursorsV']);
    expect(controlsIn('view', 'cursors')).not.toContain('view.spanUi');
  });

  it('lists the groups of a panel in order', () => {
    expect(groupsIn('eq').map((g) => g.id)).toEqual(['ffe', 'ctle', 'dfe', 'slicer']);
  });

  it('canonicalises an indexed path on lookup', () => {
    expect(controlFor('crosstalk.aggressors.3.kb')).toBe(CONTROLS['crosstalk.aggressors.[].kb']);
    expect(controlFor('crosstalk.aggressors.0.pattern.prbs')).toBeDefined();
    expect(controlFor('no.such.control')).toBeUndefined();
  });
});

describe('valueAtPath', () => {
  const s = fullScenario();

  it('reads a plain path', () => {
    expect(valueAtPath(s, 'source.symbolRate')).toBe(s.source.symbolRate);
  });

  it('reads an indexed path', () => {
    expect(valueAtPath(s, 'crosstalk.aggressors.[].kb', 0)).toBe(s.crosstalk.aggressors[0]!.kb);
  });

  it('returns undefined rather than throwing on a missing path', () => {
    expect(valueAtPath(s, 'source.nope.deeper')).toBeUndefined();
    expect(valueAtPath(s, 'crosstalk.aggressors.[].kb', 7)).toBeUndefined();
  });
});

describe('quantize', () => {
  const linear: ControlSpec = {
    ui: 'slider',
    min: 0,
    max: 1,
    step: 0.1,
    panel: 'view',
    group: 'traces',
    order: 99,
  };

  it('clamps to the range', () => {
    expect(quantize(linear, -5)).toBe(0);
    expect(quantize(linear, 5)).toBe(1);
  });

  it('lands on a step', () => {
    expect(quantize(linear, 0.34)).toBeCloseTo(0.3, 12);
    expect(quantize(linear, 0.36)).toBeCloseTo(0.4, 12);
  });

  it('does not leave floating-point litter', () => {
    expect(quantize(linear, 0.3)).toBe(0.3);
    expect(String(quantize(linear, 0.7))).toBe('0.7');
  });

  it('rounds integer controls to integers', () => {
    const bits = CONTROLS['scope.adcBits']!;
    expect(Number.isInteger(quantize(bits, 9.4))).toBe(true);
    expect(quantize(bits, 9.4)).toBe(9);
  });

  it('snaps to a nearby snap point', () => {
    const z = CONTROLS['channel.terminationZ']!;
    expect(quantize(z, 50.2)).toBe(50);
    // Two ohms away is more than half a one-ohm step: no snapping, just stepping.
    expect(quantize(z, 53)).toBe(53);
  });

  it('steps a log control in decades', () => {
    const bw = CONTROLS['channel.rc.bw']!;
    const a = quantize(bw, 1e9);
    expect(a / 1e9).toBeCloseTo(1, 6);
    expect(quantize(bw, 1e12)).toBe(bw.max);
    expect(quantize(bw, 1)).toBe(bw.min);
  });

  it('returns the minimum for a value that is not a number', () => {
    expect(quantize(linear, Number.NaN)).toBe(0);
  });

  it('passes through a control with no range', () => {
    const list = CONTROLS['crosstalk.aggressors']!;
    expect(quantize(list, 3)).toBe(3);
  });
});

describe('normalize and denormalize', () => {
  it('round-trip a linear control', () => {
    const spec = CONTROLS['sampling.strobePhase']!;
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(denormalize(spec, normalize(spec, v))).toBeCloseTo(v, 9);
    }
  });

  it('round-trip a log control', () => {
    const spec = CONTROLS['source.symbolRate']!;
    for (const v of [1e8, 1e9, 6.4e9, 3.2e10]) {
      expect(denormalize(spec, normalize(spec, v)) / v).toBeCloseTo(1, 3);
    }
  });

  it('places the midpoint of a log control at the geometric mean', () => {
    const spec = CONTROLS['channel.rc.bw']!;
    const mid = denormalize(spec, 0.5);
    expect(mid / Math.sqrt(spec.min! * spec.max!)).toBeCloseTo(1, 2);
  });

  it('clamps the slider position', () => {
    const spec = CONTROLS['sampling.strobePhase']!;
    expect(denormalize(spec, -1)).toBe(0);
    expect(denormalize(spec, 2)).toBe(1);
  });
});
