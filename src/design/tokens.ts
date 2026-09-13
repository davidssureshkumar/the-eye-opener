/**
 * Design tokens - the single source of truth for the entire site.
 *
 * Consumed by:
 *   - tailwind.config.ts (build time, for utility classes)
 *   - src/plots/* (runtime, canvas strokes and fills)
 *   - src/design/tokens.css (hand-mirrored custom properties; guarded by a unit test)
 *
 * Design intent: this is an oscilloscope-and-lab-bench world. The surface palette is
 * a cool near-black ramp; the signal palette borrows scope channel-colour convention
 * so trace meaning is pre-learned by the audience. Dark only, by decision.
 */

/** Surface / text ramp. Six values, cool-shifted, never pure black (canvas AA halos). */
export const surface = {
  /** page ground */
  ink900: '#0B0E12',
  /** panel + canvas ground */
  ink800: '#12161C',
  /** raised control, major grid line */
  ink700: '#1C232C',
  /** hairline rules, minor grid, axis lines */
  rule: '#2A343F',
  /** primary text */
  textHi: '#E6EDF3',
  /** axis labels, units, secondary text */
  textLo: '#8B98A5',
} as const;

/**
 * Signal palette, four channels, after scope channel-colour convention.
 * Semantic assignment is fixed site-wide so a colour means the same thing in every module.
 */
export const signal = {
  /** ideal / transmitted / reference */
  ch1: '#3DDC97',
  /** measured / received / post-channel */
  ch2: '#F2C14E',
  /** recovered / equalized / reconstructed */
  ch3: '#5AA9E6',
  /** error / violation / failure */
  ch4: '#E5646E',
} as const;

/** Muted variants for overlays, ghost traces and individual harmonic components. */
export const signalMuted = {
  ch1: '#1E6E4C',
  ch2: '#7A6227',
  ch3: '#2D5673',
  ch4: '#733237',
} as const;

/** Semantic aliases. Use these in module code, not the raw channel names. */
export const semantic = {
  ideal: signal.ch1,
  measured: signal.ch2,
  equalized: signal.ch3,
  error: signal.ch4,
  pass: signal.ch1,
  marginal: signal.ch2,
  fail: signal.ch4,
  cursor: '#E6EDF3',
  mask: '#E5646E',
  /** Annotations drawn over a plot: a measured window, a called-out feature. */
  marker: signal.ch3,
} as const;

/** Type scale in px. Body 15; all numeric readouts are mono at 13. */
export const fontSize = {
  tick: 11,
  micro: 12,
  readout: 13,
  body: 15,
  lead: 18,
  h2: 24,
  h1: 32,
} as const;

/** 4px base spacing scale. */
export const space = [0, 4, 8, 12, 16, 24, 32, 48, 64] as const;

/** Instrument geometry: hard edges, hairlines, two radii only. */
export const geometry = {
  radiusSm: 2,
  radiusMd: 4,
  hairline: 1,
  /** fixed width of the right-hand instrument panel, px */
  panelWidth: 340,
} as const;

/** Fonts. Self-hosted via @fontsource; no runtime network calls. */
export const font = {
  sans: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export const tokens = {
  surface,
  signal,
  signalMuted,
  semantic,
  fontSize,
  space,
  geometry,
  font,
} as const;

export type Tokens = typeof tokens;
