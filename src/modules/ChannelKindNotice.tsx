/**
 * A notice for when the channel panel is showing a different model from the one a
 * module is about.
 *
 * The panel shows only the controls of the selected channel model, which is right:
 * a lossy line's roughness slider means nothing to a lumped RLC. But it means a
 * module whose prose says "change the far-end load in the channel panel" can open
 * on a Scenario where that control is not there. The figures in such a module read
 * their own model's fields directly, so they are still correct - it is only the
 * panel that disagrees, and the notice says so and offers the one-click fix.
 *
 * Switching the model is a Scenario change, so it lands in the permalink and in
 * every other module, and it pushes a history entry so the back button undoes it.
 */

import { Callout } from '../ui';
import { setScenario, useScenario } from '../state/store';
import { withPatch } from '../state/url-codec';
import type { Scenario } from '../state/scenario';

type ChannelKind = Scenario['channel']['kind'];

/** Human names, matching the options in the channel panel. */
const KIND_NAMES: Record<ChannelKind, string> = {
  ideal: 'ideal wire',
  rc: 'single-pole RC',
  rlc: 'lumped RLC',
  tline: 'lossless transmission line',
  lossy: 'lossy line',
  touchstone: 'Touchstone file',
};

export interface ChannelKindNoticeProps {
  /** The model this module's figures use. */
  kind: ChannelKind;
  /** Which controls the reader will find once it is selected. */
  controls: readonly string[];
}

export function ChannelKindNotice({ kind, controls }: ChannelKindNoticeProps): JSX.Element | null {
  const [scenario] = useScenario();
  const current = scenario.channel.kind;
  if (current === kind) return null;

  return (
    <Callout variant="notice" title="The channel panel is showing a different model">
      <p>
        The figures here use the {KIND_NAMES[kind]} fields of the Scenario, whatever model is selected. The
        channel panel only shows the controls of the selected model, which is currently the{' '}
        {KIND_NAMES[current]}, so the controls this module refers to ({controls.join(', ')}) are hidden.
      </p>
      <p>
        <button
          type="button"
          className="rounded-sm border px-2 py-0.5 text-micro text-hi"
          style={{ borderColor: 'var(--ch2)' }}
          // push, not replace, as TryThis does: the back button undoes it.
          onClick={() => setScenario(withPatch(scenario, { 'channel.kind': kind }), false)}
        >
          Select the {KIND_NAMES[kind]}
        </button>
        <span className="ml-2 text-micro text-lo">
          Changes the Scenario, so every module and the permalink see it.
        </span>
      </p>
    </Callout>
  );
}
