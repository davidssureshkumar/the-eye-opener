/**
 * The two discrete controls: a set of named options, and an on/off.
 *
 * Both are native form elements for the same reason the slider is. A `<select>`
 * gets the platform's own picker on a phone, and a checkbox gets the space bar and
 * an announced checked state, neither of which a styled div does without work that
 * is invariably left half finished.
 *
 * Option labels come from `labelFromOption`, so 'pam4' shows as 'PAM4' and
 * 'worst-case-isi' as 'Worst-case ISI', while the value written into the Scenario
 * stays exactly the schema's enum member.
 */

import { useId } from 'react';
import type { ControlSpec } from '../content/controls';
import type { ControlHelp } from '../content/help';
import { labelFromOption } from './format';
import { HelpTip, IllustrativeBadge } from './HelpTip';

export interface SelectProps {
  path: string;
  spec: ControlSpec;
  help: ControlHelp;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

export function Select({ path, spec, help, value, onChange, disabled = false }: SelectProps): JSX.Element {
  const id = useId();
  const options = spec.options ?? [];

  return (
    <div className="py-2">
      <label htmlFor={id} className="block text-micro text-hi">
        {help.label}
        {help.illustrative ? <IllustrativeBadge /> : null}
      </label>
      <select
        id={id}
        className="mt-1 w-full rounded-sm border border-rule bg-ink-700 px-2 py-1 text-readout text-hi"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labelFromOption(o)}
          </option>
        ))}
      </select>
      <HelpTip help={help} path={path} />
    </div>
  );
}

export interface ToggleProps {
  path: string;
  help: ControlHelp;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ path, help, value, onChange, disabled = false }: ToggleProps): JSX.Element {
  const id = useId();
  return (
    <div className="py-2">
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 accent-ch3"
          checked={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label htmlFor={id} className="text-micro text-hi">
          {help.label}
          {help.illustrative ? <IllustrativeBadge /> : null}
        </label>
      </div>
      <HelpTip help={help} path={path} />
    </div>
  );
}

export interface TextFieldProps {
  path: string;
  spec: ControlSpec;
  help: ControlHelp;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/** A short free-text field: a custom bit pattern, a Touchstone file name. */
export function TextField({
  path,
  spec,
  help,
  value,
  onChange,
  disabled = false,
}: TextFieldProps): JSX.Element {
  const id = useId();
  return (
    <div className="py-2">
      <label htmlFor={id} className="block text-micro text-hi">
        {help.label}
        {help.illustrative ? <IllustrativeBadge /> : null}
      </label>
      <input
        id={id}
        type="text"
        className="readout mt-1 w-full rounded-sm border border-rule bg-ink-700 px-2 py-1 text-readout text-hi"
        value={value}
        maxLength={spec.maxLength}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <HelpTip help={help} path={path} />
    </div>
  );
}
