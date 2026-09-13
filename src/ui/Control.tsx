/**
 * One control, chosen by its declaration.
 *
 * Nothing here decides what a control looks like, what range it has or what it is
 * called. `src/content/controls.ts` says which affordance and over what range,
 * `src/content/help.ts` says what it is called and what it does, and the Scenario
 * says what it currently is. This file only routes between them.
 *
 * That indirection is the point. A control added to the schema gets a registry
 * entry and a help entry - both enforced by coverage tests - and then appears in
 * the right panel with a working explanation, without anyone writing JSX for it.
 *
 * Array paths carry a `[]` segment in the registry and a concrete index at the
 * point of use, so the eight aggressors share one declaration and write to eight
 * different places.
 */

import type { ControlSpec } from '../content/controls';
import type { ControlHelp } from '../content/help';
import { controlFor, valueAtPath } from '../content/controls';
import { helpFor } from '../content/help';
import type { Scenario } from '../state/scenario';
import { Slider } from './Slider';
import { Select, TextField, Toggle } from './Choice';
import { NumberList } from './NumberList';
import { concretePath, labelFromPath } from './format';

/** A value written back into the Scenario. Matches what the URL codec can carry. */
export type ControlValue = number | string | boolean | number[];

export interface ControlProps {
  /** Registry path, with `[]` where an array index belongs. */
  path: string;
  scenario: Scenario;
  /** Which element of the array, for a path containing `[]`. */
  index?: number;
  onPatch: (concretePath: string, value: ControlValue) => void;
}

/**
 * Help is required for every control and a coverage test enforces that, so a
 * missing entry means the registry and the schema have diverged since the last
 * test run. Rendering a usable fallback beats rendering nothing: the control still
 * works, and the label says plainly that its explanation is missing.
 */
function fallbackHelp(path: string): ControlHelp {
  return {
    label: labelFromPath(path),
    unit: '',
    what: 'No help entry for this control yet.',
  };
}

export function Control({ path, scenario, index = 0, onPatch }: ControlProps): JSX.Element | null {
  const spec: ControlSpec | undefined = controlFor(path);
  if (!spec) return null;

  const help = helpFor(path) ?? fallbackHelp(path);
  const target = concretePath(path, index);
  const raw = valueAtPath(scenario, path, index);

  switch (spec.ui) {
    case 'slider':
    case 'log-slider':
      return (
        <Slider
          path={target}
          spec={spec}
          help={help}
          value={typeof raw === 'number' ? raw : (spec.min ?? 0)}
          onChange={(v) => onPatch(target, v)}
        />
      );

    case 'select':
      return (
        <Select
          path={target}
          spec={spec}
          help={help}
          value={typeof raw === 'string' ? raw : (spec.options?.[0] ?? '')}
          onChange={(v) => onPatch(target, v)}
        />
      );

    case 'toggle':
      return <Toggle path={target} help={help} value={raw === true} onChange={(v) => onPatch(target, v)} />;

    case 'text':
      return (
        <TextField
          path={target}
          spec={spec}
          help={help}
          value={typeof raw === 'string' ? raw : ''}
          onChange={(v) => onPatch(target, v)}
        />
      );

    case 'list':
      // An array of objects - the aggressor list - is not a value editor. The panel
      // owns adding, removing and selecting those, and mounts the element's own
      // controls itself.
      if (!Array.isArray(raw) || raw.some((e) => typeof e !== 'number')) return null;
      return (
        <NumberList
          path={target}
          spec={spec}
          help={help}
          value={raw as number[]}
          onChange={(v) => onPatch(target, v)}
        />
      );
  }
}
