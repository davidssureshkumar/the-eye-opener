/**
 * A lossless transmission line, in the time domain.
 *
 * This is the model M3 is built on, and it is the point at which the lumped RLC of
 * M2 stops being the right answer. A lumped model assumes every node in a network
 * changes at the same instant. A trace does not: a step launched at the driver
 * arrives at the receiver one propagation delay later, and until it does, the
 * driver has no idea what is at the far end. That single fact - the line has
 * memory, and the memory is exactly one delay long - is where reflections,
 * staircases, and the whole notion of an impedance discontinuity come from.
 *
 * Two implementations are provided, and they are two views of one physics:
 *
 *   - `bounceDiagram` is the analytic lattice. A launched wave, a reflection
 *     coefficient at each end, and a geometric series of round trips. It is exact
 *     for resistive terminations, it is what a reader draws on paper, and it is
 *     the oracle the simulator is tested against.
 *   - `simulateLine` is a wave-variable (scattering) time-stepper. It takes any
 *     source waveform rather than an ideal step, it handles a capacitive far-end
 *     load (exactly at the node, to first order in dt in the returned wave), and
 *     it reduces to the bounce diagram when that capacitance is zero. That reduction is asserted in the tests rather than assumed.
 *
 * What is deliberately NOT here: loss. No skin effect, no dielectric loss, no
 * frequency-dependent impedance. Every wave in this file travels undistorted and
 * arrives at full amplitude. That is wrong for a real board at multi-gigabit rates
 * and it is the subject of Module 4; separating the two is the only way a reader
 * can tell which features of a received waveform are reflections and which are
 * loss, because on a scope they arrive superimposed.
 *
 * Frequency-domain (ABCD or S-parameter) formulations were considered for the
 * primary model and rejected. A lossless line with a reflection coefficient of
 * magnitude one never decays, so any finite FFT window wraps the tail of the
 * ringing back onto its own start. The scattering formulation truncates
 * gracefully instead: stopping the simulation early loses the late bounces and
 * misrepresents none of the early ones.
 *
 * Derivations, sources and validity ranges: PHYSICS.md section 12.
 */

/** Speed of light in vacuum, m/s. Exact by the SI definition of the metre. */
export const SPEED_OF_LIGHT = 299_792_458;

/** The geometry of one uniform lossless line. */
export interface LineSpec {
  /** Characteristic impedance, ohms. */
  z0: number;
  /** Physical length, metres. */
  length: number;
  /** Propagation velocity as a fraction of c. */
  velocityFactor: number;
}

/** What is at each end of the line. */
export interface TerminationSpec {
  /** Driver output impedance, ohms, in series with an ideal voltage source. */
  sourceZ: number;
  /** Far-end resistance to ground, ohms. A large value stands in for an open. */
  loadZ: number;
  /** Far-end shunt capacitance, farads. Receiver input capacitance, or a stub. */
  loadC: number;
}

export type LinkSpec = LineSpec & TerminationSpec;

/* ------------------------------------------------------------- propagation */

/**
 * Propagation velocity, m/s.
 *
 * Stated as a fraction of c rather than derived from a permittivity, because that
 * is the number a stackup document gives and the number a TDR measures. The two
 * are related by `effectivePermittivity` below.
 */
export function propagationVelocity(velocityFactor: number): number {
  return velocityFactor * SPEED_OF_LIGHT;
}

/** One-way propagation delay, seconds. */
export function propagationDelay(line: LineSpec): number {
  return line.length / propagationVelocity(line.velocityFactor);
}

/**
 * Effective relative permittivity implied by a velocity factor: er_eff = 1/vf^2.
 *
 * For a stripline, every field line is in the dielectric and this is the bulk er.
 * For a microstrip, part of the field is in air, so the effective value is lower
 * than the laminate's - which is why a microstrip is faster than a stripline on
 * the same board, and why quoting "0.5c on FR-4" without saying which is sloppy.
 */
export function effectivePermittivity(velocityFactor: number): number {
  return 1 / (velocityFactor * velocityFactor);
}

/** The inverse: velocity factor from an effective permittivity. */
export function velocityFactorFromPermittivity(erEff: number): number {
  return 1 / Math.sqrt(erEff);
}

/**
 * Delay per unit length, s/m. The unit a stackup is actually specified in.
 *
 * 3.336 ps/mm in vacuum; about 6.7 ps/mm at a velocity factor of 0.5, which is the
 * "170 ps per inch" a layout engineer carries in their head.
 */
export function delayPerMetre(velocityFactor: number): number {
  return 1 / propagationVelocity(velocityFactor);
}

/**
 * Characteristic impedance of a lossless line from its per-unit-length inductance
 * (H/m) and capacitance (F/m): Z0 = sqrt(L'/C').
 *
 * The ratio of voltage to current in a single travelling wave. It has units of
 * ohms and dissipates nothing - no resistance appears in it - and it does not
 * depend on length, because both L' and C' are per metre.
 */
export function characteristicImpedance(inductancePerMetre: number, capacitancePerMetre: number): number {
  return Math.sqrt(inductancePerMetre / capacitancePerMetre);
}

/** Propagation velocity of a lossless line from the same two numbers: v = 1/sqrt(L'C'), m/s. */
export function velocityFromPerUnitLength(inductancePerMetre: number, capacitancePerMetre: number): number {
  return 1 / Math.sqrt(inductancePerMetre * capacitancePerMetre);
}

/* --------------------------------------------------------------- interfaces */

/**
 * Voltage reflection coefficient looking into `zTerm` from a line of `z0`.
 *
 * Gamma = (Z - Z0)/(Z + Z0). Open circuit gives +1, short gives -1, a matched
 * termination gives 0. The sign is the whole story at the bench: a positive
 * reflection means the far end is too high an impedance and the step overshoots,
 * a negative one means it is too low and the step sags.
 *
 * The two degenerate terminations are answered rather than divided: a genuine
 * open is +1 and a genuine short is -1, and both would otherwise come out of the
 * arithmetic as NaN. The Scenario itself models an open as a large finite
 * resistance, because a non-finite number in a job result is a defect by the rule
 * in `src/dsp/guard.ts`, but a caller reaching for Infinity should get physics
 * back and not a silent NaN.
 */
export function reflectionCoefficient(zTerm: number, z0: number): number {
  if (!Number.isFinite(zTerm)) return zTerm > 0 ? 1 : -1;
  const sum = zTerm + z0;
  return sum === 0 ? -1 : (zTerm - z0) / sum;
}

/**
 * The inverse, which is what a TDR does: Z = Z0 (1 + G)/(1 - G).
 *
 * Returns Infinity for G exactly 1, which the caller has to handle; every measured
 * coefficient is short of that, and `tdrImpedance` clamps before calling this.
 */
export function impedanceFromReflection(gamma: number, z0: number): number {
  return (z0 * (1 + gamma)) / (1 - gamma);
}

/**
 * Voltage launched into the line at t = 0, volts.
 *
 * The driver does not put its open-circuit voltage on the line. It sees the line's
 * characteristic impedance - not the far-end load, which it has not heard from yet
 * - so what starts down the trace is a resistive divider between the source
 * impedance and Z0. A 40 ohm driver into a 50 ohm line launches 5/9 of its swing,
 * and the rest arrives only after the far end has replied.
 */
export function launchVoltage(sourceVolts: number, sourceZ: number, z0: number): number {
  const sum = sourceZ + z0;
  return sum === 0 ? sourceVolts : (sourceVolts * z0) / sum;
}

/**
 * The voltage the far end settles at, volts.
 *
 * Once every wave has died away the line is just a wire, and the answer is the
 * divider between the source impedance and the load. It does not depend on Z0 at
 * all, which is worth seeing: the characteristic impedance decides the journey,
 * not the destination.
 */
export function steadyStateVoltage(sourceVolts: number, sourceZ: number, loadZ: number): number {
  const sum = sourceZ + loadZ;
  return sum === 0 ? 0 : (sourceVolts * loadZ) / sum;
}

/**
 * The length at which a trace has to be treated as a transmission line, metres.
 *
 * There is no sharp threshold, and anyone who quotes one without saying which
 * fraction they used has hidden a factor of five. The criterion is a comparison
 * between the round-trip delay and the edge rate: if the reflection returns while
 * the edge is still moving, it blends into the edge and the trace behaves like a
 * lump; if it returns afterwards, it is a separate, visible event.
 *
 * Published rules of thumb put the boundary at a one-way delay of t_r/2, t_r/4,
 * t_r/6 and t_r/10 depending on how much distortion the author will tolerate.
 * `fraction` is that choice, defaulting to 1/6, and M3 exposes it so the reader
 * can see the rule is a judgement rather than a law.
 */
export function criticalLength(riseTime: number, velocityFactor: number, fraction = 1 / 6): number {
  return fraction * riseTime * propagationVelocity(velocityFactor);
}

/** One-way delay as a fraction of the rise time. Above about 1/3, reflections separate. */
export function electricalLengthRatio(line: LineSpec, riseTime: number): number {
  return riseTime > 0 ? propagationDelay(line) / riseTime : Infinity;
}

/* ----------------------------------------------------------- bounce diagram */

/** One event on the lattice: a wave arriving at an end, and what leaves in reply. */
export interface BounceEvent {
  /** Which end this happens at. */
  end: 'near' | 'far';
  /** Time of the event, seconds. Zero for the launch. */
  time: number;
  /** Amplitude of the wave arriving, volts. Zero for the launch itself. */
  incident: number;
  /** Amplitude of the wave leaving in reply, volts. */
  departing: number;
  /** Total voltage at that end just after this event, volts. */
  level: number;
}

export interface BounceSpec extends LineSpec {
  sourceZ: number;
  loadZ: number;
  /** Open-circuit step amplitude of the source, volts. */
  amplitude: number;
}

export interface BounceDiagram {
  events: readonly BounceEvent[];
  /** One-way delay, seconds. */
  delay: number;
  /** Reflection coefficient at the driver. */
  gammaSource: number;
  /** Reflection coefficient at the load. */
  gammaLoad: number;
  /** The first wave down the line, volts. */
  launch: number;
  /** Where both ends end up, volts. */
  steadyState: number;
  /** Near-end voltage after the last event included, volts. */
  nearFinal: number;
  /** Far-end voltage after the last event included, volts. */
  farFinal: number;
  /** How far from `steadyState` the truncated series still is, volts. */
  truncationError: number;
}

/**
 * The reflection lattice for a step into a resistively terminated line.
 *
 * Exact, closed form, and resistive only - the moment a reactance is present the
 * reflected wave is a function of time rather than a number, and the lattice stops
 * being a set of steps. Use `simulateLine` for that case; this one exists because
 * it is the picture a reader can draw by hand, and because a closed form is the
 * right thing to test a time-stepper against.
 *
 * `bounces` counts round trips. Each contributes two events, one at each end, so
 * the returned list has 1 + 2*bounces entries including the launch.
 */
export function bounceDiagram(spec: BounceSpec, bounces: number): BounceDiagram {
  const td = propagationDelay(spec);
  const gammaSource = reflectionCoefficient(spec.sourceZ, spec.z0);
  const gammaLoad = reflectionCoefficient(spec.loadZ, spec.z0);
  const launch = launchVoltage(spec.amplitude, spec.sourceZ, spec.z0);
  const trips = Math.max(1, Math.floor(bounces));

  const events: BounceEvent[] = [{ end: 'near', time: 0, incident: 0, departing: launch, level: launch }];

  let near = launch;
  let far = 0;
  let travelling = launch;

  for (let k = 0; k < 2 * trips; k++) {
    const atFar = k % 2 === 0;
    const gamma = atFar ? gammaLoad : gammaSource;
    const incident = travelling;
    const departing = gamma * incident;
    // Both the arriving wave and the one leaving are present at the interface, so
    // the node moves by the sum of the two, not by the incident alone. This is why
    // an open far end doubles the step rather than merely holding it.
    if (atFar) {
      far += incident + departing;
    } else {
      near += incident + departing;
    }
    events.push({
      end: atFar ? 'far' : 'near',
      time: (k + 1) * td,
      incident,
      departing,
      level: atFar ? far : near,
    });
    travelling = departing;
  }

  const steadyState = steadyStateVoltage(spec.amplitude, spec.sourceZ, spec.loadZ);

  return {
    events,
    delay: td,
    gammaSource,
    gammaLoad,
    launch,
    steadyState,
    nearFinal: near,
    farFinal: far,
    truncationError: Math.max(Math.abs(near - steadyState), Math.abs(far - steadyState)),
  };
}

/**
 * The staircase evaluated at an arbitrary time, volts.
 *
 * Right-continuous: at exactly the arrival time the step has already happened,
 * which matches how the events are defined and how a scope of infinite bandwidth
 * would record it. Before the launch the line is at zero.
 */
export function bounceVoltageAt(diagram: BounceDiagram, end: 'near' | 'far', t: number): number {
  let v = 0;
  for (const e of diagram.events) {
    if (e.end !== end) continue;
    if (e.time > t) break;
    v = e.level;
  }
  return v;
}

/* ---------------------------------------------------------------- simulator */

export interface SimulationResult {
  /** Time, seconds, starting at zero. */
  t: Float64Array;
  /** Voltage at the driver pin, volts. */
  near: Float64Array;
  /** Voltage at the receiver pad, volts. */
  far: Float64Array;
  /** Sample interval, seconds. */
  dt: number;
  /** One-way delay actually simulated, seconds: an exact multiple of dt. */
  delay: number;
  /** That delay in samples. At least one. */
  delaySamples: number;
  /** Reflection coefficient at the driver. */
  gammaSource: number;
  /** Reflection coefficient at the load resistance alone, ignoring its capacitance. */
  gammaLoad: number;
  /** Fraction of the source voltage that starts down the line. */
  launchFraction: number;
}

/**
 * Step a lossless line forward in time, driven by an arbitrary source waveform.
 *
 * The line is represented by its two travelling waves rather than by its voltage
 * and current, which is what makes this exact rather than an approximation. On a
 * lossless line a wave travels undistorted, so the only thing the line does to it
 * is delay it, and a delay of an integer number of samples is a ring buffer. All
 * of the physics is at the two ends.
 *
 * Near end, with V = a + b and I = (a - b)/Z0 into the line, and a source Vs
 * behind Zs:
 *
 *     a = Vs*Z0/(Z0 + Zs) + Gs*b,    Gs = (Zs - Z0)/(Zs + Z0)
 *
 * which is the launch divider plus whatever came back, re-reflected. Far end, with
 * R and C in parallel:
 *
 *     C dV/dt = 2a/Z0 - V*(1/Z0 + 1/R)
 *
 * a first-order equation with an exact solution under a zero-order hold on the
 * incident wave, so the time step is not limited by the RC constant:
 *
 *     V[n+1] = Vinf + (V[n] - Vinf) exp(-dt/tau),   tau = C*(R || Z0),
 *     Vinf = 2a*(R || Z0)/Z0
 *
 * With C = 0 this collapses to V = a(1 + GL) applied instantly, which is the
 * bounce diagram, and the tests assert the two agree to floating point.
 *
 * `sourceVolts` is the open-circuit voltage of the driver, sampled at `dt`. It is
 * the caller's job to have band-limited it - M3 passes an edge shaped by
 * `applyResponse`, so what is launched has a real rise time rather than being a
 * mathematical step.
 *
 * Accuracy, stated plainly. With `loadC` zero the whole scheme is exact: every end
 * relation is algebraic, the delay is an integer number of samples, and the result
 * equals the bounce diagram to floating point. With `loadC` above zero the far-end
 * node voltage is still exact under the zero-order hold, but the wave sent back up
 * the line is that voltage sampled at the start of each interval rather than
 * averaged across it, so what returns to the driver is first-order accurate in
 * `dt` and converges as the sample rate rises. At the sample rates M3 uses - a
 * hundred or more samples per delay, with an edge spanning many of them - that
 * error is far below the line widths it is drawn with, but it is an error and not
 * a rounding.
 */
export function simulateLine(spec: LinkSpec, sourceVolts: ArrayLike<number>, dt: number): SimulationResult {
  const n = sourceVolts.length;
  const td = propagationDelay(spec);
  // At least one sample of delay: a zero-delay line is not a line, and a ring
  // buffer of length zero is an algebraic loop. The caller picks dt from the
  // delay, so this only bites on a degenerately short line.
  const m = Math.max(1, Math.round(td / dt));

  const gammaSource = reflectionCoefficient(spec.sourceZ, spec.z0);
  const gammaLoad = reflectionCoefficient(spec.loadZ, spec.z0);
  const divider = spec.sourceZ + spec.z0 === 0 ? 1 : spec.z0 / (spec.sourceZ + spec.z0);

  // R in parallel with Z0: the resistance the far-end capacitor charges through.
  // It is not R alone, because the line itself sources current into the node.
  const rPar = (spec.loadZ * spec.z0) / (spec.loadZ + spec.z0);
  const tau = spec.loadC * rPar;
  const decay = tau > 0 ? Math.exp(-dt / tau) : 0;
  const reactive = tau > 0;

  const toFar = new Float64Array(m);
  const toNear = new Float64Array(m);
  let p = 0;

  const t = new Float64Array(n);
  const near = new Float64Array(n);
  const far = new Float64Array(n);

  // Far-end node voltage, carried between steps. A capacitor cannot change
  // instantaneously, so this is state; with no capacitor it is not.
  let vFar = 0;

  for (let i = 0; i < n; i++) {
    const b1 = toNear[p]; // left the far end m samples ago
    const a2 = toFar[p]; // left the near end m samples ago

    const a1 = sourceVolts[i] * divider + gammaSource * b1;
    const v1 = a1 + b1;

    let v2: number;
    let b2: number;
    if (reactive) {
      // The node cannot jump, so the voltage now is the state and the reflected
      // wave is whatever continuity demands. At the instant a wave arrives at an
      // uncharged capacitor that is b = -a: a capacitor looks like a short.
      v2 = vFar;
      b2 = v2 - a2;
      const vInf = (2 * a2 * rPar) / spec.z0;
      vFar = vInf + (v2 - vInf) * decay;
    } else {
      v2 = a2 * (1 + gammaLoad);
      b2 = gammaLoad * a2;
      vFar = v2;
    }

    t[i] = i * dt;
    near[i] = v1;
    far[i] = v2;

    toFar[p] = a1;
    toNear[p] = b2;
    p = p + 1 === m ? 0 : p + 1;
  }

  return {
    t,
    near,
    far,
    dt,
    delay: m * dt,
    delaySamples: m,
    gammaSource,
    gammaLoad,
    launchFraction: launchVoltage(1, spec.sourceZ, spec.z0),
  };
}

/* ---------------------------------------------------------------------- TDR */

/**
 * The reflection coefficient a TDR displays, as a function of time: rho(t).
 *
 * A TDR instrument has a matched source: an ideal step behind a resistance equal
 * to its reference impedance, usually 50 ohms. Into its own reference that source
 * would put exactly half its open-circuit voltage on the line, so the incident
 * wave at every instant is `source/2`, whatever the device under test does.
 * Anything at the instrument port beyond that is reflected, and dividing by the
 * final height of the incident step makes it a coefficient:
 *
 *     rho(t) = (Vport(t) - Vs(t)/2) / (Vstep/2)
 *
 * Subtracting the instantaneous incident wave rather than its final value is what
 * keeps the display flat through the launched edge itself. Before the step, and
 * while nothing has come back, rho is zero - the trace sits at the reference
 * impedance, which on a real instrument is the cable.
 */
export function tdrReflection(
  port: ArrayLike<number>,
  source: ArrayLike<number>,
  stepVolts: number,
): Float64Array {
  const out = new Float64Array(port.length);
  const incident = stepVolts / 2;
  for (let i = 0; i < port.length; i++) {
    out[i] = incident === 0 ? 0 : (port[i] - source[i] / 2) / incident;
  }
  return out;
}

/**
 * Turn a reflection-coefficient trace into an apparent impedance profile, ohms.
 *
 * This is the second half of what a TDR does, and it is worth being precise about
 * what it assumes. Each coefficient from `tdrReflection` is inverted through
 * Z = Zref(1 + rho)/(1 - rho), as if it had come from a single interface with the
 * reference impedance on the near side.
 *
 * The inversion is exact for the first discontinuity and an approximation for
 * everything after it, because a later reflection rides on a wave that has already
 * been modified by the earlier one. A real TDR display is therefore trustworthy
 * near the front and increasingly a cartoon further in - which is why impedance is
 * measured on a coupon with one discontinuity rather than read off the middle of a
 * complicated board.
 *
 * `gammaClamp` bounds the coefficient away from +/-1 so an open circuit maps to a
 * large impedance rather than to Infinity, which would fail the finite-value guard
 * and, more to the point, cannot be plotted.
 */
export function tdrImpedance(rho: ArrayLike<number>, zRef: number, gammaClamp = 0.999): Float64Array {
  const out = new Float64Array(rho.length);
  const clamp = Math.min(Math.abs(gammaClamp), 0.999999);
  for (let i = 0; i < rho.length; i++) {
    const bounded = Math.min(clamp, Math.max(-clamp, rho[i]));
    out[i] = impedanceFromReflection(bounded, zRef);
  }
  return out;
}

/**
 * What a TDR reads for the second of two discontinuities, as a reflection coefficient.
 *
 * The instrument launches into a section whose interface with it reflects gamma1.
 * Only (1 + gamma1) of the step gets in; the far interface reflects gamma2 of that;
 * and only (1 - gamma1) of the returning wave gets back out, because crossing the
 * same interface in the other direction has coefficient -gamma1. The instrument
 * adds that to the gamma1 it is already displaying:
 *
 *     rho = gamma1 + (1 + gamma1)(1 - gamma1) gamma2 = gamma1 + (1 - gamma1^2) gamma2
 *
 * and inverts rho as though it came from a single interface against the reference.
 * Valid for the first arrival from the second interface, before the re-reflection
 * between the two returns one round trip of the section later.
 */
export function apparentSecondReflection(gamma1: number, gamma2: number): number {
  return gamma1 + (1 - gamma1 * gamma1) * gamma2;
}

/**
 * Distance along the line a TDR event at time `t` corresponds to, metres.
 *
 * Half the round trip, because the wave went out and came back. Getting this
 * factor of two wrong is the classic TDR mistake, and it doubles every reported
 * distance.
 */
export function tdrDistance(t: number, velocityFactor: number): number {
  return (propagationVelocity(velocityFactor) * t) / 2;
}

/**
 * The voltage a step of amplitude A reflects from a parallel RC load, volts.
 *
 * Closed form, used to check the simulator's far end: at the instant of arrival
 * the capacitor is a short and the reflection is -A; it then relaxes towards the
 * resistive value A*GR with time constant C*(R || Z0).
 *
 *     Vref(t) = A [ GR - (1 + GR) exp(-t/tau) ]
 *
 * This is why a receiver's input capacitance shows up as a downward notch at the
 * far end even when the termination resistor is perfect: for the first few
 * picoseconds the termination is not a resistor.
 */
export function rcLoadReflection(
  amplitude: number,
  t: number,
  z0: number,
  loadZ: number,
  loadC: number,
): number {
  const gr = reflectionCoefficient(loadZ, z0);
  const rPar = (loadZ * z0) / (loadZ + z0);
  const tau = loadC * rPar;
  if (tau <= 0) return amplitude * gr;
  return amplitude * (gr - (1 + gr) * Math.exp(-t / tau));
}
