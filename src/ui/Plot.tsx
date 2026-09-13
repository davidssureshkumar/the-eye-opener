/**
 * The canvas host: one place where every plot on the site gets its pixels.
 *
 * Everything a plot needs and nobody should re-implement per module lives here:
 *
 *   - Device pixel ratio, via `prepare`. Handled once, so drawing code works in CSS
 *     pixels and traces are sharp on the machines engineers actually use.
 *   - Repaint coalescing, via `useAnimationFrame`. A slider fires far faster than
 *     the display refreshes; painting every event makes the drag feel worse, not
 *     better.
 *   - The text beside the picture. `describePlot` turns the same `ChromeSpec` the
 *     canvas was drawn from into the caption, the canvas `aria-label` and the metric
 *     summary, so the three cannot drift apart.
 *   - Export. Every plot can leave the browser as a PNG or, when the caller supplies
 *     the arrays, as a CSV carrying the setup that produced it.
 *
 * The caller supplies `render`, which is handed a prepared `Surface` and returns the
 * plot's declaration plus a function that draws the traces. It is called on every
 * paint, and it must be cheap: the heavy arithmetic belongs in a job, and what
 * reaches this component is the already-computed result.
 *
 * `spec` is captured into React state after the paint, because the scales inside it
 * depend on the plot rectangle and so cannot be known before the canvas is sized.
 * The state is only written when the rendered description actually changes, which
 * is what stops a paint from scheduling a render that schedules a paint.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { prepare, useAnimationFrame, useElementSize, type Insets, type Surface } from '../plots/canvas';
import { withChrome, type ChromeSpec } from '../plots/chrome';
import { describePlot, type PlotDescription } from '../plots/describe';
import { chromeToCsv, downloadCsv, downloadPng } from '../plots/export';
import { MetricList } from './MetricList';

/** What a caller returns for one paint: the declaration, and the traces. */
export interface PlotRender {
  spec: ChromeSpec;
  drawTraces: (s: Surface) => void;
}

/** Arrays behind the picture, for CSV export. Omit to offer PNG only. */
export interface PlotData {
  x: ArrayLike<number>;
  series: readonly { key: string; values: ArrayLike<number> }[];
}

export interface PlotProps {
  /** Used for the export filename and the figure's accessible name. */
  title: string;
  /** Called with a prepared surface on every paint. Must be cheap. */
  render: (s: Surface) => PlotRender;
  /** CSS pixels. The width is whatever the container gives it. */
  height?: number;
  insets?: Partial<Insets>;
  /** A job is running; the previous result stays on screen underneath. */
  busy?: boolean;
  /** Job progress, 0 to 100. Shown only while `busy`. */
  progress?: number;
  /** Permalink for the current setup, written into the CSV preamble. */
  permalink?: string;
  data?: () => PlotData;
  /** Show the metric summary under the plot. On by default. */
  showMetrics?: boolean;
}

export function Plot({
  title,
  render,
  height = 300,
  insets,
  busy = false,
  progress = 0,
  permalink,
  data,
  showMetrics = true,
}: PlotProps): JSX.Element {
  const [hostRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const specRef = useRef<ChromeSpec | null>(null);
  const [description, setDescription] = useState<PlotDescription | null>(null);

  // `render` is a closure over the caller's data and changes on every one of their
  // renders. Reading it through a ref keeps the paint callback stable, so the
  // animation-frame scheduler is not torn down and rebuilt on every keystroke.
  const renderRef = useRef(render);
  renderRef.current = render;

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size || size.width <= 0) return;

    const surface = prepare(canvas, size.width, height, insets);
    if (!surface) return;

    const { spec, drawTraces } = renderRef.current(surface);
    specRef.current = spec;
    withChrome(surface, spec, () => drawTraces(surface));

    const next = describePlot(spec);
    // Compare the rendered text, not the spec: a new scale object on every paint
    // is not a change a reader can see, and setting state on it would loop.
    setDescription((prev) => (prev !== null && prev.text === next.text ? prev : next));
    // `insets` is an object literal at most call sites, so it is a new value every
    // render and cannot be a dependency without defeating the memo. Its contents
    // are read on every paint regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, height]);

  const requestPaint = useAnimationFrame(paint);

  useEffect(() => {
    requestPaint();
  }, [requestPaint, render, size, height, busy]);

  const savePng = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) void downloadPng(canvas, title);
  }, [title]);

  const saveCsv = useCallback(() => {
    const spec = specRef.current;
    if (!spec || !data) return;
    const { x, series } = data();
    downloadCsv(chromeToCsv(spec, x, series, permalink ? { permalink } : {}), title);
  }, [data, permalink, title]);

  return (
    <figure className="my-5">
      <div ref={hostRef} className="relative w-full" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="h-full w-full rounded-sm border border-rule"
          role="img"
          aria-label={description ? description.aria : `${title}, not yet computed`}
        />

        {busy ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 px-2 py-1">
            <div className="flex items-center gap-2 text-tick text-lo">
              <span className="readout" style={{ color: 'var(--ch2)' }}>
                computing
              </span>
              <div className="h-0.5 flex-1 bg-ink-700">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, progress))}%`,
                    background: 'var(--ch2)',
                  }}
                />
              </div>
              <span className="readout w-10 text-right">{Math.round(progress)}%</span>
            </div>
          </div>
        ) : null}
      </div>

      <figcaption className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-micro text-lo">{description?.caption ?? ''}</span>
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            className="rounded-sm border border-rule px-2 py-0.5 text-tick text-lo hover:text-hi"
            onClick={savePng}
          >
            PNG
          </button>
          {data ? (
            <button
              type="button"
              className="rounded-sm border border-rule px-2 py-0.5 text-tick text-lo hover:text-hi"
              onClick={saveCsv}
            >
              CSV
            </button>
          ) : null}
        </span>
      </figcaption>

      {showMetrics && description && (description.metrics.length > 0 || description.notes.length > 0) ? (
        <div className="mt-2">
          <MetricList
            metrics={specRef.current?.metrics ?? []}
            notes={description.notes}
            title="Measured"
            columns
          />
        </div>
      ) : null}
    </figure>
  );
}
