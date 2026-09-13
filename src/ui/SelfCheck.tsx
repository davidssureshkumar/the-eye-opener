/**
 * A self-check question.
 *
 * The point is not scoring. It is that a reader who has just watched an edge slow
 * down should be asked to predict what happens next, commit to an answer, and then
 * be told why - because a prediction that turns out wrong is what makes the
 * explanation stick, and a paragraph read passively is not.
 *
 * So: the explanation for every option is shown after the answer is given, not only
 * for the wrong one. Knowing why the right answer is right matters as much as
 * knowing why the others are not, and a reader who guessed correctly has learned
 * nothing until they see it.
 *
 * The answer is recorded in `localStorage` through the progress store. It is not in
 * the permalink: a shared link should open someone else's setup, not their answers.
 */

import { useState } from 'react';
import { recordAnswer, useProgress } from '../state/store';

export interface SelfCheckOption {
  /** Stable id, recorded as the answer. Not the visible text. */
  id: string;
  text: string;
  correct?: boolean;
  /** Why this option is right, or why it is tempting and wrong. */
  why: string;
}

export interface SelfCheckProps {
  moduleId: string;
  /** Unique within the module. Part of the storage key. */
  id: string;
  question: string;
  options: readonly SelfCheckOption[];
}

export function SelfCheck({ moduleId, id, question, options }: SelfCheckProps): JSX.Element {
  const progress = useProgress();
  const stored = progress.answers[`${moduleId}:${id}`];
  const [chosen, setChosen] = useState<string | undefined>(stored);
  const answered = chosen !== undefined;

  const choose = (optionId: string): void => {
    setChosen(optionId);
    recordAnswer(moduleId, id, optionId);
  };

  return (
    <section
      className="my-6 rounded-sm border border-rule bg-ink-800 px-4 py-3"
      aria-labelledby={`check-${moduleId}-${id}`}
    >
      <p className="mb-1 text-micro uppercase tracking-wide" style={{ color: 'var(--ch3)' }}>
        Check yourself
      </p>
      <p id={`check-${moduleId}-${id}`} className="mb-3 text-body text-hi">
        {question}
      </p>

      <ul className="space-y-2">
        {options.map((o) => {
          const picked = chosen === o.id;
          const reveal = answered;
          const color = o.correct ? 'var(--pass)' : 'var(--fail)';
          return (
            <li key={o.id}>
              <button
                type="button"
                className="w-full rounded-sm border px-3 py-2 text-left text-body"
                style={{
                  borderColor: reveal ? color : picked ? 'var(--ch3)' : 'var(--rule)',
                  background: picked ? 'color-mix(in srgb, var(--ch3) 8%, transparent)' : 'transparent',
                }}
                aria-pressed={picked}
                onClick={() => choose(o.id)}
              >
                <span className="text-hi">{o.text}</span>
                {reveal ? (
                  <span className="ml-2 text-tick uppercase" style={{ color }}>
                    {o.correct ? 'correct' : 'not this one'}
                  </span>
                ) : null}
              </button>
              {reveal ? <p className="mt-1 pl-3 text-micro text-lo">{o.why}</p> : null}
            </li>
          );
        })}
      </ul>

      {answered ? (
        <button
          type="button"
          className="mt-3 text-tick text-lo underline hover:text-hi"
          onClick={() => setChosen(undefined)}
        >
          Hide the answers
        </button>
      ) : (
        <p className="mt-3 text-tick text-lo">Commit to an answer before reading on.</p>
      )}
    </section>
  );
}
