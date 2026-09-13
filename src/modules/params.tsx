/**
 * Controls for a module's own job parameters.
 *
 * These are **not** Scenario controls and are deliberately not built on the
 * declaration-driven path in `src/content/controls.ts`. The distinction is real and
 * worth keeping visible:
 *
 *   A Scenario field describes the *link* - what is driven, what it travels
 *   through, what receives it. It is shared by every module, it is validated by the
 *   schema, it is carried in the permalink, and it gets a registry entry, a help
 *   entry and a coverage test.
 *
 *   A job parameter describes *this module's question about that link* - how many
 *   harmonics to sum, how many rise times of record to compute, whether to return
 *   the per-harmonic traces. `FourierParams.maxN` is not a property of the
 *   transmitter; it is a property of the experiment M1 is running on it.
 *
 * The consequence a reader can see is that a job parameter is not in the permalink.
 * That is a real limitation and it is recorded in PROGRESS.md rather than papered
 * over here: a link to M1 reproduces the signal exactly and opens at the default
 * number of harmonics.
 *
 * Native elements throughout, for the same reasons `Slider` gives.
 */

import { useId, type ReactNode } from 'react';

interface FieldProps {
  label: string;
  /** The current value, already formatted with its unit. */
  readout?: string;
  /** One line under the control saying what moving it does. */
  hint?: string;
  children: (id: string) => ReactNode;
}

function Field({ label, readout, hint, children }: FieldProps): JSX.Element {
  const id = useId();
  return (
    <div className="min-w-[11rem] flex-1 py-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-micro text-hi">
          {label}
        </label>
        {readout === undefined ? null : (
          <output htmlFor={id} className="readout shrink-0 text-readout" style={{ color: 'var(--ch2)' }}>
            {readout}
          </output>
        )}
      </div>
      {children(id)}
      {hint === undefined ? null : <p className="mt-0.5 text-tick text-lo">{hint}</p>}
    </div>
  );
}

/**
 * A row of job-parameter controls, labelled as such.
 *
 * The heading is not decoration. A reader who has just learned that the address bar
 * carries the whole setup needs to know that these particular knobs are the
 * exception.
 */
export function ParamRow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <section
      className="my-5 rounded-sm border border-rule px-3 py-2"
      aria-label="Figure controls"
      style={{ background: 'var(--ink-800)' }}
    >
      <p className="mb-1 text-micro uppercase tracking-wide text-lo">
        Figure controls
        <span className="ml-2 normal-case tracking-normal">not carried by the permalink</span>
      </p>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-1">{children}</div>
    </section>
  );
}

export interface ParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Formats the value for the readout and for `aria-valuetext`. */
  format: (v: number) => string;
  hint?: string;
  onChange: (next: number) => void;
}

export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  hint,
  onChange,
}: ParamSliderProps): JSX.Element {
  const text = format(value);
  return (
    <Field label={label} readout={text} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="range"
          className="mt-1 w-full accent-ch3"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-valuetext={text}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
    </Field>
  );
}

export interface ParamSelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  hint?: string;
  onChange: (next: T) => void;
}

export function ParamSelect<T extends string>({
  label,
  value,
  options,
  hint,
  onChange,
}: ParamSelectProps<T>): JSX.Element {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select
          id={id}
          className="mt-1 w-full rounded-sm border border-rule bg-ink-700 px-2 py-1 text-micro text-hi"
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface ParamToggleProps {
  label: string;
  value: boolean;
  hint?: string;
  onChange: (next: boolean) => void;
}

export function ParamToggle({ label, value, hint, onChange }: ParamToggleProps): JSX.Element {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          type="checkbox"
          className="mt-2 h-4 w-4 accent-ch3"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
    </Field>
  );
}
