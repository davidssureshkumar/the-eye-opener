/**
 * The network data model, checked against closed forms.
 *
 * The inverse against its definition, the change of reference against a series
 * resistor whose S-parameters are known in any reference, the largest singular
 * value against matrices whose singular values can be written down, and reciprocity
 * against a matrix built to break it by a known amount.
 */

import { describe, expect, it } from 'vitest';
import {
  dbOf,
  emptyNetwork,
  identity,
  matInverse,
  matMul,
  maxSingularValue,
  reciprocityError,
  renormalize,
  sAt,
  setS,
  type CMatrix,
} from '../network';

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

function randomMatrix(n: number, seed: number): CMatrix {
  const r = random(seed);
  const m: CMatrix = { n, re: new Float64Array(n * n), im: new Float64Array(n * n) };
  for (let i = 0; i < n * n; i++) {
    m.re[i] = r();
    m.im[i] = r();
  }
  return m;
}

/** Series resistor R between ports with reference Z: S11 = R/(R+2Z), S21 = 2Z/(R+2Z). */
function seriesResistor(r: number, z: number, freqs = 3) {
  const net = emptyNetwork(
    2,
    Float64Array.from({ length: freqs }, (_, k) => 1e9 * (k + 1)),
    z,
  );
  for (let k = 0; k < freqs; k++) {
    const s11 = r / (r + 2 * z);
    const s21 = (2 * z) / (r + 2 * z);
    setS(net, k, 0, 0, { re: s11, im: 0 });
    setS(net, k, 1, 1, { re: s11, im: 0 });
    setS(net, k, 1, 0, { re: s21, im: 0 });
    setS(net, k, 0, 1, { re: s21, im: 0 });
  }
  return net;
}

describe('matInverse', () => {
  it('gives the identity when multiplied by the original', () => {
    for (const n of [1, 2, 4, 7, 12]) {
      const a = randomMatrix(n, n * 17);
      const p = matMul(a, matInverse(a));
      const eye = identity(n);
      for (let i = 0; i < n * n; i++) {
        expect(p.re[i]).toBeCloseTo(eye.re[i], 10);
        expect(p.im[i]).toBeCloseTo(0, 10);
      }
    }
  });

  it('needs pivoting on a matrix with a zero leading entry', () => {
    const a: CMatrix = { n: 2, re: Float64Array.from([0, 1, 1, 0]), im: new Float64Array(4) };
    const inv = matInverse(a);
    expect(Array.from(inv.re)).toEqual([0, 1, 1, 0]);
  });

  it('refuses a singular matrix', () => {
    const a: CMatrix = { n: 2, re: Float64Array.from([1, 2, 2, 4]), im: new Float64Array(4) };
    expect(() => matInverse(a)).toThrow(/singular/);
  });
});

describe('renormalize', () => {
  it('matches the closed form of a series resistor in the new reference', () => {
    const r = 30;
    const moved = renormalize(seriesResistor(r, 50), 75);
    const expected = seriesResistor(r, 75);
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          expect(sAt(moved, k, i, j).re).toBeCloseTo(sAt(expected, k, i, j).re, 12);
          expect(sAt(moved, k, i, j).im).toBeCloseTo(0, 12);
        }
      }
    }
    expect(Array.from(moved.reference)).toEqual([75, 75]);
  });

  it('turns a 50 ohm thru into the reflection of a mismatch, per port', () => {
    const thru = seriesResistor(0, 50);
    const moved = renormalize(thru, [50, 100]);
    // A direct connection of a 50 ohm reference to a 100 ohm one.
    const gamma = (100 - 50) / (100 + 50);
    expect(sAt(moved, 0, 0, 0).re).toBeCloseTo(gamma, 12);
    expect(sAt(moved, 0, 1, 1).re).toBeCloseTo(-gamma, 12);
    expect(sAt(moved, 0, 1, 0).re).toBeCloseTo(Math.sqrt(1 - gamma * gamma), 12);
  });

  it('round-trips a random complex network', () => {
    const net = emptyNetwork(4, Float64Array.from([1e9, 2e9]), 50);
    const r = random(5);
    for (let i = 0; i < net.re.length; i++) {
      net.re[i] = 0.3 * r();
      net.im[i] = 0.3 * r();
    }
    const back = renormalize(renormalize(net, [40, 60, 75, 100]), 50);
    for (let i = 0; i < net.re.length; i++) {
      expect(back.re[i]).toBeCloseTo(net.re[i], 12);
      expect(back.im[i]).toBeCloseTo(net.im[i], 12);
    }
  });

  it('copies rather than aliases when the reference is unchanged', () => {
    const net = seriesResistor(10, 50);
    const same = renormalize(net, 50);
    same.re[0] = 99;
    expect(net.re[0]).not.toBe(99);
  });
});

describe('maxSingularValue', () => {
  it('is 1 for a lossless delayed thru and scales with gain', () => {
    const th = 1.234;
    const m: CMatrix = {
      n: 2,
      re: Float64Array.from([0, Math.cos(th), Math.cos(th), 0]),
      im: Float64Array.from([0, -Math.sin(th), -Math.sin(th), 0]),
    };
    expect(maxSingularValue(m)).toBeCloseTo(1, 6);
    for (let i = 0; i < 4; i++) {
      m.re[i] *= 1.05;
      m.im[i] *= 1.05;
    }
    expect(maxSingularValue(m)).toBeCloseTo(1.05, 6);
  });

  it('picks the largest entry of a diagonal matrix, and the largest of a repeated one', () => {
    const d: CMatrix = { n: 3, re: new Float64Array(9), im: new Float64Array(9) };
    d.re[0] = 0.2;
    d.im[4] = -0.9;
    d.re[8] = 0.5;
    expect(maxSingularValue(d)).toBeCloseTo(0.9, 6);
    const eye = identity(12);
    expect(maxSingularValue(eye)).toBeCloseTo(1, 6);
  });

  it('agrees with the closed form of a real 2 by 2', () => {
    // Singular values of [[a, b], [0, c]] from the eigenvalues of its Gram matrix.
    const a = 0.7;
    const b = 0.4;
    const c = 0.2;
    const tr = a * a + b * b + c * c;
    const det = a * a * c * c;
    const expected = Math.sqrt((tr + Math.sqrt(tr * tr - 4 * det)) / 2);
    const m: CMatrix = { n: 2, re: Float64Array.from([a, b, 0, c]), im: new Float64Array(4) };
    expect(maxSingularValue(m)).toBeCloseTo(expected, 6);
  });

  it('is zero for a zero matrix', () => {
    expect(maxSingularValue({ n: 2, re: new Float64Array(4), im: new Float64Array(4) })).toBe(0);
  });
});

describe('reciprocityError and dbOf', () => {
  it('measures the largest departure from symmetry', () => {
    const net = seriesResistor(20, 50, 1);
    expect(reciprocityError(net, 0)).toBe(0);
    setS(net, 0, 0, 1, { re: sAt(net, 0, 1, 0).re + 0.03, im: 0.04 });
    expect(reciprocityError(net, 0)).toBeCloseTo(0.05, 12);
  });

  it('converts to decibels with a floor', () => {
    expect(dbOf(0.1, 0)).toBeCloseTo(-20, 12);
    expect(dbOf(0, 0)).toBe(-300);
  });
});
