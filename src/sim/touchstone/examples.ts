/**
 * Two synthetic four-port networks, built so the measured-channel path has
 * something to run on before a reader loads a file of their own, and so every
 * check on that path has a network whose answer is known.
 *
 * Both are labelled synthetic on the page and neither stands for any product.
 * Both are built from the lossy line of PHYSICS.md section 13, so they share its
 * loss, and both are written into the same `Network` a file is read into.
 *
 * 1. A differential pair over woven glass. Glass fibre and resin differ in
 *    permittivity, and a weave puts glass under a trace in a periodic pattern. Two
 *    traces a pair pitch apart can sit over different mixes, so the legs of one pair
 *    see different Dk, travel at different speeds and arrive apart: intra-pair skew.
 *    Across a trace of width w centred at x, a glass fraction that varies as
 *
 *        phi(x) = phi_mean + phi_swing cos(2 pi x / p)
 *
 *    averages to phi_mean + phi_swing sinc(w/p) cos(2 pi x / p), with
 *    sinc(u) = sin(pi u)/(pi u). A route at angle theta to the weave drifts across it
 *    by D = l sin(theta) over its length l, and averaging along the route multiplies
 *    the swing again, by sinc(D/p), with the centre moved to x + D/2. Rotating the
 *    route so D is a whole number of pitches averages the weave out: the fix that
 *    fabricators call zig-zag or angled routing. The Dk of each leg is then the
 *    linear mix Dk_resin + (Dk_glass - Dk_resin) phi, an approximation stated on
 *    screen, and the skew is l (sqrt Dk_P - sqrt Dk_N) / c.
 *
 *    The legs are not coupled to each other. With identical legs apart from delay,
 *    the mixed-mode transfers have closed forms, which the tests hold them to:
 *
 *        |Sdd21| = |S21| |cos(pi f tau)|,   |Scd21| = |S21| |sin(pi f tau)|
 *
 *    so the differential signal has a null at f = 1 / (2 tau), and what it loses
 *    there reappears as common mode.
 *
 * 2. A coupled victim and aggressor. Two identical coupled lines have an even mode
 *    and an odd mode, each a lossy line of its own, with impedances
 *
 *        Z_even = Z0 (1 + K) / (1 - K),   Z_odd = Z0 (1 - K) / (1 + K)
 *
 *    for a backward coupling coefficient K, and permittivities that differ by a
 *    split delta when the field is not all in one dielectric, as on a microstrip.
 *    With ports 1 -> 2 the victim and 3 -> 4 the aggressor,
 *
 *        S21 = (S21e + S21o) / 2      S11 = (S11e + S11o) / 2
 *        S41 = (S21e - S21o) / 2      far-end crosstalk
 *        S31 = (S11e - S11o) / 2      near-end crosstalk
 *
 *    which is exactly passive, because each mode is. With no split the two modes
 *    travel together and far-end crosstalk nearly cancels, which is why stripline,
 *    all in one dielectric, has so little of it. What remains comes from the modes'
 *    different impedances: each is mismatched to the port differently, and conductor
 *    loss, R / 2Z per metre, takes more from the lower-impedance odd mode.
 *
 * Physics: PHYSICS.md section 14.4. The values of every material and geometry
 * preset are illustrative.
 */

import { SPEED_OF_LIGHT } from '../channel/tline';
import { prepareLine, sParametersAt, type LossyLineSpec } from '../channel/lossy';
import { emptyNetwork, setS, type Network } from './network';

export interface WeaveSpec {
  /** Weave pitch, metres: centre to centre of the glass bundles. */
  pitch: number;
  /** Mean glass fraction under a trace, 0..1. */
  glassMean: number;
  /** Swing of the glass fraction about its mean, 0..min(mean, 1 - mean). */
  glassSwing: number;
  /** Relative permittivity of the glass, 1. */
  dkGlass: number;
  /** Relative permittivity of the resin, 1. */
  dkResin: number;
  /** Centre-to-centre spacing of the P and N traces, metres. */
  pairPitch: number;
  /** Lateral position of the P trace's centre within the weave, metres. */
  offset: number;
  /** Angle of the route to the weave, degrees. */
  angleDeg: number;
}

/** A plain-weave glass style of the kind a DDR route crosses. Illustrative numbers, not any laminate's. */
export const WEAVE_DEFAULTS: WeaveSpec = {
  pitch: 500e-6,
  glassMean: 0.45,
  glassSwing: 0.06,
  dkGlass: 6.1,
  dkResin: 3.0,
  pairPitch: 250e-6,
  offset: 0,
  angleDeg: 0,
};

/** sin(pi u) / (pi u), 1 at u = 0. */
export function normalizedSinc(u: number): number {
  if (Math.abs(u) < 1e-8) return 1;
  const x = Math.PI * u;
  return Math.sin(x) / x;
}

/**
 * Mean glass fraction under a trace of width `width` whose centre starts at `x` and
 * drifts by `drift` over the route, averaged over the width and the route.
 */
export function meanGlassFraction(weave: WeaveSpec, x: number, width: number, drift: number): number {
  const p = weave.pitch;
  const swing =
    weave.glassSwing *
    normalizedSinc(width / p) *
    normalizedSinc(drift / p) *
    Math.cos((2 * Math.PI * (x + drift / 2)) / p);
  return Math.min(1, Math.max(0, weave.glassMean + swing));
}

/** Linear mix of glass and resin permittivity. */
export function mixedDk(weave: WeaveSpec, glassFraction: number): number {
  return weave.dkResin + (weave.dkGlass - weave.dkResin) * glassFraction;
}

export interface WeaveLegs {
  /** Drift across the weave over the route, metres: l sin(theta). */
  drift: number;
  glassP: number;
  glassN: number;
  dkP: number;
  dkN: number;
  /** Arrival of P minus arrival of N, seconds. */
  skew: number;
  /** First frequency at which the differential transfer has a null, Hz; Infinity with no skew. */
  nullFrequency: number;
}

export function weaveLegs(weave: WeaveSpec, line: Pick<LossyLineSpec, 'length' | 'traceWidth'>): WeaveLegs {
  const drift = line.length * Math.sin((weave.angleDeg * Math.PI) / 180);
  const glassP = meanGlassFraction(weave, weave.offset, line.traceWidth, drift);
  const glassN = meanGlassFraction(weave, weave.offset + weave.pairPitch, line.traceWidth, drift);
  const dkP = mixedDk(weave, glassP);
  const dkN = mixedDk(weave, glassN);
  const skew = (line.length * (Math.sqrt(dkP) - Math.sqrt(dkN))) / SPEED_OF_LIGHT;
  return {
    drift,
    glassP,
    glassN,
    dkP,
    dkN,
    skew,
    nullFrequency: skew === 0 ? Infinity : 1 / (2 * Math.abs(skew)),
  };
}

/** `count` frequencies from `step` to `count * step`, as a vector network analyser sweeps. */
export function linearSweep(step: number, count: number): Float64Array {
  return Float64Array.from({ length: count }, (_, k) => step * (k + 1));
}

/**
 * The woven differential pair as a four-port: 1 -> 2 is P, 3 -> 4 is N, in a
 * 50 ohm reference unless `r0` says otherwise.
 */
export function weavePairNetwork(
  line: LossyLineSpec,
  weave: WeaveSpec,
  freq: Float64Array,
  r0 = 50,
): { network: Network; legs: WeaveLegs } {
  const legs = weaveLegs(weave, line);
  const p = prepareLine({ ...line, er: legs.dkP });
  const n = prepareLine({ ...line, er: legs.dkN });
  const net = emptyNetwork(4, freq, r0);
  for (let k = 0; k < freq.length; k++) {
    const sp = sParametersAt(p, freq[k], r0);
    const sn = sParametersAt(n, freq[k], r0);
    setS(net, k, 0, 0, sp.s11);
    setS(net, k, 1, 1, sp.s22);
    setS(net, k, 1, 0, sp.s21);
    setS(net, k, 0, 1, sp.s21);
    setS(net, k, 2, 2, sn.s11);
    setS(net, k, 3, 3, sn.s22);
    setS(net, k, 3, 2, sn.s21);
    setS(net, k, 2, 3, sn.s21);
  }
  return { network: net, legs };
}

export interface CouplingSpec {
  /** Backward coupling coefficient K, 0..0.5. */
  k: number;
  /** Even-mode Dk minus odd-mode Dk, 1. Zero for a homogeneous dielectric. */
  modalSplit: number;
}

/** A loosely coupled microstrip pair. Illustrative. */
export const COUPLING_DEFAULTS: CouplingSpec = { k: 0.05, modalSplit: 0.3 };

export function modalImpedances(z0: number, k: number): { even: number; odd: number } {
  return { even: (z0 * (1 + k)) / (1 - k), odd: (z0 * (1 - k)) / (1 + k) };
}

/** The coupled pair as a four-port: 1 -> 2 victim, 3 -> 4 aggressor. */
export function coupledPairNetwork(
  line: LossyLineSpec,
  coupling: CouplingSpec,
  freq: Float64Array,
  r0 = 50,
): Network {
  const z = modalImpedances(line.z0, coupling.k);
  const even = prepareLine({ ...line, z0: z.even, er: line.er + coupling.modalSplit / 2 });
  const odd = prepareLine({ ...line, z0: z.odd, er: Math.max(1, line.er - coupling.modalSplit / 2) });
  const net = emptyNetwork(4, freq, r0);
  const half = (a: { re: number; im: number }, b: { re: number; im: number }, sign: number) => ({
    re: (a.re + sign * b.re) / 2,
    im: (a.im + sign * b.im) / 2,
  });
  for (let k = 0; k < freq.length; k++) {
    const e = sParametersAt(even, freq[k], r0);
    const o = sParametersAt(odd, freq[k], r0);
    const thru = half(e.s21, o.s21, 1);
    const fext = half(e.s21, o.s21, -1);
    const near = half(e.s11, o.s11, 1);
    const next = half(e.s11, o.s11, -1);
    const far = half(e.s22, o.s22, 1);
    const nextFar = half(e.s22, o.s22, -1);
    // Victim ports 0 (near) and 1 (far); aggressor ports 2 (near) and 3 (far).
    for (const [a, b] of [
      [0, 2],
      [2, 0],
    ]) {
      setS(net, k, a, a, near);
      setS(net, k, b, a, next);
    }
    for (const [a, b] of [
      [1, 3],
      [3, 1],
    ]) {
      setS(net, k, a, a, far);
      setS(net, k, b, a, nextFar);
    }
    for (const [out, inp] of [
      [1, 0],
      [0, 1],
      [3, 2],
      [2, 3],
    ]) {
      setS(net, k, out, inp, thru);
    }
    for (const [out, inp] of [
      [3, 0],
      [0, 3],
      [1, 2],
      [2, 1],
    ]) {
      setS(net, k, out, inp, fext);
    }
  }
  return net;
}
