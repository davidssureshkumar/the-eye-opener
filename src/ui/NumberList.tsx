/**
 * A short array of numbers: FFE taps, DFE taps, cursor positions.
 *
 * The list length is itself a parameter - a three-tap FFE and a five-tap FFE are
 * different equalizers - so adding and removing is part of the control, not a
 * setup step. `maxItems` comes from the registry, which takes it from the Zod
 * schema's own bound, so the panel cannot offer a list the schema would reject.
 *
 * Each element is a slider over the same declared range rather than a text box.
 * Tap weights are explored by dragging and watching the eye, not by typing, and
 * the range keeps the arrow keys stepping in the declared increment.
 */

import { useId } from 'react';
import type { ControlSpec } from '../content/controls';
import type { ControlHelp } from '../content/help';
import { denormalize, normalize } from '../content/controls';
import { formatControlValue, stepCount } from './format';
import { HelpTip, IllustrativeBadge } from './HelpTip';

export interface NumberListProps {
  path: string;
  spec: ControlSpec;
  help: ControlHelp;
  value: readonly number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}

export function NumberList({
  path,
  spec,
  help,
  value,
  onChange,
  disabled = false,
}: NumberListProps): JSX.Element {
  const id = useId();
  const steps = stepCount(spec);
  const max = spec.maxItems ?? 8;

  const setAt = (i: number, v: number): void => {
    const next = [...value];
    next[i] = v;
    onChange(next);
  };

  const append = (): void => {
    // A new tap starts at zero: appending a tap should change the list length
    // without changing the response, so the effect of the tap is what the reader
    // then sees when they move it.
    const seed = spec.min !== undefined && spec.max !== undefined && spec.min > 0 ? spec.min : 0;
    onChange([...value, seed]);
  };

  const removeLast = (): void => onChange(value.slice(0, -1));

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-micro text-hi" id={id}>
          {help.label}
          {help.illustrative ? <IllustrativeBadge /> : null}
        </span>
        <span className="readout text-tick text-lo">
          {value.length} of {max}
        </span>
      </div>

      <ul className="mt-1 space-y-1" aria-labelledby={id}>
        {value.map((v, i) => (
          // The index is the identity: element three of an FFE is the third tap,
          // and reordering is not an operation this control offers.
          <li key={`${path}-${i}`} className="flex items-center gap-2">
            <span className="readout w-10 shrink-0 text-tick text-lo">{`[${i}]`}</span>
            <input
              type="range"
              className="min-w-0 flex-1 accent-ch3"
              min={0}
              max={steps}
              step={1}
              value={Math.round(normalize(spec, v) * steps)}
              disabled={disabled}
              onChange={(e) => setAt(i, denormalize(spec, Number(e.target.value) / steps))}
              aria-label={`${help.label}, element ${i}`}
              aria-valuetext={formatControlValue(spec, help.unit, v)}
            />
            <span className="readout w-16 shrink-0 text-right text-tick" style={{ color: 'var(--ch2)' }}>
              {formatControlValue(spec, help.unit, v)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded-sm border border-rule px-2 py-0.5 text-tick text-hi disabled:opacity-40"
          onClick={append}
          disabled={disabled || value.length >= max}
        >
          Add
        </button>
        <button
          type="button"
          className="rounded-sm border border-rule px-2 py-0.5 text-tick text-hi disabled:opacity-40"
          onClick={removeLast}
          disabled={disabled || value.length === 0}
        >
          Remove last
        </button>
      </div>

      <HelpTip help={help} path={path} />
    </div>
  );
}
