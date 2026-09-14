/**
 * Complex helpers, against identities that do not depend on how they are written.
 */

import { describe, expect, it } from 'vitest';
import { cAdd, cConj, cExpz, cLog, cMul, cScale, cSqrt, cSub, cx, type Complex } from '../complex';

function close(a: Complex, b: Complex, tol = 1e-12): void {
  expect(Math.abs(a.re - b.re)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b.re)));
  expect(Math.abs(a.im - b.im)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b.im)));
}

const SAMPLES: Complex[] = [
  cx(4, 0),
  cx(-4, 0),
  cx(0, 2),
  cx(0, -2),
  cx(3, 4),
  cx(-3, 4),
  cx(-3, -4),
  cx(3, -4),
  cx(-1e6, 1e-9),
  cx(-1e6, -1e-9),
  cx(1e-300, 1e-300),
];

describe('complex arithmetic', () => {
  it('adds, subtracts, scales and conjugates', () => {
    close(cAdd(cx(1, 2), cx(3, -5)), cx(4, -3));
    close(cSub(cx(1, 2), cx(3, -5)), cx(-2, 7));
    close(cScale(cx(1, -2), -3), cx(-3, 6));
    close(cConj(cx(1, -2)), cx(1, 2));
  });

  it.each(SAMPLES.map((z) => [`${z.re}${z.im >= 0 ? '+' : ''}${z.im}j`, z] as const))(
    'the square root of %s squares back and lies in the right half-plane',
    (_name, z) => {
      const r = cSqrt(z);
      expect(r.re).toBeGreaterThanOrEqual(0);
      close(cMul(r, r), z, 1e-9);
    },
  );

  it('keeps the sign of a tiny imaginary part next to a large negative real part', () => {
    expect(cSqrt(cx(-1e6, 1e-9)).im).toBeGreaterThan(0);
    expect(cSqrt(cx(-1e6, -1e-9)).im).toBeLessThan(0);
    close(cSqrt(cx(-4, 0)), cx(0, 2));
    close(cSqrt(cx(0, 0)), cx(0, 0));
  });

  it('exp and log are inverse, with the principal branch', () => {
    close(cExpz(cx(0, Math.PI)), cx(-1, 0));
    close(cLog(cx(-1, 0)), cx(0, Math.PI));
    for (const z of SAMPLES.slice(0, 8)) close(cExpz(cLog(z)), z, 1e-12);
    const l = cLog(cx(-1, -1e-12));
    expect(l.im).toBeLessThan(0);
    expect(l.im).toBeGreaterThan(-Math.PI - 1e-9);
  });
});
