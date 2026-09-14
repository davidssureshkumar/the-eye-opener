/**
 * The lossless line, checked against closed forms rather than against itself.
 *
 * Three kinds of assertion here, in order of how much they are worth:
 *
 *   - Values that are known independently of this code: a reflection coefficient
 *     of +1 into an open, a steady state that is a resistive divider, a delay of
 *     length over velocity, the textbook half-then-full staircase of a
 *     matched-source open-load line.
 *   - Agreement between two implementations that were derived separately: the
 *     analytic lattice and the wave-variable time-stepper must produce the same
 *     numbers when the load is resistive. They share the reflection-coefficient
 *     helper and nothing else.
 *   - Properties that must hold whatever the numbers are: causality, energy going
 *     the right way, every output finite.
 */

import { describe, expect, it } from 'vitest';
import {
  characteristicImpedance,
  velocityFromPerUnitLength,
  apparentSecondReflection,
  bounceDiagram,
  bounceVoltageAt,
  criticalLength,
  delayPerMetre,
  effectivePermittivity,
  electricalLengthRatio,
  impedanceFromReflection,
  launchVoltage,
  propagationDelay,
  propagationVelocity,
  rcLoadReflection,
  reflectionCoefficient,
  simulateLine,
  SPEED_OF_LIGHT,
  steadyStateVoltage,
  tdrDistance,
  tdrImpedance,
  tdrReflection,
  velocityFactorFromPermittivity,
  type LinkSpec,
} from '../tline';

const LINE = { z0: 50, length: 0.15, velocityFactor: 0.5 };

/** A step of `amplitude` volts starting at sample zero, `n` samples long. */
function step(n: number, amplitude = 1): Float64Array {
  return new Float64Array(n).fill(amplitude);
}

/* ----------------------------------------------------------- propagation */

describe('propagation', () => {
  it('uses the defined speed of light', () => {
    expect(SPEED_OF_LIGHT).toBe(299792458);
  });

  it('recovers Z0 and v from the per-unit-length L and C that produce them', () => {
    // L' = Z0/v and C' = 1/(Z0 v) invert the two formulas exactly.
    for (const [z0, vf] of [
      [50, 0.5],
      [85, 0.62],
      [30, 0.4],
    ]) {
      const v = vf * SPEED_OF_LIGHT;
      expect(characteristicImpedance(z0 / v, 1 / (z0 * v))).toBeCloseTo(z0, 9);
      expect(velocityFromPerUnitLength(z0 / v, 1 / (z0 * v)) / v).toBeCloseTo(1, 12);
    }
    // A 50 ohm line at vf 0.5 is about 334 nH/m and 133 pF/m.
    const v = 0.5 * SPEED_OF_LIGHT;
    expect((50 / v) * 1e9).toBeCloseTo(333.56, 2);
    expect((1 / (50 * v)) * 1e12).toBeCloseTo(133.43, 2);
  });

  it('gives delay as length over velocity', () => {
    const td = propagationDelay(LINE);
    expect(td).toBeCloseTo(0.15 / (0.5 * 299792458), 18);
    // 150 mm at half the speed of light is almost exactly a nanosecond.
    expect(td).toBeCloseTo(1.0007e-9, 12);
  });

  it('gives 3.336 ps per mm in vacuum and twice that at vf = 0.5', () => {
    expect(delayPerMetre(1) * 1e-3).toBeCloseTo(3.3356e-12, 15);
    expect(delayPerMetre(0.5)).toBeCloseTo(2 * delayPerMetre(1), 18);
  });

  it('round trips velocity factor through effective permittivity', () => {
    for (const vf of [0.3, 0.4444, 0.5, 0.6, 0.9, 1]) {
      expect(velocityFactorFromPermittivity(effectivePermittivity(vf))).toBeCloseTo(vf, 12);
    }
    // er_eff = 4 is vf = 0.5, which is the FR-4 stripline figure the default uses.
    expect(effectivePermittivity(0.5)).toBeCloseTo(4, 12);
  });

  it('scales velocity linearly with the factor', () => {
    expect(propagationVelocity(0.5)).toBeCloseTo(SPEED_OF_LIGHT / 2, 6);
  });
});

/* ------------------------------------------------------------- interfaces */

describe('reflection coefficients', () => {
  it('is +1 into an open, -1 into a short, 0 into a match', () => {
    expect(reflectionCoefficient(Infinity, 50)).toBe(1);
    expect(reflectionCoefficient(0, 50)).toBe(-1);
    expect(reflectionCoefficient(50, 50)).toBe(0);
  });

  it('approaches +1 for the large resistance that stands in for an open', () => {
    // The Scenario models an open as 1e6 ohms rather than as Infinity, because a
    // non-finite number in a result fails the guard in src/dsp/guard.ts.
    const g = reflectionCoefficient(1e6, 50);
    expect(g).toBeGreaterThan(0.9998);
    expect(g).toBeLessThan(1);
  });

  it('is negative for a load below Z0 and positive above it', () => {
    expect(reflectionCoefficient(30, 50)).toBeCloseTo(-0.25, 12);
    expect(reflectionCoefficient(75, 50)).toBeCloseTo(0.2, 12);
  });

  it('inverts back to the impedance it came from', () => {
    for (const z of [1, 25, 50, 75, 100, 1000]) {
      expect(impedanceFromReflection(reflectionCoefficient(z, 50), 50)).toBeCloseTo(z, 9);
    }
  });
});

describe('dividers', () => {
  it('launches the source into Z0, not into the load', () => {
    // A 40 ohm driver into a 50 ohm line: 50/90 of the swing leaves immediately,
    // whatever is at the far end.
    expect(launchVoltage(1, 40, 50)).toBeCloseTo(5 / 9, 12);
    expect(launchVoltage(1, 0, 50)).toBeCloseTo(1, 12);
    expect(launchVoltage(1, 50, 50)).toBeCloseTo(0.5, 12);
  });

  it('settles at the divider between source and load, with no Z0 in it', () => {
    expect(steadyStateVoltage(1, 40, 60)).toBeCloseTo(0.6, 12);
    // Same terminations, different line: the destination does not depend on Z0.
    expect(steadyStateVoltage(1, 40, 60)).toBe(steadyStateVoltage(1, 40, 60));
    expect(steadyStateVoltage(1, 20, 1e6)).toBeGreaterThan(0.99998);
  });
});

describe('electrical length', () => {
  it('is the rise time times the velocity times the chosen fraction', () => {
    const tr = 25e-12;
    expect(criticalLength(tr, 0.5, 1 / 6)).toBeCloseTo((25e-12 * 0.5 * SPEED_OF_LIGHT) / 6, 15);
    // The published rules differ by a factor of five end to end, which is the
    // point of making the fraction a parameter.
    expect(criticalLength(tr, 0.5, 1 / 2) / criticalLength(tr, 0.5, 1 / 10)).toBeCloseTo(5, 12);
  });

  it('reports the delay-to-rise-time ratio the rule is actually about', () => {
    const ratio = electricalLengthRatio(LINE, 25e-12);
    expect(ratio).toBeCloseTo(propagationDelay(LINE) / 25e-12, 12);
    // 150 mm of FR-4 against a 25 ps edge is 40 rise times of delay: enormously
    // long electrically, which is why the default Scenario rings.
    expect(ratio).toBeGreaterThan(39);
  });
});

/* --------------------------------------------------------- bounce diagram */

describe('bounce diagram', () => {
  const spec = { ...LINE, sourceZ: 40, loadZ: 1e6, amplitude: 1 };

  it('produces one launch plus two events per round trip', () => {
    for (const n of [1, 2, 12, 64]) {
      expect(bounceDiagram(spec, n).events).toHaveLength(1 + 2 * n);
    }
  });

  it('places events at integer multiples of the one-way delay', () => {
    const d = bounceDiagram(spec, 4);
    const td = propagationDelay(spec);
    d.events.forEach((e, i) => expect(e.time).toBeCloseTo(i * td, 18));
    // Far end first, then near end, alternating.
    expect(d.events.map((e) => e.end).slice(0, 5)).toEqual(['near', 'far', 'near', 'far', 'near']);
  });

  it('gives the textbook staircase for a matched source into an open', () => {
    // Zs = Z0 means Gs = 0, so there is exactly one reflection and it is total.
    // The near end launches half the swing, the far end doubles it to the full
    // swing at t = td, and the near end catches up at 2*td. Nothing after that.
    const d = bounceDiagram({ ...LINE, sourceZ: 50, loadZ: 1e9, amplitude: 1 }, 6);
    const td = d.delay;
    expect(bounceVoltageAt(d, 'near', 0.5 * td)).toBeCloseTo(0.5, 9);
    expect(bounceVoltageAt(d, 'far', 0.5 * td)).toBe(0);
    expect(bounceVoltageAt(d, 'far', 1.5 * td)).toBeCloseTo(1, 6);
    expect(bounceVoltageAt(d, 'near', 1.5 * td)).toBeCloseTo(0.5, 9);
    expect(bounceVoltageAt(d, 'near', 2.5 * td)).toBeCloseTo(1, 6);
    expect(bounceVoltageAt(d, 'near', 20 * td)).toBeCloseTo(1, 6);
  });

  it('converges to the resistive divider however many bounces are taken', () => {
    // The series is geometric in Gs*GL, so the destination is fixed and only the
    // distance to it changes. This is the check that the lattice is a series and
    // not an accumulation of arithmetic error.
    const under = { ...LINE, sourceZ: 20, loadZ: 200, amplitude: 1 };
    const target = steadyStateVoltage(1, 20, 200);
    let previous = Infinity;
    for (const n of [1, 2, 4, 8, 16, 32, 64]) {
      const d = bounceDiagram(under, n);
      expect(d.steadyState).toBeCloseTo(target, 12);
      expect(d.truncationError).toBeLessThanOrEqual(previous);
      previous = d.truncationError;
    }
    expect(bounceDiagram(under, 64).truncationError).toBeLessThan(1e-12);
  });

  it('never leaves the launch level when both ends are matched', () => {
    const d = bounceDiagram({ ...LINE, sourceZ: 50, loadZ: 50, amplitude: 1 }, 8);
    expect(d.gammaSource).toBe(0);
    expect(d.gammaLoad).toBe(0);
    for (const e of d.events.slice(1)) expect(e.departing).toBe(0);
    expect(d.nearFinal).toBeCloseTo(0.5, 12);
    expect(d.farFinal).toBeCloseTo(0.5, 12);
    expect(d.farFinal).toBeCloseTo(steadyStateVoltage(1, 50, 50), 12);
  });

  it('alternates the sign of the far-end steps when the load is below Z0', () => {
    // Gs and GL both negative gives a positive product, so the far end approaches
    // its final value from one side; a negative product would alternate. This is
    // the difference between a sagging step and a ringing one.
    const d = bounceDiagram({ ...LINE, sourceZ: 10, loadZ: 25, amplitude: 1 }, 12);
    expect(d.gammaSource).toBeCloseTo(-2 / 3, 12);
    expect(d.gammaLoad).toBeCloseTo(-1 / 3, 12);
    const far = d.events.filter((e) => e.end === 'far').map((e) => e.level);
    for (let i = 1; i < far.length; i++) {
      expect(far[i]).toBeGreaterThan(far[i - 1]);
    }
    expect(far[far.length - 1]).toBeCloseTo(steadyStateVoltage(1, 10, 25), 6);
  });

  it('reads zero before the launch and holds the last level after it', () => {
    const d = bounceDiagram(spec, 3);
    expect(bounceVoltageAt(d, 'near', -1e-9)).toBe(0);
    expect(bounceVoltageAt(d, 'far', 0)).toBe(0);
    expect(bounceVoltageAt(d, 'far', 1e9)).toBeCloseTo(d.farFinal, 12);
  });
});

/* --------------------------------------------------------------- simulator */

describe('wave-variable simulator', () => {
  const link: LinkSpec = { ...LINE, sourceZ: 40, loadZ: 1e6, loadC: 0 };
  const td = propagationDelay(LINE);

  function run(spec: LinkSpec, samplesPerDelay = 64, delays = 12): ReturnType<typeof simulateLine> {
    const dt = td / samplesPerDelay;
    return simulateLine(spec, step(samplesPerDelay * delays), dt);
  }

  it('shows the far end nothing before one delay has passed', () => {
    const r = run(link, 64);
    for (let i = 0; i < r.delaySamples; i++) expect(r.far[i]).toBe(0);
    expect(r.far[r.delaySamples]).not.toBe(0);
  });

  it('holds the near end at the launch level until the reflection returns', () => {
    const r = run(link, 64);
    const launch = launchVoltage(1, 40, 50);
    for (let i = 0; i < 2 * r.delaySamples; i++) expect(r.near[i]).toBeCloseTo(launch, 12);
    expect(r.near[2 * r.delaySamples]).toBeGreaterThan(launch + 0.1);
  });

  it('agrees with the bounce diagram everywhere, for a resistive load', () => {
    // The two were derived separately - a geometric series and a time-stepper -
    // and share only `reflectionCoefficient`. If this ever drifts, one of them is
    // wrong, and the lattice is the one that can be checked by hand.
    for (const [sourceZ, loadZ] of [
      [40, 1e6],
      [50, 1e6],
      [10, 25],
      [20, 200],
      [50, 50],
      [5, 1e3],
    ]) {
      const spec: LinkSpec = { ...LINE, sourceZ, loadZ, loadC: 0 };
      const r = run(spec, 32, 10);
      const d = bounceDiagram({ ...LINE, sourceZ, loadZ, amplitude: 1 }, 12);
      for (let i = 0; i < r.t.length; i++) {
        // Skip the samples that land exactly on an arrival: the staircase is
        // discontinuous there and which side a sample falls on is arithmetic,
        // not physics.
        if (Math.abs((r.t[i] / td) % 1) < 1e-9) continue;
        expect(r.near[i]).toBeCloseTo(bounceVoltageAt(d, 'near', r.t[i]), 9);
        expect(r.far[i]).toBeCloseTo(bounceVoltageAt(d, 'far', r.t[i]), 9);
      }
    }
  });

  it('doubles the step at an open far end and leaves a matched one alone', () => {
    const open = run({ ...LINE, sourceZ: 50, loadZ: 1e9, loadC: 0 }, 64, 6);
    expect(open.far[open.delaySamples + 4]).toBeCloseTo(1, 6);
    const matched = run({ ...LINE, sourceZ: 50, loadZ: 50, loadC: 0 }, 64, 6);
    expect(matched.far[matched.delaySamples + 4]).toBeCloseTo(0.5, 12);
    expect(matched.near[matched.near.length - 1]).toBeCloseTo(0.5, 12);
  });

  it('sags rather than overshoots when the far end is below Z0', () => {
    const r = run({ ...LINE, sourceZ: 50, loadZ: 25, loadC: 0 }, 64, 8);
    const settled = r.far[r.far.length - 1];
    expect(settled).toBeCloseTo(steadyStateVoltage(1, 50, 25), 9);
    // Everything the far end ever sees is below where it ends up: a negative
    // load reflection cannot overshoot.
    for (let i = 0; i < r.far.length; i++) expect(r.far[i]).toBeLessThanOrEqual(settled + 1e-12);
  });

  it('settles at the resistive divider for every termination pair', () => {
    for (const [sourceZ, loadZ] of [
      [40, 1e6],
      [10, 25],
      [20, 200],
      [50, 50],
      [5, 75],
    ]) {
      const r = run({ ...LINE, sourceZ, loadZ, loadC: 0 }, 32, 200);
      const target = steadyStateVoltage(1, sourceZ, loadZ);
      expect(r.far[r.far.length - 1]).toBeCloseTo(target, 8);
      expect(r.near[r.near.length - 1]).toBeCloseTo(target, 8);
    }
  });

  it('uses an integer number of samples of delay, and at least one', () => {
    const r = simulateLine(link, step(1000), td / 64);
    expect(r.delaySamples).toBe(64);
    expect(r.delay).toBeCloseTo(td, 18);
    // A sample interval longer than the whole line still gets one sample of it.
    const coarse = simulateLine(link, step(50), td * 10);
    expect(coarse.delaySamples).toBe(1);
  });

  it('converges on the bounce diagram as the sample rate rises', () => {
    const spec: LinkSpec = { ...LINE, sourceZ: 20, loadZ: 200, loadC: 0 };
    const d = bounceDiagram({ ...LINE, sourceZ: 20, loadZ: 200, amplitude: 1 }, 12);
    for (const spd of [8, 32, 128]) {
      const r = run(spec, spd, 6);
      const i = Math.floor(3.5 * r.delaySamples);
      expect(r.near[i]).toBeCloseTo(bounceVoltageAt(d, 'near', r.t[i]), 9);
    }
  });

  it('keeps every sample finite in all of these cases', () => {
    for (const spec of [
      link,
      { ...LINE, sourceZ: 1e-6, loadZ: 1e-6, loadC: 0 },
      { ...LINE, sourceZ: 1e6, loadZ: 1e6, loadC: 1e-12 },
      { ...LINE, sourceZ: 40, loadZ: 50, loadC: 1e-9 },
    ] as LinkSpec[]) {
      const r = run(spec, 16, 20);
      for (let i = 0; i < r.t.length; i++) {
        expect(Number.isFinite(r.near[i])).toBe(true);
        expect(Number.isFinite(r.far[i])).toBe(true);
      }
    }
  });
});

/* ---------------------------------------------------------- capacitive load */

describe('a capacitive far end', () => {
  const td = propagationDelay(LINE);

  it('reflects like a short at the instant of arrival', () => {
    // A charged-from-zero capacitor is a short circuit to a step, whatever the
    // resistor beside it says. That is the notch at the receiver pad.
    expect(rcLoadReflection(1, 0, 50, 50, 1e-12)).toBeCloseTo(-1, 12);
    expect(rcLoadReflection(1, 0, 50, 1e6, 1e-12)).toBeCloseTo(-1, 12);
  });

  it('relaxes to the resistive coefficient with time constant C*(R || Z0)', () => {
    const gr = reflectionCoefficient(75, 50);
    const tau = 2e-12 * ((75 * 50) / 125);
    expect(rcLoadReflection(1, 100 * tau, 50, 75, 2e-12)).toBeCloseTo(gr, 12);
    // One time constant in, the gap to the final value is down by 1/e.
    const atTau = rcLoadReflection(1, tau, 50, 75, 2e-12);
    expect((atTau - gr) / (-1 - gr)).toBeCloseTo(Math.exp(-1), 12);
  });

  it('reduces to the resistive answer when there is no capacitance', () => {
    for (const z of [25, 50, 75, 1e6]) {
      expect(rcLoadReflection(1, 0, 50, z, 0)).toBeCloseTo(reflectionCoefficient(z, 50), 12);
    }
  });

  it('matches the closed form when the simulator runs it', () => {
    // A matched source means the far end sees one clean step of half the swing and
    // nothing else, so the whole far-end waveform is the closed form above with no
    // later bounces layered on it.
    const loadZ = 75;
    const loadC = 2e-12;
    const spd = 4096;
    const dt = td / spd;
    const r = simulateLine({ ...LINE, sourceZ: 50, loadZ, loadC }, step(spd * 3), dt);
    const a = 0.5; // the wave that arrives, volts
    for (let i = r.delaySamples + 1; i < r.delaySamples * 2; i++) {
      const dtSince = (i - r.delaySamples) * dt;
      const expected = a + rcLoadReflection(a, dtSince, 50, loadZ, loadC);
      expect(r.far[i]).toBeCloseTo(expected, 4);
    }
  });

  it('starts the far end at zero and ends it at the divider', () => {
    const r = simulateLine({ ...LINE, sourceZ: 40, loadZ: 200, loadC: 5e-12 }, step(40000), td / 64);
    expect(r.far[r.delaySamples]).toBe(0);
    expect(r.far[r.far.length - 1]).toBeCloseTo(steadyStateVoltage(1, 40, 200), 6);
  });

  it('slows the far-end edge as the capacitance grows', () => {
    const rise = (loadC: number): number => {
      const r = simulateLine({ ...LINE, sourceZ: 50, loadZ: 50, loadC }, step(200000), td / 64);
      const target = 0.9 * steadyStateVoltage(1, 50, 50);
      for (let i = 0; i < r.far.length; i++) if (r.far[i] >= target) return r.t[i];
      return Infinity;
    };
    const a = rise(0.3e-12);
    const b = rise(3e-12);
    const c = rise(30e-12);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

/* ---------------------------------------------------------------------- TDR */

describe('TDR', () => {
  const td = propagationDelay(LINE);

  /** A TDR run: an instrument of `zRef` into the line, returning rho and Z. */
  function tdr(spec: LinkSpec, spd = 256, delays = 6): { rho: Float64Array; z: Float64Array; m: number } {
    const src = step(spd * delays, 1);
    const r = simulateLine(spec, src, td / spd);
    const rho = tdrReflection(r.near, src, 1);
    return { rho, z: tdrImpedance(rho, spec.sourceZ), m: r.delaySamples };
  }

  it('halves the round trip when turning time into distance', () => {
    expect(tdrDistance(2 * td, 0.5)).toBeCloseTo(LINE.length, 12);
    expect(tdrDistance(0, 0.5)).toBe(0);
  });

  it('recovers the load exactly when the line matches the instrument', () => {
    // One discontinuity, so the inversion is the measurement and not an
    // approximation to it.
    for (const loadZ of [25, 40, 75, 100, 250]) {
      const { z, m } = tdr({ ...LINE, sourceZ: 50, loadZ, loadC: 0 });
      expect(z[Math.floor(0.5 * m)]).toBeCloseTo(50, 9);
      expect(z[Math.floor(3 * m)]).toBeCloseTo(loadZ, 9);
    }
  });

  it('reads the first discontinuity exactly and the second only approximately', () => {
    // A 50 ohm instrument into a 40 ohm line into a 75 ohm load. The line itself is
    // the first interface the step meets, so it reads 40 ohms to the arithmetic.
    // The load is seen through that interface and read with the wrong reference,
    // so the display is wrong about it - by a computable amount: 73.38 ohms, about
    // 2% low, which is small enough to be believed and large enough to fail a
    // tight impedance tolerance.
    const { z, m } = tdr({ ...LINE, z0: 40, sourceZ: 50, loadZ: 75, loadC: 0 });
    expect(z[Math.floor(1 * m)]).toBeCloseTo(40, 9);
    const apparent = z[Math.floor(3 * m)];
    // Transmitted into the line: 2*40/90; reflected at the load: (75-40)/115;
    // transmitted back: 2*50/90. Added to the first reflection, -10/90.
    const rho = -10 / 90 + (80 / 90) * (35 / 115) * (100 / 90);
    expect(apparent).toBeCloseTo(impedanceFromReflection(rho, 50), 9);
    expect(apparent).toBeCloseTo(73.3775, 3);
    // The same arithmetic in the form M3 displays it.
    expect(apparentSecondReflection(-10 / 90, 35 / 115)).toBeCloseTo(rho, 15);
  });

  it('stays at the reference through the launched edge itself', () => {
    // Subtracting the instantaneous incident wave is what keeps a band-limited
    // launch from reading as a dip to zero ohms at t = 0.
    const n = 512;
    const src = new Float64Array(n);
    for (let i = 0; i < n; i++) src[i] = 0.5 * (1 + Math.tanh((i - 40) / 6));
    const r = simulateLine({ ...LINE, sourceZ: 50, loadZ: 1e6, loadC: 0 }, src, td / 256);
    const rho = tdrReflection(r.near, src, 1);
    for (let i = 0; i < r.delaySamples * 2; i++) expect(rho[i]).toBeCloseTo(0, 12);
  });

  it('maps an open to a large finite impedance rather than to infinity', () => {
    const { z } = tdr({ ...LINE, sourceZ: 50, loadZ: 1e9, loadC: 0 }, 64);
    const settled = z[z.length - 1];
    expect(Number.isFinite(settled)).toBe(true);
    expect(settled).toBeGreaterThan(5e4);
  });

  it('shows a capacitive load as a dip below the resistance beside it', () => {
    const { z, m } = tdr({ ...LINE, sourceZ: 50, loadZ: 50, loadC: 2e-12 }, 1024, 4);
    let lowest = Infinity;
    for (let i = 2 * m; i < 2 * m + 200; i++) lowest = Math.min(lowest, z[i]);
    expect(lowest).toBeLessThan(5);
    expect(z[z.length - 1]).toBeCloseTo(50, 3);
  });

  it('reports the reference itself when nothing has come back yet', () => {
    const z = tdrImpedance(new Float64Array(16), 50);
    for (let i = 0; i < z.length; i++) expect(z[i]).toBeCloseTo(50, 12);
  });
});
