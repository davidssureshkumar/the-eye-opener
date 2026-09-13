/**
 * Window functions.
 *
 * Needed wherever a finite record is treated as if it were periodic: spectra of
 * captured waveforms, band-limiting a synthesised channel response before the
 * IFFT, and the resampling filters in interp.ts.
 *
 * The oscilloscope connection is direct - the FFT math function on a scope asks
 * you to choose a window, and the answer changes what you see. Rectangular gives
 * the best frequency resolution and the worst leakage; Hann is the safe default
 * for continuous signals; flat-top is what you use when you need the amplitude of
 * a tone to be right rather than its frequency.
 */

export type WindowName =
  'rectangular' | 'hann' | 'hamming' | 'blackman' | 'blackman-harris' | 'flat-top' | 'kaiser' | 'tukey';

export interface WindowInfo {
  label: string;
  /** Height of the first sidelobe relative to the main lobe, dB. Lower leaks less. */
  sidelobeDb: number;
  /** Main lobe width in DFT bins (-3 dB points), which sets frequency resolution. */
  mainLobeBins: number;
  note: string;
}

export const WINDOW_INFO: Record<WindowName, WindowInfo> = {
  rectangular: {
    label: 'Rectangular',
    sidelobeDb: -13,
    mainLobeBins: 0.89,
    note: 'Best frequency resolution, worst leakage. Correct only when the record contains a whole number of cycles.',
  },
  hann: {
    label: 'Hann',
    sidelobeDb: -31,
    mainLobeBins: 1.44,
    note: 'The general-purpose default for continuous signals. Good leakage suppression at modest resolution cost.',
  },
  hamming: {
    label: 'Hamming',
    sidelobeDb: -43,
    mainLobeBins: 1.3,
    note: 'Lowest first sidelobe of the two-term cosine windows, but the far sidelobes fall off slowly.',
  },
  blackman: {
    label: 'Blackman',
    sidelobeDb: -58,
    mainLobeBins: 1.68,
    note: 'Strong leakage suppression for resolving a small tone next to a large one.',
  },
  'blackman-harris': {
    label: 'Blackman-Harris (4-term)',
    sidelobeDb: -92,
    mainLobeBins: 1.9,
    note: 'Very low leakage. Use when a spur is buried far below a carrier.',
  },
  'flat-top': {
    label: 'Flat top',
    sidelobeDb: -69,
    mainLobeBins: 3.77,
    note: 'Deliberately wide main lobe so a tone anywhere in a bin reads the correct amplitude. Amplitude accuracy over frequency resolution.',
  },
  kaiser: {
    label: 'Kaiser',
    sidelobeDb: -60,
    mainLobeBins: 1.7,
    note: 'Adjustable via beta: trades main lobe width against sidelobe level continuously.',
  },
  tukey: {
    label: 'Tukey (tapered cosine)',
    sidelobeDb: -15,
    mainLobeBins: 1.0,
    note: 'Rectangular in the middle with cosine skirts. Used here to taper a band-limited channel response without distorting its passband.',
  },
};

/** Modified Bessel function of the first kind, order zero. Series form; converges fast for the beta range in use. */
export function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const half = x / 2;
  for (let k = 1; k < 60; k++) {
    term *= (half / k) * (half / k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/**
 * Generate a window of length n.
 * Symmetric (endpoint-inclusive) form, appropriate for filter design. For
 * spectral analysis of a periodic record the periodic form is marginally better;
 * the difference is one sample in n and is not visible at the sizes used here.
 *
 * @param param Kaiser beta, or Tukey taper fraction (0 = rectangular, 1 = Hann).
 */
export function makeWindow(name: WindowName, n: number, param = 8.6): Float64Array {
  const w = new Float64Array(n);
  if (n === 0) return w;
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  const d = n - 1;

  switch (name) {
    case 'rectangular':
      w.fill(1);
      break;
    case 'hann':
      for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d);
      break;
    case 'hamming':
      for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / d);
      break;
    case 'blackman':
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / d;
        w[i] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t);
      }
      break;
    case 'blackman-harris':
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / d;
        w[i] = 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t);
      }
      break;
    case 'flat-top':
      for (let i = 0; i < n; i++) {
        const t = (2 * Math.PI * i) / d;
        w[i] =
          0.21557895 -
          0.41663158 * Math.cos(t) +
          0.277263158 * Math.cos(2 * t) -
          0.083578947 * Math.cos(3 * t) +
          0.006947368 * Math.cos(4 * t);
      }
      break;
    case 'kaiser': {
      const denom = besselI0(param);
      for (let i = 0; i < n; i++) {
        const r = (2 * i) / d - 1;
        w[i] = besselI0(param * Math.sqrt(Math.max(0, 1 - r * r))) / denom;
      }
      break;
    }
    case 'tukey': {
      const a = Math.min(1, Math.max(0, param));
      if (a === 0) {
        w.fill(1);
        break;
      }
      const edge = (a * d) / 2;
      for (let i = 0; i < n; i++) {
        if (i < edge) w[i] = 0.5 * (1 + Math.cos(Math.PI * (i / edge - 1)));
        else if (i > d - edge) w[i] = 0.5 * (1 + Math.cos(Math.PI * ((i - d) / edge + 1)));
        else w[i] = 1;
      }
      break;
    }
  }
  return w;
}

/** Apply a window in place. */
export function applyWindow(x: Float64Array, w: Float64Array): Float64Array {
  const n = Math.min(x.length, w.length);
  for (let i = 0; i < n; i++) x[i] *= w[i];
  return x;
}

/**
 * Coherent gain: mean of the window. Multiply a windowed amplitude spectrum by
 * 1/coherentGain to recover the correct tone amplitude. This is the correction a
 * scope applies internally when it reports the amplitude of an FFT peak.
 */
export function coherentGain(w: Float64Array): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i];
  return w.length === 0 ? 0 : s / w.length;
}

/** Noise power bandwidth in bins. Divide a windowed power spectrum by this for correct noise density. */
export function noisePowerBandwidth(w: Float64Array): number {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < w.length; i++) {
    s1 += w[i];
    s2 += w[i] * w[i];
  }
  return s1 === 0 ? 0 : (w.length * s2) / (s1 * s1);
}
