/**
 * The UI barrel.
 *
 * Module files import from here so that a module body reads as a list of things a
 * reader sees - a `MathBlock`, a `Plot`, a `SelfCheck` - rather than a column of
 * relative paths. Only components a module body legitimately uses are re-exported:
 * `Control`, `Slider` and the rest are the instrument panel's private business, and
 * a module that reaches past `InstrumentPanel` to place one slider by hand has
 * stopped being declaration-driven.
 */

export { Math, MathBlock } from './Math';
export { Callout, IllustrativeNotice } from './Callout';
export type { CalloutVariant } from './Callout';
export { HelpTip, IllustrativeBadge } from './HelpTip';
export { InstrumentPanel } from './InstrumentPanel';
export { MetricList } from './MetricList';
export { ModuleShell } from './ModuleShell';
export { Plot } from './Plot';
export type { PlotData, PlotRender } from './Plot';
export { SelfCheck } from './SelfCheck';
export { TryThis } from './TryThis';
