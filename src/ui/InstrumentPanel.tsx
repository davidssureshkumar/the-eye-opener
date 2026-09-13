/**
 * The instrument panel: every control a module exposes, in the order the registry
 * declares.
 *
 * A module names the panels it wants (source, channel, and so on) and gets exactly
 * the controls that belong to them, grouped and ordered by `src/content/controls.ts`.
 * There is no per-module list of sliders to keep in step with the schema, which is
 * the arrangement that would guarantee some module quietly missing a control that
 * changes its plot.
 *
 * Three behaviours worth naming:
 *
 *   - Irrelevant controls are hidden, not disabled. `isVisible` hides the RLC values
 *     while a lossy channel is selected. The values are still there, so switching
 *     back restores the setup the reader had; they are simply not offered while they
 *     do nothing.
 *   - Controls marked `advanced` are folded behind a disclosure. They are correct
 *     and occasionally essential, and putting them at the same visual weight as the
 *     symbol rate makes the panel unreadable.
 *   - A change replaces history rather than pushing it. Dragging a slider produces
 *     dozens of states a second and none of them belong in the back button.
 */

import { useState } from 'react';
import type { PanelId } from '../content/controls';
import { PANELS, controlFor, controlsIn, groupsIn, isVisible } from '../content/controls';
import { aggressorSchema, cloneScenario, type Scenario } from '../state/scenario';
import { withPatch } from '../state/url-codec';
import { Control, type ControlValue } from './Control';
import { concretePath } from './format';

export interface InstrumentPanelProps {
  /** Which panels this module exposes, in the order it wants them. */
  panels: readonly PanelId[];
  scenario: Scenario;
  onChange: (next: Scenario) => void;
}

const MAX_AGGRESSORS = 8;

export function InstrumentPanel({ panels, scenario, onChange }: InstrumentPanelProps): JSX.Element {
  // Which aggressor the per-aggressor controls are editing. Panel state, not
  // scenario state: it changes what you are looking at, not what is simulated, so
  // it does not belong in a permalink.
  const [selected, setSelected] = useState(0);

  const patch = (path: string, value: ControlValue): void => {
    onChange(withPatch(scenario, { [path]: value }));
  };

  const setAggressorCount = (n: number): void => {
    const next = cloneScenario(scenario);
    const list = next.crosstalk.aggressors;
    while (list.length > n) list.pop();
    while (list.length < n) list.push(aggressorSchema.parse({}));
    onChange(next);
    if (selected >= n) setSelected(Math.max(0, n - 1));
  };

  const aggressorCount = scenario.crosstalk.aggressors.length;
  const index = Math.min(selected, Math.max(0, aggressorCount - 1));

  return (
    <div className="space-y-6">
      {panels.map((panelId) => {
        const meta = PANELS.find((p) => p.id === panelId);
        if (!meta) return null;

        return (
          <section key={panelId} aria-labelledby={`panel-${panelId}`}>
            <h3
              id={`panel-${panelId}`}
              className="border-b border-rule pb-1 text-micro uppercase tracking-wide"
              style={{ color: 'var(--ch3)' }}
            >
              {meta.title}
            </h3>
            <p className="mt-1 text-tick text-lo">{meta.summary}</p>

            {groupsIn(panelId).map((group) => {
              const paths = controlsIn(panelId, group.id).filter((p) =>
                isVisible(scenario, p, p.includes('[]') ? index : 0),
              );
              const perAggressor = paths.filter((p) => p.includes('[]'));
              const plain = paths.filter((p) => !p.includes('[]'));
              const showsAggressorManager = panelId === 'crosstalk' && group.id === 'coupling';

              // A group whose every control is currently irrelevant is not rendered
              // at all; an empty heading is worse than no heading.
              if (paths.length === 0 && !showsAggressorManager) return null;
              if (plain.length === 0 && perAggressor.length > 0 && aggressorCount === 0) return null;

              const ordinary = plain.filter((p) => controlFor(p)?.advanced !== true);
              const advanced = plain.filter((p) => controlFor(p)?.advanced === true);
              const perAggressorPlain = perAggressor.filter((p) => controlFor(p)?.advanced !== true);

              return (
                <div key={group.id} className="mt-4">
                  <h4 className="text-micro font-semibold text-hi">{group.title}</h4>
                  {group.note ? <p className="text-tick text-lo">{group.note}</p> : null}

                  {ordinary.map((p) => (
                    <Control key={p} path={p} scenario={scenario} index={index} onPatch={patch} />
                  ))}

                  {showsAggressorManager && scenario.crosstalk.enabled ? (
                    <AggressorManager
                      count={aggressorCount}
                      selected={index}
                      onCount={setAggressorCount}
                      onSelect={setSelected}
                    />
                  ) : null}

                  {aggressorCount > 0
                    ? perAggressorPlain.map((p) => (
                        <Control
                          key={concretePath(p, index)}
                          path={p}
                          scenario={scenario}
                          index={index}
                          onPatch={patch}
                        />
                      ))
                    : null}

                  {advanced.length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-tick text-lo hover:text-hi">
                        Advanced ({advanced.length})
                      </summary>
                      <div className="border-l border-rule pl-2">
                        {advanced.map((p) => (
                          <Control key={p} path={p} scenario={scenario} index={index} onPatch={patch} />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * How many aggressors there are, and which one the per-aggressor controls edit.
 *
 * The aggressor array is the one place where a single registry entry stands for a
 * variable number of things. Rather than render eight copies of seven controls, the
 * panel edits one aggressor at a time and says plainly which one.
 */
function AggressorManager({
  count,
  selected,
  onCount,
  onSelect,
}: {
  count: number;
  selected: number;
  onCount: (n: number) => void;
  onSelect: (i: number) => void;
}): JSX.Element {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-micro text-hi">Aggressors</span>
        <span className="readout text-tick text-lo">
          {count} of {MAX_AGGRESSORS}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className="readout rounded-sm border px-2 py-0.5 text-tick"
            style={{
              borderColor: i === selected ? 'var(--ch3)' : 'var(--rule)',
              color: i === selected ? 'var(--ch3)' : 'var(--text-lo)',
            }}
            aria-pressed={i === selected}
            onClick={() => onSelect(i)}
          >
            A{i + 1}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="rounded-sm border border-rule px-2 py-0.5 text-tick text-hi disabled:opacity-40"
          onClick={() => onCount(count + 1)}
          disabled={count >= MAX_AGGRESSORS}
        >
          Add aggressor
        </button>
        <button
          type="button"
          className="rounded-sm border border-rule px-2 py-0.5 text-tick text-hi disabled:opacity-40"
          onClick={() => onCount(count - 1)}
          disabled={count === 0}
        >
          Remove last
        </button>
      </div>

      <p className="mt-1 text-tick text-lo">
        Controls below edit aggressor {count === 0 ? '—' : `A${selected + 1}`}.
      </p>
    </div>
  );
}
