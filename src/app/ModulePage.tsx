/**
 * One module page.
 *
 * The shell, the panels and the body come from three different places on purpose:
 * `ModuleShell` owns the layout and everything common, `panelsFor` owns which
 * controls this module offers, and the body is the module's own file. Until a
 * module's body exists, `Placeholder` stands in and says so.
 *
 * When a module is written it is added to `BODIES` and nothing else changes. That is
 * what keeps a half-built course honest: the difference between a written module and
 * an outline is one entry in one table, visible in the diff, not a heading somewhere
 * that somebody forgot to update.
 */

import type { ComponentType } from 'react';
import { ModuleShell } from '../ui/ModuleShell';
import { Placeholder } from '../modules/Placeholder';
import { panelsFor } from '../modules/registry';
import { M1 } from '../modules/m1/M1';
import { M2 } from '../modules/m2/M2';

/**
 * Modules with a written body. Everything not listed here falls through to
 * `Placeholder`, which says plainly that the module is an outline.
 */
const BODIES: Record<string, ComponentType<{ moduleId: string }>> = {
  m1: M1,
  m2: M2,
};

export function ModulePage({ moduleId }: { moduleId: string }): JSX.Element {
  const Body = BODIES[moduleId] ?? Placeholder;
  return (
    <ModuleShell moduleId={moduleId} panels={panelsFor(moduleId)}>
      <Body moduleId={moduleId} />
    </ModuleShell>
  );
}
