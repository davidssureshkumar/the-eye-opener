/**
 * The site header.
 *
 * Thin on purpose. The plots need the vertical space, and on a laptop a chunky
 * header costs a visible fraction of an eye diagram. It carries the one navigation
 * a reader needs from anywhere - the contents, the glossary - and the module
 * stepper, which is how the course is actually read.
 *
 * The through-line is in the title bar rather than only on the home page, because it
 * is the question every module is answering and a reader who has been dragging
 * sliders for ten minutes should be able to look up and remember why.
 */

import { MODULES } from '../content/modules';
import { useRoute } from '../state/store';

export function SiteHeader(): JSX.Element {
  const route = useRoute();

  return (
    <header className="sticky top-0 z-10 border-b border-rule bg-ink-900/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2 lg:px-8">
        <a href="#/" className="text-micro font-semibold uppercase tracking-wide text-hi no-underline">
          Anatomy of an Edge
        </a>
        <span className="hidden text-tick text-lo sm:inline">
          A transmitter sent a square wave. The receiver measured this. How do we get back to ones and zeros?
        </span>

        <nav className="ml-auto flex items-center gap-1" aria-label="Modules">
          {MODULES.map((m) => (
            <a
              key={m.id}
              href={`#/${m.id}`}
              className="readout rounded-sm px-1.5 py-0.5 text-tick no-underline"
              aria-current={route.module === m.id ? 'page' : undefined}
              title={`M${m.number} - ${m.title}`}
              style={{
                color: route.module === m.id ? 'var(--ch3)' : 'var(--text-lo)',
                background:
                  route.module === m.id ? 'color-mix(in srgb, var(--ch3) 14%, transparent)' : 'transparent',
              }}
            >
              {m.number}
            </a>
          ))}
          <a href="#/glossary" className="ml-2 text-tick text-lo no-underline hover:text-hi">
            Glossary
          </a>
        </nav>
      </div>
    </header>
  );
}
