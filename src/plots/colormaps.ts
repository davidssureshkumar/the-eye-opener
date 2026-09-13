/**
 * Colour maps for density plots: eye diagrams, shmoo heatmaps, jitter histograms.
 *
 * Why perceptually uniform maps and not a rainbow: on a rainbow map, equal steps in
 * the data produce wildly unequal steps in apparent brightness, so the eye invents
 * banding that is not in the data and misses gradients that are. On an eye diagram
 * that means inventing a contour where the density is smooth, which is exactly the
 * kind of artefact a validation engineer must not be shown.
 *
 * PROVENANCE, stated plainly because this project does not quote numbers it cannot
 * source: the viridis and inferno anchors below are control points at 0.1 intervals
 * from matplotlib's published colour data (BSD-licensed, Smith and van der Walt),
 * with linear interpolation between them. That is visually equivalent to the full
 * 256-entry tables but not bit-identical; intermediate values can differ by a level
 * or two out of 255. Nothing in this site measures colour, so that is acceptable,
 * and it is noted in PROGRESS.md as a known approximation.
 *
 * 'ember' is not from anywhere - it is defined here, and is the map used where a
 * plot needs to sit in the site's own palette rather than look like matplotlib.
 */

export type ColormapName = 'viridis' | 'inferno' | 'ember' | 'grayscale';

type Anchor = readonly [number, number, number];

/** viridis, 11 control points from 0 to 1. */
const VIRIDIS: Anchor[] = [
  [0.267004, 0.004874, 0.329415],
  [0.283072, 0.130895, 0.449241],
  [0.253935, 0.265254, 0.529983],
  [0.206756, 0.371758, 0.553117],
  [0.163625, 0.471133, 0.558148],
  [0.127568, 0.566949, 0.550556],
  [0.134692, 0.658636, 0.517649],
  [0.266941, 0.748751, 0.440573],
  [0.477504, 0.821444, 0.318195],
  [0.741388, 0.873449, 0.149561],
  [0.993248, 0.906157, 0.143936],
];

/** inferno, 11 control points from 0 to 1. */
const INFERNO: Anchor[] = [
  [0.001462, 0.000466, 0.013866],
  [0.087411, 0.044556, 0.224813],
  [0.229739, 0.032791, 0.404411],
  [0.376422, 0.09379, 0.432943],
  [0.517933, 0.154029, 0.405475],
  [0.665859, 0.215906, 0.34953],
  [0.797475, 0.298577, 0.273913],
  [0.902003, 0.412913, 0.183849],
  [0.962517, 0.555565, 0.075521],
  [0.96968, 0.720006, 0.231674],
  [0.988362, 0.998364, 0.644924],
];

/**
 * The site's own map: the panel ground, through the two cool signal colours, to the
 * warm one. Chosen so that a hot eye centre reads as ch2 amber, matching the
 * "measured" trace colour, and an empty region disappears into the canvas.
 */
const EMBER: Anchor[] = [
  [0.071, 0.086, 0.11], // ink800, so zero density is invisible
  [0.11, 0.17, 0.25],
  [0.176, 0.337, 0.451],
  [0.243, 0.549, 0.647],
  [0.365, 0.729, 0.663],
  [0.549, 0.816, 0.573],
  [0.757, 0.831, 0.427],
  [0.925, 0.796, 0.322],
  [0.949, 0.71, 0.271],
  [0.933, 0.541, 0.298],
  [0.898, 0.392, 0.431],
];

const GRAYSCALE: Anchor[] = [
  [0.0, 0.0, 0.0],
  [1.0, 1.0, 1.0],
];

const ANCHORS: Record<ColormapName, Anchor[]> = {
  viridis: VIRIDIS,
  inferno: INFERNO,
  ember: EMBER,
  grayscale: GRAYSCALE,
};

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Sample a colormap at t in [0, 1]. Values outside are clamped to the ends. */
export function sampleColormap(name: ColormapName, t: number): Rgb {
  const anchors = ANCHORS[name] ?? VIRIDIS;
  if (!Number.isFinite(t)) t = 0;
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const x = u * (anchors.length - 1);
  const i = Math.min(anchors.length - 2, Math.floor(x));
  const f = x - i;
  const a = anchors[i];
  const b = anchors[i + 1];
  return {
    r: Math.round(255 * (a[0] + (b[0] - a[0]) * f)),
    g: Math.round(255 * (a[1] + (b[1] - a[1]) * f)),
    b: Math.round(255 * (a[2] + (b[2] - a[2]) * f)),
  };
}

/** CSS colour string, for stroke and fill styles. */
export function colormapCss(name: ColormapName, t: number, alpha = 1): string {
  const c = sampleColormap(name, t);
  return alpha >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/**
 * A 256-entry RGBA lookup table.
 *
 * Every density plot on this site goes through one of these. Building the table once
 * and indexing it per pixel turns a per-pixel interpolation into a per-pixel array
 * read, which is the difference between a 512x384 eye repainting inside one frame
 * and not.
 */
export function buildLut(name: ColormapName, alpha = 255): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = sampleColormap(name, i / 255);
    lut[i * 4] = c.r;
    lut[i * 4 + 1] = c.g;
    lut[i * 4 + 2] = c.b;
    lut[i * 4 + 3] = alpha;
  }
  return lut;
}

/**
 * A LUT whose alpha ramps from transparent at zero density to opaque.
 *
 * This is the right choice for an eye diagram drawn over a graticule: an unvisited
 * pixel must show the grid, not paint the bottom colour of the map over it. `knee`
 * is where the ramp reaches full opacity, as a fraction of the range.
 */
export function buildAlphaLut(name: ColormapName, knee = 0.25): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const c = sampleColormap(name, t);
    lut[i * 4] = c.r;
    lut[i * 4 + 1] = c.g;
    lut[i * 4 + 2] = c.b;
    lut[i * 4 + 3] = Math.round(255 * Math.min(1, knee <= 0 ? 1 : t / knee));
  }
  return lut;
}

/**
 * Relative luminance, Rec. 709 coefficients.
 * Used by the test suite to check that a map really is monotonic in brightness,
 * which is the property that makes it safe to read a gradient off.
 */
export function luminance(c: Rgb): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

export interface ColormapInfo {
  label: string;
  /** What this map is the right choice for. Shown in the picker. */
  note: string;
}

export const COLORMAP_INFO: Record<ColormapName, ColormapInfo> = {
  viridis: {
    label: 'Viridis',
    note: 'Perceptually uniform and colour-blind safe. The default for density plots, and the one to use when someone will read a gradient off the picture.',
  },
  inferno: {
    label: 'Inferno',
    note: 'Perceptually uniform with a black floor and far more dynamic range at the top. Better than viridis when the interesting structure is in the densest few percent, as it is in an eye centre.',
  },
  ember: {
    label: 'Ember',
    note: "The site's own map. Zero density matches the panel background so the graticule shows through, and full density matches the measured-trace colour.",
  },
  grayscale: {
    label: 'Grayscale',
    note: 'Plain intensity, the way a sampling scope renders infinite persistence. Useful when you want to compare against a screenshot from the bench.',
  },
};
