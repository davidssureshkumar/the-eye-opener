/**
 * "Try this": a directed experiment.
 *
 * A page full of sliders and no suggestion of what to do with them is a toy. These
 * are the specific moves worth making - set the rise time to 20 ps, then to 80 ps,
 * and watch which harmonics leave - together with what to look for and what it
 * means when you see it.
 *
 * The optional setup button applies the patch and pushes a history entry rather than
 * replacing one, so the back button returns the reader to whatever they had before.
 * That matters: an experiment that silently destroys the setup someone spent five
 * minutes building is one they will not run twice.
 *
 * The patch is a sparse set of Scenario paths, the same form the URL codec carries,
 * so a `TryThis` and a permalink describe a setup identically.
 */

import { setScenario, useScenario } from '../state/store';
import { withPatch } from '../state/url-codec';

/** A sparse Scenario patch: dotted paths to leaf values. */
export type ScenarioPatch = Record<string, number | string | boolean | number[]>;

export interface TryThisProps {
  title: string;
  /** What to do, in order. One action each. */
  steps: readonly string[];
  /** What should happen, and what it tells you. */
  expect?: string;
  /** Controls to move, applied by the button. Omit for a purely manual exercise. */
  setup?: ScenarioPatch;
  /** Label for the setup button. */
  setupLabel?: string;
}

export function TryThis({
  title,
  steps,
  expect,
  setup,
  setupLabel = 'Set this up',
}: TryThisProps): JSX.Element {
  const [scenario] = useScenario();

  const apply = (): void => {
    if (!setup) return;
    // push, not replace: the reader can undo the experiment with the back button.
    setScenario(withPatch(scenario, setup), false);
  };

  return (
    <section
      className="my-6 rounded-sm border-l-2 px-4 py-3"
      style={{
        borderColor: 'var(--ch3)',
        background: 'color-mix(in srgb, var(--ch3) 6%, var(--ink-800))',
      }}
    >
      <p className="mb-1 text-micro uppercase tracking-wide" style={{ color: 'var(--ch3)' }}>
        Try this
        <span className="ml-2 normal-case tracking-normal text-hi">{title}</span>
      </p>

      <ol className="ml-4 list-decimal space-y-1 text-body text-hi">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      {expect ? (
        <p className="mt-2 text-micro text-lo">
          <span className="uppercase tracking-wide">What to look for: </span>
          {expect}
        </p>
      ) : null}

      {setup ? (
        <button
          type="button"
          className="mt-3 rounded-sm border px-2 py-1 text-micro"
          style={{ borderColor: 'var(--ch3)', color: 'var(--ch3)' }}
          onClick={apply}
        >
          {setupLabel}
        </button>
      ) : null}
    </section>
  );
}
