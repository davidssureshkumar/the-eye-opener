/**
 * The explanation attached to a control.
 *
 * A disclosure rather than a hover tooltip, for three reasons: hover does not exist
 * on a phone, a tooltip cannot be read by a screen reader without a fight, and the
 * text here is three or four sentences rather than a word. `<details>` gives
 * keyboard operation, an accessible expanded state and a working browser find,
 * none of which a div with an onMouseEnter gives.
 *
 * The content is `src/content/help.ts`, which a coverage test proves has an entry
 * for every control in the Scenario. Nothing is written here.
 */

import type { ControlHelp } from '../content/help';
import { getTerm, type GlossaryEntry } from '../content/glossary';

export interface HelpTipProps {
  help: ControlHelp;
  /** Scenario path, so the disclosure ids are unique on a panel with 60 controls. */
  path: string;
}

export function HelpTip({ help, path }: HelpTipProps): JSX.Element {
  const terms = (help.see ?? []).map((id) => getTerm(id)).filter((e): e is GlossaryEntry => e !== undefined);

  return (
    <details className="group mt-1">
      <summary
        className="cursor-pointer list-none text-micro text-lo hover:text-hi"
        aria-label={`What ${help.label} does`}
      >
        <span aria-hidden="true" className="inline-block w-3">
          <span className="group-open:hidden">+</span>
          <span className="hidden group-open:inline">&minus;</span>
        </span>
        <span className="group-open:hidden">What this does</span>
        <span className="hidden group-open:inline">Hide</span>
      </summary>

      <div className="mt-2 space-y-2 border-l border-rule pl-3 text-micro text-lo">
        <p className="text-hi">{help.what}</p>
        {help.why ? (
          <p>
            <span className="uppercase tracking-wide text-lo">Why move it: </span>
            {help.why}
          </p>
        ) : null}
        {help.bench ? (
          <p>
            <span className="uppercase tracking-wide" style={{ color: 'var(--ch1)' }}>
              At the bench:{' '}
            </span>
            {help.bench}
          </p>
        ) : null}
        {terms.length > 0 ? (
          <p>
            <span className="uppercase tracking-wide text-lo">See: </span>
            {terms.map((t, i) => (
              <span key={t.id}>
                {i > 0 ? ', ' : ''}
                <a href={`#/glossary/${t.id}`}>{t.term}</a>
              </span>
            ))}
          </p>
        ) : null}
        <p className="readout text-lo opacity-60">{path}</p>
      </div>
    </details>
  );
}

/**
 * The badge on a control whose default is a stand-in.
 *
 * `help.illustrative` marks a control whose shipped default is a plausible figure
 * rather than one from a standard. Showing that on the control itself, not only in
 * a paragraph somewhere above, is the difference between a reader knowing which
 * numbers they may quote and a reader assuming all of them.
 */
export function IllustrativeBadge(): JSX.Element {
  return (
    <span
      className="ml-2 rounded-sm px-1 text-tick uppercase tracking-wide"
      style={{ color: 'var(--ch2)', background: 'color-mix(in srgb, var(--ch2) 14%, transparent)' }}
      title="The default value here is a representative stand-in, not a specification figure."
    >
      illustrative
    </span>
  );
}
