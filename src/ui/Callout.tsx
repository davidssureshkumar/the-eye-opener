/**
 * Callouts: the three asides the course actually uses.
 *
 * Deliberately three, not a general-purpose box with a colour prop. Each one makes
 * a different kind of claim and a reader learns to read them differently:
 *
 *   notice   - a caveat about the model. What this simplification costs, where the
 *              formula stops holding, which number is illustrative rather than
 *              specified. This is where "not a JEDEC value" lives.
 *   silicon  - what a real device does that the model does not. Training sequences,
 *              per-bit deskew, on-die termination calibration.
 *   bench    - how to see the same thing on an instrument: which control, which
 *              trade-off, and the mistake that produces a confident wrong answer.
 *
 * The colour carries meaning and is not the only carrier: each variant has a label
 * in the heading, so the distinction survives a monochrome print and a reader who
 * does not distinguish the two greens.
 */

import type { ReactNode } from 'react';

export type CalloutVariant = 'notice' | 'silicon' | 'bench';

interface VariantStyle {
  /** Word in the heading. Meaning does not live in the colour alone. */
  kind: string;
  accent: string;
  tint: string;
}

const VARIANTS: Record<CalloutVariant, VariantStyle> = {
  notice: {
    kind: 'Caveat',
    accent: 'var(--ch2)',
    tint: 'color-mix(in srgb, var(--ch2) 7%, var(--ink-800))',
  },
  silicon: {
    kind: 'In silicon',
    accent: 'var(--ch3)',
    tint: 'color-mix(in srgb, var(--ch3) 7%, var(--ink-800))',
  },
  bench: {
    kind: 'At the bench',
    accent: 'var(--ch1)',
    tint: 'color-mix(in srgb, var(--ch1) 7%, var(--ink-800))',
  },
};

export interface CalloutProps {
  variant: CalloutVariant;
  /** Specific title. The variant word is shown beside it, not instead of it. */
  title?: string;
  /**
   * Instrument controls this refers to, by generic name, so a reader can find them
   * in whatever menu their scope buries them in. `bench` only.
   */
  controls?: readonly string[];
  children: ReactNode;
}

export function Callout({ variant, title, controls, children }: CalloutProps): JSX.Element {
  const style = VARIANTS[variant];
  return (
    <aside
      className="my-5 rounded-sm border-l-2 px-4 py-3"
      style={{ borderColor: style.accent, background: style.tint }}
    >
      <p className="mb-2 text-micro font-semibold uppercase tracking-wide" style={{ color: style.accent }}>
        {style.kind}
        {title ? <span className="ml-2 normal-case tracking-normal text-hi">{title}</span> : null}
      </p>
      <div className="text-body text-hi [&>p:last-child]:mb-0">{children}</div>
      {controls && controls.length > 0 ? (
        <p className="mt-3 text-micro text-lo">
          <span className="uppercase tracking-wide">Controls: </span>
          {controls.map((c, i) => (
            <span key={c}>
              {i > 0 ? <span aria-hidden="true"> &middot; </span> : null}
              <span className="readout text-hi">{c}</span>
            </span>
          ))}
        </p>
      ) : null}
    </aside>
  );
}

/**
 * The standing disclaimer, in one place.
 *
 * Every number on this site that looks like a specification is a plausible stand-in
 * unless it is derived from first principles on the page. Repeating that sentence by
 * hand in eleven modules is how eleven slightly different versions of it appear, one
 * of which eventually reads as an endorsement.
 */
export function IllustrativeNotice({ what }: { what: string }): JSX.Element {
  return (
    <Callout variant="notice" title="Illustrative values">
      <p>
        {what} These are representative figures chosen to make the physics visible, not values from a standard
        or a datasheet. Real limits come from the relevant JEDEC document (JESD79-5 for DDR5, JESD209-5 for
        LPDDR5, JESD238 for HBM3) and from the silicon vendor.
      </p>
    </Callout>
  );
}
