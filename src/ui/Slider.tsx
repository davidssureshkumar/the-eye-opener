/**
 * A continuous control.
 *
 * Built on a native `<input type="range">` rather than a div with pointer handlers.
 * That is a deliberate choice and not laziness: the native element already gives
 * arrow-key stepping, Page Up and Down, Home and End, a correct ARIA role, the
 * platform's own touch target sizing and a working focus ring. Every hand-rolled
 * slider re-implements some of that and forgets the rest, and the brief requires
 * the whole site be keyboard-operable.
 *
 * The input works in *step positions*, not in field units. `stepCount` turns the
 * control's declared step - field units for a linear control, decades for a log one
 * - into an integer range, and `denormalize` maps a position back through the
 * control's own quantisation and snap points. So an arrow key moves exactly one
 * declared step at any point on a logarithmic scale, and releasing near 50 ohms
 * gives 50 ohms rather than 49.87.
 *
 * `aria-valuetext` carries the formatted value with its unit. Without it a screen
 * reader announces "position 313 of 501", which is true and useless.
 */

import { useCallback, useId } from 'react';
import type { ControlSpec } from '../content/controls';
import type { ControlHelp } from '../content/help';
import { denormalize, normalize } from '../content/controls';
import { formatControlValue, stepCount } from './format';
import { HelpTip, IllustrativeBadge } from './HelpTip';

export interface SliderProps {
  /** Scenario path this control writes to. Shown in the help, used for ids. */
  path: string;
  spec: ControlSpec;
  help: ControlHelp;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}

export function Slider({ path, spec, help, value, onChange, disabled = false }: SliderProps): JSX.Element {
  const id = useId();
  const steps = stepCount(spec);
  const position = Math.round(normalize(spec, value) * steps);
  const text = formatControlValue(spec, help.unit, value);

  const handle = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const p = Number(event.target.value);
      onChange(denormalize(spec, p / steps));
    },
    [onChange, spec, steps],
  );

  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-micro text-hi">
          {help.label}
          {help.illustrative ? <IllustrativeBadge /> : null}
        </label>
        <output htmlFor={id} className="readout shrink-0 text-readout" style={{ color: 'var(--ch2)' }}>
          {text}
        </output>
      </div>

      <input
        id={id}
        type="range"
        className="mt-1 w-full accent-ch3"
        min={0}
        max={steps}
        step={1}
        value={position}
        disabled={disabled}
        onChange={handle}
        aria-valuetext={text}
        aria-describedby={`${id}-range`}
      />

      <div id={`${id}-range`} className="flex justify-between text-tick text-lo">
        <span>{formatControlValue(spec, help.unit, spec.min ?? 0)}</span>
        <span>{formatControlValue(spec, help.unit, spec.max ?? 0)}</span>
      </div>

      <HelpTip help={help} path={path} />
    </div>
  );
}
