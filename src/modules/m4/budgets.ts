/**
 * The silicon callout's loss-budget comparison: three memory routes of very
 * different construction, put through the same lossy-line model at the same rate.
 *
 * Every geometry and material value below is illustrative, chosen to be of the right
 * order for the class of route named and taken from no JEDEC document or datasheet.
 * All three are evaluated at one rate so that only the medium differs; the interfaces
 * themselves run at the rates their standards set, which this site does not restate.
 */

import {
  dcResistancePerMetre,
  insertionLossDb,
  prepareLine,
  skinDepth,
  sParametersAt,
  type LossyLineSpec,
} from '../../sim/channel/lossy';

export interface RouteClass {
  key: string;
  name: string;
  /** What is left out, said plainly. */
  omits: string;
  spec: Partial<LossyLineSpec>;
}

export const ROUTE_CLASSES: readonly RouteClass[] = [
  {
    key: 'dimm',
    name: 'DDR5 DIMM-class board route',
    omits: 'trace only; no connector, no package',
    spec: {
      z0: 45,
      length: 0.12,
      traceWidth: 100e-6,
      thickness: 35e-6,
      er: 3.7,
      lossTangent: 0.008,
      roughnessEnabled: true,
      roughnessModel: 'hammerstad',
      roughnessRms: 1e-6,
      viaCount: 2,
      viaC: 0.3e-12,
    },
  },
  {
    key: 'pop',
    name: 'LPDDR5 package-on-package route',
    omits: 'substrate trace only; no solder balls, no die pad',
    spec: {
      z0: 45,
      length: 8e-3,
      traceWidth: 25e-6,
      thickness: 15e-6,
      er: 3.4,
      lossTangent: 0.005,
      roughnessEnabled: true,
      roughnessModel: 'hammerstad',
      roughnessRms: 0.3e-6,
      viaCount: 2,
      viaC: 0.05e-12,
    },
  },
  {
    key: 'hbm',
    name: 'HBM silicon interposer link',
    omits: 'interposer line only; no microbumps, no through-silicon vias',
    spec: {
      z0: 50,
      length: 3e-3,
      traceWidth: 2e-6,
      thickness: 1e-6,
      er: 3.9,
      lossTangent: 0.001,
      roughnessEnabled: false,
      viaCount: 0,
    },
  },
];

export interface RouteBudget {
  key: string;
  name: string;
  omits: string;
  length: number;
  traceWidth: number;
  thickness: number;
  /** Skin depth at the evaluation frequency over the conductor thickness. */
  skinOverThickness: number;
  /** DC series resistance of the whole route, ohms. */
  seriesResistance: number;
  /** Insertion loss at DC between 50 ohm ports, dB: 20 log10(1 + R / 2 R0) for a short route. */
  ilDc: number;
  /** Insertion loss at the evaluation frequency, dB. */
  ilAt: number;
}

/** Each route class on the given base line, at frequency f, between r0 ports. */
export function routeBudgets(base: LossyLineSpec, f: number, r0 = 50): RouteBudget[] {
  return ROUTE_CLASSES.map((c) => {
    const spec: LossyLineSpec = {
      ...base,
      conductorLossEnabled: true,
      dielectricLossEnabled: true,
      ...c.spec,
    };
    const model = prepareLine(spec);
    return {
      key: c.key,
      name: c.name,
      omits: c.omits,
      length: spec.length,
      traceWidth: spec.traceWidth,
      thickness: spec.thickness,
      skinOverThickness: skinDepth(f, spec.conductivity) / spec.thickness,
      seriesResistance: dcResistancePerMetre(spec) * spec.length,
      ilDc: insertionLossDb(sParametersAt(model, 1, r0).s21),
      ilAt: insertionLossDb(sParametersAt(model, f, r0).s21),
    };
  });
}
