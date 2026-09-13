/**
 * How a control's value is written next to it.
 *
 * Separate from `src/plots/scale.ts` because a panel readout and an axis tick want
 * different things. An axis formats a whole set of ticks with one shared prefix so
 * the row reads evenly; a single control wants the prefix that suits its own value,
 * so 12 ps stays 12 ps while the slider beside it reads 3.2 GBd.
 *
 * The rules that matter:
 *   - An integer field is written as an integer. A PRBS seed of 65535 is a seed,
 *     not "65.5 k".
 *   - A dimensionless ratio keeps its decimals rather than growing an SI prefix:
 *     a coupling coefficient of 0.02 is not "20 m".
 *   - Everything else gets engineering notation with its unit.
 */

import type { ControlSpec } from '../content/controls';
import { formatEng } from '../plots/scale';

/** Units that are labels rather than physical dimensions, so no SI prefix. */
const UNPREFIXED = new Set(['', '1', 'dB', 'UI', '%', 'bit', 'bits', 'tap', 'taps']);

/**
 * Decimals for a plain (unprefixed) value, taken from the control's own step so the
 * readout can always show the smallest change the control can make.
 */
function decimalsFor(step: number | undefined): number {
  if (step === undefined || step <= 0) return 3;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

export function formatControlValue(spec: ControlSpec | undefined, unit: string, value: number): string {
  if (!Number.isFinite(value)) return String(value);

  if (spec?.integer === true) {
    const text = String(Math.round(value));
    return unit ? `${text} ${unit}` : text;
  }

  if (UNPREFIXED.has(unit)) {
    // A log control spans decades, so a fixed decimal count is wrong for it: 1e-6
    // and 1 cannot share a precision. Significant figures suit it instead.
    const text = spec?.ui === 'log-slider' ? formatEng(value, '', 3) : value.toFixed(decimalsFor(spec?.step));
    return unit && unit !== '1' ? `${text} ${unit}` : text;
  }

  return formatEng(value, unit, 4);
}

/**
 * How many discrete positions a slider offers.
 *
 * The range input works in whole steps, so the control's own `step` - field units
 * for a linear control, decades for a log one - decides the count. Clamped at both
 * ends: fewer than two positions is not a slider, and more than a couple of thousand
 * is finer than a pixel and only makes the keyboard arrow keys useless.
 */
export function stepCount(spec: ControlSpec): number {
  if (spec.min === undefined || spec.max === undefined) return 100;
  const step = spec.step;
  if (step === undefined || step <= 0) return 100;
  const span = spec.ui === 'log-slider' ? Math.log10(spec.max) - Math.log10(spec.min) : spec.max - spec.min;
  return Math.min(2000, Math.max(2, Math.round(span / step)));
}

/** A Scenario path as a readable fallback label: 'source.riseTime' -> 'Rise time'. */
export function labelFromPath(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  const spaced = leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Enum members as they should be read: 'clock-div-n' -> 'Clock div N', 'prbs7' -> 'PRBS7'. */
export function labelFromOption(option: string): string {
  const special: Record<string, string> = {
    nrz: 'NRZ',
    pam4: 'PAM4',
    rc: 'RC',
    rlc: 'RLC',
    ideal: 'Ideal',
    tline: 'Transmission line',
    lossy: 'Lossy line',
    touchstone: 'Touchstone file',
    brickwall: 'Brick wall',
    'clock-div-n': 'Clock div N',
    'worst-case-isi': 'Worst-case ISI',
  };
  if (special[option]) return special[option];
  if (/^prbs\d+$/.test(option)) return option.toUpperCase();
  const spaced = option.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `crosstalk.aggressors.[].kb` at index 2 becomes `crosstalk.aggressors.2.kb`.
 *
 * One registry entry stands for the whole aggressor array; the index arrives at the
 * point of use, so eight aggressors share one declaration and write to eight
 * different places.
 */
export function concretePath(path: string, index: number): string {
  return path.replace('[]', String(index));
}
