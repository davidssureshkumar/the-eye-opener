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

/**
 * Modules with a written body. Empty at Milestone 1 by design: the shell is the
 * milestone, and M1 onwards are the milestones after it.
 */
const BODIES: Record<string, ComponentType<{ moduleId: string }>> = {};

export function ModulePage({ moduleId }: { moduleId: string }): JSX.Element {
  const Body = BODIES[moduleId] ?? Placeholder;
  return (
    <ModuleShell moduleId={moduleId} panels={panelsFor(moduleId)}>
      <Body moduleId={moduleId} />
    </ModuleShell>
  );
}
