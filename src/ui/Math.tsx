/**
 * Rendered mathematics.
 *
 * KaTeX rather than MathJax because it renders synchronously and has no runtime
 * network dependency: the fonts are bundled by Vite from the package, so the site
 * still typesets correctly from a file:// copy on a lab machine with no DNS.
 *
 * `throwOnError` is false and the failure is rendered in the error colour with the
 * source visible. A typo in a formula should look wrong on the page - loudly, where
 * the author will see it - rather than blank the section or take down the module.
 *
 * The output is inserted as HTML. That is safe here and only here: every string
 * passed to these components is a literal in this repository, never reader input
 * and never anything decoded from a URL. Nothing in the app renders maths from a
 * permalink payload.
 */

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { physicsSectionUrl, splitSource } from '../content/physics-sections';

export interface MathProps {
  /** TeX source, without delimiters. */
  tex: string;
  /**
   * What the formula says, for a screen reader. KaTeX emits MathML alongside the
   * visual rendering, but a plain-language reading is better than a symbol-by-symbol
   * one: "rise time times bandwidth is about 0.35" beats "t sub r times B W".
   */
  label?: string;
  className?: string;
}

function render(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    errorColor: 'var(--error)',
    strict: 'ignore',
    trust: false,
    output: 'htmlAndMathml',
  });
}

/** Inline maths, sitting on the text baseline inside a sentence. */
export function Math({ tex, label, className = '' }: MathProps): JSX.Element {
  const html = useMemo(() => render(tex, false), [tex]);
  return (
    <span
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export interface MathBlockProps extends MathProps {
  /**
   * Where the formula comes from and under what conditions it holds. Every displayed
   * formula on this site is also implemented in src/dsp or src/sim and derived in
   * PHYSICS.md; this is the pointer to that entry, so a reader can check the claim
   * rather than take it.
   */
  source?: string;
  /** Equation number, for referring back to it in the prose. */
  tag?: string;
}

/** A centred display equation, optionally numbered and attributed. */
export function MathBlock({ tex, label, source, tag, className = '' }: MathBlockProps): JSX.Element {
  const html = useMemo(() => render(tex, true), [tex]);
  return (
    <figure className={`my-5 ${className}`}>
      <div className="flex items-baseline gap-3">
        <div
          className="min-w-0 flex-1 overflow-x-auto"
          role={label ? 'img' : undefined}
          aria-label={label}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {tag ? <span className="readout shrink-0 text-micro text-lo">({tag})</span> : null}
      </div>
      {source ? (
        <figcaption className="mt-1 text-micro text-lo">
          <span className="text-lo">Source: </span>
          <SourceNote source={source} />
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * A source note with each PHYSICS.md section citation linked to that section. The
 * file is not part of the build, so the link opens the repository copy in a new tab.
 */
function SourceNote({ source }: { source: string }): JSX.Element {
  return (
    <>
      {splitSource(source).map((part, i) => {
        const href = part.kind === 'section' ? physicsSectionUrl(part.section) : undefined;
        return href ? (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        );
      })}
    </>
  );
}
