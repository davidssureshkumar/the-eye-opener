import { describe, it, expect } from 'vitest';
import { hilbert, analyticSignal, envelope, minimumPhaseFromMagnitude } from '../hilbert';
import { transferAt, cAbs } from '../filters';
import { fft, ifft } from '../fft';

describe('Hilbert transform', () => {
  it('maps cos to sin', () => {
    // H{cos(wt)} = sin(wt). Use a bin-centred tone so there is no leakage.
    const n = 512;
    const k = 16;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.cos((2 * Math.PI * k * i) / n);
    const h = hilbert(x);
    for (let i = 0; i < n; i++) {
      expect(h[i]).toBeCloseTo(Math.sin((2 * Math.PI * k * i) / n), 9);
    }
  });

  it('maps sin to -cos', () => {
    const n = 512;
    const k = 11;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * k * i) / n);
    const h = hilbert(x);
    for (let i = 0; i < n; i++) {
      expect(h[i]).toBeCloseTo(-Math.cos((2 * Math.PI * k * i) / n), 9);
    }
  });

  it('the analytic signal keeps the original as its real part', () => {
    const n = 256;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++)
      x[i] = Math.cos((2 * Math.PI * 7 * i) / n) + 0.3 * Math.sin((2 * Math.PI * 19 * i) / n);
    const a = analyticSignal(x);
    for (let i = 0; i < n; i++) expect(a.re[i]).toBeCloseTo(x[i], 10);
  });

  it('applying the transform twice negates the signal', () => {
    // H{H{x}} = -x for a zero-mean signal.
    const n = 256;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    const twice = hilbert(hilbert(x));
    for (let i = 0; i < n; i++) expect(twice[i]).toBeCloseTo(-x[i], 9);
  });
});

describe('envelope detection', () => {
  it('recovers the envelope of an amplitude-modulated carrier', () => {
    const n = 4096;
    const carrier = 200;
    const x = new Float64Array(n);
    const env = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const e = 1 + 0.5 * Math.sin((2 * Math.PI * 3 * i) / n);
      env[i] = e;
      x[i] = e * Math.cos((2 * Math.PI * carrier * i) / n);
    }
    const got = envelope(x);
    // Ignore the ends, where the periodic assumption of the FFT bites.
    for (let i = 200; i < n - 200; i++) expect(got[i]).toBeCloseTo(env[i], 2);
  });

  it('the envelope of a pure tone is its constant amplitude', () => {
    const n = 1024;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = 2.5 * Math.cos((2 * Math.PI * 32 * i) / n);
    const e = envelope(x);
    for (let i = 0; i < n; i++) expect(e[i]).toBeCloseTo(2.5, 8);
  });
});

describe('minimum-phase reconstruction', () => {
  /** DFT magnitude of a short impulse response, zero padded to n. */
  function magOf(h: readonly number[], n: number): Float64Array {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re.set(h, 0);
    fft(re, im);
    const mag = new Float64Array(n);
    for (let k = 0; k < n; k++) mag[k] = Math.hypot(re[k], im[k]);
    return mag;
  }

  /** Impulse response of a reconstructed spectrum. */
  function impulseOf(mp: { re: Float64Array; im: Float64Array }): Float64Array {
    const re = Float64Array.from(mp.re);
    const im = Float64Array.from(mp.im);
    ifft(re, im);
    return re;
  }

  it('returns a minimum-phase FIR unchanged', () => {
    // h = [1, -0.5] has its zero at z = 0.5, inside the unit circle, so it is
    // already minimum phase and must come back exactly as it went in.
    const n = 256;
    const y = impulseOf(minimumPhaseFromMagnitude(magOf([1, -0.5], n)));
    expect(y[0]).toBeCloseTo(1, 12);
    expect(y[1]).toBeCloseTo(-0.5, 12);
    for (let i = 2; i < n; i++) expect(Math.abs(y[i])).toBeLessThan(1e-12);
  });

  it('replaces a maximum-phase response with its minimum-phase twin', () => {
    // h = [-0.5, 1] has the SAME magnitude response but its zero at z = 2, outside
    // the unit circle. The reconstruction must return [1, -0.5]: same magnitude,
    // least possible phase lag, energy as early as it can be. This is the whole
    // claim the M4 loss model rests on.
    const n = 256;
    const magMin = magOf([1, -0.5], n);
    const magMax = magOf([-0.5, 1], n);
    for (let k = 0; k < n; k++) expect(magMax[k]).toBeCloseTo(magMin[k], 12);

    const y = impulseOf(minimumPhaseFromMagnitude(magMax));
    expect(y[0]).toBeCloseTo(1, 12);
    expect(y[1]).toBeCloseTo(-0.5, 12);
    for (let i = 2; i < n; i++) expect(Math.abs(y[i])).toBeLessThan(1e-12);
  });

  it('handles a longer minimum-phase response exactly', () => {
    // Zeros at 0.5 and 0.4, both well inside the unit circle.
    const n = 512;
    const h = [1, -0.9, 0.2];
    const y = impulseOf(minimumPhaseFromMagnitude(magOf(h, n)));
    for (let i = 0; i < h.length; i++) expect(y[i]).toBeCloseTo(h[i], 10);
    for (let i = h.length; i < n; i++) expect(Math.abs(y[i])).toBeLessThan(1e-10);
  });

  it('concentrates energy as early as possible, which is what "minimum phase" means', () => {
    const n = 512;
    const minPhase = impulseOf(minimumPhaseFromMagnitude(magOf([1, -0.5], n)));
    const maxPhase = [-0.5, 1];
    const partial = (h: ArrayLike<number>, m: number): number => {
      let s = 0;
      for (let i = 0; i < m; i++) s += h[i] * h[i];
      return s;
    };
    // Every partial energy sum of the minimum-phase response is at least as large.
    for (const m of [1, 2]) {
      expect(partial(minPhase, m)).toBeGreaterThanOrEqual(partial(maxPhase, m) - 1e-12);
    }
  });

  it('preserves the requested magnitude response exactly', () => {
    const n = 2048;
    const mag = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const kk = k <= n / 2 ? k : n - k;
      mag[k] = Math.exp(-kk / 300);
    }
    const mp = minimumPhaseFromMagnitude(mag);
    for (let k = 0; k < n; k++) {
      expect(Math.hypot(mp.re[k], mp.im[k])).toBeCloseTo(mag[k], 12);
    }
  });

  it('produces a causal impulse response, unlike a zero-phase assumption', () => {
    // The practical consequence: energy must not appear before t = 0. A zero-phase
    // (magnitude-only) channel model puts half the pulse response before the pulse.
    const n = 4096;
    const fs = 100e9;
    const mag = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const kk = k <= n / 2 ? k : n - k;
      mag[k] = cAbs(transferAt({ type: 'rc', bw: 4e9 }, (kk * fs) / n));
    }
    const y = impulseOf(minimumPhaseFromMagnitude(mag));

    let head = 0;
    let tail = 0;
    for (let i = 0; i < 64; i++) head += Math.abs(y[i]);
    for (let i = n - 64; i < n; i++) tail += Math.abs(y[i]);
    expect(tail).toBeLessThan(head * 1e-3);

    // The zero-phase alternative, for contrast: acausal by construction.
    const zp = Float64Array.from(mag);
    const zim = new Float64Array(n);
    ifft(zp, zim);
    let zHead = 0;
    let zTail = 0;
    for (let i = 0; i < 64; i++) zHead += Math.abs(zp[i]);
    for (let i = n - 64; i < n; i++) zTail += Math.abs(zp[i]);
    expect(zTail).toBeGreaterThan(zHead * 0.5);
  });

  it('matches the analog RC phase, to a fraction of a sample of delay, well below Nyquist', () => {
    // A sampled analog response is not exactly a discrete minimum-phase system:
    // the periodic extension of |H| forces the reconstructed phase to zero at
    // Nyquist, and the two differ by a sub-sample delay plus a residual that grows
    // with f/fs. Practical consequence for M4: oversample the channel model
    // generously with respect to its own bandwidth.
    const n = 16384;
    const fs = 100e9;
    const bw = 5e9;
    const mag = new Float64Array(n);
    const truePhase = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const kk = k <= n / 2 ? k : n - k;
      const h = transferAt({ type: 'rc', bw }, (kk * fs) / n);
      mag[k] = cAbs(h);
      truePhase[k] = k <= n / 2 ? Math.atan2(h.im, h.re) : -Math.atan2(h.im, h.re);
    }
    const mp = minimumPhaseFromMagnitude(mag);

    // Least-squares fit of the phase difference to a pure delay over the lower
    // tenth of the sample rate, then check what is left over.
    const kMax = Math.round(0.1 * n);
    let sxy = 0;
    let sxx = 0;
    for (let k = 1; k < kMax; k++) {
      sxy += k * (Math.atan2(mp.im[k], mp.re[k]) - truePhase[k]);
      sxx += k * k;
    }
    const slope = sxy / sxx;
    const delaySamples = (slope * n) / (2 * Math.PI);
    expect(Math.abs(delaySamples)).toBeLessThan(1);

    let maxResidual = 0;
    for (let k = 1; k < kMax; k++) {
      const r = Math.atan2(mp.im[k], mp.re[k]) - truePhase[k] - slope * k;
      maxResidual = Math.max(maxResidual, Math.abs(r));
    }
    expect(maxResidual).toBeLessThan(1e-3);

    // Halving the band cuts the residual by roughly eight: the discrepancy is a
    // sampling artefact that shrinks with f/fs, not a wrong algorithm.
    const kNarrow = Math.round(0.05 * n);
    let nxy = 0;
    let nxx = 0;
    for (let k = 1; k < kNarrow; k++) {
      nxy += k * (Math.atan2(mp.im[k], mp.re[k]) - truePhase[k]);
      nxx += k * k;
    }
    const narrowSlope = nxy / nxx;
    let narrowResidual = 0;
    for (let k = 1; k < kNarrow; k++) {
      const r = Math.atan2(mp.im[k], mp.re[k]) - truePhase[k] - narrowSlope * k;
      narrowResidual = Math.max(narrowResidual, Math.abs(r));
    }
    expect(narrowResidual).toBeLessThan(maxResidual / 4);
  });
});
