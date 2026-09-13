/**
 * The frame every module is written inside.
 *
 * A module file should contain its physics, its plots and its prose, and nothing
 * about layout, navigation, permalinks or progress. All of that is here and is
 * identical in all eleven, which is the only way eleven modules stay consistent.
 *
 * The layout is two columns on a wide screen: a reading column of at most 68
 * characters, and a sticky instrument panel beside it. On a narrow screen the panel
 * moves above the prose rather than disappearing behind a drawer - the controls are
 * the content here, not a settings page, and a reader on a phone should meet them
 * first rather than hunt for them.
 *
 * Three things this owns that a module must not:
 *
 *   - Decode warnings. A permalink from a newer version of the site can carry a path
 *     this build does not have. The codec drops it and says so; this shows that once,
 *     dismissibly, rather than letting a link fail silently into a wrong setup.
 *   - The permalink. One button, one canonical encoding, at the top of every module.
 *   - Progress. Visiting is recorded on mount; completion is the reader's own claim,
 *     made with a button at the foot of the module.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { PanelId } from '../content/controls';
import { getModule, moduleNeighbours } from '../content/modules';
import { tipsForModule } from '../content/bench-tips';
import { termsForModule } from '../content/glossary';
import { presetsForModule } from '../state/presets';
import { permalinkFor } from '../state/url-codec';
import {
  dismissWarnings,
  markCompleted,
  markVisited,
  navigate,
  resetScenario,
  setScenario,
  useAppState,
  useProgress,
} from '../state/store';
import { InstrumentPanel } from './InstrumentPanel';
import { Callout } from './Callout';

export interface ModuleShellProps {
  moduleId: string;
  /** Instrument panels this module exposes. Empty for a prose-only module. */
  panels?: readonly PanelId[];
  children: ReactNode;
}

export function ModuleShell({ moduleId, panels = [], children }: ModuleShellProps): JSX.Element {
  const { scenario, warnings } = useAppState();
  const progress = useProgress();
  const meta = getModule(moduleId);
  const { previous, next } = moduleNeighbours(moduleId);
  const presets = presetsForModule(moduleId);
  const tips = tipsForModule(moduleId);
  const terms = termsForModule(moduleId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    markVisited(moduleId);
  }, [moduleId]);

  if (!meta) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-h2">No module {moduleId}</h1>
        <p className="mt-2 text-lo">
          The course has eleven modules, m1 to m11. <a href="#/">Back to the contents</a>.
        </p>
      </main>
    );
  }

  const copyPermalink = (): void => {
    const link = permalinkFor(moduleId, '', scenario, window.location.origin, window.location.pathname);
    // A clipboard write can be refused (an insecure origin, a denied permission).
    // Failing quietly is wrong; the URL bar already holds the same link, so say so.
    void navigator.clipboard
      ?.writeText(link)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8">
      <nav className="mb-4 text-micro text-lo" aria-label="Breadcrumb">
        <a href="#/">Anatomy of an Edge</a>
        <span aria-hidden="true"> / </span>
        <span className="readout">M{meta.number}</span>
      </nav>

      <header className="mb-6 border-b border-rule pb-4">
        <p className="text-micro uppercase tracking-wide" style={{ color: 'var(--ch3)' }}>
          Module {meta.number}
          {meta.status !== 'done' ? (
            <span className="ml-3 text-lo">
              {meta.status === 'planned' ? 'not written yet' : 'in progress'}
            </span>
          ) : null}
        </p>
        <h1 className="mt-1 text-h1">{meta.title}</h1>
        <p className="mt-2 text-lead text-lo">{meta.question}</p>
      </header>

      {warnings.length > 0 ? (
        <div
          role="status"
          className="mb-6 rounded-sm border-l-2 px-4 py-3"
          style={{ borderColor: 'var(--ch2)', background: 'color-mix(in srgb, var(--ch2) 8%, transparent)' }}
        >
          <p className="text-micro" style={{ color: 'var(--ch2)' }}>
            This link did not decode cleanly
          </p>
          <ul className="mt-1 list-disc pl-5 text-micro text-hi">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-tick text-lo underline" onClick={dismissWarnings}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-8 lg:flex-row-reverse lg:items-start">
        {panels.length > 0 ? (
          <aside
            className="w-full shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-panel lg:overflow-y-auto lg:pr-2"
            aria-label="Instrument panel"
          >
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-sm border border-rule px-2 py-1 text-tick text-hi"
                onClick={copyPermalink}
              >
                {copied ? 'Link copied' : 'Copy permalink'}
              </button>
              <button
                type="button"
                className="rounded-sm border border-rule px-2 py-1 text-tick text-hi"
                onClick={resetScenario}
              >
                Reset
              </button>
            </div>

            {presets.length > 0 ? (
              <section className="mb-6" aria-labelledby="presets-heading">
                <h3
                  id="presets-heading"
                  className="border-b border-rule pb-1 text-micro uppercase tracking-wide"
                  style={{ color: 'var(--ch3)' }}
                >
                  Starting points
                </h3>
                <ul className="mt-2 space-y-2">
                  {presets.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full rounded-sm border border-rule px-2 py-1 text-left"
                        onClick={() => setScenario(p.scenario, false)}
                      >
                        <span className="text-micro text-hi">{p.label}</span>
                        {p.illustrative ? (
                          <span className="ml-2 text-tick" style={{ color: 'var(--ch2)' }}>
                            illustrative
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-tick text-lo">{p.blurb}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <InstrumentPanel panels={panels} scenario={scenario} onChange={(s) => setScenario(s, true)} />
          </aside>
        ) : null}

        <div className="prose-column min-w-0 flex-1">{children}</div>
      </div>

      {tips.length > 0 ? (
        <section className="mt-10 border-t border-rule pt-6" aria-labelledby="bench-heading">
          <h2 id="bench-heading" className="text-h2">
            At the bench
          </h2>
          <p className="mt-1 text-micro text-lo">
            How the same thing is seen, and got wrong, on a real instrument.
          </p>
          <div className="prose-column mt-4">
            {tips.map((t) => (
              <Callout key={t.id} variant="bench" title={t.title} controls={t.controls}>
                <p>{t.body}</p>
              </Callout>
            ))}
          </div>
        </section>
      ) : null}

      {terms.length > 0 ? (
        <section className="mt-10 border-t border-rule pt-6" aria-labelledby="terms-heading">
          <h2 id="terms-heading" className="text-h2">
            Terms introduced here
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {terms.map((t) => (
              <li key={t.id}>
                <a
                  className="inline-block rounded-sm border border-rule px-2 py-0.5 text-micro"
                  href={`#/glossary/${t.id}`}
                >
                  {t.term}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-rule pt-6">
        <div className="flex gap-4 text-micro">
          {previous ? (
            <button type="button" className="text-lo hover:text-hi" onClick={() => navigate(previous.id)}>
              &larr; M{previous.number} {previous.title}
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button type="button" className="text-lo hover:text-hi" onClick={() => navigate(next.id)}>
              M{next.number} {next.title} &rarr;
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="rounded-sm border px-3 py-1 text-micro"
          style={{
            borderColor: progress.completed.includes(moduleId) ? 'var(--pass)' : 'var(--rule)',
            color: progress.completed.includes(moduleId) ? 'var(--pass)' : 'var(--text-lo)',
          }}
          onClick={() => markCompleted(moduleId)}
        >
          {progress.completed.includes(moduleId) ? 'Marked as read' : 'Mark as read'}
        </button>
      </footer>
    </main>
  );
}
