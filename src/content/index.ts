/**
 * Content layer: the prose that makes the instruments teachable.
 *
 * Four files, four jobs. `modules` is the canonical course outline, so
 * navigation, progress and cross-links all read one list. `glossary` defines
 * every term with its unit, precisely enough to compute with. `help` attaches an
 * explanation to every control in the Scenario, enforced by a coverage test.
 * `controls` says how each of those controls is presented - which affordance,
 * over what usable range, in which panel - and a test proves that range lies
 * inside the Zod schema's range of validity.
 */

export type { ModuleStatus, ModuleMeta } from './modules';
export { MODULES, getModule, isModuleId, moduleOrder, moduleNeighbours } from './modules';

export type { GlossaryEntry } from './glossary';
export { GLOSSARY, getTerm, hasTerm, glossaryAlphabetical, termsForModule, searchGlossary } from './glossary';

export type { ControlHelp } from './help';
export {
  CONTROL_HELP,
  NON_CONTROL_PATHS,
  canonicalPath,
  controlPaths,
  helpFor,
  referencedTerms,
  illustrativeControls,
  danglingTermRefs,
} from './help';

export type { ControlUi, PanelId, ShowWhen, ControlSpec, GroupSpec, PanelSpec } from './controls';
export {
  CONTROLS,
  PANELS,
  GROUPS,
  PATTERN_KINDS,
  PRBS_ORDERS,
  EDGE_SHAPES,
  CHANNEL_KINDS,
  controlFor,
  controlsIn,
  groupsIn,
  orderedPaths,
  valueAtPath,
  isVisible,
  quantize,
  normalize,
  denormalize,
} from './controls';
