/**
 * The lossy line, checked against closed forms rather than against itself.
 *
 * Every mechanism is tested alone first, where it has a textbook answer: the skin
 * depth of copper, the saturation of the Hammerstad factor, the high-frequency
 * limit of the Huray factor, the exact propagation constant of a line whose only
 * loss is its dielectric. Then the assembled network is tested where it has one
 * too: a lossless matched line is a pure delay, a lossless mismatched line has the
 * closed-form section S-parameters, a via on a matched line is a shunt capacitor,
 * and a route at DC is a series resistor. Causality and passivity are asserted as
 * properties, the first through the Kramers-Kronig relation at DC. The numerical
 * causal completion of a roughness factor is checked against the one roughness
 * model that has a closed-form causal partner, Bracken's Huray.
 */

import { describe, expect, it } from 'vitest';
import { cx, type Complex } from '../../../dsp/complex';
import {
  causalCompletion,
  causalRoughnessFactor,
  characteristicImpedanceAt,
  conductorAttenuation,
  dcResistancePerMetre,
  dielectricAttenuation,
  fitWidebandDebye,
  groupDelayAt,
  hammerstadCausalFactor,
  hammerstadFactor,
  hurayCausalFactor,
  hurayFactor,
  insertionLossDb,
  internalImpedance,
  lossTangentAt,
  losslessDelay,
  METRES_PER_INCH,
  NEPER_TO_DB,
  permittivityAt,
  prepareLine,
  propagationConstant,
  rlgcAt,
  roughnessFactor,
  roughnessLowFrequencyInductance,
  roughnessRatio,
  skinDepth,
  skinOnsetFrequency,
  sParametersAt,
  surfaceResistance,
  VACUUM_PERMEABILITY,
  type LossyLineSpec,
} from '../lossy';
import { SPEED_OF_LIGHT } from '../tline';

const COPPER = 5.8e7;

const BASE: LossyLineSpec = {
  z0: 50,
  length: 0.3,
  er: 4,
  lossTangent: 0.02,
  referenceFreq: 1e9,
  conductivity: COPPER,
  traceWidth: 100e-6,
  thickness: 35e-6,
  roughnessEnabled: true,
  roughnessModel: 'hammerstad',
  roughnessRms: 0.5e-6,
  hurayRadius: 0.5e-6,
  hurayRatio: 1.5,
  conductorLossEnabled: true,
  dielectricLossEnabled: true,
  viaCount: 0,
  viaC: 0.25e-12,
};

const LOSSLESS: LossyLineSpec = { ...BASE, conductorLossEnabled: false, dielectricLossEnabled: false };

function spec(patch: Partial<LossyLineSpec>): LossyLineSpec {
  return { ...BASE, ...patch };
}

function mag(z: Complex): number {
  return Math.hypot(z.re, z.im);
}

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

function logSweep(f0: number, f1: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => f0 * (f1 / f0) ** (i / (n - 1)));
}

/** Phase difference wrapped into (-pi, pi]. */
function wrap(phi: number): number {
  return Math.atan2(Math.sin(phi), Math.cos(phi));
}

describe('conductor', () => {
  it('skin depth of copper at 1 GHz is sqrt(rho / (pi f mu0)), about 2.09 um', () => {
    const d = skinDepth(1e9, COPPER);
    expect(d).toBeCloseTo(Math.sqrt(1 / COPPER / (Math.PI * 1e9 * VACUUM_PERMEABILITY)), 18);
    expect(d * 1e6).toBeCloseTo(2.0898, 3);
    expect(skinDepth(4e9, COPPER)).toBeCloseTo(d / 2, 18);
    expect(skinDepth(0, COPPER)).toBe(Infinity);
  });

  it('surface resistance is 1 / (sigma delta)', () => {
    for (const f of [1e6, 1e9, 3e10]) {
      expect(rel(surfaceResistance(f, COPPER), 1 / (COPPER * skinDepth(f, COPPER)))).toBeLessThan(1e-12);
    }
    expect(surfaceResistance(0, COPPER)).toBe(0);
  });

  it('DC resistance is 1 / (sigma w t)', () => {
    expect(dcResistancePerMetre(BASE)).toBeCloseTo(1 / (COPPER * 100e-6 * 35e-6), 12);
    expect(dcResistancePerMetre(BASE)).toBeCloseTo(4.926, 3);
  });

  it('the skin onset is where the skin depth is sqrt(2) times the thickness', () => {
    const f = skinOnsetFrequency(BASE);
    expect(rel(skinDepth(f, COPPER), Math.SQRT2 * BASE.thickness)).toBeLessThan(1e-12);
  });

  it('internal impedance is R_dc at DC and (1 + j) R_s / w far above the onset', () => {
    const dc = internalImpedance(BASE, 0);
    expect(dc.re).toBeCloseTo(dcResistancePerMetre(BASE), 12);
    expect(dc.im).toBe(0);
    const f = 1e8 * skinOnsetFrequency(BASE);
    const z = internalImpedance(BASE, f);
    const skin = surfaceResistance(f, COPPER) / BASE.traceWidth;
    expect(rel(z.re, skin)).toBeLessThan(1e-4);
    expect(rel(z.im, skin)).toBeLessThan(1e-4);
  });

  it('internal resistance and reactance rise monotonically and stay positive', () => {
    let prev = internalImpedance(BASE, 0);
    for (const f of logSweep(1e3, 1e11, 200)) {
      const z = internalImpedance(BASE, f);
      expect(z.re).toBeGreaterThanOrEqual(prev.re);
      expect(z.im).toBeGreaterThanOrEqual(prev.im);
      expect(z.im).toBeLessThanOrEqual(z.re);
      prev = z;
    }
  });
});

describe('roughness', () => {
  it('Hammerstad is 1 for smooth copper, 1 + (2/pi) atan(1.4) where delta equals the profile, and saturates at 2', () => {
    expect(hammerstadFactor(1e10, 0, COPPER)).toBe(1);
    const fEqual = 1 / (Math.PI * VACUUM_PERMEABILITY * COPPER * 1e-12);
    expect(hammerstadFactor(fEqual, 1e-6, COPPER)).toBeCloseTo(1 + (2 / Math.PI) * Math.atan(1.4), 10);
    const high = hammerstadFactor(1e15, 1e-6, COPPER);
    expect(high).toBeLessThan(2);
    expect(high).toBeGreaterThan(1.999);
    let prev = 1;
    for (const f of logSweep(1e6, 1e12, 100)) {
      const k = hammerstadFactor(f, 1e-6, COPPER);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
  });

  it('Huray is 1 + S/2.5 where delta equals the radius, and tends to 1 + S without saturating at 2', () => {
    const a = 0.5e-6;
    const fEqual = 1 / (Math.PI * VACUUM_PERMEABILITY * COPPER * a * a);
    expect(hurayFactor(fEqual, a, 1.5, COPPER)).toBeCloseTo(1 + 1.5 / 2.5, 10);
    expect(hurayFactor(1e18, a, 2.5, COPPER)).toBeCloseTo(3.5, 2);
    expect(hurayFactor(1e3, a, 1.5, COPPER)).toBeLessThan(1.0001);
    expect(hurayFactor(1e10, 0, 1.5, COPPER)).toBe(1);
  });

  it('selects the model, and is 1 with roughness off', () => {
    expect(roughnessFactor({ ...BASE, roughnessEnabled: false }, 1e10)).toBe(1);
    expect(roughnessFactor(BASE, 1e10)).toBe(hammerstadFactor(1e10, BASE.roughnessRms, COPPER));
    expect(roughnessFactor({ ...BASE, roughnessModel: 'huray' }, 1e10)).toBe(
      hurayFactor(1e10, BASE.hurayRadius, BASE.hurayRatio, COPPER),
    );
  });
});

describe('causal roughness', () => {
  const S = 1.5;
  const hurayLoss = (y: number): number => 1 + S / (1 + 1 / Math.sqrt(y) + 1 / (2 * y));
  const hammerstadLoss = (y: number): number => 1 + (2 / Math.PI) * Math.atan(1.4 * y);
  const argDeg = (z: Complex): number => (Math.atan2(z.im, z.re) * 180) / Math.PI;

  it('the roughness ratio is (L / delta)^2', () => {
    for (const f of [1e6, 1e9, 3e10]) {
      expect(rel(roughnessRatio(f, 0.7e-6, COPPER), (0.7e-6 / skinDepth(f, COPPER)) ** 2)).toBeLessThan(
        1e-12,
      );
    }
    expect(roughnessRatio(0, 1e-6, COPPER)).toBe(0);
  });

  it("Bracken's Huray has exactly the real Huray loss, 1 + S(1 + j) sqrt(y) at low frequency, and 1 + S at high", () => {
    const a = 0.5e-6;
    for (const f of logSweep(1e3, 1e13, 61)) {
      const k = hurayCausalFactor(f, a, S, COPPER);
      expect(Math.abs(k.re - k.im - hurayFactor(f, a, S, COPPER))).toBeLessThan(1e-12);
      expect(k.im).toBeGreaterThan(0);
      expect(argDeg(k)).toBeLessThan(45);
    }
    const f = 1e3;
    const r = Math.sqrt(roughnessRatio(f, a, COPPER));
    const low = hurayCausalFactor(f, a, S, COPPER);
    expect(rel(low.re - 1, S * r)).toBeLessThan(1e-3);
    expect(rel(low.im, S * r)).toBeLessThan(1e-3);
    const high = hurayCausalFactor(1e20, a, S, COPPER);
    expect(Math.abs(high.re - (1 + S))).toBeLessThan(1e-3);
    expect(hurayCausalFactor(1e10, 0, S, COPPER)).toEqual(cx(1));
  });

  it("the numerical completion of the Huray loss reproduces Bracken's closed form", () => {
    const c = causalCompletion(hurayLoss, 1 + S);
    expect(rel(c.lowFrequencySlope, S)).toBeLessThan(1e-6);
    for (const y of logSweep(1e-12, 1e8, 241)) {
      const q = cx(Math.sqrt(y), Math.sqrt(y));
      const exact = {
        re: 1 + S * ((q.re * (1 + q.re) + q.im * q.im) / ((1 + q.re) ** 2 + q.im ** 2)),
        im: 0,
      };
      exact.im = exact.re - hurayLoss(y);
      const got = c.at(y);
      expect(rel(got.im, exact.im), `y = ${y}`).toBeLessThan(3e-4);
      expect(Math.abs(got.re - got.im - hurayLoss(y))).toBeLessThan(1e-12);
    }
    // Beyond the interpolated span it extrapolates as a power law, still close.
    for (const y of [1e-16, 1e12]) {
      const k = hurayCausalFactor(y / (Math.PI * VACUUM_PERMEABILITY * COPPER * 1e-12), 1e-6, S, COPPER);
      expect(Math.abs(c.at(y).im - k.im)).toBeLessThan(1e-6);
    }
  });

  it('causal Hammerstad keeps the Hammerstad loss exactly, stays passive, and has the closed-form low-frequency slope', () => {
    const rms = 1e-6;
    for (const f of logSweep(1e3, 1e14, 111)) {
      const k = hammerstadCausalFactor(f, rms, COPPER);
      expect(Math.abs(k.re - k.im - hammerstadFactor(f, rms, COPPER))).toBeLessThan(1e-12);
      expect(k.im).toBeGreaterThan(0);
      expect(argDeg(k)).toBeLessThan(45);
    }
    // J = integral (2/pi) atan(1.4 u) u^(-3/2) du = 2 sqrt(2.8), by parts and a Mellin integral.
    const c = causalCompletion(hammerstadLoss, 2);
    expect(rel(c.lowFrequencySlope, (2 * Math.sqrt(2.8)) / Math.PI)).toBeLessThan(1e-6);
    const y = 1e-10;
    expect(rel(c.at(y).im, c.lowFrequencySlope * Math.sqrt(y))).toBeLessThan(1e-4);
    expect(Math.abs(hammerstadCausalFactor(1e16, rms, COPPER).re - 2)).toBeLessThan(1e-3);
    expect(hammerstadCausalFactor(1e10, 0, COPPER)).toEqual(cx(1));
  });

  it('selects the model, and is 1 with roughness off', () => {
    expect(causalRoughnessFactor({ ...BASE, roughnessEnabled: false }, 1e10)).toEqual(cx(1));
    expect(causalRoughnessFactor(BASE, 1e10)).toEqual(
      hammerstadCausalFactor(1e10, BASE.roughnessRms, COPPER),
    );
    expect(causalRoughnessFactor({ ...BASE, roughnessModel: 'huray' }, 1e10)).toEqual(
      hurayCausalFactor(1e10, BASE.hurayRadius, BASE.hurayRatio, COPPER),
    );
  });

  it('adds mu0 C L / w of inductance at DC, continuous with the inductance just above it', () => {
    for (const model of ['hammerstad', 'huray'] as const) {
      const causal = prepareLine(spec({ roughnessModel: model }));
      const real = prepareLine(spec({ roughnessModel: model }), { causalRoughness: false });
      const added = roughnessLowFrequencyInductance(causal.spec);
      const length = model === 'huray' ? BASE.hurayRatio * BASE.hurayRadius : 1.0652686 * BASE.roughnessRms;
      expect(rel(added, (VACUUM_PERMEABILITY * length) / BASE.traceWidth)).toBeLessThan(1e-6);
      expect(rel(rlgcAt(causal, 0).l - rlgcAt(real, 0).l, added)).toBeLessThan(1e-9);
      expect(rel(rlgcAt(causal, 1).l, rlgcAt(causal, 0).l)).toBeLessThan(1e-4);
      expect(rel(rlgcAt(real, 1).l, rlgcAt(real, 0).l)).toBeLessThan(1e-4);
    }
    expect(roughnessLowFrequencyInductance({ ...BASE, roughnessEnabled: false })).toBe(0);
  });
});

describe('wideband Debye dielectric', () => {
  const CASES: [number, number, number][] = [
    [4, 0.02, 1e9],
    [4.3, 0.02, 1e10],
    [3.0, 0.004, 1e9],
    [3.4, 0.002, 1e10],
    [10, 0.05, 1e8],
  ];

  it.each(CASES)('reproduces er %s and tan(delta) %s exactly at %s Hz', (er, df, fr) => {
    const m = fitWidebandDebye({ er, lossTangent: df, referenceFreq: fr });
    expect(rel(permittivityAt(m, fr).re, er)).toBeLessThan(1e-12);
    expect(rel(lossTangentAt(m, fr), df)).toBeLessThan(1e-10);
  });

  it('is real at DC and falls monotonically towards epsInf, with eps" never negative', () => {
    const m = fitWidebandDebye(BASE);
    const dc = permittivityAt(m, 0);
    expect(dc.im).toBeCloseTo(0, 15);
    expect(dc.re).toBeCloseTo(m.epsInf + m.deltaEps, 12);
    let prev = dc.re;
    for (const f of logSweep(1, 1e15, 300)) {
      const e = permittivityAt(m, f);
      expect(e.re).toBeLessThanOrEqual(prev + 1e-12);
      expect(e.im).toBeLessThanOrEqual(0);
      prev = e.re;
    }
    expect(permittivityAt(m, 1e20).re).toBeCloseTo(m.epsInf, 6);
  });

  it('keeps the loss tangent within 5% of its stated value across three decades around 1 GHz', () => {
    const m = fitWidebandDebye(BASE);
    for (const f of logSweep(1e8, 1e11, 31)) expect(rel(lossTangentAt(m, f), 0.02)).toBeLessThan(0.05);
  });

  it('satisfies Kramers-Kronig at DC: eps(0) - epsInf = (2/pi) integral of eps"(f)/f df', () => {
    const m = fitWidebandDebye(BASE);
    // Integrate in u = ln f, where df/f = du, by Simpson's rule far past both corners.
    const u0 = Math.log(1e-4);
    const u1 = Math.log(1e22);
    const n = 200_000;
    const h = (u1 - u0) / n;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
      const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
      sum += w * -permittivityAt(m, Math.exp(u0 + i * h)).im;
    }
    const integral = ((2 / Math.PI) * sum * h) / 3;
    expect(rel(integral, m.deltaEps)).toBeLessThan(1e-4);
  });

  it('is a lossless constant when the loss tangent is zero', () => {
    const m = fitWidebandDebye({ er: 3.5, lossTangent: 0, referenceFreq: 1e9 });
    expect(m.deltaEps).toBe(0);
    expect(permittivityAt(m, 1e10).re).toBe(3.5);
  });
});

describe('per-unit-length parameters', () => {
  it('a lossless line has sqrt(L/C) = Z0 and 1/sqrt(LC) = c/sqrt(er)', () => {
    const m = prepareLine(spec({ ...LOSSLESS, z0: 85, er: 3.7 }));
    for (const f of [0, 1e6, 1e10]) {
      const p = rlgcAt(m, f);
      expect(p.r).toBe(0);
      expect(p.g).toBe(0);
      expect(rel(Math.sqrt(p.l / p.c), 85)).toBeLessThan(1e-12);
      expect(rel(1 / Math.sqrt(p.l * p.c), SPEED_OF_LIGHT / Math.sqrt(3.7))).toBeLessThan(1e-12);
    }
  });

  it('with loss, Z0 still holds at the reference frequency once the conductor is switched off', () => {
    const m = prepareLine(spec({ conductorLossEnabled: false }));
    const p = rlgcAt(m, BASE.referenceFreq);
    expect(rel(Math.sqrt(p.l / p.c), 50)).toBeLessThan(1e-12);
    expect(rel(p.g, 2 * Math.PI * 1e9 * p.c * 0.02)).toBeLessThan(1e-10);
  });

  it('R at DC is the DC resistance, and at any frequency adds (K - 1) R_s / w for roughness, causal or not', () => {
    for (const model of ['hammerstad', 'huray'] as const) {
      const sp = spec({ roughnessModel: model });
      for (const causalRoughness of [true, false]) {
        const m = prepareLine(sp, { causalRoughness });
        expect(rlgcAt(m, 0).r).toBeCloseTo(dcResistancePerMetre(BASE), 12);
        for (const f of [1e5, 1e8, 2e10]) {
          const r =
            internalImpedance(sp, f).re +
            ((roughnessFactor(sp, f) - 1) * surfaceResistance(f, COPPER)) / sp.traceWidth;
          expect(rel(rlgcAt(m, f).r, r)).toBeLessThan(1e-12);
        }
      }
    }
  });
});

describe('attenuation', () => {
  it('dielectric-only propagation is exactly gamma = j (w/c) sqrt(eps)', () => {
    const m = prepareLine(spec({ conductorLossEnabled: false }));
    for (const f of [1e8, 1e9, 1e10, 5e10]) {
      const g = propagationConstant(m, f);
      const root = Math.sqrt(mag(permittivityAt(m.debye, f)));
      const half = Math.atan2(permittivityAt(m.debye, f).im, permittivityAt(m.debye, f).re) / 2;
      const w = (2 * Math.PI * f) / SPEED_OF_LIGHT;
      // j * root * e^{j half} = root * (-sin(half) + j cos(half))
      expect(rel(g.re, -w * root * Math.sin(half))).toBeLessThan(1e-10);
      expect(rel(g.im, w * root * Math.cos(half))).toBeLessThan(1e-10);
      expect(rel(dielectricAttenuation(m, f), g.re)).toBeLessThan(2e-4);
    }
  });

  it('the dielectric rule of thumb coefficient is 2.31 dB per inch per GHz per unit tan(delta) sqrt(er)', () => {
    const coefficient = (NEPER_TO_DB * Math.PI * 1e9 * METRES_PER_INCH) / SPEED_OF_LIGHT;
    expect(coefficient).toBeCloseTo(2.312, 3);
  });

  it('conductor-only loss is Re(gamma) l, and R/(2 Z0) is within the internal-inductance correction', () => {
    const s = spec({ dielectricLossEnabled: false });
    const m = prepareLine(s);
    let prevError = Infinity;
    for (const f of [2e9, 5e9, 2e10, 5e10]) {
      const il = insertionLossDb(sParametersAt(m, f).s21);
      expect(rel(il, propagationConstant(m, f).re * s.length * NEPER_TO_DB)).toBeLessThan(1e-3);
      // The internal reactance equals the resistance in the skin regime, so the line
      // impedance rises by R/(2 w L) and the approximation overstates by that fraction.
      const p = rlgcAt(m, f);
      const error = rel(conductorAttenuation(m, f), propagationConstant(m, f).re);
      expect(error).toBeLessThan(p.r / (2 * Math.PI * f * p.l));
      expect(error).toBeLessThan(prevError);
      prevError = error;
    }
  });

  it('switching a mechanism off removes its attenuation', () => {
    expect(conductorAttenuation(prepareLine(spec({ conductorLossEnabled: false })), 1e10)).toBe(0);
    expect(dielectricAttenuation(prepareLine(spec({ dielectricLossEnabled: false })), 1e10)).toBe(0);
    expect(dielectricAttenuation(prepareLine(BASE), 0)).toBe(0);
  });
});

describe('S-parameters', () => {
  it('a lossless matched line is a pure delay of l sqrt(er)/c', () => {
    const m = prepareLine(LOSSLESS);
    const td = losslessDelay(LOSSLESS);
    for (const f of [1e6, 1e9, 7.3e9, 4e10]) {
      const s = sParametersAt(m, f, 50);
      expect(mag(s.s11)).toBeLessThan(1e-12);
      expect(Math.abs(mag(s.s21) - 1)).toBeLessThan(1e-12);
      expect(Math.abs(wrap(Math.atan2(s.s21.im, s.s21.re) + 2 * Math.PI * f * td))).toBeLessThan(1e-9);
      expect(rel(groupDelayAt(m, f, 50), td)).toBeLessThan(1e-6);
    }
  });

  it('a lossless mismatched section has the closed-form S11 and S21', () => {
    const z1 = 75;
    const r0 = 50;
    const s = { ...LOSSLESS, z0: z1 };
    const m = prepareLine(s);
    for (const f of [1e8, 3.3e8, 1e9, 2.9e9]) {
      const th = 2 * Math.PI * f * losslessDelay(s);
      const den = cx(2 * z1 * r0 * Math.cos(th), (z1 * z1 + r0 * r0) * Math.sin(th));
      const d2 = den.re * den.re + den.im * den.im;
      const s21 = cx((2 * z1 * r0 * den.re) / d2, (-2 * z1 * r0 * den.im) / d2);
      const n11 = cx(0, (z1 * z1 - r0 * r0) * Math.sin(th));
      const s11 = cx((n11.re * den.re + n11.im * den.im) / d2, (n11.im * den.re - n11.re * den.im) / d2);
      const got = sParametersAt(m, f, r0);
      expect(Math.abs(got.s21.re - s21.re)).toBeLessThan(1e-12);
      expect(Math.abs(got.s21.im - s21.im)).toBeLessThan(1e-12);
      expect(Math.abs(got.s11.re - s11.re)).toBeLessThan(1e-12);
      expect(Math.abs(got.s11.im - s11.im)).toBeLessThan(1e-12);
      expect(mag(got.s11) ** 2 + mag(got.s21) ** 2).toBeCloseTo(1, 12);
    }
  });

  it('a via on a matched lossless line is a shunt capacitor: S21 = e^{-j theta} 2/(2 + j w C r0)', () => {
    const s = { ...LOSSLESS, viaCount: 1, viaC: 0.4e-12 };
    const m = prepareLine(s);
    for (const f of [1e9, 1e10, 3e10]) {
      const th = 2 * Math.PI * f * losslessDelay(s);
      const wcr = 2 * Math.PI * f * s.viaC * 50;
      const d2 = 4 + wcr * wcr;
      const shunt = cx(4 / d2, (-2 * wcr) / d2);
      const expected = cx(
        shunt.re * Math.cos(th) + shunt.im * Math.sin(th),
        shunt.im * Math.cos(th) - shunt.re * Math.sin(th),
      );
      const got = sParametersAt(m, f, 50).s21;
      expect(Math.abs(got.re - expected.re)).toBeLessThan(1e-12);
      expect(Math.abs(got.im - expected.im)).toBeLessThan(1e-12);
    }
  });

  it('at DC the route is its series resistance', () => {
    const m = prepareLine(spec({ viaCount: 3 }));
    const x = (dcResistancePerMetre(BASE) * BASE.length) / 50;
    const s = sParametersAt(m, 0, 50);
    expect(s.s21.re).toBeCloseTo(2 / (2 + x), 12);
    expect(s.s21.im).toBeCloseTo(0, 12);
    expect(s.s11.re).toBeCloseTo(x / (2 + x), 12);
  });

  it('is passive and symmetric at every frequency, with vias and every loss on', () => {
    for (const model of ['hammerstad', 'huray'] as const) {
      const m = prepareLine(spec({ viaCount: 4, viaC: 0.6e-12, z0: 42, roughnessModel: model }));
      for (const f of logSweep(1e5, 6e10, 120)) {
        const s = sParametersAt(m, f, 50);
        expect(mag(s.s11) ** 2 + mag(s.s21) ** 2).toBeLessThanOrEqual(1 + 1e-12);
        expect(Math.abs(s.s11.re - s.s22.re)).toBeLessThan(1e-9);
        expect(Math.abs(s.s11.im - s.s22.im)).toBeLessThan(1e-9);
      }
    }
  });

  it('loses more at every frequency when a mechanism is added', () => {
    const cond = prepareLine(spec({ dielectricLossEnabled: false }));
    const both = prepareLine(BASE);
    const rough = prepareLine(spec({ roughnessModel: 'huray' }));
    const smooth = prepareLine(spec({ roughnessEnabled: false }));
    for (const f of logSweep(1e8, 4e10, 40)) {
      const il = (m: ReturnType<typeof prepareLine>): number => insertionLossDb(sParametersAt(m, f).s21);
      expect(il(both)).toBeGreaterThan(il(cond));
      expect(il(rough)).toBeGreaterThan(il(smooth));
    }
  });

  it('stays finite on a route long enough to overflow cosh', () => {
    const m = prepareLine(spec({ length: 100, viaCount: 16 }));
    const s = sParametersAt(m, 5e10, 50);
    for (const v of [s.s11.re, s.s11.im, s.s21.re, s.s21.im]) expect(Number.isFinite(v)).toBe(true);
    expect(mag(s.s21)).toBeLessThan(1e-100);
    expect(mag(s.s11)).toBeLessThanOrEqual(1);
    expect(insertionLossDb(s.s21)).toBe(300);
  });

  it('group delay of a lossy line lies between the infinite-frequency and DC permittivity bounds', () => {
    const m = prepareLine(spec({ conductorLossEnabled: false }));
    const lo = (BASE.length * Math.sqrt(m.debye.epsInf)) / SPEED_OF_LIGHT;
    const hi = (BASE.length * Math.sqrt(m.debye.epsInf + m.debye.deltaEps)) / SPEED_OF_LIGHT;
    for (const f of logSweep(1e7, 4e10, 20)) {
      const tg = groupDelayAt(m, f);
      expect(tg).toBeGreaterThan(lo);
      expect(tg).toBeLessThan(hi);
    }
  });

  it('characteristic impedance tends to Z0 at the reference frequency without conductor loss', () => {
    const m = prepareLine(spec({ conductorLossEnabled: false }));
    const zc = characteristicImpedanceAt(m, BASE.referenceFreq);
    // The loss tangent makes Zc complex: sqrt(1/(1 - j tan d)) about 1 + j tan(d)/2.
    expect(rel(zc.re, 50)).toBeLessThan(1e-3);
    expect(rel(zc.im, 50 * 0.01)).toBeLessThan(1e-2);
  });
});
