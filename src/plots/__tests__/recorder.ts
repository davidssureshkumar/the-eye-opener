/**
 * A recording 2D context, shared by every plot test.
 *
 * Canvas output cannot be asserted on in a node test environment without a
 * headless canvas, and pixel comparison would be flaky for font metrics anyway.
 * What can be asserted, and is what actually matters, is the *transcript*: which
 * drawing calls were made, in what order, with what styles. A legend drawn before
 * the traces instead of after is a real defect and shows up here as two lines
 * swapping places; an antialiasing difference does not show up at all.
 *
 * The context is a Proxy so that style assignments - `ctx.fillStyle = '#0f0'` -
 * land in the transcript alongside the calls. That is what makes "this trace was
 * drawn in the colour the legend claims" testable.
 *
 * Not a test file: `vitest.config.ts` collects `*.test.ts` only.
 */

import { DEFAULT_INSETS, type Surface } from '../canvas';

export interface DrawOp {
  op: string;
  args: readonly (number | string)[];
}

export interface Recorder {
  ctx: CanvasRenderingContext2D;
  /** Every string passed to fillText or strokeText, in order. */
  texts: string[];
  /** Method names only, in order. */
  calls: string[];
  /** Method calls and style assignments, in order, with arguments. */
  ops: DrawOp[];
  /** Current save/restore nesting, and the deepest it reached. */
  depth: number;
  maxDepth: number;
  clips: number;
}

const METHODS = [
  'beginPath',
  'moveTo',
  'lineTo',
  'rect',
  'arc',
  'stroke',
  'fill',
  'fillRect',
  'strokeRect',
  'clearRect',
  'setLineDash',
  'translate',
  'rotate',
  'scale',
  'closePath',
  'setTransform',
  'strokeText',
  'quadraticCurveTo',
  'bezierCurveTo',
] as const;

const round = (v: number | string): number | string =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : v;

export function recorder(): Recorder {
  const r: Recorder = {
    ctx: null as unknown as CanvasRenderingContext2D,
    texts: [],
    calls: [],
    ops: [],
    depth: 0,
    maxDepth: 0,
    clips: 0,
  };

  const record = (op: string, args: readonly unknown[]): void => {
    r.calls.push(op);
    r.ops.push({ op, args: args.map((a) => round(a as number | string)) });
  };

  const target: Record<string, unknown> = {
    save: (): void => {
      record('save', []);
      r.depth += 1;
      r.maxDepth = Math.max(r.maxDepth, r.depth);
    },
    restore: (): void => {
      record('restore', []);
      r.depth -= 1;
    },
    clip: (): void => {
      record('clip', []);
      r.clips += 1;
    },
    fillText: (t: string, x: number, y: number): void => {
      record('fillText', [t, x, y]);
      r.texts.push(t);
    },
    measureText: (t: string): TextMetrics => ({ width: t.length * 6 }) as TextMetrics,
    createLinearGradient: (): CanvasGradient =>
      ({ addColorStop: (): void => undefined }) as unknown as CanvasGradient,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    textAlign: 'left',
    textBaseline: 'middle',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };

  for (const name of METHODS) {
    target[name] = (...args: unknown[]): void => {
      if (name === 'strokeText') r.texts.push(String(args[0]));
      record(name, args);
    };
  }

  r.ctx = new Proxy(target, {
    set(obj, prop, value): boolean {
      const key = String(prop);
      record(`set ${key}`, [String(value)]);
      obj[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return r;
}

/** A 678x458 surface with the standard insets, matching the default plot layout. */
export function surfaceOf(r: Recorder, over: Partial<Surface> = {}): Surface {
  return {
    ctx: r.ctx,
    width: 678,
    height: 458,
    dpr: 1,
    plot: { x: 62, y: 12, width: 600, height: 400 },
    insets: DEFAULT_INSETS,
    ...over,
  };
}

export interface TranscriptOptions {
  /** Drop these ops. Path plumbing is voluminous and says nothing on its own. */
  omit?: readonly string[];
  /** Keep only these ops. */
  only?: readonly string[];
}

const NOISE = ['moveTo', 'lineTo', 'beginPath', 'closePath', 'setTransform'] as const;

/** The transcript as lines of text: `fillText("Time", 362, 446)`. */
export function transcript(r: Recorder, options: TranscriptOptions = {}): string[] {
  const omit = new Set(options.omit ?? []);
  const only = options.only === undefined ? undefined : new Set(options.only);
  return r.ops
    .filter((o) => !omit.has(o.op) && (only === undefined || only.has(o.op)))
    .map((o) => `${o.op}(${o.args.map((a) => (typeof a === 'string' ? `"${a}"` : a)).join(', ')})`);
}

/** The transcript with path plumbing removed: the shape of the drawing, reviewably short. */
export function outline(r: Recorder): string[] {
  return transcript(r, { omit: NOISE });
}

/** How many of each op were issued. Stable under coordinate changes; a good snapshot. */
export function opCounts(r: Recorder): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of r.calls) counts[c] = (counts[c] ?? 0) + 1;
  return counts;
}

/** Every colour the context was set to, in order, without repeats. */
export function colorSequence(r: Recorder): string[] {
  const out: string[] = [];
  for (const o of r.ops) {
    if (o.op !== 'set fillStyle' && o.op !== 'set strokeStyle') continue;
    const c = String(o.args[0]);
    if (out[out.length - 1] !== c) out.push(c);
  }
  return out;
}

/** Index of the first op matching `op`, or -1. Used to assert drawing order. */
export function indexOfOp(r: Recorder, op: string): number {
  return r.ops.findIndex((o) => o.op === op);
}

/** Index of the first `fillText` whose text contains `needle`, or -1. */
export function indexOfText(r: Recorder, needle: string): number {
  return r.ops.findIndex((o) => o.op === 'fillText' && String(o.args[0]).includes(needle));
}
