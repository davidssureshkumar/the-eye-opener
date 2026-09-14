/**
 * Complex arithmetic on plain `{ re, im }` records.
 *
 * `filters.ts` has the four operations a rational transfer function needs. A
 * distributed line needs more: square roots for the propagation constant and the
 * characteristic impedance, exponentials of a complex argument for the section
 * matrices, and a logarithm for the wideband dielectric model. They live here
 * rather than in `filters.ts` so that file stays about filters.
 *
 * Every function returns a new record and none allocates more than that. Branches
 * are the principal ones, stated per function, because the physics depends on them:
 * the propagation constant must be the root with a non-negative real part or a
 * passive line would appear to grow.
 */

import type { Complex } from './filters';

export { cAbs, cDiv, cMul, type Complex } from './filters';

export function cx(re: number, im = 0): Complex {
  return { re, im };
}

export function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function cScale(a: Complex, k: number): Complex {
  return { re: a.re * k, im: a.im * k };
}

export function cConj(a: Complex): Complex {
  return { re: a.re, im: -a.im };
}

/**
 * Principal square root: the root with a non-negative real part, and a
 * non-negative imaginary part when the real part is zero.
 *
 * Computed without squaring the magnitude away, so a tiny imaginary part next to
 * a large negative real part keeps its sign rather than rounding to the wrong
 * half-plane.
 */
export function cSqrt(a: Complex): Complex {
  if (a.re === 0 && a.im === 0) return { re: 0, im: 0 };
  const m = Math.hypot(a.re, a.im);
  if (a.re >= 0) {
    const r = Math.sqrt(0.5 * (m + a.re));
    return { re: r, im: a.im / (2 * r) };
  }
  const i = Math.sqrt(0.5 * (m - a.re));
  const im = a.im < 0 ? -i : i;
  return { re: a.im / (2 * im), im };
}

/** e^z. */
export function cExpz(a: Complex): Complex {
  const e = Math.exp(a.re);
  return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) };
}

/** Principal natural logarithm: imaginary part in (-pi, pi]. */
export function cLog(a: Complex): Complex {
  return { re: Math.log(Math.hypot(a.re, a.im)), im: Math.atan2(a.im, a.re) };
}
