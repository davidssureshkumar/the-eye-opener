/**
 * Which instrument panels each module exposes.
 *
 * This is outline, not content: it says what a reader can reach for while reading
 * M4, and it follows directly from what M4 is about. It lives apart from
 * `src/content/modules.ts` because that file is the course outline as prose - what
 * each module is called and what question it answers - and this is the wiring.
 *
 * A module that has not been written yet still gets its panels. The controls are
 * real, the schema behind them is real and the help text is real; what is missing
 * is the argument the module makes with them, and the placeholder says so plainly
 * rather than dressing an empty page in a heading.
 *
 * The list grows as modules are built. Nothing here invents physics: a panel
 * appearing in this list is a claim that the module lets you change those things,
 * not a claim that the simulation behind them exists yet.
 */

import type { PanelId } from '../content/controls';
import { MODULES } from '../content/modules';

/** Panels every module offers, because every module draws a waveform. */
const ALWAYS: PanelId[] = ['view'];

const PANELS_BY_MODULE: Record<string, PanelId[]> = {
  // Harmonics of a synthesised square wave: the pattern and the edge, nothing else.
  m1: ['source', 'analysis'],
  // Bandwidth limiting as a filter: the edge, and a first- or second-order channel.
  m2: ['source', 'channel'],
  // Reflections: the line, its terminations and the launched edge.
  m3: ['source', 'channel'],
  // Loss: the lossy-line model and a measured Touchstone channel.
  m4: ['source', 'channel', 'analysis'],
  // ISI, eyes and jitter: everything that closes an eye, and how it is measured.
  m5: ['source', 'channel', 'impairments', 'sampling', 'analysis'],
  // Crosstalk, SSO and the PDN: the aggressors and the supply.
  m6: ['source', 'channel', 'crosstalk', 'impairments', 'analysis'],
  // Equalization: the three equalizers, the slicer and the recovery loop.
  m7: ['source', 'channel', 'impairments', 'eq', 'cdr', 'sampling', 'analysis'],
  // Memory interfaces: strobes, per-bit deskew and the shmoo.
  m8: ['source', 'channel', 'impairments', 'crosstalk', 'sampling', 'analysis'],
  // The wireless view: the same channel, read as a constellation.
  m9: ['source', 'channel', 'impairments', 'analysis'],
  // The instrument itself, which is why this one owns the scope panel.
  m10: ['source', 'channel', 'impairments', 'scope', 'analysis'],
  // Sandbox: no guard rails, so every panel.
  m11: ['source', 'channel', 'impairments', 'crosstalk', 'eq', 'cdr', 'sampling', 'analysis', 'scope'],
};

/** The panels a module exposes, in display order, with the common ones appended. */
export function panelsFor(moduleId: string): PanelId[] {
  const own = PANELS_BY_MODULE[moduleId];
  if (!own) return [];
  return [...own, ...ALWAYS];
}

/** Every module id that has a panel list. Used by the coverage test. */
export function wiredModules(): string[] {
  return MODULES.map((m) => m.id).filter((id) => PANELS_BY_MODULE[id] !== undefined);
}
