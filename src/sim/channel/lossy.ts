/**
 * A lossy transmission line, in the frequency domain.
 *
 * M3's line delays a wave and nothing else. A real route also takes energy out of
 * it, and takes more at high frequency than at low, which is why the far end of a
 * long route looks smaller as well as slower. This file is that loss, built from
 * the mechanisms up so each can be switched off and its share read directly.
 *
 * The line is described per metre by a series impedance Z' and a shunt admittance
 * Y', both functions of frequency:
 *
 *   Z'(f) = j w L_ext + Z_int(f)            conductor: external inductance, plus the
 *           + (K_c(f) - 1) Z_s(f)            internal impedance of the copper, plus
 *                                            what roughness adds to its surface
 *   Y'(f) = j w C_vac eps_r(f)               dielectric: a wideband Debye permittivity,
 *                                            whose imaginary part is the conductance G'
 *
 * and a section of length l is the ABCD matrix of the telegrapher solution. Vias,
 * where present, are shunt capacitors between equal sections. S-parameters follow
 * from the cascade in a real reference impedance.
 *
 * Two modelling decisions a reader should know about, both derived in PHYSICS.md:
 *
 *   - The dielectric is causal. A constant loss tangent with a constant permittivity
 *     is not: it violates the Kramers-Kronig relations, and its impulse response
 *     starts before the signal could have arrived. The wideband Debye
 *     (Djordjevic-Sarkar) form fixes eps' and tan(delta) at one reference frequency
 *     and lets both vary slowly with frequency in the way causality requires.
 *   - The conductor is causal too, through R_dc sqrt(1 + j f/f_skin), which is the
 *     DC resistance at low frequency and the skin-effect surface impedance
 *     Z_s = (1 + j)R_s / w at high frequency. So is the roughness. The usual practice
 *     multiplies Z_s by a real factor K, which leaves the reactance unchanged in
 *     ratio and makes the far end move before any wave could have arrived. Here K is
 *     completed into a complex K_c whose loss is exactly K and whose reactance is the
 *     one Kramers-Kronig requires: Bracken's closed form for Huray, and a numerical
 *     Hilbert transform for Hammerstad. The real factor is kept for comparison.
 *
 * Geometry is deliberately minimal. The line is taken as homogeneous (stripline-
 * like), so one permittivity serves both the delay and the dielectric loss, and the
 * current is taken to spread over one trace width in total for the signal conductor
 * and its return together, the usual stripline rule of thumb. A field solver would
 * do better on both; this model makes no claim to replace one.
 *
 * Derivations, sources and validity ranges: PHYSICS.md section 13.
 */

import { cAdd, cDiv, cExpz, cLog, cMul, cScale, cSqrt, cSub, cx, type Complex } from '../../dsp/complex';
import { SPEED_OF_LIGHT } from './tline';

/** Vacuum permeability, H/m (CODATA 2018). No longer exactly 4 pi 1e-7 after the 2019 SI. */
export const VACUUM_PERMEABILITY = 1.25663706212e-6;

/** Nepers to decibels: 20 / ln 10. */
export const NEPER_TO_DB = 20 / Math.LN10;

/** Metres in one inch, exactly. */
export const METRES_PER_INCH = 0.0254;

/** Lower and upper corner of the wideband Debye model, as decades of hertz. */
export const DEBYE_LOWER_DECADE = 4;
export const DEBYE_UPPER_DECADE = 12;

export type RoughnessModel = 'hammerstad' | 'huray';

/** The copper. */
export interface ConductorSpec {
  /** Conductivity, S/m. */
  conductivity: number;
  /** Trace width, metres. */
  traceWidth: number;
  /** Copper thickness, metres. */
  thickness: number;
}

/** The copper surface. */
export interface RoughnessSpec {
  roughnessEnabled: boolean;
  roughnessModel: RoughnessModel;
  /** RMS profile height for the Hammerstad model, metres. */
  roughnessRms: number;
  /** Nodule radius for the Huray model, metres. */
  hurayRadius: number;
  /** Total nodule surface area per unit flat area, for the Huray model. */
  hurayRatio: number;
}

/** The laminate, stated at one frequency. */
export interface DielectricSpec {
  /** Relative permittivity at the reference frequency. */
  er: number;
  /** Loss tangent at the reference frequency. */
  lossTangent: number;
  /** Frequency the two are stated at, Hz. */
  referenceFreq: number;
}

/** One lossy route, in the Scenario's own field names. */
export interface LossyLineSpec extends ConductorSpec, RoughnessSpec, DielectricSpec {
  /** Characteristic impedance at the reference frequency, ignoring conductor loss, ohms. */
  z0: number;
  /** Physical length, metres. */
  length: number;
  conductorLossEnabled: boolean;
  dielectricLossEnabled: boolean;
  /** Via discontinuities, equally spaced along the route. */
  viaCount: number;
  /** Shunt capacitance of each via, farads. */
  viaC: number;
}

/* ------------------------------------------------------------------ conductor */

/** Skin depth, metres: 1 / sqrt(pi f mu0 sigma), which is sqrt(rho / (pi f mu0)). Infinite at DC. */
export function skinDepth(f: number, conductivity: number): number {
  if (!(f > 0)) return Infinity;
  return 1 / Math.sqrt(Math.PI * f * VACUUM_PERMEABILITY * conductivity);
}

/** Surface resistance, ohms per square: sqrt(pi f mu0 / sigma), which is 1 / (sigma delta). */
export function surfaceResistance(f: number, conductivity: number): number {
  if (!(f > 0)) return 0;
  return Math.sqrt((Math.PI * f * VACUUM_PERMEABILITY) / conductivity);
}

/** DC resistance per metre of a rectangular conductor, ohms/m: 1 / (sigma w t). */
export function dcResistancePerMetre(c: ConductorSpec): number {
  return 1 / (c.conductivity * c.traceWidth * c.thickness);
}

/**
 * The frequency at which the internal impedance turns from resistive to skin-limited, Hz:
 * 1 / (2 pi mu0 sigma t^2). There the skin depth is sqrt(2) times the thickness.
 */
export function skinOnsetFrequency(c: ConductorSpec): number {
  return 1 / (2 * Math.PI * VACUUM_PERMEABILITY * c.conductivity * c.thickness * c.thickness);
}

/**
 * Internal impedance of the conductor per metre, smooth copper, ohms/m:
 *
 *   Z_int(f) = R_dc sqrt(1 + j f / f_skin)
 *
 * R_dc at DC; (1 + j) R_s / w once f >> f_skin, the skin-effect surface impedance
 * with equal resistance and internal reactance. Analytic in the right half of the
 * s-plane (its branch point is at s = -2 pi f_skin), so causal, and its real part is
 * positive at every frequency, so passive.
 */
export function internalImpedance(c: ConductorSpec, f: number): Complex {
  const rdc = dcResistancePerMetre(c);
  return cScale(cSqrt(cx(1, Math.max(0, f) / skinOnsetFrequency(c))), rdc);
}

/** Hammerstad roughness factor: 1 + (2/pi) atan(1.4 (Delta/delta)^2). Saturates at 2. */
export function hammerstadFactor(f: number, rms: number, conductivity: number): number {
  if (!(rms > 0) || !(f > 0)) return 1;
  const r = rms / skinDepth(f, conductivity);
  return 1 + (2 / Math.PI) * Math.atan(1.4 * r * r);
}

/**
 * Huray (cannonball) roughness factor, single nodule size, matte base taken as flat:
 *
 *   K = 1 + S / (1 + delta/a + delta^2 / (2 a^2))
 *
 * with a the nodule radius and S the nodule surface area per unit flat area. Tends
 * to 1 + S at high frequency and does not saturate at 2.
 */
export function hurayFactor(f: number, radius: number, ratio: number, conductivity: number): number {
  if (!(radius > 0) || !(ratio > 0) || !(f > 0)) return 1;
  const q = skinDepth(f, conductivity) / radius;
  return 1 + ratio / (1 + q + 0.5 * q * q);
}

/** The roughness factor the spec selects, or 1 with roughness off. */
export function roughnessFactor(r: RoughnessSpec & Pick<ConductorSpec, 'conductivity'>, f: number): number {
  if (!r.roughnessEnabled) return 1;
  return r.roughnessModel === 'huray'
    ? hurayFactor(f, r.hurayRadius, r.hurayRatio, r.conductivity)
    : hammerstadFactor(f, r.roughnessRms, r.conductivity);
}

/**
 * Normalised roughness frequency y = (L / delta)^2 = pi f mu0 sigma L^2, for a surface
 * length L. It is 1 where the skin depth equals L. Both roughness factors are
 * functions of y alone: Hammerstad of the RMS height, Huray of the nodule radius.
 */
export function roughnessRatio(f: number, length: number, conductivity: number): number {
  if (!(f > 0) || !(length > 0)) return 0;
  return Math.PI * f * VACUUM_PERMEABILITY * conductivity * length * length;
}

/**
 * Bracken's causal Huray factor (DesignCon 2012), complex:
 *
 *   K_c = 1 + S q / (1 + q),   q = (1 + j) a / delta = sqrt(2 j y)
 *
 * It multiplies the smooth surface impedance (1 + j) R_s. Re K_c - Im K_c is exactly
 * the real Huray factor, so the loss is unchanged; the imaginary part is the
 * internal reactance that loss must come with. Its argument stays below 45 degrees,
 * so the rough surface impedance keeps a positive real part: passive.
 */
export function hurayCausalFactor(f: number, radius: number, ratio: number, conductivity: number): Complex {
  if (!(radius > 0) || !(ratio > 0) || !(f > 0)) return cx(1);
  const r = Math.sqrt(roughnessRatio(f, radius, conductivity));
  const q = cx(r, r);
  return cAdd(cx(1), cScale(cDiv(q, cAdd(cx(1), q)), ratio));
}

/** A real roughness factor, completed into its causal complex form. */
export interface CausalCompletion {
  /** K_c at normalised frequency y: Re K_c - Im K_c is the real factor, exactly. */
  at(y: number): Complex;
  /** J / pi, with J = integral_0^inf (K(u) - 1) u^(-3/2) du: K_c - 1 tends to this times (1 + j) sqrt(y) as y -> 0. */
  lowFrequencySlope: number;
}

/** The grid a causal completion is tabulated on, in decades of y, and the span it interpolates over. */
export const COMPLETION_GRID = { low: -18, high: 14, perDecade: 24, validLow: -14, validHigh: 10 } as const;

/**
 * Complete a real roughness factor K(y), rising from 1 at DC to kInf, into a causal K_c.
 *
 * What roughness adds to the surface impedance is (K_c - 1)(1 + j) R_s. In units of
 * R_s at y = 1 its resistance is rho(y) = (K(y) - 1) sqrt(y), known, and its
 * reactance chi(y) is not free: for a causal impedance with even resistance and odd
 * reactance, Kramers-Kronig gives
 *
 *   chi(y) = (2y / pi) PV integral_0^inf rho(u) / (u^2 - y^2) du,
 *
 * and then K_c = 1 + (rho + j chi) / ((1 + j) sqrt(y)), so Im K_c = (chi - rho) / (2 sqrt(y)).
 *
 * Numerically, on a log grid, the principal value is taken by subtracting rho(y)
 * from the integrand, which is allowed because PV integral_0^inf du / (u^2 - y^2) = 0,
 * and leaves a smooth integrand whose value at u = y is rho'(y) / 2. Below y = 1 the
 * transform is of rho itself; above it, of rho - (kInf - 1) sqrt(y), which differs by
 * the smooth surface's own pair (sqrt(y) is its own transform) and avoids a
 * cancellation between two large numbers. The tails beyond the grid are added in
 * closed form. Im K_c is tabulated at the nodes, interpolated in log-log by
 * Catmull-Rom, and extrapolated as a power law beyond the interpolated span; the real
 * part is always K + Im K_c, so the loss is exact whatever the interpolation error.
 *
 * Checked against Bracken's closed form for the Huray factor in the tests.
 */
export function causalCompletion(loss: (y: number) => number, kInf: number): CausalCompletion {
  const { low, high, perDecade, validLow, validHigh } = COMPLETION_GRID;
  const n = (high - low) * perDecade + 1;
  const ds = Math.LN10 / perDecade;
  const y = new Float64Array(n);
  const below = new Float64Array(n);
  const above = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    y[i] = Math.exp(low * Math.LN10 + i * ds);
    const root = Math.sqrt(y[i]);
    const excess = loss(y[i]) - 1;
    below[i] = excess * root;
    above[i] = (excess - (kInf - 1)) * root;
    j += ((i === 0 || i === n - 1 ? 0.5 : 1) * excess * ds) / root;
  }
  const first = (validLow - low) * perDecade;
  const last = (validHigh - low) * perDecade;
  const lnIm = new Float64Array(n);
  for (let i = first - 1; i <= last + 1; i++) {
    const rho = y[i] < 1 ? below : above;
    const yi = y[i];
    const r = rho[i];
    const y2 = yi * yi;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const g =
        k === i ? (rho[i + 1] - rho[i - 1]) / (4 * ds * yi) : ((rho[k] - r) * y[k]) / (y[k] * y[k] - y2);
      sum += k === 0 || k === n - 1 ? 0.5 * g : g;
    }
    let integral = sum * ds + (r * y[0]) / y2 - r / y[n - 1];
    if (rho === below) integral += (2 * (kInf - 1)) / Math.sqrt(y[n - 1]);
    const chi = ((2 * yi) / Math.PI) * integral;
    const im = (chi - r) / (2 * Math.sqrt(yi));
    if (!(im > 0)) throw new Error(`causal completion: reactance not positive at y = ${yi}`);
    lnIm[i] = Math.log(im);
  }
  const s0 = low * Math.LN10;
  const slopeLow = (lnIm[first + perDecade] - lnIm[first]) / Math.LN10;
  const slopeHigh = (lnIm[last] - lnIm[last - perDecade]) / Math.LN10;
  const imAt = (lnY: number): number => {
    const t = (lnY - s0) / ds;
    if (t <= first) return Math.exp(lnIm[first] + slopeLow * (lnY - (s0 + first * ds)));
    if (t >= last) return Math.exp(lnIm[last] + slopeHigh * (lnY - (s0 + last * ds)));
    const i = Math.floor(t);
    const u = t - i;
    const p0 = lnIm[i - 1];
    const p1 = lnIm[i];
    const p2 = lnIm[i + 1];
    const p3 = lnIm[i + 2];
    return Math.exp(
      p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0))),
    );
  };
  return {
    at(yq: number): Complex {
      if (!(yq > 0)) return cx(1);
      const im = imAt(Math.log(yq));
      return cx(loss(yq) + im, im);
    },
    lowFrequencySlope: j / Math.PI,
  };
}

/** Hammerstad's factor as a function of y: 1 + (2/pi) atan(1.4 y). */
function hammerstadOfRatio(y: number): number {
  return 1 + (2 / Math.PI) * Math.atan(1.4 * y);
}

let hammerstadCompletion: CausalCompletion | undefined;

/**
 * The causal Hammerstad factor, complex. Hammerstad has no closed-form causal
 * partner, so this is its numerical completion; its shape is universal in y, so the
 * table is built once, on first use.
 */
export function hammerstadCausalFactor(f: number, rms: number, conductivity: number): Complex {
  if (!(rms > 0) || !(f > 0)) return cx(1);
  hammerstadCompletion ??= causalCompletion(hammerstadOfRatio, 2);
  return hammerstadCompletion.at(roughnessRatio(f, rms, conductivity));
}

/** The causal roughness factor the spec selects, or 1 with roughness off. */
export function causalRoughnessFactor(
  r: RoughnessSpec & Pick<ConductorSpec, 'conductivity'>,
  f: number,
): Complex {
  if (!r.roughnessEnabled) return cx(1);
  return r.roughnessModel === 'huray'
    ? hurayCausalFactor(f, r.hurayRadius, r.hurayRatio, r.conductivity)
    : hammerstadCausalFactor(f, r.roughnessRms, r.conductivity);
}

/**
 * Inductance per metre the causal roughness adds as f -> 0, H/m: mu0 C L / w, with C
 * the low-frequency slope of K_c and L its surface length. It follows from
 * K_c - 1 ~ C (1 + j) sqrt(y): that times (1 + j) R_s / w is a pure reactance, linear
 * in f. Rough copper looks slower as well as lossier, at every frequency below the
 * roughness corner; this is its DC value.
 */
export function roughnessLowFrequencyInductance(r: RoughnessSpec & ConductorSpec): number {
  if (!r.roughnessEnabled) return 0;
  if (r.roughnessModel === 'huray') {
    if (!(r.hurayRadius > 0) || !(r.hurayRatio > 0)) return 0;
    return (VACUUM_PERMEABILITY * r.hurayRatio * r.hurayRadius) / r.traceWidth;
  }
  if (!(r.roughnessRms > 0)) return 0;
  hammerstadCompletion ??= causalCompletion(hammerstadOfRatio, 2);
  return (VACUUM_PERMEABILITY * hammerstadCompletion.lowFrequencySlope * r.roughnessRms) / r.traceWidth;
}

/**
 * Series impedance of the conductor per metre, ohms/m:
 *
 *   Z_int(f) + (K_c(f) - 1) (1 + j) R_s(f) / w
 *
 * The roughness term is added to the surface impedance rather than multiplying the
 * finite-thickness Z_int, so the resistance is Re Z_int + (K - 1) R_s / w at every
 * frequency, not only far above the skin onset. With `causal` false the real K is
 * used in place of K_c, which is the usual practice and is not causal.
 */
export function conductorImpedance(spec: ConductorSpec & RoughnessSpec, f: number, causal = true): Complex {
  const z = internalImpedance(spec, f);
  if (!spec.roughnessEnabled || !(f > 0)) return z;
  const k = causal ? causalRoughnessFactor(spec, f) : cx(roughnessFactor(spec, f));
  const rs = surfaceResistance(f, spec.conductivity) / spec.traceWidth;
  return cAdd(z, cMul(cSub(k, cx(1)), cx(rs, rs)));
}

/* ----------------------------------------------------------------- dielectric */

/** A wideband Debye (Djordjevic-Sarkar) permittivity. */
export interface WidebandDebye {
  /** Permittivity as frequency goes to infinity. */
  epsInf: number;
  /** Total change in permittivity from DC to infinity. */
  deltaEps: number;
  /** Lower and upper corners, decades of hertz. */
  m1: number;
  m2: number;
}

/** log10((f2 + j f)/(f1 + j f)) / (m2 - m1): 1 at DC, 0 at infinity. */
function debyeShape(f: number, m1: number, m2: number): Complex {
  const num = cx(10 ** m2, f);
  const den = cx(10 ** m1, f);
  return cScale(cLog(cDiv(num, den)), 1 / (Math.LN10 * (m2 - m1)));
}

/**
 * Fit the wideband Debye model to a permittivity and loss tangent stated at one
 * frequency, so that the model reproduces both exactly there.
 */
export function fitWidebandDebye(
  d: DielectricSpec,
  m1 = DEBYE_LOWER_DECADE,
  m2 = DEBYE_UPPER_DECADE,
): WidebandDebye {
  if (!(d.lossTangent > 0)) return { epsInf: d.er, deltaEps: 0, m1, m2 };
  const F = debyeShape(d.referenceFreq, m1, m2);
  const deltaEps = (-d.er * d.lossTangent) / F.im;
  return { epsInf: d.er - deltaEps * F.re, deltaEps, m1, m2 };
}

/** Complex relative permittivity eps' - j eps'' at f. The imaginary part is never positive. */
export function permittivityAt(model: WidebandDebye, f: number): Complex {
  const F = debyeShape(Math.max(0, f), model.m1, model.m2);
  return cx(model.epsInf + model.deltaEps * F.re, model.deltaEps * F.im);
}

/** eps'' / eps' at f. */
export function lossTangentAt(model: WidebandDebye, f: number): number {
  const e = permittivityAt(model, f);
  return -e.im / e.re;
}

/* ----------------------------------------------------------------------- line */

/** A line spec with everything that does not depend on frequency worked out once. */
export interface LineModel {
  spec: LossyLineSpec;
  /** External inductance per metre, H/m. */
  lExt: number;
  /** Capacitance per metre with the dielectric replaced by vacuum, F/m. */
  cVac: number;
  /** The dielectric, fitted at the reference frequency. */
  debye: WidebandDebye;
  /** Whether roughness is applied in its causal complex form (true) or as the real factor. */
  causalRoughness: boolean;
}

export interface LineOptions {
  /** Apply roughness as the real factor instead, to show what that costs in causality. Default true. */
  causalRoughness?: boolean;
}

/** L_ext = Z0 sqrt(er) / c and C_vac = 1 / (Z0 c sqrt(er)), so that L_ext C_vac = 1/c^2. */
export function prepareLine(spec: LossyLineSpec, options: LineOptions = {}): LineModel {
  const root = Math.sqrt(spec.er);
  return {
    spec,
    lExt: (spec.z0 * root) / SPEED_OF_LIGHT,
    cVac: 1 / (spec.z0 * SPEED_OF_LIGHT * root),
    debye: fitWidebandDebye(spec),
    causalRoughness: options.causalRoughness ?? true,
  };
}

/** Relative permittivity the line uses at f: the Debye fit, or er itself with dielectric loss off. */
export function linePermittivity(m: LineModel, f: number): Complex {
  return m.spec.dielectricLossEnabled ? permittivityAt(m.debye, f) : cx(m.spec.er);
}

/** Series impedance per metre, ohms/m. */
export function seriesImpedance(m: LineModel, f: number): Complex {
  const w = 2 * Math.PI * Math.max(0, f);
  const ext = cx(0, w * m.lExt);
  if (!m.spec.conductorLossEnabled) return ext;
  return cAdd(ext, conductorImpedance(m.spec, f, m.causalRoughness));
}

/** Shunt admittance per metre, siemens/m. */
export function shuntAdmittance(m: LineModel, f: number): Complex {
  const w = 2 * Math.PI * Math.max(0, f);
  return cMul(cx(0, w * m.cVac), linePermittivity(m, f));
}

/** The four per-unit-length parameters at f. */
export interface Rlgc {
  /** Ohms/m. */
  r: number;
  /** H/m. */
  l: number;
  /** S/m. */
  g: number;
  /** F/m. */
  c: number;
}

export function rlgcAt(m: LineModel, f: number): Rlgc {
  const eps = linePermittivity(m, f);
  const c = m.cVac * eps.re;
  if (!(f > 0)) {
    // DC limits. The internal reactance vanishes in proportion to f, so its inductance
    // is the slope, R_dc / (4 pi f_skin), from the first-order expansion of the root;
    // causal roughness adds its own low-frequency inductance on top.
    const cond = m.spec.conductorLossEnabled;
    const rdc = cond ? dcResistancePerMetre(m.spec) : 0;
    const rough = cond && m.causalRoughness ? roughnessLowFrequencyInductance(m.spec) : 0;
    const lInt = cond ? rdc / (4 * Math.PI * skinOnsetFrequency(m.spec)) + rough : 0;
    return { r: rdc, l: m.lExt + lInt, g: 0, c };
  }
  const w = 2 * Math.PI * f;
  const z = seriesImpedance(m, f);
  return { r: z.re, l: z.im / w, g: Math.max(0, -w * m.cVac * eps.im), c };
}

/** Propagation constant gamma = alpha + j beta, per metre, with alpha >= 0. */
export function propagationConstant(m: LineModel, f: number): Complex {
  return cSqrt(cMul(seriesImpedance(m, f), shuntAdmittance(m, f)));
}

/** Characteristic impedance sqrt(Z'/Y'), ohms. f must be above zero; at DC it is unbounded. */
export function characteristicImpedanceAt(m: LineModel, f: number): Complex {
  return cSqrt(cDiv(seriesImpedance(m, f), shuntAdmittance(m, f)));
}

/**
 * Attenuation from conductor loss alone, low-loss approximation, Np/m: R' / (2 Z0),
 * with R' the resistance including roughness, which the causal and real factors share. It neglects the internal inductance,
 * which raises the line impedance by a fraction of about R' / (2 omega L), so it
 * overstates the exact value by that fraction: about 1.5% for a 100 um trace at 2 GHz.
 */
export function conductorAttenuation(m: LineModel, f: number): number {
  if (!m.spec.conductorLossEnabled) return 0;
  return conductorImpedance(m.spec, f, false).re / (2 * m.spec.z0);
}

/**
 * Attenuation from dielectric loss alone, low-loss approximation, Np/m:
 * pi f sqrt(eps') tan(delta) / c, which is G' Z0 / 2 for a homogeneous line.
 */
export function dielectricAttenuation(m: LineModel, f: number): number {
  if (!m.spec.dielectricLossEnabled || !(f > 0)) return 0;
  const eps = permittivityAt(m.debye, f);
  return (Math.PI * f * Math.sqrt(eps.re) * (-eps.im / eps.re)) / SPEED_OF_LIGHT;
}

/* ------------------------------------------------------------------ networks */

/**
 * A 2x2 ABCD matrix held as e^exponent times [a b; c d], so that a long lossy line
 * whose cosh would overflow is a bounded matrix and a large exponent.
 */
interface ScaledAbcd {
  a: Complex;
  b: Complex;
  c: Complex;
  d: Complex;
  exponent: Complex;
}

/** (1 - e^{-2x}) / (2x), which is e^{-x} sinh(x)/x, with its series near zero. */
function scaledSinhc(x: Complex, e2: Complex): Complex {
  if (Math.hypot(x.re, x.im) < 1e-4) {
    const x2 = cMul(x, x);
    const x3 = cMul(x2, x);
    return cAdd(cSub(cx(1), x), cSub(cScale(x2, 2 / 3), cScale(x3, 1 / 3)));
  }
  return cDiv(cSub(cx(1), e2), cScale(x, 2));
}

/**
 * One uniform section: A = D = cosh(x), B = Z' l sinh(x)/x, C = Y' l sinh(x)/x, with
 * x = gamma l. Written through sinh(x)/x, which is even in x and finite at DC, so
 * neither the branch of gamma nor an unbounded Zc at DC can enter.
 */
function sectionAbcd(m: LineModel, f: number, length: number): ScaledAbcd {
  const z = cScale(seriesImpedance(m, f), length);
  const y = cScale(shuntAdmittance(m, f), length);
  const x = cSqrt(cMul(z, y));
  const e2 = cExpz(cScale(x, -2));
  const a = cScale(cAdd(cx(1), e2), 0.5);
  const s = scaledSinhc(x, e2);
  return { a, b: cMul(z, s), c: cMul(y, s), d: a, exponent: x };
}

function shuntAbcd(f: number, capacitance: number): ScaledAbcd {
  return { a: cx(1), b: cx(0), c: cx(0, 2 * Math.PI * f * capacitance), d: cx(1), exponent: cx(0) };
}

function cascade(p: ScaledAbcd, q: ScaledAbcd): ScaledAbcd {
  return {
    a: cAdd(cMul(p.a, q.a), cMul(p.b, q.c)),
    b: cAdd(cMul(p.a, q.b), cMul(p.b, q.d)),
    c: cAdd(cMul(p.c, q.a), cMul(p.d, q.c)),
    d: cAdd(cMul(p.c, q.b), cMul(p.d, q.d)),
    exponent: cAdd(p.exponent, q.exponent),
  };
}

/** S-parameters of a reciprocal two-port at one frequency. S12 = S21. */
export interface TwoPortS {
  s11: Complex;
  s21: Complex;
  s22: Complex;
}

/**
 * S-parameters of the whole route in a real reference impedance r0:
 *
 *   S21 = 2 / (A + B/r0 + C r0 + D)
 *   S11 = (A + B/r0 - C r0 - D) / (A + B/r0 + C r0 + D)
 *
 * The route is viaCount + 1 equal sections with a via between each pair.
 */
export function sParametersAt(m: LineModel, f: number, r0 = 50): TwoPortS {
  const vias = Math.max(0, Math.floor(m.spec.viaCount));
  const piece = sectionAbcd(m, f, m.spec.length / (vias + 1));
  let net = piece;
  for (let k = 0; k < vias; k++) net = cascade(cascade(net, shuntAbcd(f, m.spec.viaC)), piece);
  const bOver = cScale(net.b, 1 / r0);
  const cTimes = cScale(net.c, r0);
  const den = cAdd(cAdd(net.a, bOver), cAdd(cTimes, net.d));
  return {
    s11: cDiv(cSub(cAdd(net.a, bOver), cAdd(cTimes, net.d)), den),
    s21: cDiv(cScale(cExpz(cScale(net.exponent, -1)), 2), den),
    s22: cDiv(cSub(cAdd(bOver, net.d), cAdd(cTimes, net.a)), den),
  };
}

/** Insertion loss, dB, positive for a lossy route: -20 log10 |S21|. Capped at 300 dB. */
export function insertionLossDb(s21: Complex): number {
  const mag = Math.hypot(s21.re, s21.im);
  return mag <= 1e-15 ? 300 : -20 * Math.log10(mag);
}

/** Delay the route would have with no loss and no vias, seconds: l sqrt(er) / c. */
export function losslessDelay(spec: Pick<LossyLineSpec, 'length' | 'er'>): number {
  return (spec.length * Math.sqrt(spec.er)) / SPEED_OF_LIGHT;
}

/**
 * Group delay of S21 at f, seconds: -d(arg S21)/d(omega).
 *
 * A central difference taken as the argument of one S21 divided by the other, with
 * a step small enough that the phase between them cannot wrap, so no unwrapping is
 * needed and a sparse frequency grid is safe.
 */
export function groupDelayAt(m: LineModel, f: number, r0 = 50): number {
  const eps0 = linePermittivity(m, 0).re;
  const bound = (m.spec.length * Math.sqrt(Math.max(eps0, m.spec.er))) / SPEED_OF_LIGHT;
  const h = Math.min(1e-4 * Math.max(f, 1), 1 / (64 * Math.max(bound, 1e-15)));
  const lo = Math.max(0, f - h);
  const hi = f + h;
  const a = sParametersAt(m, hi, r0).s21;
  const b = sParametersAt(m, lo, r0).s21;
  const ratio = cMul(a, { re: b.re, im: -b.im });
  return -Math.atan2(ratio.im, ratio.re) / (2 * Math.PI * (hi - lo));
}
