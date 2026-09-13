/**
 * The text of a plot, built from the same declaration as the picture.
 *
 * Every plot needs three descriptions and they must agree: the `aria-label` on the
 * canvas element, the metric summary printed beside it, and the caption under it.
 * Written separately they drift - the eye height in the summary becomes stale when
 * the plotting code changes, and nobody notices because nothing compares them.
 *
 * So they are all derived here from one `ChromeSpec`. The caption, the axes, the
 * traces and the metrics are declared once; `describePlot` renders them into
 * whichever of the three forms is wanted. A reader who cannot see the canvas gets
 * the same numbers as a reader who can, by construction rather than by discipline.
 *
 * This file is pure string formatting: no canvas, no DOM.
 */

import type { AxisSpec, ChromeSpec, MetricFormat, MetricSpec, TraceSpec } from './chrome';
import { formatEng, formatDb, formatPercent, formatUi } from './scale';

/* ------------------------------------------------------------------ numbers */

/**
 * How a unit wants to be written.
 *
 * Engineering prefixes are right for physical quantities and wrong for the rest:
 * a level of 0.5 dB is not "500 mdB", and a jitter of 0.02 UI is not "20 mUI".
 */
export function defaultFormat(unit: string): MetricFormat {
  switch (unit) {
    case 'dB':
      return 'db';
    case 'UI':
      return 'ui';
    case '%':
      return 'percent';
    case '1':
    case '':
      return 'plain';
    default:
      return 'eng';
  }
}

function significant(v: number, sig: number): string {
  if (v === 0) return '0';
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v))));
  const text = v.toFixed(Math.min(15, digits));
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** The number on its own, in the unit it was declared with. */
export function formatMetricValue(m: MetricSpec): string {
  const sig = m.sig ?? 3;
  if (!Number.isFinite(m.value)) return Number.isNaN(m.value) ? 'NaN' : m.value > 0 ? '∞' : '-∞';
  switch (m.format ?? defaultFormat(m.unit)) {
    case 'db':
      return formatDb(m.value, Math.max(0, sig - 2));
    case 'ui':
      return formatUi(m.value, Math.max(0, sig));
    case 'percent':
      return formatPercent(m.value, sig);
    // A bit error rate is a number of decades, not a quantity with a prefix: 1e-12,
    // never "1 pBER".
    case 'exp':
      return m.value === 0 ? '0' : m.value.toExponential(Math.max(0, sig - 1));
    case 'integer':
      return Math.round(m.value).toLocaleString('en-US');
    case 'plain':
      return significant(m.value, sig);
    default:
      return formatEng(m.value, m.unit, sig);
  }
}

/**
 * One metric as a line of text: label, value, and the verdict if there is one.
 *
 * `Eye height: 142 mV (target 100 mV, pass)`
 */
export function describeMetric(m: MetricSpec): string {
  let line = `${m.label}: ${formatMetricValue(m)}`;
  const qualifiers: string[] = [];
  if (m.target !== undefined) {
    qualifiers.push(`target ${formatMetricValue({ ...m, value: m.target })}`);
  }
  if (m.status !== undefined) qualifiers.push(m.status);
  if (qualifiers.length > 0) line += ` (${qualifiers.join(', ')})`;
  if (m.note !== undefined && m.note.trim() !== '') line += ` - ${m.note}`;
  return line;
}

/** Every metric, one per line. This is what goes beside the canvas. */
export function metricLines(metrics: readonly MetricSpec[]): string[] {
  return metrics.map(describeMetric);
}

/* -------------------------------------------------------------------- parts */

/** `Time, 0 s to 2 ns` - what the axis is and what it spans. */
export function describeAxis(axis: AxisSpec): string {
  const [lo, hi] = axis.scale.domain;
  const unit = axis.unit === '1' ? '' : axis.unit;
  const span = `${formatEng(lo, unit, 3)} to ${formatEng(hi, unit, 3)}`;
  const scale = axis.log === true ? ', logarithmic' : '';
  const target = axis.target === undefined ? '' : `, marked at ${formatEng(axis.target, unit, 3)}`;
  return `${axis.title}, ${span}${scale}${target}`;
}

function describeTrace(t: TraceSpec): string {
  return t.dash === undefined ? t.label : `${t.label} (dashed)`;
}

/**
 * `Two traces: Transmitted; Received (dashed).`
 *
 * Hidden traces are left out rather than described as hidden: the description is of
 * the picture in front of the reader, not of the code that made it.
 */
export function describeTraces(traces: readonly TraceSpec[]): string {
  const visible = traces.filter((t) => t.hidden !== true);
  if (visible.length === 0) return 'No traces.';
  if (visible.length === 1) return `One trace: ${describeTrace(visible[0]!)}.`;
  return `${visible.length} traces: ${visible.map(describeTrace).join('; ')}.`;
}

/* ------------------------------------------------------------------- whole */

export interface PlotDescription {
  /** The caption, verbatim. Goes under the figure. */
  caption: string;
  /** The single-string `aria-label` for the canvas element. */
  aria: string;
  /** The metric summary, one line each, for the panel beside the plot. */
  metrics: string[];
  /** Notes and warnings, verbatim. */
  notes: string[];
  /** Everything, for a text-only rendering or a copy-to-clipboard. */
  text: string;
}

/**
 * The three descriptions of one plot, from one declaration.
 *
 * The `aria` string is deliberately a single flat sentence sequence: screen readers
 * announce a label as one utterance, so list markup inside it would be lost and
 * punctuation is what produces the pauses.
 */
export function describePlot(spec: ChromeSpec): PlotDescription {
  const metrics = metricLines(spec.metrics ?? []);
  const notes = [...(spec.notes ?? [])];

  const parts = [
    spec.caption.trim().replace(/\.?$/, '.'),
    `Horizontal axis: ${describeAxis(spec.x)}.`,
    `Vertical axis: ${describeAxis(spec.y)}.`,
    describeTraces(spec.traces),
  ];
  if (metrics.length > 0) parts.push(`${metrics.join('. ')}.`);
  for (const n of notes) parts.push(n.trim().replace(/\.?$/, '.'));

  return {
    caption: spec.caption,
    aria: parts.join(' '),
    metrics,
    notes,
    text: [spec.caption, ...metrics, ...notes].join('\n'),
  };
}
