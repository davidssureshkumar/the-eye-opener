/**
 * The glossary.
 *
 * Every definition is written to be precise enough to compute with, and carries its
 * unit. That is the difference between a glossary an engineer uses and one they skim
 * once: "eye height" is not "how open the eye is", it is a voltage measured between
 * stated levels at a stated point in the unit interval.
 *
 * Deep-linkable by term - `#/glossary/eye-height` - because every `see` reference in
 * the control help points here, and a definition you cannot link to is a definition
 * nobody cites.
 *
 * The search is a plain substring match over terms, abbreviations and definitions,
 * run on every keystroke over a few hundred entries. There is no index and no
 * debounce: the whole list is smaller than one waveform, and a search box that lags
 * behind typing is worse than one that is theoretically slower.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { GLOSSARY, getTerm, searchGlossary } from '../content/glossary';
import { getModule } from '../content/modules';

export function GlossaryPage({ termId }: { termId: string }): JSX.Element {
  const [query, setQuery] = useState('');
  const target = useRef<HTMLDivElement | null>(null);
  const selected = termId ? getTerm(termId) : undefined;

  const entries = useMemo(
    () =>
      query.trim() === ''
        ? [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term))
        : searchGlossary(query),
    [query],
  );

  useEffect(() => {
    // A deep link should land on the term, not at the top of a list of hundreds.
    if (selected && target.current) {
      target.current.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }, [selected]);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-10 lg:px-8">
      <h1 className="text-h1">Glossary</h1>
      <p className="mt-2 max-w-[68ch] text-body text-lo">
        {GLOSSARY.length} terms, each with its unit and a definition precise enough to compute with. Where a
        term has a standardised meaning, the standard is named rather than quoted.
      </p>

      <label className="mt-6 block max-w-md">
        <span className="text-micro text-lo">Search</span>
        <input
          type="search"
          className="mt-1 w-full rounded-sm border border-rule bg-ink-800 px-2 py-1 text-body text-hi"
          value={query}
          placeholder="eye height, ISI, Kf, de-emphasis"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <p className="mt-2 text-tick text-lo" role="status">
        {entries.length} of {GLOSSARY.length} terms
      </p>

      <dl className="mt-6 space-y-5">
        {entries.map((e) => {
          const isTarget = selected?.id === e.id;
          const module = e.module ? getModule(e.module) : undefined;
          return (
            <div
              key={e.id}
              id={e.id}
              ref={isTarget ? target : undefined}
              className="rounded-sm border-l-2 pl-3"
              style={{ borderColor: isTarget ? 'var(--ch3)' : 'var(--rule)' }}
            >
              <dt className="flex flex-wrap items-baseline gap-2">
                <a href={`#/glossary/${e.id}`} className="text-lead text-hi no-underline">
                  {e.term}
                </a>
                {e.unit ? (
                  <span className="readout text-tick" style={{ color: 'var(--ch2)' }}>
                    [{e.unit}]
                  </span>
                ) : null}
                {e.aka && e.aka.length > 0 ? (
                  <span className="text-tick text-lo">{e.aka.join(', ')}</span>
                ) : null}
                {module ? (
                  <a href={`#/${module.id}`} className="ml-auto text-tick text-lo">
                    M{module.number}
                  </a>
                ) : null}
              </dt>
              <dd className="mt-1 text-body text-hi">{e.definition}</dd>
              {e.note ? <dd className="mt-1 text-micro text-lo">{e.note}</dd> : null}
              {e.see && e.see.length > 0 ? (
                <dd className="mt-1 text-micro text-lo">
                  See:{' '}
                  {e.see.map((id, i) => {
                    const other = getTerm(id);
                    if (!other) return null;
                    return (
                      <span key={id}>
                        {i > 0 ? ', ' : ''}
                        <a href={`#/glossary/${id}`}>{other.term}</a>
                      </span>
                    );
                  })}
                </dd>
              ) : null}
            </div>
          );
        })}
      </dl>

      {entries.length === 0 ? (
        <p className="mt-6 text-lo">
          Nothing matches <span className="readout text-hi">{query}</span>.
        </p>
      ) : null}
    </main>
  );
}
