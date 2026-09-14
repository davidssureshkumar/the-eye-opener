/**
 * Filling the gaps in a measured transfer, checked on a pure delay, whose every
 * value is known, and the causality screen checked on a causal lossy line, the same
 * line with its phase conjugated, and with its phase thrown away.
 */

import { describe, expect, it } from 'vitest';
import { prepareLine, sParametersAt, type LossyLineSpec } from '../../channel/lossy';
import { linearSweep } from '../examples';
import { impulseOf, transferInterpolant, unwrappedPhase } from '../to-impulse';

const LINE: LossyLineSpec = {
  z0: 50,
  length: 0.25,
  er: 4,
  lossTangent: 0.02,
  referenceFreq: 1e9,
  dielectricLossEnabled: true,
  conductorLossEnabled: true,
  conductivity: 5.8e7,
  traceWidth: 100e-6,
  thickness: 35e-6,
  roughnessEnabled: true,
  roughnessModel: 'hammerstad',
  roughnessRms: 0.5e-6,
  hurayRadius: 0.5e-6,
  hurayRatio: 1.5,
  viaCount: 0,
  viaC: 0,
};

function delay(freq: Float64Array, tau: number, gain = 1) {
  const re = freq.map((f) => gain * Math.cos(2 * Math.PI * f * tau));
  const im = freq.map((f) => -gain * Math.sin(2 * Math.PI * f * tau));
  return { re, im };
}

describe('unwrappedPhase', () => {
  it('follows a delay through many turns and reports the step', () => {
    const freq = linearSweep(10e6, 2000);
    const tau = 1.3e-9;
    const { re, im } = delay(freq, tau);
    const { phase, maxStep } = unwrappedPhase(re, im);
    expect(phase[1999] - phase[0]).toBeCloseTo(-2 * Math.PI * (freq[1999] - freq[0]) * tau, 6);
    expect(maxStep).toBeCloseTo(2 * Math.PI * 10e6 * tau, 9);
  });
});

describe('transferInterpolant', () => {
  const freq = linearSweep(10e6, 2000);
  const tau = 1.3e-9;
  const { re, im } = delay(freq, tau, 0.8);
  const t = transferInterpolant(freq, re, im, { taper: 0.2 });

  it('reproduces a delay between samples, below the first and at DC', () => {
    for (const f of [0, 3e6, 12.345e6, 7.77e9, 19.99e9]) {
      const v = t.at(f);
      expect(v.re).toBeCloseTo(0.8 * Math.cos(2 * Math.PI * f * tau), 4);
      expect(v.im).toBeCloseTo(-0.8 * Math.sin(2 * Math.PI * f * tau), 4);
    }
    expect(t.dcPhaseResidual).toBeCloseTo(0, 9);
    expect(t.inverting).toBe(false);
    expect(t.sweepDelay).toBeCloseTo(tau, 15);
  });

  it('rolls off above the sweep, keeps the delay, and is conjugate at negative frequency', () => {
    const f = 20e9 * 1.1;
    const v = t.at(f);
    expect(Math.hypot(v.re, v.im)).toBeCloseTo(0.4, 9);
    expect(Math.atan2(v.im, v.re)).toBeCloseTo(
      Math.atan2(-Math.sin(2 * Math.PI * f * tau), Math.cos(2 * Math.PI * f * tau)),
      6,
    );
    expect(t.at(24.1e9)).toEqual({ re: 0, im: 0 });
    const neg = t.at(-5e9);
    const pos = t.at(5e9);
    expect(neg.re).toBe(pos.re);
    expect(neg.im).toBe(-pos.im);
  });

  it('finds an inverting path and the branch of a phase that starts several turns off', () => {
    const inv = delay(freq, tau, -0.5);
    const ti = transferInterpolant(freq, inv.re, inv.im);
    expect(ti.inverting).toBe(true);
    expect(Math.abs(ti.dcPhaseResidual)).toBeLessThan(1e-9);
    expect(ti.at(0).re).toBeCloseTo(-0.5, 9);
  });

  it('flags a sweep too coarse for the delay, by its median step', () => {
    const coarse = linearSweep(200e6, 50);
    const d = delay(coarse, tau);
    const tc = transferInterpolant(coarse, d.re, d.im);
    expect(tc.medianPhaseStep).toBeCloseTo(2 * Math.PI * 200e6 * tau, 9);
    expect(tc.medianPhaseStep).toBeGreaterThan(Math.PI / 2);
  });

  it('does not take the null of a skewed pair for a coarse sweep', () => {
    // (e^{-j w tP} + e^{-j w tN}) / 2 = e^{-j w tau} cos(w skew / 2): a real zero at
    // 1 / (2 skew), where the phase jumps by pi between two fine samples.
    const skew = 55e-12;
    const re = freq.map((f) => Math.cos(2 * Math.PI * f * tau) * Math.cos(Math.PI * f * skew));
    const im = freq.map((f) => -Math.sin(2 * Math.PI * f * tau) * Math.cos(Math.PI * f * skew));
    const tn = transferInterpolant(freq, re, im);
    expect(tn.maxPhaseStep).toBeGreaterThan(Math.PI / 2);
    expect(tn.medianPhaseStep).toBeCloseTo(2 * Math.PI * 10e6 * tau, 9);
  });
});

describe('impulseOf and the causality screen', () => {
  const freq = linearSweep(10e6, 3000);
  const line = prepareLine(LINE);
  const s21 = Array.from(freq, (f) => sParametersAt(line, f).s21);
  const re = Float64Array.from(s21, (s) => s.re);
  const im = Float64Array.from(s21, (s) => s.im);

  it('puts a pure delay at its delay with no pre-response', () => {
    const d = delay(freq, 1e-9);
    const r = impulseOf(transferInterpolant(freq, d.re, d.im));
    let peak = 0;
    for (let i = 0; i < r.h.length; i++) if (Math.abs(r.h[i]) > Math.abs(r.h[peak])) peak = i;
    expect(peak * r.dt).toBeCloseTo(1e-9, 11);
    expect(r.preResponseEnergy).toBeLessThan(1e-8);
  });

  it('passes the causal line and flags its conjugate and its magnitude alone', () => {
    const causal = impulseOf(transferInterpolant(freq, re, im));
    expect(causal.preResponseEnergy).toBeLessThan(1e-7);
    expect(causal.acausal).toBe(false);
    const conj = impulseOf(
      transferInterpolant(
        freq,
        re,
        im.map((x) => -x),
      ),
    );
    expect(conj.preResponseEnergy).toBeGreaterThan(0.5);
    expect(conj.acausal).toBe(true);
    const mag = re.map((x, k) => Math.hypot(x, im[k]));
    const magOnly = impulseOf(transferInterpolant(freq, mag, new Float64Array(freq.length)));
    expect(magOnly.acausal).toBe(true);
    // Symmetric: about as much before as after.
    expect(magOnly.preResponseEnergy / magOnly.postResponseEnergy).toBeGreaterThan(0.5);
  });

  it('flags nothing for a delay that sits inside the guard, where no judgement is possible', () => {
    const d = delay(freq, 1e-12);
    expect(impulseOf(transferInterpolant(freq, d.re, d.im)).acausal).toBe(false);
  });
});
