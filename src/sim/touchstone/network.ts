/**
 * A multiport network sampled in frequency: the data model every measured channel
 * on this site goes through.
 *
 * One layout serves a file read from disk and a network synthesised from a model,
 * so a figure never needs to know which it was given. The S-matrix at every
 * frequency is stored flat, row first, in two Float64Arrays, so a whole file moves
 * to a worker without being copied element by element and without a single object
 * per sample.
 *
 *   re[(k * N + i) * N + j] + j im[...]  =  S_{i+1, j+1} at freq[k]
 *
 * Indices in code are 0-based; port numbers shown to a reader are 1-based. Every
 * function here that takes a port takes it 0-based.
 *
 * The matrix operations are the few a channel needs and no more: products, an
 * inverse by Gauss-Jordan elimination with partial pivoting, a change of reference
 * impedance, the largest singular value for passivity, and the largest departure
 * from reciprocity. N is at most 12, so none of them needs to be clever.
 *
 * Physics: PHYSICS.md section 14.1.
 */

import type { Complex } from '../../dsp/complex';

export interface Network {
  /** Port count, N. */
  ports: number;
  /** Frequencies, Hz, strictly increasing. */
  freq: Float64Array;
  /** Real parts of S, length freq.length * N * N, row first. */
  re: Float64Array;
  /** Imaginary parts of S, same layout. */
  im: Float64Array;
  /** Reference impedance of each port, ohms, real and positive. */
  reference: Float64Array;
}

/** A square complex matrix, flat and row first. */
export interface CMatrix {
  n: number;
  re: Float64Array;
  im: Float64Array;
}

export function emptyNetwork(ports: number, freq: Float64Array, reference = 50): Network {
  const size = freq.length * ports * ports;
  return {
    ports,
    freq,
    re: new Float64Array(size),
    im: new Float64Array(size),
    reference: new Float64Array(ports).fill(reference),
  };
}

/** Offset of S_{i+1, j+1} at frequency index k. */
export function sIndex(net: Pick<Network, 'ports'>, k: number, i: number, j: number): number {
  return (k * net.ports + i) * net.ports + j;
}

export function sAt(net: Network, k: number, i: number, j: number): Complex {
  const o = sIndex(net, k, i, j);
  return { re: net.re[o], im: net.im[o] };
}

export function setS(net: Network, k: number, i: number, j: number, v: Complex): void {
  const o = sIndex(net, k, i, j);
  net.re[o] = v.re;
  net.im[o] = v.im;
}

/** S_{i+1, j+1} at every frequency, as two arrays. */
export function sColumn(net: Network, i: number, j: number): { re: Float64Array; im: Float64Array } {
  const nf = net.freq.length;
  const re = new Float64Array(nf);
  const im = new Float64Array(nf);
  for (let k = 0; k < nf; k++) {
    const o = sIndex(net, k, i, j);
    re[k] = net.re[o];
    im[k] = net.im[o];
  }
  return { re, im };
}

/** The S-matrix at frequency index k, copied. */
export function matrixAt(net: Network, k: number): CMatrix {
  const n = net.ports;
  const o = k * n * n;
  return { n, re: net.re.slice(o, o + n * n), im: net.im.slice(o, o + n * n) };
}

function zeros(n: number): CMatrix {
  return { n, re: new Float64Array(n * n), im: new Float64Array(n * n) };
}

export function identity(n: number): CMatrix {
  const m = zeros(n);
  for (let i = 0; i < n; i++) m.re[i * n + i] = 1;
  return m;
}

export function matMul(a: CMatrix, b: CMatrix): CMatrix {
  const n = a.n;
  const out = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const ar = a.re[i * n + k];
      const ai = a.im[i * n + k];
      if (ar === 0 && ai === 0) continue;
      for (let j = 0; j < n; j++) {
        const br = b.re[k * n + j];
        const bi = b.im[k * n + j];
        out.re[i * n + j] += ar * br - ai * bi;
        out.im[i * n + j] += ar * bi + ai * br;
      }
    }
  }
  return out;
}

/** Conjugate transpose. */
export function matAdjoint(a: CMatrix): CMatrix {
  const n = a.n;
  const out = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      out.re[j * n + i] = a.re[i * n + j];
      out.im[j * n + i] = -a.im[i * n + j];
    }
  }
  return out;
}

/**
 * Inverse by Gauss-Jordan elimination with partial pivoting. Throws on a matrix
 * whose pivot falls below 1e-300 in magnitude squared, which for the matrices this
 * site inverts (P + Q S with |Q| < |P| and S passive) cannot happen.
 */
export function matInverse(a: CMatrix): CMatrix {
  const n = a.n;
  const wr = Float64Array.from(a.re);
  const wi = Float64Array.from(a.im);
  const inv = identity(n);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    let best = wr[c * n + c] ** 2 + wi[c * n + c] ** 2;
    for (let r = c + 1; r < n; r++) {
      const m = wr[r * n + c] ** 2 + wi[r * n + c] ** 2;
      if (m > best) {
        best = m;
        pivot = r;
      }
    }
    if (!(best > 1e-300)) throw new Error('matInverse: singular matrix');
    if (pivot !== c) {
      for (let j = 0; j < n; j++) {
        const p = pivot * n + j;
        const q = c * n + j;
        [wr[p], wr[q]] = [wr[q], wr[p]];
        [wi[p], wi[q]] = [wi[q], wi[p]];
        [inv.re[p], inv.re[q]] = [inv.re[q], inv.re[p]];
        [inv.im[p], inv.im[q]] = [inv.im[q], inv.im[p]];
      }
    }
    // Scale the pivot row by 1 / pivot.
    const pr = wr[c * n + c] / best;
    const pi = -wi[c * n + c] / best;
    for (let j = 0; j < n; j++) {
      const o = c * n + j;
      let r = wr[o] * pr - wi[o] * pi;
      wi[o] = wr[o] * pi + wi[o] * pr;
      wr[o] = r;
      r = inv.re[o] * pr - inv.im[o] * pi;
      inv.im[o] = inv.re[o] * pi + inv.im[o] * pr;
      inv.re[o] = r;
    }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fr = wr[r * n + c];
      const fi = wi[r * n + c];
      if (fr === 0 && fi === 0) continue;
      for (let j = 0; j < n; j++) {
        const o = r * n + j;
        const s = c * n + j;
        wr[o] -= fr * wr[s] - fi * wi[s];
        wi[o] -= fr * wi[s] + fi * wr[s];
        inv.re[o] -= fr * inv.re[s] - fi * inv.im[s];
        inv.im[o] -= fr * inv.im[s] + fi * inv.re[s];
      }
    }
  }
  return inv;
}

/**
 * The same network in new reference impedances.
 *
 * With power waves in real references, a = (V + Z I) / (2 sqrt Z) and
 * b = (V - Z I) / (2 sqrt Z). Writing the waves in the new reference Z' in terms of
 * the old gives a' = (P + Q S) a and b' = (Q + P S) a, with the diagonal matrices
 *
 *   P = (Z + Z') / (2 sqrt(Z Z')),   Q = (Z - Z') / (2 sqrt(Z Z')),
 *
 * so S' = (Q + P S)(P + Q S)^-1. P + Q S = P (I - Gamma S) with |Gamma| < 1, which
 * is invertible for any passive S.
 */
export function renormalize(net: Network, to: number | ArrayLike<number>): Network {
  const n = net.ports;
  const target = new Float64Array(n);
  for (let i = 0; i < n; i++) target[i] = typeof to === 'number' ? to : to[i];
  const same = target.every((z, i) => z === net.reference[i]);
  const out: Network = {
    ports: n,
    freq: net.freq,
    re: Float64Array.from(net.re),
    im: Float64Array.from(net.im),
    reference: target,
  };
  if (same) return out;

  const p = new Float64Array(n);
  const q = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const z = net.reference[i];
    const zn = target[i];
    const root = 2 * Math.sqrt(z * zn);
    p[i] = (z + zn) / root;
    q[i] = (z - zn) / root;
  }
  for (let k = 0; k < net.freq.length; k++) {
    const s = matrixAt(net, k);
    const num = zeros(n);
    const den = zeros(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const o = i * n + j;
        num.re[o] = p[i] * s.re[o] + (i === j ? q[i] : 0);
        num.im[o] = p[i] * s.im[o];
        den.re[o] = q[i] * s.re[o] + (i === j ? p[i] : 0);
        den.im[o] = q[i] * s.im[o];
      }
    }
    const r = matMul(num, matInverse(den));
    out.re.set(r.re, k * n * n);
    out.im.set(r.im, k * n * n);
  }
  return out;
}

/**
 * Largest singular value of a square complex matrix: the square root of the largest
 * eigenvalue of B = S^H S.
 *
 * B is Hermitian and positive semidefinite, so for m = 2^p the trace of B^m lies
 * between lambda_max^m and N lambda_max^m. Squaring B p times, renormalising by the
 * trace each time and carrying the logarithm of the scale, gives lambda_max within
 * a factor N^(1/m): for p = 24 and N = 12, one part in 7 million. That bound is
 * exact, which an iteration that stops on convergence would not give.
 */
export function maxSingularValue(s: CMatrix, squarings = 24): number {
  let b = matMul(matAdjoint(s), s);
  const n = b.n;
  const trace = (m: CMatrix): number => {
    let t = 0;
    for (let i = 0; i < n; i++) t += m.re[i * n + i];
    return t;
  };
  let t = trace(b);
  if (!(t > 0)) return 0;
  // log(lambda) is accumulated as sum over steps of log(trace) / 2^step.
  let logLambda = 0;
  let weight = 1;
  for (let step = 0; step < squarings; step++) {
    logLambda += weight * Math.log(t);
    for (let i = 0; i < b.re.length; i++) {
      b.re[i] /= t;
      b.im[i] /= t;
    }
    b = matMul(b, b);
    weight /= 2;
    t = trace(b);
    if (!(t > 0)) break;
  }
  logLambda += weight * Math.log(Math.max(t, 1e-300));
  return Math.sqrt(Math.exp(logLambda));
}

/** Largest |S_ij - S_ji| over i < j at frequency index k. Zero for a reciprocal network. */
export function reciprocityError(net: Network, k: number): number {
  const n = net.ports;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sIndex(net, k, i, j);
      const b = sIndex(net, k, j, i);
      worst = Math.max(worst, Math.hypot(net.re[a] - net.re[b], net.im[a] - net.im[b]));
    }
  }
  return worst;
}

/** 20 log10 |z|, floored at -300 dB. */
export function dbOf(re: number, im: number): number {
  const m = Math.hypot(re, im);
  return m > 1e-15 ? 20 * Math.log10(m) : -300;
}
