/**
 * Port wiring, the mixed-mode conversion and the two synthetic networks, against
 * closed forms: the cosine and sine of a skewed pair, the odd mode of a coupled
 * pair, the orthogonality of the change of basis, and exact passivity.
 */

import { describe, expect, it } from 'vitest';
import { prepareLine, sParametersAt, type LossyLineSpec } from '../../channel/lossy';
import { SPEED_OF_LIGHT } from '../../channel/tline';
import {
  COUPLING_DEFAULTS,
  coupledPairNetwork,
  linearSweep,
  meanGlassFraction,
  modalImpedances,
  normalizedSinc,
  WEAVE_DEFAULTS,
  weaveLegs,
  weavePairNetwork,
  type WeaveSpec,
} from '../examples';
import { channelView, detectTopology, mixedModeMatrix, modalTransfer } from '../mixed-mode';
import { emptyNetwork, matrixAt, maxSingularValue, reciprocityError, setS, type Network } from '../network';

const LINE: LossyLineSpec = {
  z0: 50,
  length: 0.2,
  er: 4,
  lossTangent: 0.015,
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

const LOSSLESS: LossyLineSpec = { ...LINE, dielectricLossEnabled: false, conductorLossEnabled: false };

/** Swap port labels: new port perm[i] is old port i. */
function permute(net: Network, perm: number[]): Network {
  const out = emptyNetwork(net.ports, net.freq);
  const n = net.ports;
  for (let k = 0; k < net.freq.length; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const o = (k * n + i) * n + j;
        setS(out, k, perm[i], perm[j], { re: net.re[o], im: net.im[o] });
      }
    }
  }
  return out;
}

describe('detectTopology', () => {
  const freq = linearSweep(10e6, 40);
  const base = coupledPairNetwork(LINE, COUPLING_DEFAULTS, freq);

  it('finds 1-2 / 3-4 wiring and pairs the lines', () => {
    const t = detectTopology(base);
    expect(t.lines).toEqual([
      { input: 0, output: 1 },
      { input: 2, output: 3 },
    ]);
    expect(t.pairs.length).toBe(1);
    expect(t.pairs[0][0].input).toBe(0);
  });

  it('finds 1-3 / 2-4 wiring after relabelling, with P still the thru from port 1', () => {
    // Old ports (0,1,2,3) become (0,2,1,3): thrus 1-3 and 2-4.
    const t = detectTopology(permute(base, [0, 2, 1, 3]));
    expect(t.lines).toEqual([
      { input: 0, output: 2 },
      { input: 1, output: 3 },
    ]);
    expect(t.pairs[0][0]).toEqual({ input: 0, output: 2 });
  });

  it('handles an eight-port with two pairs, and leaves one port out of an odd count', () => {
    const net = emptyNetwork(8, Float64Array.from([1e7, 2e7]));
    for (let k = 0; k < 2; k++) {
      for (const [a, b] of [
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ]) {
        setS(net, k, a, b, { re: 0.9, im: 0 });
        setS(net, k, b, a, { re: 0.9, im: 0 });
      }
    }
    const t = detectTopology(net);
    expect(t.lines.map((l) => [l.input, l.output])).toEqual([
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ]);
    expect(t.pairs.length).toBe(2);
    const three = emptyNetwork(3, Float64Array.from([1e7, 2e7]));
    for (let k = 0; k < 2; k++) {
      setS(three, k, 0, 2, { re: 1, im: 0 });
      setS(three, k, 2, 0, { re: 1, im: 0 });
    }
    const t3 = detectTopology(three);
    expect(t3.unmatched).toBe(1);
    expect(t3.lines).toEqual([{ input: 0, output: 2 }]);
  });
});

describe('weave geometry', () => {
  it('averages the cosine over a width and a drift as the sinc closed form', () => {
    const w: WeaveSpec = { ...WEAVE_DEFAULTS, pitch: 1, glassMean: 0.5, glassSwing: 0.3 };
    const x = 0.17;
    const width = 0.4;
    const drift = 0.65;
    // Numerical double average of phi over the trace width and along the route.
    const steps = 400;
    let sum = 0;
    for (let a = 0; a < steps; a++) {
      const along = ((a + 0.5) / steps) * drift;
      for (let b = 0; b < steps; b++) {
        const across = ((b + 0.5) / steps - 0.5) * width;
        sum += w.glassMean + w.glassSwing * Math.cos(2 * Math.PI * (x + along + across));
      }
    }
    expect(meanGlassFraction(w, x, width, drift)).toBeCloseTo(sum / (steps * steps), 5);
    expect(normalizedSinc(1)).toBeCloseTo(0, 15);
  });

  it('removes the skew when the route drifts across a whole pitch', () => {
    const angled = weaveLegs(
      { ...WEAVE_DEFAULTS, angleDeg: (Math.asin(WEAVE_DEFAULTS.pitch / 0.2) * 180) / Math.PI },
      LINE,
    );
    expect(Math.abs(angled.skew)).toBeLessThan(1e-18);
    const straight = weaveLegs(WEAVE_DEFAULTS, LINE);
    expect(Math.abs(straight.skew)).toBeGreaterThan(1e-12);
    expect(straight.skew).toBeCloseTo(
      (LINE.length * (Math.sqrt(straight.dkP) - Math.sqrt(straight.dkN))) / SPEED_OF_LIGHT,
      20,
    );
    expect(straight.nullFrequency).toBeCloseTo(1 / (2 * Math.abs(straight.skew)), 0);
  });
});

describe('mixed-mode transfers of a skewed pair', () => {
  const freq = linearSweep(50e6, 400);
  const { network, legs } = weavePairNetwork(LOSSLESS, WEAVE_DEFAULTS, freq);
  const topology = detectTopology(network);
  const view = channelView(network, topology, 1, 2, true);

  it('picks the pair and reports the legs', () => {
    expect(view.mode).toBe('differential');
    expect([view.txPort, view.txPortN, view.rxPort, view.rxPortN]).toEqual([0, 2, 1, 3]);
  });

  it('follows |cos(pi f tau)| differentially and |sin(pi f tau)| in common mode', () => {
    const tau = legs.skew;
    const lineP = prepareLine({ ...LOSSLESS, er: legs.dkP });
    for (let k = 0; k < freq.length; k += 7) {
      const s21 = Math.hypot(sParametersAt(lineP, freq[k]).s21.re, sParametersAt(lineP, freq[k]).s21.im);
      const dd = Math.hypot(view.thru.re[k], view.thru.im[k]);
      const cd = Math.hypot(view.conversion!.re[k], view.conversion!.im[k]);
      expect(dd).toBeCloseTo(s21 * Math.abs(Math.cos(Math.PI * freq[k] * tau)), 9);
      expect(cd).toBeCloseTo(s21 * Math.abs(Math.sin(Math.PI * freq[k] * tau)), 9);
    }
  });

  it('keeps the singular values of the single-ended matrix', () => {
    for (const k of [0, 100, 399]) {
      const mm = mixedModeMatrix(network, k, [
        { p: 0, n: 2 },
        { p: 1, n: 3 },
      ]);
      expect(maxSingularValue(mm)).toBeCloseTo(maxSingularValue(matrixAt(network, k)), 6);
    }
  });
});

describe('the coupled pair', () => {
  const freq = linearSweep(100e6, 200);
  const net = coupledPairNetwork(LINE, COUPLING_DEFAULTS, freq);

  it('is reciprocal and passive', () => {
    for (let k = 0; k < freq.length; k += 11) {
      expect(reciprocityError(net, k)).toBeLessThan(1e-15);
      expect(maxSingularValue(matrixAt(net, k))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('has the odd mode as its differential transfer and no mode conversion', () => {
    const z = modalImpedances(LINE.z0, COUPLING_DEFAULTS.k);
    const odd = prepareLine({ ...LINE, z0: z.odd, er: LINE.er - COUPLING_DEFAULTS.modalSplit / 2 });
    const input = { p: 0, n: 2 };
    const output = { p: 1, n: 3 };
    for (let k = 0; k < freq.length; k += 13) {
      const dd = modalTransfer(net, k, output, input, 'd', 'd');
      const o = sParametersAt(odd, freq[k]).s21;
      expect(dd.re).toBeCloseTo(o.re, 12);
      expect(dd.im).toBeCloseTo(o.im, 12);
      const cd = modalTransfer(net, k, output, input, 'c', 'd');
      expect(Math.hypot(cd.re, cd.im)).toBeLessThan(1e-15);
    }
  });

  it('nearly cancels far-end crosstalk of a lossless pair with no modal split, and not near-end', () => {
    // With loss the modes attenuate differently (R / 2Z differs), which leaves some.
    const homogeneous = coupledPairNetwork(LOSSLESS, { k: 0.05, modalSplit: 0 }, freq);
    const split = coupledPairNetwork(LOSSLESS, { k: 0.05, modalSplit: 0.4 }, freq);
    const k = 100;
    const at = (n: Network, o: number, i: number) => {
      const x = (k * 4 + o) * 4 + i;
      return Math.hypot(n.re[x], n.im[x]);
    };
    expect(at(homogeneous, 3, 0)).toBeLessThan(0.1 * at(split, 3, 0));
    expect(at(homogeneous, 2, 0)).toBeGreaterThan(0.01);
  });

  it('classifies near-end and far-end paths in the single-ended view', () => {
    const view = channelView(net, detectTopology(net), 1, 2, false);
    expect(view.mode).toBe('single');
    const byPort = Object.fromEntries(view.aggressors.map((a) => [a.port, a.kind]));
    // Aggressor driven at port 3 (index 2, same end as the transmitter): far end at port 2.
    expect(byPort[2]).toBe('fext');
    expect(byPort[3]).toBe('next');
    expect(view.notes).toEqual([]);
    const coupled = channelView(net, detectTopology(net), 1, 3, false);
    expect(coupled.notes.some((n) => /not a through path/.test(n))).toBe(true);
  });
});
