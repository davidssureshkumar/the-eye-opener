/**
 * Plot chrome: everything on a plot that is not the data.
 *
 * The problem this solves is not that legends are hard to draw - `drawLegend` is
 * twenty lines - but that they are easy to forget. A plot drawn by calling
 * background, grid, axes and traces in sequence works perfectly well and ships
 * without a legend, and nobody notices until a reader asks which of the two green
 * traces is the equalized one.
 *
 * So chrome is declared, not drawn. A plot states its axes and its traces once, as
 * data; `drawChrome` paints everything behind the traces and `drawOverlay`
 * everything in front of them. A legend appears because the traces were declared,
 * not because someone remembered. `validateChrome` then fails a unit test on a
 * declaration that would produce an unreadable plot - an axis with no units, two
 * traces the same colour, more than one trace and no legend.
 *
 * Drawing order matters and is fixed here: background, grid, axes, then the caller's
 * traces clipped to the plot area, then legend and readouts on top. Legend over
 * trace rather than under it, because a legend hidden behind a waveform is worse
 * than no legend.
 */

import { paintBackground, type Surface } from './canvas';
import {
  drawGrid,
  drawAutoGrid,
  drawGraticule,
  drawFrame,
  drawLogGrid,
  divisionsOf,
  type GridStyle,
} from './grid';
import { drawXAxis, drawYAxis, drawLogXAxis, drawLogYAxis, drawLegend, drawCornerText } from './axes';
import { formatEng, linearTicks, logTicks, type Scale } from './scale';
import { metricLines } from './describe';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** One named curve on the plot. The legend is generated from these. */
export interface TraceSpec {
  /** Stable key, for hit-testing and for toggling visibility. */
  key: string;
  /** What the legend says. Name the quantity, not the colour. */
  label: string;
  color: string;
  /** Dash pattern, repeated in the legend swatch so the two can be matched. */
  dash?: number[];
  /** Currently hidden: keeps its identity but leaves the legend. */
  hidden?: boolean;
}

/**
 * One number the plot exists to communicate.
 *
 * Metrics are declared alongside the traces rather than rendered independently,
 * because the alternative - a canvas drawn by one function and a summary written by
 * another - is how a plot ends up saying 200 mV while the text beside it says 180.
 * `describePlot` in `./describe.ts` turns this one declaration into both the
 * accessible label on the canvas element and the visible summary next to it.
 */
export interface MetricSpec {
  /** Stable key, for pinning a value in a regression test. */
  key: string;
  /** What the number is. Sentence case, no trailing colon. */
  label: string;
  value: number;
  /**
   * SI unit symbol, or '1' for a genuinely dimensionless quantity. Same convention
   * as `AxisSpec.unit`, and validated the same way.
   */
  unit: string;
  /** Significant figures. Three unless the quantity deserves more. */
  sig?: number;
  /** How to render the number. Inferred from the unit when omitted. */
  format?: MetricFormat;
  /** The limit this is measured against, in the same unit. */
  target?: number;
  /** Verdict against that target, when there is one. */
  status?: 'pass' | 'marginal' | 'fail';
  /** A qualifier the number would be misread without. */
  note?: string;
}

export type MetricFormat = 'eng' | 'db' | 'ui' | 'percent' | 'exp' | 'integer' | 'plain';

/** One axis of the plot. */
export interface AxisSpec {
  scale: Scale;
  /**
   * SI unit symbol: 's', 'Hz', 'V', 'dB', 'UI', 'ohm'. Use '1' for a quantity that
   * is genuinely dimensionless (a reflection coefficient, a probability) and '' only
   * for a count. The distinction is deliberate: '' reads as "nobody filled this in",
   * which is exactly the mistake `validateChrome` is looking for.
   */
  unit: string;
  /** Axis title, without the unit - the axis drawing appends it. */
  title: string;
  /** Logarithmic axis: decade ticks and a decade grid. */
  log?: boolean;
  ticks?: readonly number[];
  target?: number;
}

export interface ChromeSpec {
  x: AxisSpec;
  y: AxisSpec;
  /** Every curve on the plot, in draw order. */
  traces: readonly TraceSpec[];
  /**
   * What the plot shows, in one sentence, in the terms of the physics rather than
   * the terms of the drawing: "the received waveform after 300 mm of lossy line",
   * not "two lines on a graph". This is the first thing a screen reader says and
   * the caption under the figure, so it is required rather than optional.
   */
  caption: string;
  /**
   * The numbers the plot exists to show. Required - an empty array is allowed and
   * means "this picture carries no measured numbers", which is true of a bounce
   * diagram and false of an eye. Leaving it out is the mistake being caught.
   */
  metrics: readonly MetricSpec[];
  /** Where to paint the metric lines on the canvas. Off by default: they belong in
   * the DOM beside the plot, where they can be selected and read aloud. */
  metricsCorner?: Corner | 'none';
  /**
   * 'graticule' for the ten-by-eight scope screen, 'auto' for a grid on the tick
   * positions, 'none' for a plot where a grid would obscure the data - an eye
   * diagram or a shmoo.
   */
  grid?: 'graticule' | 'auto' | 'none';
  legend?: Corner | 'none';
  /** Corner readout. Omit for the automatic per-division values. */
  readout?: readonly string[] | 'divisions' | 'none';
  readoutCorner?: Corner;
  /**
   * Extra lines under the readout: a sample count, a "statistical extrapolation"
   * note, an "illustrative values" warning. Anything a reader would need in order
   * not to misread a screenshot of the plot.
   */
  notes?: readonly string[];
  /** Draw a border around the plot area. Default true. */
  frame?: boolean;
  gridStyle?: GridStyle;
  /** Graticule divisions, which also set the per-division readout. */
  xDivisions?: number;
  yDivisions?: number;
}

/* ------------------------------------------------------- derived, and pure */

/** The legend entries a trace list implies: the visible ones, in order. */
export function legendEntries(
  traces: readonly TraceSpec[],
): Array<{ label: string; color: string; dash?: number[] }> {
  return traces
    .filter((t) => t.hidden !== true)
    .map((t) =>
      t.dash
        ? { label: t.label, color: t.color, dash: t.dash }
        : {
            label: t.label,
            color: t.color,
          },
    );
}

/**
 * The "2 ns/div, 100 mV/div" readout.
 *
 * Computed from the scales actually in use rather than from what the caller meant to
 * set, so the number in the corner cannot drift away from the picture. A
 * dimensionless axis is omitted rather than labelled "0.25 /div", which means
 * nothing.
 */
export function divisionReadout(x: AxisSpec, y: AxisSpec, xDivisions = 10, yDivisions = 8): string[] {
  const out: string[] = [];
  const { perXDivision, perYDivision } = divisionsOf(x.scale, y.scale, xDivisions, yDivisions);
  // A log axis spans decades, so a linear per-division figure would be a lie.
  if (!x.log && x.unit !== '' && x.unit !== '1') {
    out.push(`${formatEng(perXDivision, x.unit, 3)}/div`);
  }
  if (!y.log && y.unit !== '' && y.unit !== '1') {
    out.push(`${formatEng(perYDivision, y.unit, 3)}/div`);
  }
  return out;
}

/**
 * Everything wrong with a chrome declaration, as human-readable problems.
 *
 * Called by the unit tests on every plot's declaration, which is what turns "we
 * should remember legends" into something a build can enforce. Each rule exists
 * because the resulting plot is genuinely ambiguous, not because of house style.
 */
export function validateChrome(spec: ChromeSpec): string[] {
  const problems: string[] = [];

  for (const [name, axis] of [
    ['x', spec.x],
    ['y', spec.y],
  ] as const) {
    if (axis.title.trim() === '') problems.push(`${name} axis has no title`);
    // '' is allowed only for a pure count; '1' is how a dimensionless quantity
    // says so on purpose. Anything else must carry its unit.
    if (axis.unit.trim() === '' && !/count|bits?|samples?|index|n\b/i.test(axis.title)) {
      problems.push(`${name} axis "${axis.title}" has no unit (use '1' if dimensionless)`);
    }
  }

  const visible = spec.traces.filter((t) => t.hidden !== true);
  for (const t of spec.traces) {
    if (t.label.trim() === '') problems.push(`trace "${t.key}" has no label`);
  }

  const keys = spec.traces.map((t) => t.key);
  const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
  for (const k of new Set(dupKeys)) problems.push(`duplicate trace key "${k}"`);

  const labels = visible.map((t) => t.label);
  const dupLabels = labels.filter((l, i) => labels.indexOf(l) !== i);
  for (const l of new Set(dupLabels)) problems.push(`duplicate trace label "${l}"`);

  // Two traces the same colour and the same dash are indistinguishable, and a
  // legend that maps two entries to one appearance is worse than none.
  const seen = new Map<string, string>();
  for (const t of visible) {
    const look = `${t.color}|${(t.dash ?? []).join(',')}`;
    const prior = seen.get(look);
    if (prior !== undefined) {
      problems.push(`traces "${prior}" and "${t.key}" are drawn identically`);
    } else {
      seen.set(look, t.key);
    }
  }

  if (visible.length > 1 && spec.legend === 'none') {
    problems.push(`${visible.length} visible traces but the legend is suppressed`);
  }

  if (typeof spec.caption !== 'string' || spec.caption.trim() === '') {
    problems.push('plot has no caption');
  }

  if (!Array.isArray(spec.metrics)) {
    problems.push('plot declares no metrics (use [] if it genuinely has none)');
  } else {
    const mKeys = spec.metrics.map((m) => m.key);
    for (const k of new Set(mKeys.filter((k, i) => mKeys.indexOf(k) !== i))) {
      problems.push(`duplicate metric key "${k}"`);
    }
    const mLabels = spec.metrics.map((m) => m.label);
    for (const l of new Set(mLabels.filter((l, i) => mLabels.indexOf(l) !== i))) {
      problems.push(`duplicate metric label "${l}"`);
    }
    for (const m of spec.metrics) {
      if (m.label.trim() === '') problems.push(`metric "${m.key}" has no label`);
      // A NaN on screen is a bug that reached the reader. Catch it in the test.
      if (!Number.isFinite(m.value)) problems.push(`metric "${m.key}" is not finite`);
      if (m.unit.trim() === '' && !/count|bits?|samples?|index|\bn\b/i.test(m.label)) {
        problems.push(`metric "${m.key}" has no unit (use '1' if dimensionless)`);
      }
      if (m.status !== undefined && m.target === undefined) {
        problems.push(`metric "${m.key}" has a verdict but no target to judge it against`);
      }
    }
  }

  return problems;
}

/** Convenience for the tests: throws with every problem listed at once. */
export function assertChrome(spec: ChromeSpec, context = 'plot'): void {
  const problems = validateChrome(spec);
  if (problems.length > 0) {
    throw new Error(`${context}: ${problems.join('; ')}`);
  }
}

/* ----------------------------------------------------------------- drawing */

/**
 * Everything behind the data: background, grid, axes, frame.
 *
 * Call this, then draw the traces inside `withClip`, then call `drawOverlay`.
 */
export function drawChrome(s: Surface, spec: ChromeSpec): void {
  paintBackground(s);

  const grid = spec.grid ?? 'auto';
  if (grid === 'graticule') {
    drawGraticule(s, { xDivisions: spec.xDivisions ?? 10, yDivisions: spec.yDivisions ?? 8 });
  } else if (grid === 'auto') {
    if (spec.x.log) {
      // Decade lines across, linear down: the Bode layout.
      drawLogGrid(s, spec.x.scale, spec.y.scale, spec.gridStyle);
    } else if (spec.y.log) {
      // A log y axis with a linear x - a bathtub curve. Linear ticks on a decade
      // domain would put every line in the top decade, so take the decades.
      drawGrid(
        s,
        spec.x.scale,
        spec.y.scale,
        linearTicks(spec.x.scale.domain, 8),
        logTicks(spec.y.scale.domain).major,
        spec.gridStyle,
      );
    } else {
      drawAutoGrid(s, spec.x.scale, spec.y.scale, spec.gridStyle);
    }
  }

  const xOpts = { unit: spec.x.unit === '1' ? '' : spec.x.unit, title: spec.x.title };
  const yOpts = { unit: spec.y.unit === '1' ? '' : spec.y.unit, title: spec.y.title };

  if (spec.x.log) drawLogXAxis(s, spec.x.scale, xOpts);
  else drawXAxis(s, spec.x.scale, { ...xOpts, ticks: spec.x.ticks, target: spec.x.target });

  if (spec.y.log) drawLogYAxis(s, spec.y.scale, yOpts);
  else drawYAxis(s, spec.y.scale, { ...yOpts, ticks: spec.y.ticks, target: spec.y.target });

  if (spec.frame !== false) drawFrame(s);
}

/**
 * Everything in front of the data: legend and corner readouts.
 *
 * Separate from `drawChrome` because the legend has to be painted after the traces
 * to stay readable, and because an animated plot can repaint traces without
 * rebuilding the axes.
 */
export function drawOverlay(s: Surface, spec: ChromeSpec): void {
  const legend = spec.legend ?? 'tr';
  if (legend !== 'none') drawLegend(s, legendEntries(spec.traces), legend);

  // Metrics live in the DOM beside the plot by default, where they can be selected
  // and read aloud. A plot that opts in gets them on the canvas too, so a pasted
  // screenshot carries its own numbers.
  const corner = spec.metricsCorner ?? 'none';
  if (corner !== 'none' && (spec.metrics?.length ?? 0) > 0) {
    drawCornerText(s, metricLines(spec.metrics), corner);
  }

  const readout = spec.readout ?? 'divisions';
  const lines =
    readout === 'none'
      ? []
      : readout === 'divisions'
        ? divisionReadout(spec.x, spec.y, spec.xDivisions ?? 10, spec.yDivisions ?? 8)
        : [...readout];
  const all = [...lines, ...(spec.notes ?? [])];
  if (all.length > 0) drawCornerText(s, all, spec.readoutCorner ?? 'br');
}

/**
 * The whole plot in one call: chrome, then the caller's traces clipped to the plot
 * area, then the overlay. The common case, and the one that cannot forget a legend.
 */
export function withChrome(s: Surface, spec: ChromeSpec, drawTraces: () => void): void {
  drawChrome(s, spec);
  const { ctx, plot } = s;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y, plot.width, plot.height);
  ctx.clip();
  try {
    drawTraces();
  } finally {
    ctx.restore();
  }
  drawOverlay(s, spec);
}
