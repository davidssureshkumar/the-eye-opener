/**
 * Two numbers a channel is often judged by, computed from its S-parameters.
 *
 * Insertion loss deviation (ILD). A uniform line's loss rises smoothly: a constant
 * from mismatch, a term in sqrt f from the skin effect, a term in f from the
 * dielectric, and a term in f^2 that absorbs the curvature of both. Fitting
 *
 *     IL_fit(f) = a0 + a1 sqrt(f) + a2 f + a3 f^2,   f in GHz,
 *
 * by least squares over a band and subtracting leaves the ripple: reflections from
 * vias, connectors and stubs, and the null of a skewed pair. An equaliser can undo
 * a smooth loss, and it cannot undo the ripple, which is why the deviation is
 * reported separately. The fit weights every sample equally, so the grid should be
 * evenly spaced in frequency, as analyser sweeps are.
 *
 * Integrated crosstalk noise (ICN). Crosstalk from a random aggressor is noise at
 * the victim's receiver, and its RMS follows from the power spectrum of the
 * aggressor's signal weighted by the coupling. A random NRZ signal of levels +/- L
 * and symbol time T has one-sided power density 2 L^2 T sinc^2(f T), whose integral
 * is L^2. Shaping it by the transmitter's edge H_tx, the coupling XT and a
 * receiver bandwidth H_rx gives
 *
 *     sigma^2 = integral over 0..F of 2 L^2 T sinc^2(f T) |H_tx|^2 |XT|^2 |H_rx|^2 df
 *
 * with |H_rx|^2 = 1 / (1 + (f / f_r)^8), a fourth-order Butterworth-like roll-off,
 * as in the method of IEEE 802.3 Annex 69B, which is cited by number only. For
 * flat coupling k and no filters, sigma = k L, less a tail beyond F of about
 * 1 / (pi^2 F T) in sigma^2 / (k L)^2, which the tests hold it to. Independent
 * aggressors add in power.
 *
 * Physics: PHYSICS.md section 14.6.
 */

import { transferAt, type ResponseSpec } from '../../dsp/filters';

export interface IldFit {
  /** Fit coefficients a0..a3, dB, with f in GHz. */
  coefficients: [number, number, number, number];
  /** The fitted loss at every frequency of the grid, dB, including outside the band. */
  fitted: Float64Array;
  /** IL minus the fit at every frequency, dB. */
  deviation: Float64Array;
  /** RMS of the deviation over the band, dB. */
  rms: number;
  /** Largest |deviation| over the band, dB. */
  peak: number;
  /** Frequency of that largest deviation, Hz. */
  peakFrequency: number;
  /** Samples inside the band. */
  count: number;
}

/** Solve a small dense real system by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    if (Math.abs(d) < 1e-300) throw new Error('solve: singular system');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / d;
      for (let j = c; j <= n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Least-squares fit of insertion loss (dB, positive) to a0 + a1 sqrt f + a2 f + a3 f^2
 * over [fLo, fHi], and the deviation from it.
 */
export function insertionLossDeviation(
  freq: ArrayLike<number>,
  ilDb: ArrayLike<number>,
  fLo: number,
  fHi: number,
): IldFit {
  const basis = (fHz: number): [number, number, number, number] => {
    const g = fHz / 1e9;
    return [1, Math.sqrt(Math.max(0, g)), g, g * g];
  };
  const ata = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  const atb = [0, 0, 0, 0];
  let count = 0;
  for (let k = 0; k < freq.length; k++) {
    if (freq[k] < fLo || freq[k] > fHi) continue;
    const phi = basis(freq[k]);
    for (let i = 0; i < 4; i++) {
      atb[i] += phi[i] * ilDb[k];
      for (let j = 0; j < 4; j++) ata[i][j] += phi[i] * phi[j];
    }
    count++;
  }
  if (count < 4) throw new Error('insertionLossDeviation: fewer than four samples in the band');
  // Scale columns so the f^2 column does not dwarf the constant one.
  const scale = [0, 1, 2, 3].map((i) => (ata[i][i] > 0 ? 1 / Math.sqrt(ata[i][i]) : 1));
  const scaled = ata.map((row, i) => row.map((v, j) => v * scale[i] * scale[j]));
  const y = solve(
    scaled,
    atb.map((v, i) => v * scale[i]),
  );
  const coefficients = y.map((v, i) => v * scale[i]) as [number, number, number, number];

  const fitted = new Float64Array(freq.length);
  const deviation = new Float64Array(freq.length);
  let sum = 0;
  let peak = 0;
  let peakFrequency = NaN;
  for (let k = 0; k < freq.length; k++) {
    const phi = basis(freq[k]);
    fitted[k] =
      coefficients[0] * phi[0] +
      coefficients[1] * phi[1] +
      coefficients[2] * phi[2] +
      coefficients[3] * phi[3];
    deviation[k] = ilDb[k] - fitted[k];
    if (freq[k] < fLo || freq[k] > fHi) continue;
    sum += deviation[k] ** 2;
    if (Math.abs(deviation[k]) > peak) {
      peak = Math.abs(deviation[k]);
      peakFrequency = freq[k];
    }
  }
  return { coefficients, fitted, deviation, rms: Math.sqrt(sum / count), peak, peakFrequency, count };
}

export interface IcnOptions {
  /** Aggressor level: the NRZ signal swings +/- this, volts. */
  level: number;
  /** Symbol time, seconds. */
  symbolTime: number;
  /** Transmit edge shaping; omitted for none. */
  edge?: ResponseSpec;
  /** Receiver bandwidth f_r, Hz; omitted or Infinity for none. */
  rxBandwidth?: number;
  /** Upper limit of the integral, Hz; defaults to the last frequency. */
  fMax?: number;
}

/**
 * One-sided noise power density of a coupled random NRZ aggressor at frequency f,
 * V^2/Hz, for coupling magnitude `xt`.
 */
export function crosstalkDensity(f: number, xt: number, o: IcnOptions): number {
  const x = Math.PI * f * o.symbolTime;
  const sinc = f === 0 ? 1 : Math.sin(x) / x;
  let w = 2 * o.level * o.level * o.symbolTime * sinc * sinc * xt * xt;
  if (o.edge) {
    const h = transferAt(o.edge, f);
    w *= h.re * h.re + h.im * h.im;
  }
  if (o.rxBandwidth !== undefined && Number.isFinite(o.rxBandwidth)) w /= 1 + (f / o.rxBandwidth) ** 8;
  return w;
}

/**
 * RMS crosstalk noise, volts, from coupling magnitudes |XT| sampled at `freq`, by
 * the trapezoidal rule from DC (the density at DC taken as the first sample's
 * coupling at f = 0) to fMax.
 */
export function integratedCrosstalkNoise(
  freq: ArrayLike<number>,
  xtMag: ArrayLike<number>,
  o: IcnOptions,
): number {
  const top = o.fMax ?? freq[freq.length - 1];
  let prevF = 0;
  let prevW = freq.length > 0 && freq[0] > 0 ? crosstalkDensity(0, xtMag[0], o) : 0;
  let sum = 0;
  for (let k = 0; k < freq.length; k++) {
    const f = freq[k];
    if (f > top) break;
    const w = crosstalkDensity(f, xtMag[k], o);
    if (f > prevF) sum += 0.5 * (w + prevW) * (f - prevF);
    prevF = f;
    prevW = w;
  }
  return Math.sqrt(sum);
}

/** Power sum of independent noise sources. */
export function powerSum(sigmas: readonly number[]): number {
  return Math.sqrt(sigmas.reduce((s, x) => s + x * x, 0));
}
