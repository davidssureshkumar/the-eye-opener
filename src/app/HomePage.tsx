/**
 * The contents page.
 *
 * It has one job beyond listing modules: to state the through-line, so a reader
 * arriving at M6 from a search knows what argument they have walked into the middle
 * of. Every module is one step of the same question, and the cards say which step.
 *
 * Build status is shown rather than hidden. A reader deserves to know that M7 is an
 * outline with live controls and no derivation yet, and a course that quietly
 * presents eleven equally-finished-looking cards when four of them are empty has
 * lied on its first page.
 */

import { MODULES, getModule } from '../content/modules';
import { navigate, useProgress } from '../state/store';

const STATUS_LABEL: Record<string, string> = {
  done: 'written',
  'in-progress': 'being written',
  planned: 'outline only',
};

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--pass)',
  'in-progress': 'var(--marginal)',
  planned: 'var(--text-lo)',
};

export function HomePage(): JSX.Element {
  const progress = useProgress();
  const resume = progress.last ? getModule(progress.last) : undefined;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-10 lg:px-8">
      <h1 className="text-h1">Anatomy of an Edge</h1>
      <p className="mt-3 max-w-[68ch] text-lead text-hi">
        A transmitter sent a square wave. The receiver measured this. How do we get back to ones and zeros?
      </p>
      <p className="mt-4 max-w-[68ch] text-body text-lo">
        Eleven modules, each one step of that question, from what a square wave is made of to how a DDR5
        receiver trains itself against a channel that has taken the edge apart. Every plot is computed in your
        browser from a model you can change, every formula on the page is also implemented in the code behind
        it, and every number that looks like a specification is labelled when it is not one.
      </p>

      {resume ? (
        <p className="mt-6">
          <button
            type="button"
            className="rounded-sm border px-3 py-1 text-micro"
            style={{ borderColor: 'var(--ch3)', color: 'var(--ch3)' }}
            onClick={() => navigate(resume.id)}
          >
            Resume: M{resume.number} {resume.title}
          </button>
        </p>
      ) : null}

      <ol className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2">
        {MODULES.map((m) => {
          const read = progress.completed.includes(m.id);
          return (
            <li key={m.id}>
              <a
                href={`#/${m.id}`}
                className="block h-full rounded-sm border border-rule bg-ink-800 p-4 no-underline hover:border-ch3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="readout text-micro text-lo">M{m.number}</span>
                  <span
                    className="text-tick uppercase tracking-wide"
                    style={{ color: STATUS_COLOR[m.status] }}
                  >
                    {read ? 'read - ' : ''}
                    {STATUS_LABEL[m.status]}
                  </span>
                </div>
                <h2 className="mt-1 text-lead text-hi">{m.title}</h2>
                <p className="mt-1 text-micro" style={{ color: 'var(--ch3)' }}>
                  {m.question}
                </p>
                <p className="mt-2 text-micro text-lo">{m.summary}</p>
              </a>
            </li>
          );
        })}
      </ol>

      <section className="mt-12 border-t border-rule pt-6">
        <h2 className="text-h2">How to read this</h2>
        <div className="prose-column mt-3 text-body text-lo">
          <p>
            Each module puts a reading column beside a live instrument panel. The panel is not a settings page
            - it is the experiment. Move a control and the plots recompute; the URL updates as you go, so the
            state of your screen is always a link you can send to someone else.
          </p>
          <p>
            Three kinds of aside appear throughout. A <strong>caveat</strong> says where a model stops being
            true or which number is illustrative. An <strong>in silicon</strong> note says what a real device
            does that the model does not. An <strong>at the bench</strong> note says how to see the same
            effect on an oscilloscope, and which setting will give you a confident wrong answer if you leave
            it alone.
          </p>
          <p>
            Nothing here is quoted from a standard. Where a real limit is needed it comes from the relevant
            JEDEC document - JESD79-5 for DDR5, JESD209-5 for LPDDR5, JESD238 for HBM3 - and from the silicon
            vendor, not from a teaching site.
          </p>
        </div>
      </section>
    </main>
  );
}
