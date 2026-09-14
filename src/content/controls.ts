/**
 * The control registry: how each Scenario field is presented.
 *
 * The Zod schema in `src/state/scenario.ts` states what a field may legally be.
 * That is not the same question as what a slider should span. `symbolRate` is
 * `positive().max(1e12)` because a terahertz symbol rate is not *invalid*, merely
 * absurd; a slider running from zero to one terahertz is unusable, and one running
 * from 100 MHz to 32 GHz is the instrument a reader actually wants. Likewise
 * `riseTime` is capped at a microsecond by the schema and at 200 ps by the panel.
 *
 * So there are two ranges per field, and they mean different things:
 *
 *   schema range  - validity. A permalink outside it is rejected.
 *   control range - usability. What the panel offers.
 *
 * The invariant that matters is that the control range lies *inside* the schema
 * range, in every case and in both directions, so no slider can produce a value
 * the codec would then refuse. `__tests__/controls.test.ts` proves that by setting
 * each control to its declared minimum and maximum and re-parsing the Scenario.
 * It also proves the registry and `help.ts` cover exactly the same set of paths:
 * a control cannot exist without an explanation, and an explanation cannot exist
 * for a control that was removed.
 *
 * Keys are the canonical paths from `help.ts`, so array elements collapse to `[]`
 * and aggressor three is described once, not eight times.
 */

import { canonicalPath } from './help';

/* --------------------------------------------------------------------- types */

/**
 * The affordance a control is rendered as.
 *
 * `log-slider` is a distinct kind rather than a flag because the arithmetic of
 * stepping, snapping and reading back differs: its `step` is measured in decades,
 * not in the units of the field.
 */
export type ControlUi = 'slider' | 'log-slider' | 'select' | 'toggle' | 'text' | 'list';

export type PanelId =
  | 'source'
  | 'channel'
  | 'impairments'
  | 'crosstalk'
  | 'eq'
  | 'cdr'
  | 'sampling'
  | 'analysis'
  | 'scope'
  | 'view';

/** A condition under which a control is worth showing at all. */
export interface ShowWhen {
  /** Canonical path of the control this one depends on. */
  path: string;
  /** Values of that control for which this control is relevant. */
  equals: readonly (string | number | boolean)[];
}

export interface ControlSpec {
  ui: ControlUi;
  /**
   * Lowest offered value. For `list` controls this bounds each *element*, not the
   * list length - that is `maxItems`.
   */
  min?: number;
  max?: number;
  /**
   * Increment. Field units for `slider` and `list`; **decades** for `log-slider`,
   * so 0.01 is a hundred steps per decade.
   */
  step?: number;
  /** Values the control settles onto when released nearby: powers of two, round rates. */
  snapPoints?: readonly number[];
  /** Allowed values, in schema order. Exactly the Zod enum members. */
  options?: readonly string[];
  /** Maximum list length, for `list`. */
  maxItems?: number;
  /** Maximum string length, for `text`. */
  maxLength?: number;
  /** The field is an integer in the schema, so the control may only emit integers. */
  integer?: boolean;
  panel: PanelId;
  group: string;
  /** Position within the group. Unique per group. */
  order: number;
  /** Relevance condition; absent means always shown. */
  showWhen?: ShowWhen;
  /** Folded away behind a disclosure by default: correct, but rarely moved. */
  advanced?: boolean;
}

export interface GroupSpec {
  panel: PanelId;
  id: string;
  title: string;
  /** One line under the group heading. */
  note?: string;
  order: number;
}

export interface PanelSpec {
  id: PanelId;
  title: string;
  /** What this panel is for, in one sentence. */
  summary: string;
  order: number;
}

/* -------------------------------------------------------------- enum sources */

/**
 * These lists are duplicated from the schema deliberately: the registry states the
 * order the panel offers, and the test asserts it matches the schema member for
 * member. A silent divergence - an option added to the schema and never surfaced -
 * is exactly what that assertion is for.
 */
export const PATTERN_KINDS = [
  'prbs',
  'clock',
  'clock-div-n',
  'lone-one',
  'lone-zero',
  'walking-one',
  'walking-zero',
  'all-ones',
  'all-zeros',
  'burst-idle',
  'custom',
  'worst-case-isi',
] as const;

export const PRBS_ORDERS = [
  'prbs7',
  'prbs9',
  'prbs11',
  'prbs13',
  'prbs15',
  'prbs20',
  'prbs23',
  'prbs31',
] as const;

export const EDGE_SHAPES = ['linear', 'rc', 'gaussian', 'bessel', 'brickwall'] as const;

export const CHANNEL_KINDS = ['ideal', 'rc', 'rlc', 'tline', 'lossy', 'touchstone'] as const;

const SEED_MAX = 65535;

/* ------------------------------------------------------------------- panels */

export const PANELS: readonly PanelSpec[] = [
  {
    id: 'source',
    title: 'Transmitter',
    summary: 'What is driven onto the net: the bit pattern, the swing and the edge.',
    order: 1,
  },
  {
    id: 'channel',
    title: 'Channel',
    summary: 'What the board does between the driver pin and the receiver pin.',
    order: 2,
  },
  {
    id: 'impairments',
    title: 'Noise and jitter',
    summary: 'Everything random or periodic added on the way, and the seed behind it.',
    order: 3,
  },
  {
    id: 'crosstalk',
    title: 'Crosstalk and SSO',
    summary: 'What the neighbouring nets and the shared return path contribute.',
    order: 4,
  },
  {
    id: 'eq',
    title: 'Equalization',
    summary: 'The receiver trying to undo the channel: FFE, CTLE, DFE, slicer.',
    order: 5,
  },
  {
    id: 'cdr',
    title: 'Clock recovery',
    summary: 'How the sampling clock is derived, and which jitter it tracks.',
    order: 6,
  },
  {
    id: 'sampling',
    title: 'Receiver sampling',
    summary: 'Where in the unit interval the decision is taken, and what the latch needs.',
    order: 7,
  },
  {
    id: 'analysis',
    title: 'Analysis',
    summary: 'Which engine builds the eye and the bathtub, and how far down it goes.',
    order: 8,
  },
  {
    id: 'scope',
    title: 'Oscilloscope',
    summary: 'The instrument itself: bandwidth, digitiser, probe, math.',
    order: 9,
  },
  {
    id: 'view',
    title: 'Display',
    summary: 'What is on screen and where. Nothing here changes the physics.',
    order: 10,
  },
];

/* ------------------------------------------------------------------- groups */

export const GROUPS: readonly GroupSpec[] = [
  { panel: 'source', id: 'pattern', title: 'Test pattern', note: 'What the transmitter sends.', order: 1 },
  { panel: 'source', id: 'levels', title: 'Rate and levels', order: 2 },
  { panel: 'source', id: 'edge', title: 'Edge', note: 'The transition, and what launches it.', order: 3 },

  { panel: 'channel', id: 'model', title: 'Channel model', order: 1 },
  { panel: 'channel', id: 'rc', title: 'RC channel', order: 2 },
  { panel: 'channel', id: 'rlc', title: 'RLC channel', order: 3 },
  { panel: 'channel', id: 'tline', title: 'Transmission line', order: 4 },
  {
    panel: 'channel',
    id: 'lossy',
    title: 'Lossy line',
    note: 'Skin effect, dielectric loss, vias.',
    order: 5,
  },
  { panel: 'channel', id: 'touchstone', title: 'Touchstone file', order: 6 },
  { panel: 'channel', id: 'termination', title: 'Receiver termination', order: 7 },

  { panel: 'impairments', id: 'noise', title: 'Voltage noise', order: 1 },
  { panel: 'impairments', id: 'jitter', title: 'Jitter', order: 2 },
  { panel: 'impairments', id: 'supply', title: 'Supply', order: 3 },

  { panel: 'crosstalk', id: 'coupling', title: 'Aggressors', order: 1 },
  { panel: 'crosstalk', id: 'aggressor', title: 'Selected aggressor', order: 2 },
  { panel: 'crosstalk', id: 'aggressor-pattern', title: 'Aggressor pattern', order: 3 },
  { panel: 'crosstalk', id: 'sso', title: 'Simultaneous switching', order: 4 },

  { panel: 'eq', id: 'ffe', title: 'Transmit FFE', order: 1 },
  { panel: 'eq', id: 'ctle', title: 'CTLE', order: 2 },
  { panel: 'eq', id: 'dfe', title: 'DFE', order: 3 },
  { panel: 'eq', id: 'slicer', title: 'Slicer', order: 4 },

  { panel: 'cdr', id: 'loop', title: 'Recovery loop', order: 1 },

  { panel: 'sampling', id: 'resolution', title: 'Simulation resolution', order: 1 },
  { panel: 'sampling', id: 'strobe', title: 'Strobe', order: 2 },
  { panel: 'sampling', id: 'latch', title: 'Latch requirements', order: 3 },

  { panel: 'analysis', id: 'engine', title: 'Engine', order: 1 },
  { panel: 'analysis', id: 'eye', title: 'Eye rendering', order: 2 },

  { panel: 'scope', id: 'frontend', title: 'Front end and probe', order: 1 },
  { panel: 'scope', id: 'digitizer', title: 'Digitiser', order: 2 },
  { panel: 'scope', id: 'math', title: 'Math', order: 3 },

  { panel: 'view', id: 'window', title: 'Time window', order: 1 },
  { panel: 'view', id: 'traces', title: 'Traces', order: 2 },
  { panel: 'view', id: 'cursors', title: 'Cursors', order: 3 },
];

/* ------------------------------------------------------------ pattern block */

/**
 * The pattern controls, mounted wherever a pattern lives.
 *
 * The victim's pattern and each aggressor's pattern are the same eight controls,
 * so they are generated once and mounted twice. `showWhen` refers back to the
 * `kind` control of the same mounting, which keeps the aggressor's selector
 * independent of the victim's.
 */
function patternControls(
  prefix: string,
  panel: PanelId,
  group: string,
  base: number,
): Record<string, ControlSpec> {
  const kind = `${prefix}.kind`;
  const on = (...kinds: string[]): ShowWhen => ({ path: kind, equals: kinds });
  return {
    [kind]: { ui: 'select', options: PATTERN_KINDS, panel, group, order: base + 1 },
    [`${prefix}.prbs`]: {
      ui: 'select',
      options: PRBS_ORDERS,
      panel,
      group,
      order: base + 2,
      showWhen: on('prbs'),
    },
    [`${prefix}.seed`]: {
      ui: 'slider',
      min: 1,
      max: SEED_MAX,
      step: 1,
      integer: true,
      panel,
      group,
      order: base + 3,
      showWhen: on('prbs'),
    },
    [`${prefix}.divN`]: {
      ui: 'slider',
      min: 1,
      max: 64,
      step: 1,
      integer: true,
      snapPoints: [1, 2, 4, 8, 16, 32, 64],
      panel,
      group,
      order: base + 4,
      showWhen: on('clock-div-n'),
    },
    [`${prefix}.frame`]: {
      ui: 'slider',
      min: 2,
      max: 256,
      step: 1,
      integer: true,
      snapPoints: [8, 16, 32, 64, 128, 256],
      panel,
      group,
      order: base + 5,
      showWhen: on('lone-one', 'lone-zero', 'walking-one', 'walking-zero'),
    },
    [`${prefix}.burst`]: {
      ui: 'slider',
      min: 1,
      max: 256,
      step: 1,
      integer: true,
      panel,
      group,
      order: base + 6,
      showWhen: on('burst-idle'),
    },
    [`${prefix}.custom`]: {
      ui: 'text',
      maxLength: 256,
      panel,
      group,
      order: base + 7,
      showWhen: on('custom'),
    },
    [`${prefix}.invert`]: { ui: 'toggle', panel, group, order: base + 8 },
  };
}

/* ----------------------------------------------------------- the registry */

export const CONTROLS: Record<string, ControlSpec> = {
  /* ------------------------------------------------------------- transmitter */

  ...patternControls('source.pattern', 'source', 'pattern', 0),

  'source.symbolRate': {
    ui: 'log-slider',
    min: 1e8,
    max: 3.2e10,
    step: 0.005,
    snapPoints: [1e9, 2e9, 3.2e9, 4.8e9, 6.4e9, 8e9, 1.6e10, 3.2e10],
    panel: 'source',
    group: 'levels',
    order: 1,
  },
  'source.levels': {
    ui: 'select',
    options: ['nrz', 'pam4'],
    panel: 'source',
    group: 'levels',
    order: 2,
  },
  'source.amplitude': {
    ui: 'slider',
    min: 0.05,
    max: 2,
    step: 0.01,
    panel: 'source',
    group: 'levels',
    order: 3,
  },
  'source.dcOffset': {
    ui: 'slider',
    min: -1,
    max: 1,
    step: 0.005,
    panel: 'source',
    group: 'levels',
    order: 4,
    advanced: true,
  },

  'source.riseTime': {
    ui: 'log-slider',
    min: 1e-12,
    max: 2e-10,
    step: 0.01,
    panel: 'source',
    group: 'edge',
    order: 1,
  },
  'source.fallTime': {
    ui: 'log-slider',
    min: 1e-12,
    max: 2e-10,
    step: 0.01,
    panel: 'source',
    group: 'edge',
    order: 2,
  },
  'source.edgeShape': {
    ui: 'select',
    options: EDGE_SHAPES,
    panel: 'source',
    group: 'edge',
    order: 3,
  },
  'source.sourceZ': {
    ui: 'slider',
    min: 5,
    max: 120,
    step: 0.5,
    snapPoints: [25, 40, 50, 100],
    panel: 'source',
    group: 'edge',
    order: 4,
  },

  /* ----------------------------------------------------------------- channel */

  'channel.kind': { ui: 'select', options: CHANNEL_KINDS, panel: 'channel', group: 'model', order: 1 },

  'channel.rc.bw': {
    ui: 'log-slider',
    min: 1e8,
    max: 1e11,
    step: 0.01,
    panel: 'channel',
    group: 'rc',
    order: 1,
    showWhen: { path: 'channel.kind', equals: ['rc'] },
  },

  'channel.rlc.r': {
    ui: 'slider',
    min: 0,
    max: 200,
    step: 0.5,
    panel: 'channel',
    group: 'rlc',
    order: 1,
    showWhen: { path: 'channel.kind', equals: ['rlc'] },
  },
  'channel.rlc.l': {
    ui: 'log-slider',
    min: 1e-11,
    max: 1e-7,
    step: 0.01,
    panel: 'channel',
    group: 'rlc',
    order: 2,
    showWhen: { path: 'channel.kind', equals: ['rlc'] },
  },
  'channel.rlc.c': {
    ui: 'log-slider',
    min: 1e-14,
    max: 1e-10,
    step: 0.01,
    panel: 'channel',
    group: 'rlc',
    order: 3,
    showWhen: { path: 'channel.kind', equals: ['rlc'] },
  },

  'channel.tline.z0': {
    ui: 'slider',
    min: 20,
    max: 120,
    step: 0.5,
    snapPoints: [40, 50, 75, 85, 100],
    panel: 'channel',
    group: 'tline',
    order: 1,
    showWhen: { path: 'channel.kind', equals: ['tline'] },
  },
  'channel.tline.length': {
    ui: 'slider',
    min: 0.005,
    max: 2,
    step: 0.005,
    panel: 'channel',
    group: 'tline',
    order: 2,
    showWhen: { path: 'channel.kind', equals: ['tline'] },
  },
  'channel.tline.velocityFactor': {
    ui: 'slider',
    min: 0.3,
    max: 0.9,
    step: 0.005,
    panel: 'channel',
    group: 'tline',
    order: 3,
    showWhen: { path: 'channel.kind', equals: ['tline'] },
  },
  'channel.tline.loadZ': {
    ui: 'log-slider',
    min: 10,
    max: 1e6,
    step: 0.02,
    snapPoints: [50, 1e6],
    panel: 'channel',
    group: 'tline',
    order: 4,
    showWhen: { path: 'channel.kind', equals: ['tline'] },
  },
  'channel.tline.loadC': {
    ui: 'slider',
    min: 0,
    max: 5e-12,
    step: 1e-13,
    panel: 'channel',
    group: 'tline',
    order: 5,
    showWhen: { path: 'channel.kind', equals: ['tline'] },
  },
  'channel.tline.bounces': {
    ui: 'slider',
    min: 1,
    max: 64,
    step: 1,
    integer: true,
    panel: 'channel',
    group: 'tline',
    order: 6,
    advanced: true,
    showWhen: { path: 'channel.kind', equals: ['tline'] },
  },

  'channel.lossy.z0': {
    ui: 'slider',
    min: 20,
    max: 120,
    step: 0.5,
    snapPoints: [40, 50, 85, 100],
    panel: 'channel',
    group: 'lossy',
    order: 1,
    showWhen: { path: 'channel.kind', equals: ['lossy'] },
  },
  'channel.lossy.length': {
    ui: 'slider',
    min: 0.01,
    max: 2,
    step: 0.005,
    panel: 'channel',
    group: 'lossy',
    order: 2,
    showWhen: { path: 'channel.kind', equals: ['lossy'] },
  },
  'channel.lossy.er': {
    ui: 'slider',
    min: 2,
    max: 12,
    step: 0.05,
    snapPoints: [3.0, 3.7, 4.3],
    panel: 'channel',
    group: 'lossy',
    order: 3,
    showWhen: { path: 'channel.kind', equals: ['lossy'] },
  },
  'channel.lossy.dielectricLossEnabled': {
    ui: 'toggle',
    panel: 'channel',
    group: 'lossy',
    order: 4,
    showWhen: { path: 'channel.kind', equals: ['lossy'] },
  },
  'channel.lossy.lossTangent': {
    ui: 'slider',
    min: 0,
    max: 0.05,
    step: 0.0005,
    panel: 'channel',
    group: 'lossy',
    order: 5,
    showWhen: { path: 'channel.lossy.dielectricLossEnabled', equals: [true] },
  },
  'channel.lossy.referenceFreq': {
    ui: 'log-slider',
    min: 1e8,
    max: 1e11,
    step: 0.05,
    snapPoints: [1e9, 1e10],
    panel: 'channel',
    group: 'lossy',
    order: 6,
    advanced: true,
    showWhen: { path: 'channel.lossy.dielectricLossEnabled', equals: [true] },
  },
  'channel.lossy.conductorLossEnabled': {
    ui: 'toggle',
    panel: 'channel',
    group: 'lossy',
    order: 7,
    showWhen: { path: 'channel.kind', equals: ['lossy'] },
  },
  'channel.lossy.conductivity': {
    ui: 'log-slider',
    min: 1e6,
    max: 1e8,
    step: 0.02,
    snapPoints: [5.8e7],
    panel: 'channel',
    group: 'lossy',
    order: 8,
    advanced: true,
    showWhen: { path: 'channel.lossy.conductorLossEnabled', equals: [true] },
  },
  'channel.lossy.traceWidth': {
    ui: 'log-slider',
    min: 2.5e-5,
    max: 1e-3,
    step: 0.01,
    panel: 'channel',
    group: 'lossy',
    order: 9,
    showWhen: { path: 'channel.lossy.conductorLossEnabled', equals: [true] },
  },
  'channel.lossy.thickness': {
    ui: 'log-slider',
    min: 5e-6,
    max: 1e-4,
    step: 0.01,
    snapPoints: [17.5e-6, 35e-6, 70e-6],
    panel: 'channel',
    group: 'lossy',
    order: 10,
    advanced: true,
    showWhen: { path: 'channel.lossy.conductorLossEnabled', equals: [true] },
  },
  'channel.lossy.roughnessEnabled': {
    ui: 'toggle',
    panel: 'channel',
    group: 'lossy',
    order: 11,
    showWhen: { path: 'channel.lossy.conductorLossEnabled', equals: [true] },
  },
  'channel.lossy.roughnessModel': {
    ui: 'select',
    options: ['hammerstad', 'huray'],
    panel: 'channel',
    group: 'lossy',
    order: 12,
    showWhen: { path: 'channel.lossy.roughnessEnabled', equals: [true] },
  },
  'channel.lossy.roughnessRms': {
    ui: 'slider',
    min: 0,
    max: 5e-6,
    step: 1e-7,
    snapPoints: [0.5e-6, 1e-6, 2e-6],
    panel: 'channel',
    group: 'lossy',
    order: 13,
    showWhen: { path: 'channel.lossy.roughnessModel', equals: ['hammerstad'] },
  },
  'channel.lossy.hurayRadius': {
    ui: 'slider',
    min: 0,
    max: 2e-6,
    step: 1e-8,
    panel: 'channel',
    group: 'lossy',
    order: 14,
    showWhen: { path: 'channel.lossy.roughnessModel', equals: ['huray'] },
  },
  'channel.lossy.hurayRatio': {
    ui: 'slider',
    min: 0,
    max: 5,
    step: 0.05,
    panel: 'channel',
    group: 'lossy',
    order: 15,
    showWhen: { path: 'channel.lossy.roughnessModel', equals: ['huray'] },
  },
  'channel.lossy.viaCount': {
    ui: 'slider',
    min: 0,
    max: 16,
    step: 1,
    integer: true,
    panel: 'channel',
    group: 'lossy',
    order: 16,
    showWhen: { path: 'channel.kind', equals: ['lossy'] },
  },
  'channel.lossy.viaC': {
    ui: 'slider',
    min: 0,
    max: 2e-12,
    step: 2.5e-14,
    panel: 'channel',
    group: 'lossy',
    order: 17,
    showWhen: { path: 'channel.kind', equals: ['lossy'] },
  },

  'channel.touchstone.txPort': {
    ui: 'slider',
    min: 1,
    max: 12,
    step: 1,
    integer: true,
    panel: 'channel',
    group: 'touchstone',
    order: 1,
    showWhen: { path: 'channel.kind', equals: ['touchstone'] },
  },
  'channel.touchstone.rxPort': {
    ui: 'slider',
    min: 1,
    max: 12,
    step: 1,
    integer: true,
    panel: 'channel',
    group: 'touchstone',
    order: 2,
    showWhen: { path: 'channel.kind', equals: ['touchstone'] },
  },
  'channel.touchstone.renormalizeTo': {
    ui: 'slider',
    min: 25,
    max: 100,
    step: 0.5,
    snapPoints: [50, 75, 100],
    panel: 'channel',
    group: 'touchstone',
    order: 3,
    showWhen: { path: 'channel.kind', equals: ['touchstone'] },
  },
  'channel.touchstone.mixedMode': {
    ui: 'toggle',
    panel: 'channel',
    group: 'touchstone',
    order: 4,
    showWhen: { path: 'channel.kind', equals: ['touchstone'] },
  },

  'channel.terminationZ': {
    ui: 'slider',
    min: 20,
    max: 200,
    step: 1,
    snapPoints: [40, 50, 60, 120],
    panel: 'channel',
    group: 'termination',
    order: 1,
  },
  'channel.terminationC': {
    ui: 'slider',
    min: 0,
    max: 2e-12,
    step: 2.5e-14,
    panel: 'channel',
    group: 'termination',
    order: 2,
  },

  /* ------------------------------------------------------------- impairments */

  'impairments.seed': {
    ui: 'slider',
    min: 1,
    max: SEED_MAX,
    step: 1,
    integer: true,
    panel: 'impairments',
    group: 'noise',
    order: 1,
  },
  'impairments.noiseRms': {
    ui: 'slider',
    min: 0,
    max: 0.02,
    step: 1e-4,
    panel: 'impairments',
    group: 'noise',
    order: 2,
  },
  'impairments.noiseFlickerCorner': {
    ui: 'slider',
    min: 0,
    max: 1e8,
    step: 1e6,
    panel: 'impairments',
    group: 'noise',
    order: 3,
    advanced: true,
  },

  'impairments.randomJitterRms': {
    ui: 'slider',
    min: 0,
    max: 5e-12,
    step: 1e-14,
    panel: 'impairments',
    group: 'jitter',
    order: 1,
  },
  'impairments.boundedJitterPp': {
    ui: 'slider',
    min: 0,
    max: 2e-11,
    step: 1e-13,
    panel: 'impairments',
    group: 'jitter',
    order: 2,
  },
  'impairments.periodicJitterAmp': {
    ui: 'slider',
    min: 0,
    max: 2e-11,
    step: 1e-13,
    panel: 'impairments',
    group: 'jitter',
    order: 3,
  },
  'impairments.periodicJitterFreq': {
    ui: 'log-slider',
    min: 1e5,
    max: 1e10,
    step: 0.02,
    panel: 'impairments',
    group: 'jitter',
    order: 4,
  },
  'impairments.dcdFraction': {
    ui: 'slider',
    min: -0.2,
    max: 0.2,
    step: 0.002,
    panel: 'impairments',
    group: 'jitter',
    order: 5,
  },

  'impairments.supplyDroop': {
    ui: 'slider',
    min: 0,
    max: 0.3,
    step: 0.002,
    panel: 'impairments',
    group: 'supply',
    order: 1,
  },

  /* --------------------------------------------------------------- crosstalk */

  'crosstalk.enabled': { ui: 'toggle', panel: 'crosstalk', group: 'coupling', order: 1 },
  'crosstalk.aggressors': {
    ui: 'list',
    maxItems: 8,
    panel: 'crosstalk',
    group: 'coupling',
    order: 2,
    showWhen: { path: 'crosstalk.enabled', equals: [true] },
  },

  'crosstalk.aggressors.[].enabled': {
    ui: 'toggle',
    panel: 'crosstalk',
    group: 'aggressor',
    order: 1,
  },
  'crosstalk.aggressors.[].end': {
    ui: 'select',
    options: ['near', 'far'],
    panel: 'crosstalk',
    group: 'aggressor',
    order: 2,
  },
  'crosstalk.aggressors.[].kb': {
    ui: 'slider',
    min: 0,
    max: 0.2,
    step: 0.002,
    panel: 'crosstalk',
    group: 'aggressor',
    order: 3,
    showWhen: { path: 'crosstalk.aggressors.[].end', equals: ['near'] },
  },
  'crosstalk.aggressors.[].kf': {
    ui: 'slider',
    min: 0,
    max: 2e-11,
    step: 1e-13,
    panel: 'crosstalk',
    group: 'aggressor',
    order: 4,
    showWhen: { path: 'crosstalk.aggressors.[].end', equals: ['far'] },
  },
  'crosstalk.aggressors.[].coupledLength': {
    ui: 'slider',
    min: 0.005,
    max: 0.5,
    step: 0.005,
    panel: 'crosstalk',
    group: 'aggressor',
    order: 5,
  },
  'crosstalk.aggressors.[].skew': {
    ui: 'slider',
    min: -5e-11,
    max: 5e-11,
    step: 1e-13,
    panel: 'crosstalk',
    group: 'aggressor',
    order: 6,
  },
  'crosstalk.aggressors.[].seed': {
    ui: 'slider',
    min: 1,
    max: SEED_MAX,
    step: 1,
    integer: true,
    panel: 'crosstalk',
    group: 'aggressor',
    order: 7,
  },

  ...patternControls('crosstalk.aggressors.[].pattern', 'crosstalk', 'aggressor-pattern', 0),

  'crosstalk.ssoCount': {
    ui: 'slider',
    min: 0,
    max: 64,
    step: 1,
    integer: true,
    snapPoints: [0, 8, 16, 32, 64],
    panel: 'crosstalk',
    group: 'sso',
    order: 1,
  },
  'crosstalk.ssoLoopInductance': {
    ui: 'slider',
    min: 0,
    max: 5e-9,
    step: 5e-11,
    panel: 'crosstalk',
    group: 'sso',
    order: 2,
  },

  /* ---------------------------------------------------------------- equalizer */

  'eq.ffeEnabled': { ui: 'toggle', panel: 'eq', group: 'ffe', order: 1 },
  'eq.ffeTaps': {
    ui: 'list',
    min: -1,
    max: 1,
    step: 0.005,
    maxItems: 16,
    panel: 'eq',
    group: 'ffe',
    order: 2,
    showWhen: { path: 'eq.ffeEnabled', equals: [true] },
  },
  'eq.ffeCursor': {
    ui: 'slider',
    min: 0,
    max: 15,
    step: 1,
    integer: true,
    panel: 'eq',
    group: 'ffe',
    order: 3,
    showWhen: { path: 'eq.ffeEnabled', equals: [true] },
  },

  'eq.ctleEnabled': { ui: 'toggle', panel: 'eq', group: 'ctle', order: 1 },
  'eq.ctleDcGainDb': {
    ui: 'slider',
    min: -20,
    max: 0,
    step: 0.25,
    panel: 'eq',
    group: 'ctle',
    order: 2,
    showWhen: { path: 'eq.ctleEnabled', equals: [true] },
  },
  'eq.ctlePeakGainDb': {
    ui: 'slider',
    min: 0,
    max: 20,
    step: 0.25,
    panel: 'eq',
    group: 'ctle',
    order: 3,
    showWhen: { path: 'eq.ctleEnabled', equals: [true] },
  },
  'eq.ctlePole1': {
    ui: 'log-slider',
    min: 1e8,
    max: 5e10,
    step: 0.01,
    panel: 'eq',
    group: 'ctle',
    order: 4,
    showWhen: { path: 'eq.ctleEnabled', equals: [true] },
  },
  'eq.ctlePole2': {
    ui: 'log-slider',
    min: 1e8,
    max: 1e11,
    step: 0.01,
    panel: 'eq',
    group: 'ctle',
    order: 5,
    showWhen: { path: 'eq.ctleEnabled', equals: [true] },
  },

  'eq.dfeEnabled': { ui: 'toggle', panel: 'eq', group: 'dfe', order: 1 },
  'eq.dfeTaps': {
    ui: 'list',
    min: -0.5,
    max: 0.5,
    step: 0.005,
    maxItems: 16,
    panel: 'eq',
    group: 'dfe',
    order: 2,
    showWhen: { path: 'eq.dfeEnabled', equals: [true] },
  },

  'eq.threshold': { ui: 'slider', min: -0.5, max: 0.5, step: 0.001, panel: 'eq', group: 'slicer', order: 1 },
  'eq.hysteresis': {
    ui: 'slider',
    min: 0,
    max: 0.1,
    step: 0.001,
    panel: 'eq',
    group: 'slicer',
    order: 2,
    advanced: true,
  },

  /* --------------------------------------------------------------------- CDR */

  'cdr.enabled': { ui: 'toggle', panel: 'cdr', group: 'loop', order: 1 },
  'cdr.type': {
    ui: 'select',
    options: ['ideal', 'first-order', 'second-order'],
    panel: 'cdr',
    group: 'loop',
    order: 2,
    showWhen: { path: 'cdr.enabled', equals: [true] },
  },
  'cdr.loopBandwidth': {
    ui: 'log-slider',
    min: 1e5,
    max: 1e9,
    step: 0.01,
    panel: 'cdr',
    group: 'loop',
    order: 3,
    showWhen: { path: 'cdr.enabled', equals: [true] },
  },
  'cdr.damping': {
    ui: 'slider',
    min: 0.2,
    max: 2,
    step: 0.01,
    snapPoints: [0.5, 0.707, 1],
    panel: 'cdr',
    group: 'loop',
    order: 4,
    showWhen: { path: 'cdr.type', equals: ['second-order'] },
  },
  'cdr.observedJitterBw': {
    ui: 'log-slider',
    min: 1e5,
    max: 1e9,
    step: 0.01,
    panel: 'cdr',
    group: 'loop',
    order: 5,
    advanced: true,
  },

  /* ---------------------------------------------------------------- sampling */

  'sampling.samplesPerUi': {
    ui: 'slider',
    min: 8,
    max: 256,
    step: 8,
    integer: true,
    snapPoints: [8, 16, 32, 64, 128, 256],
    panel: 'sampling',
    group: 'resolution',
    order: 1,
  },

  'sampling.strobePhase': {
    ui: 'slider',
    min: 0,
    max: 1,
    step: 0.005,
    snapPoints: [0.25, 0.5, 0.75],
    panel: 'sampling',
    group: 'strobe',
    order: 1,
  },
  'sampling.threshold': {
    ui: 'slider',
    min: -0.5,
    max: 0.5,
    step: 0.001,
    panel: 'sampling',
    group: 'strobe',
    order: 2,
  },

  'sampling.setupTime': {
    ui: 'slider',
    min: 0,
    max: 5e-11,
    step: 1e-13,
    panel: 'sampling',
    group: 'latch',
    order: 1,
  },
  'sampling.holdTime': {
    ui: 'slider',
    min: 0,
    max: 5e-11,
    step: 1e-13,
    panel: 'sampling',
    group: 'latch',
    order: 2,
  },
  'sampling.sensitivity': {
    ui: 'slider',
    min: 0,
    max: 0.1,
    step: 5e-4,
    panel: 'sampling',
    group: 'latch',
    order: 3,
  },

  /* ---------------------------------------------------------------- analysis */

  'analysis.engine': {
    ui: 'select',
    options: ['monte-carlo', 'statistical', 'both'],
    panel: 'analysis',
    group: 'engine',
    order: 1,
  },
  'analysis.bits': {
    ui: 'log-slider',
    min: 1000,
    max: 1_000_000,
    step: 0.05,
    integer: true,
    snapPoints: [1000, 10_000, 100_000, 1_000_000],
    panel: 'analysis',
    group: 'engine',
    order: 2,
    showWhen: { path: 'analysis.engine', equals: ['monte-carlo', 'both'] },
  },
  'analysis.targetBer': {
    ui: 'log-slider',
    min: 1e-15,
    max: 1e-3,
    step: 0.25,
    snapPoints: [1e-15, 1e-12, 1e-9, 1e-6, 1e-3],
    panel: 'analysis',
    group: 'engine',
    order: 3,
  },

  'analysis.eyeWidth': {
    ui: 'slider',
    min: 128,
    max: 1024,
    step: 64,
    integer: true,
    snapPoints: [256, 512, 1024],
    panel: 'analysis',
    group: 'eye',
    order: 1,
    advanced: true,
  },
  'analysis.eyeHeight': {
    ui: 'slider',
    min: 128,
    max: 1024,
    step: 64,
    integer: true,
    snapPoints: [256, 384, 512],
    panel: 'analysis',
    group: 'eye',
    order: 2,
    advanced: true,
  },
  'analysis.eyeUis': {
    ui: 'slider',
    min: 0.5,
    max: 4,
    step: 0.5,
    snapPoints: [1, 2],
    panel: 'analysis',
    group: 'eye',
    order: 3,
  },
  'analysis.persistence': {
    ui: 'slider',
    min: 0,
    max: 1,
    step: 0.01,
    panel: 'analysis',
    group: 'eye',
    order: 4,
  },

  /* ------------------------------------------------------------------- scope */

  'scope.enabled': { ui: 'toggle', panel: 'scope', group: 'frontend', order: 1 },
  'scope.bandwidth': {
    ui: 'log-slider',
    min: 1e9,
    max: 1e11,
    step: 0.01,
    snapPoints: [4e9, 8e9, 13e9, 16e9, 20e9, 33e9, 50e9],
    panel: 'scope',
    group: 'frontend',
    order: 2,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.responseShape': {
    ui: 'select',
    options: ['gaussian', 'bessel', 'brickwall', 'butterworth'],
    panel: 'scope',
    group: 'frontend',
    order: 3,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.probeC': {
    ui: 'slider',
    min: 0,
    max: 2e-12,
    step: 2.5e-14,
    panel: 'scope',
    group: 'frontend',
    order: 4,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.probeR': {
    ui: 'log-slider',
    min: 50,
    max: 1e6,
    step: 0.02,
    snapPoints: [50, 1e3, 1e4, 5e4, 1e6],
    panel: 'scope',
    group: 'frontend',
    order: 5,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },

  'scope.sampleRate': {
    ui: 'log-slider',
    min: 1e9,
    max: 2e11,
    step: 0.01,
    snapPoints: [10e9, 20e9, 25e9, 50e9, 80e9, 100e9, 200e9],
    panel: 'scope',
    group: 'digitizer',
    order: 1,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.adcBits': {
    ui: 'slider',
    min: 6,
    max: 16,
    step: 1,
    integer: true,
    snapPoints: [8, 10, 12],
    panel: 'scope',
    group: 'digitizer',
    order: 2,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.verticalRange': {
    ui: 'slider',
    min: 0.05,
    max: 5,
    step: 0.05,
    panel: 'scope',
    group: 'digitizer',
    order: 3,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.noiseRms': {
    ui: 'slider',
    min: 0,
    max: 0.01,
    step: 5e-5,
    panel: 'scope',
    group: 'digitizer',
    order: 4,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.interpolation': {
    ui: 'select',
    options: ['none', 'linear', 'sinx'],
    panel: 'scope',
    group: 'digitizer',
    order: 5,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },
  'scope.averages': {
    ui: 'slider',
    min: 1,
    max: 1024,
    step: 1,
    integer: true,
    snapPoints: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024],
    panel: 'scope',
    group: 'digitizer',
    order: 6,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },

  'scope.fftWindow': {
    ui: 'select',
    options: ['rectangular', 'hann', 'hamming', 'blackman', 'blackman-harris', 'flat-top', 'kaiser', 'tukey'],
    panel: 'scope',
    group: 'math',
    order: 1,
    showWhen: { path: 'scope.enabled', equals: [true] },
  },

  /* -------------------------------------------------------------------- view */

  'view.spanUi': {
    ui: 'slider',
    min: 1,
    max: 256,
    step: 1,
    snapPoints: [1, 2, 4, 8, 16, 32, 64, 128, 256],
    panel: 'view',
    group: 'window',
    order: 1,
  },
  'view.offsetUi': {
    ui: 'slider',
    min: 0,
    max: 1024,
    step: 1,
    panel: 'view',
    group: 'window',
    order: 2,
  },

  'view.showGrid': { ui: 'toggle', panel: 'view', group: 'traces', order: 1 },
  'view.showIdeal': { ui: 'toggle', panel: 'view', group: 'traces', order: 2 },
  'view.showMeasured': { ui: 'toggle', panel: 'view', group: 'traces', order: 3 },
  'view.showEqualized': { ui: 'toggle', panel: 'view', group: 'traces', order: 4 },

  'view.cursorsT': {
    ui: 'list',
    min: 0,
    max: 4,
    step: 0.001,
    maxItems: 4,
    panel: 'view',
    group: 'cursors',
    order: 1,
  },
  'view.cursorsV': {
    ui: 'list',
    min: -2,
    max: 2,
    step: 0.001,
    maxItems: 4,
    panel: 'view',
    group: 'cursors',
    order: 2,
  },
};

/* ------------------------------------------------------------------ lookups */

/** The control for a Scenario path, canonicalising array indices first. */
export function controlFor(path: string): ControlSpec | undefined {
  return CONTROLS[canonicalPath(path)];
}

/** Every control path, in panel then group then order sequence. */
export function orderedPaths(): string[] {
  const panelOrder = new Map(PANELS.map((p) => [p.id, p.order]));
  const groupOrder = new Map(GROUPS.map((g) => [`${g.panel}.${g.id}`, g.order]));
  return Object.keys(CONTROLS).sort((a, b) => {
    const ca = CONTROLS[a]!;
    const cb = CONTROLS[b]!;
    const pa = panelOrder.get(ca.panel) ?? 0;
    const pb = panelOrder.get(cb.panel) ?? 0;
    if (pa !== pb) return pa - pb;
    const ga = groupOrder.get(`${ca.panel}.${ca.group}`) ?? 0;
    const gb = groupOrder.get(`${cb.panel}.${cb.group}`) ?? 0;
    if (ga !== gb) return ga - gb;
    return ca.order - cb.order;
  });
}

/** The control paths of one panel, or of one group within it, in display order. */
export function controlsIn(panel: PanelId, group?: string): string[] {
  return orderedPaths().filter((p) => {
    const c = CONTROLS[p]!;
    return c.panel === panel && (group === undefined || c.group === group);
  });
}

/** The groups of a panel, in display order. */
export function groupsIn(panel: PanelId): GroupSpec[] {
  return GROUPS.filter((g) => g.panel === panel).sort((a, b) => a.order - b.order);
}

/* ------------------------------------------------------- values and visibility */

/**
 * Read a canonical path out of a Scenario-shaped object.
 *
 * `[]` segments resolve against `index`, so an aggressor's dependency on its own
 * `end` selector reads that aggressor's value and not the first one's.
 */
export function valueAtPath(root: unknown, path: string, index = 0): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (seg === '[]') {
      cur = Array.isArray(cur) ? cur[index] : undefined;
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

/**
 * Whether a control is worth showing, given the rest of the Scenario.
 *
 * A hidden control is still *set* - hiding the RLC values while a lossy channel is
 * selected does not discard them - which is why visibility lives here and not in
 * the schema.
 */
export function isVisible(scenario: unknown, path: string, index = 0): boolean {
  // A control is relevant only if the control it depends on is relevant too, so the
  // Huray radius hides with the roughness model, the roughness toggle and the channel
  // kind. The depth bound stops a cycle; the registry test rejects one as well.
  let current = path;
  for (let depth = 0; depth < 16; depth++) {
    const spec = controlFor(current);
    if (spec?.showWhen === undefined) return true;
    const value = valueAtPath(scenario, spec.showWhen.path, index);
    if (!spec.showWhen.equals.some((v) => v === value)) return false;
    current = spec.showWhen.path;
  }
  return false;
}

/* ------------------------------------------------------------------ stepping */

function nearestSnap(spec: ControlSpec, value: number, tolerance: number): number | undefined {
  if (spec.snapPoints === undefined) return undefined;
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const p of spec.snapPoints) {
    const d = spec.ui === 'log-slider' ? Math.abs(Math.log10(p) - Math.log10(value)) : Math.abs(p - value);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best !== undefined && bestDistance <= tolerance ? best : undefined;
}

/**
 * Clamp a raw value to the control's range and settle it onto a step or a snap
 * point. Linear controls step in field units; log controls step in decades, so a
 * 0.01 step is a hundred positions per decade at any point on the scale.
 *
 * Snapping is deliberate rather than magnetic: a value within half a step of a snap
 * point becomes that point exactly, which is how 50 ohms stays 50 and not 49.5.
 */
export function quantize(spec: ControlSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.min ?? 0;
  if (spec.min === undefined || spec.max === undefined) return value;

  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  const step = spec.step;
  if (step === undefined || step <= 0) return clamped;

  const snapped = nearestSnap(spec, clamped, step / 2);
  if (snapped !== undefined) return snapped;

  let out: number;
  if (spec.ui === 'log-slider') {
    const lo = Math.log10(spec.min);
    const decades = Math.round((Math.log10(clamped) - lo) / step) * step;
    out = Math.pow(10, lo + decades);
  } else {
    out = spec.min + Math.round((clamped - spec.min) / step) * step;
    // Binary steps leave a long tail of float noise: 0.1 + 0.2 is not 0.3.
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
    out = Number(out.toFixed(Math.min(20, decimals)));
  }
  if (spec.integer === true) out = Math.round(out);
  return Math.min(spec.max, Math.max(spec.min, out));
}

/** Position of a value along the control, 0 to 1. Log controls measure in decades. */
export function normalize(spec: ControlSpec, value: number): number {
  if (spec.min === undefined || spec.max === undefined) return 0;
  if (spec.ui === 'log-slider') {
    const lo = Math.log10(spec.min);
    const hi = Math.log10(spec.max);
    return hi === lo ? 0 : (Math.log10(value) - lo) / (hi - lo);
  }
  return spec.max === spec.min ? 0 : (value - spec.min) / (spec.max - spec.min);
}

/** Inverse of `normalize`, quantised. This is what a slider drag produces. */
export function denormalize(spec: ControlSpec, t: number): number {
  if (spec.min === undefined || spec.max === undefined) return 0;
  const u = Math.min(1, Math.max(0, t));
  const raw =
    spec.ui === 'log-slider'
      ? Math.pow(10, Math.log10(spec.min) + u * (Math.log10(spec.max) - Math.log10(spec.min)))
      : spec.min + u * (spec.max - spec.min);
  return quantize(spec, raw);
}
