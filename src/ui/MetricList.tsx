/**
 * The numbers a plot exists to show, as text beside the plot.
 *
 * The brief asks for a text-readable metric summary next to every plot, and this is
 * it. It is not a convenience for screen readers alone: a validation engineer reads
 * the number, not the picture, and a number that can be selected and pasted into a
 * report is worth more than one baked into a canvas.
 *
 * The values come from the same `MetricSpec[]` the canvas is drawn from and are
 * formatted by `src/plots/describe.ts`, so the text and the picture cannot disagree
 * about the eye height. That is the whole reason metrics are declared rather than
 * drawn.
 *
 * A verdict is shown as a word as well as a colour. Colour alone fails a monochrome
 * print and fails a reader who does not separate the two greens.
 */

import type { MetricSpec } from '../plots/chrome';
import { formatMetricValue } from '../plots/describe';

const STATUS_COLOR: Record<NonNullable<MetricSpec['status']>, string> = {
  pass: 'var(--pass)',
  marginal: 'var(--marginal)',
  fail: 'var(--fail)',
};

export interface MetricListProps {
  metrics: readonly MetricSpec[];
  /** Heading above the list. Omit inside a figure that already has a caption. */
  title?: string;
  /** Lay the list out in two columns where there is room. */
  columns?: boolean;
  /** Notes under the list: a sample count, an extrapolation warning. */
  notes?: readonly string[];
}

export function MetricList({ metrics, title, columns = false, notes }: MetricListProps): JSX.Element | null {
  if (metrics.length === 0 && (notes?.length ?? 0) === 0) return null;

  return (
    <div className="rounded-sm border border-rule bg-ink-800 px-3 py-2">
      {title ? <h4 className="mb-2 text-micro uppercase tracking-wide text-lo">{title}</h4> : null}

      <dl className={columns ? 'grid grid-cols-1 gap-x-6 sm:grid-cols-2' : ''}>
        {metrics.map((m) => (
          <div key={m.key} className="flex items-baseline justify-between gap-3 border-b border-rule/40 py-1">
            <dt className="text-micro text-lo">
              {m.label}
              {m.note ? <span className="ml-1 text-tick opacity-70">({m.note})</span> : null}
            </dt>
            <dd className="readout shrink-0 text-readout" style={{ color: 'var(--text-hi)' }}>
              {formatMetricValue(m)}
              {m.target !== undefined ? (
                <span className="ml-2 text-tick text-lo">
                  / {formatMetricValue({ ...m, value: m.target })}
                </span>
              ) : null}
              {m.status !== undefined ? (
                <span className="ml-2 text-tick uppercase" style={{ color: STATUS_COLOR[m.status] }}>
                  {m.status}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      {notes && notes.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {notes.map((n) => (
            <li key={n} className="text-tick text-lo">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
