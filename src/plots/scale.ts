/**
 * Scales, ticks and engineering-notation formatting.
 *
 * Pure, no canvas, no DOM: this is the part of plotting that is arithmetic, and it
 * is separated so it can be unit tested against known values the way the DSP is.
 *
 * Everything in this site is in SI base units - seconds, hertz, volts - which puts
 * almost every interesting number at 1e-12 or 1e9. Axis labels are therefore
 * engineering notation with an SI prefix ("156.25 ps", "3.2 GHz") rather than
 * exponent soup, because that is how the numbers are said out loud at a bench.
 */

/* --------------------------------------------------------- linear mapping */

export interface Scale {
  /** Data value -> pixel. */
  (v: number): number;
  /** Pixel -> data value. Needed for cursors and hover readouts. */
  invert(px: number): number;
  domain: readonly [number, number];
  range: readonly [number, number];
}

/** Linear scale from a data domain onto a pixel range. */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  // A zero-width domain would divide by zero; map everything to the range midpoint
  // rather than returning NaN and silently blanking a plot.
  const dd = d1 - d0;
  const m = dd === 0 ? 0 : (r1 - r0) / dd;
  const fn = ((v: number) => r0 + (v - d0) * m) as Scale;
  fn.invert = (px: number) => (m === 0 ? d0 : d0 + (px - r0) / m);
  Object.defineProperty(fn, 'domain', { value: domain, enumerable: true });
  Object.defineProperty(fn, 'range', { value: range, enumerable: true });
  return fn;
}

/**
 * Base-10 logarithmic scale. Used for every frequency axis in M4 and for the
 * bathtub's BER axis, where the interesting behaviour spans twelve decades.
 * Non-positive domain values are invalid and are clamped to a small positive value
 * rather than producing NaN, because a slider can reach zero.
 */
export function logScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const EPS = Number.MIN_VALUE;
  const l0 = Math.log10(Math.max(domain[0], EPS));
  const l1 = Math.log10(Math.max(domain[1], EPS));
  const [r0, r1] = range;
  const dd = l1 - l0;
  const m = dd === 0 ? 0 : (r1 - r0) / dd;
  const fn = ((v: number) => r0 + (Math.log10(Math.max(v, EPS)) - l0) * m) as Scale;
  fn.invert = (px: number) => (m === 0 ? domain[0] : 10 ** (l0 + (px - r0) / m));
  Object.defineProperty(fn, 'domain', { value: domain, enumerable: true });
  Object.defineProperty(fn, 'range', { value: range, enumerable: true });
  return fn;
}

/** Clamp a value into a domain. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ------------------------------------------------------------------- ticks */

/**
 * A "nice" step: 1, 2, 5 or 10 times a power of ten.
 *
 * The 1-2-5 ladder is the right one for instrument axes because the minor
 * subdivisions stay whole (a 2 splits into 4 lots of 0.5; a 2.5 does not), which is
 * what lets a reader count divisions by eye the way they would on a graticule.
 */
export function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const exp = Math.floor(Math.log10(rough));
  const pow = 10 ** exp;
  const frac = rough / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Tick positions across a domain, aiming for roughly `target` of them.
 * Returns ascending values inside the domain, inclusive of the ends when they
 * happen to land on a step.
 */
export function linearTicks(domain: readonly [number, number], target = 6): number[] {
  const [a, b] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  if (a === b) return [a];
  const step = niceStep((b - a) / Math.max(1, target));
  const out: number[] = [];
  const first = Math.ceil(a / step - 1e-9);
  const last = Math.floor(b / step + 1e-9);
  // Guard against a pathological domain producing a runaway loop.
  if (last - first > 10000) return [a, b];
  for (let i = first; i <= last; i++) {
    const v = i * step;
    // Snap a value that should be exactly zero; -1.1e-17 renders as "-0".
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

export interface LogTicks {
  /** Decade boundaries: 1e-3, 1e-2, ... Always labelled. */
  major: number[];
  /** 2e-3, 3e-3, ... Drawn faintly and left unlabelled. */
  minor: number[];
}

/** Decade ticks with 2-9 subdivisions, the standard log-axis treatment. */
export function logTicks(domain: readonly [number, number]): LogTicks {
  const lo = Math.min(domain[0], domain[1]);
  const hi = Math.max(domain[0], domain[1]);
  if (!(lo > 0) || !(hi > 0) || !Number.isFinite(hi)) return { major: [], minor: [] };
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  if (e1 - e0 > 40) return { major: [lo, hi], minor: [] };
  const major: number[] = [];
  const minor: number[] = [];
  for (let e = e0; e <= e1; e++) {
    const decade = 10 ** e;
    if (decade >= lo * (1 - 1e-9) && decade <= hi * (1 + 1e-9)) major.push(decade);
    for (let m = 2; m <= 9; m++) {
      const v = m * decade;
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) minor.push(v);
    }
  }
  return { major, minor };
}

/**
 * Expand a domain outward to the nearest nice step, so an axis ends on a round
 * number instead of on whatever the data happened to reach.
 */
export function niceDomain(domain: readonly [number, number], target = 6): [number, number] {
  const [a, b] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  if (a === b) return [a - 0.5, b + 0.5];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [0, 1];
  const step = niceStep((b - a) / Math.max(1, target));
  return [Math.floor(a / step) * step, Math.ceil(b / step) * step];
}

/**
 * Domain of a data series, padded by a fraction of its span. A flat series gets a
 * symmetric window around its value so a DC trace does not vanish onto an axis.
 */
export function extentOf(data: ArrayLike<number>, pad = 0.05): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return [0, 1];
  if (lo === hi) {
    const d = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 0.5;
    return [lo - d, hi + d];
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
}

/* -------------------------------------------------------------- formatting */

/** SI prefixes from 1e-15 to 1e12, which covers femtoseconds to terahertz. */
const PREFIXES: Array<{ exp: number; symbol: string }> = [
  { exp: 12, symbol: 'T' },
  { exp: 9, symbol: 'G' },
  { exp: 6, symbol: 'M' },
  { exp: 3, symbol: 'k' },
  { exp: 0, symbol: '' },
  { exp: -3, symbol: 'm' },
  { exp: -6, symbol: 'u' },
  { exp: -9, symbol: 'n' },
  { exp: -12, symbol: 'p' },
  { exp: -15, symbol: 'f' },
];

export interface EngParts {
  /** Mantissa, already scaled into [1, 1000). */
  mantissa: number;
  /** Power of ten the prefix represents. */
  exp: number;
  /** SI prefix symbol, '' for unity. 'u' rather than a micro sign, for mono fonts. */
  prefix: string;
}

/** Split a value into an engineering mantissa and an SI prefix. */
export function engParts(v: number): EngParts {
  if (v === 0 || !Number.isFinite(v)) return { mantissa: v, exp: 0, prefix: '' };
  const e = Math.floor(Math.log10(Math.abs(v)));
  const chosen = PREFIXES.find((p) => e >= p.exp) ?? PREFIXES[PREFIXES.length - 1];
  return { mantissa: v / 10 ** chosen.exp, exp: chosen.exp, prefix: chosen.symbol };
}

/**
 * Engineering notation with a unit: formatEng(156.25e-12, 's') -> '156.25 ps'.
 *
 * `sig` is significant figures, not decimal places: an axis wants three across the
 * whole range, not three decimals on a value of 0.0001.
 */
export function formatEng(v: number, unit = '', sig = 3): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? '∞' : '-∞';
  if (v === 0) return unit ? `0 ${unit}` : '0';
  const { mantissa, prefix } = engParts(v);
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(mantissa))));
  let text = mantissa.toFixed(Math.min(12, digits));
  // Drop trailing zeros but keep an integer looking like an integer.
  if (text.includes('.')) text = text.replace(/\.?0+$/, '');
  const suffix = `${prefix}${unit}`;
  return suffix ? `${text} ${suffix}` : text;
}

/**
 * Format a set of tick values consistently: one prefix and one decimal count for the
 * whole axis, chosen from the largest tick. Per-tick formatting makes an axis read
 * "0.5 ns, 1 ns, 1.5 ns, 2 ns" as "500 ps, 1 ns, 1.5 ns, 2 ns", which is noise.
 */
export function formatTicks(values: readonly number[], unit = ''): string[] {
  if (values.length === 0) return [];
  // With a single tick there is no gap to set the precision from, so fall back to
  // significant-figure formatting rather than rounding 3.2 GHz down to 3 GHz.
  if (values.length === 1) return [formatEng(values[0], unit, 4)];
  let maxAbs = 0;
  for (const v of values) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (maxAbs === 0) return values.map(() => (unit ? `0 ${unit}` : '0'));
  const { exp, prefix } = engParts(maxAbs);
  const scale = 10 ** exp;

  // Decimals needed so that the smallest gap between ticks is still visible.
  let minGap = Infinity;
  for (let i = 1; i < values.length; i++) {
    const g = Math.abs(values[i] - values[i - 1]);
    if (g > 0) minGap = Math.min(minGap, g);
  }
  if (!Number.isFinite(minGap)) minGap = maxAbs;
  const decimals = clamp(Math.ceil(-Math.log10(minGap / scale) + 1e-9), 0, 6);

  const suffix = `${prefix}${unit}`;
  return values.map((v) => {
    const text = (v / scale).toFixed(decimals);
    const cleaned = text === '-0' || text === `-0.${'0'.repeat(decimals)}` ? text.slice(1) : text;
    return suffix ? `${cleaned} ${suffix}` : cleaned;
  });
}

/** Powers of ten as exponent labels, for log axes: 1e-12 -> '10^-12'. */
export function formatDecade(v: number): string {
  if (v <= 0 || !Number.isFinite(v)) return '';
  const e = Math.round(Math.log10(v));
  return `10^${e}`;
}

/** Decibels, always signed, one decimal by default. */
export function formatDb(v: number, decimals = 1): string {
  if (!Number.isFinite(v)) return v > 0 ? 'inf dB' : '-inf dB';
  return `${v >= 0 ? '' : ''}${v.toFixed(decimals)} dB`;
}

/** A fraction of a unit interval, the unit every timing margin is quoted in. */
export function formatUi(v: number, decimals = 3): string {
  return `${v.toFixed(decimals)} UI`;
}

/**
 * Percentage with sensible precision. 0.0894898 -> '8.949 %' at sig 4.
 */
export function formatPercent(v: number, sig = 3): string {
  const p = v * 100;
  if (p === 0) return '0 %';
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(p))));
  return `${p.toFixed(Math.min(6, digits))} %`;
}
