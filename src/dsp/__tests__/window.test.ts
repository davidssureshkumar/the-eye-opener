import { describe, it, expect } from 'vitest';
import {
  makeWindow,
  applyWindow,
  coherentGain,
  noisePowerBandwidth,
  besselI0,
  WINDOW_INFO,
  type WindowName,
} from '../window';
import { rfft } from '../fft';

const NAMES = Object.keys(WINDOW_INFO) as WindowName[];

describe('window construction', () => {
  it('returns the requested length for every window', () => {
    for (const name of NAMES) {
      for (const n of [2, 16, 65, 1024]) {
        expect(makeWindow(name, n).length).toBe(n);
      }
    }
  });

  it('stays within unity, and only flat-top swings negative', () => {
    for (const name of NAMES) {
      const w = makeWindow(name, 512);
      for (let i = 0; i < w.length; i++) {
        expect(w[i]).toBeLessThanOrEqual(1 + 1e-12);
        if (name !== 'flat-top') expect(w[i]).toBeGreaterThanOrEqual(-1e-12);
      }
    }
  });

  it('is symmetric about its centre', () => {
    for (const name of NAMES) {
      const n = 257;
      const w = makeWindow(name, n);
      for (let i = 0; i < n; i++) expect(w[i]).toBeCloseTo(w[n - 1 - i], 10);
    }
  });

  it('peaks at the centre sample of an odd-length window', () => {
    for (const name of NAMES) {
      if (name === 'rectangular') continue;
      const n = 129;
      const w = makeWindow(name, n);
      let peak = -Infinity;
      for (let i = 0; i < n; i++) peak = Math.max(peak, w[i]);
      expect(w[(n - 1) / 2]).toBeCloseTo(peak, 12);
    }
  });

  it('handles the degenerate lengths', () => {
    expect(makeWindow('hann', 0).length).toBe(0);
    expect(Array.from(makeWindow('blackman', 1))).toEqual([1]);
  });

  it('rectangular is all ones', () => {
    const w = makeWindow('rectangular', 8);
    for (let i = 0; i < 8; i++) expect(w[i]).toBe(1);
  });

  it('Hann matches 0.5 (1 - cos(2 pi i / (N-1))) and touches zero at both ends', () => {
    const n = 16;
    const w = makeWindow('hann', n);
    for (let i = 0; i < n; i++) {
      expect(w[i]).toBeCloseTo(0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1))), 12);
    }
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[n - 1]).toBeCloseTo(0, 12);
  });

  it('Hamming stops short of zero at the ends, which is the whole difference from Hann', () => {
    const w = makeWindow('hamming', 64);
    expect(w[0]).toBeCloseTo(0.08, 12);
    expect(w[63]).toBeCloseTo(0.08, 12);
  });

  it('Kaiser collapses to rectangular at beta = 0', () => {
    const w = makeWindow('kaiser', 32, 0);
    for (let i = 0; i < 32; i++) expect(w[i]).toBeCloseTo(1, 10);
  });

  it('Tukey with alpha = 0 is rectangular and with alpha = 1 is Hann', () => {
    const n = 64;
    const rect = makeWindow('tukey', n, 0);
    for (let i = 0; i < n; i++) expect(rect[i]).toBeCloseTo(1, 10);
    const hann = makeWindow('tukey', n, 1);
    const ref = makeWindow('hann', n);
    for (let i = 0; i < n; i++) expect(hann[i]).toBeCloseTo(ref[i], 10);
  });

  it('Tukey keeps a flat passband in the middle', () => {
    const w = makeWindow('tukey', 1000, 0.2);
    for (let i = 200; i < 800; i++) expect(w[i]).toBeCloseTo(1, 12);
    expect(w[0]).toBeCloseTo(0, 12);
  });

  it('applyWindow multiplies sample by sample, in place', () => {
    const x = Float64Array.from([1, 2, 3, 4]);
    const w = Float64Array.from([0, 0.5, 0.5, 0]);
    const y = applyWindow(x, w);
    expect(Array.from(y)).toEqual([0, 1, 1.5, 0]);
    expect(y).toBe(x);
  });
});

describe('modified Bessel function of the first kind', () => {
  it('matches known values of I0', () => {
    expect(besselI0(0)).toBeCloseTo(1, 12);
    expect(besselI0(1)).toBeCloseTo(1.2660658, 6);
    expect(besselI0(2)).toBeCloseTo(2.2795853, 6);
    expect(besselI0(5)).toBeCloseTo(27.239872, 5);
  });
});

describe('window figures of merit', () => {
  it('coherent gain is the mean of the window', () => {
    for (const name of NAMES) {
      const w = makeWindow(name, 1024);
      let sum = 0;
      for (let i = 0; i < w.length; i++) sum += w[i];
      expect(coherentGain(w)).toBeCloseTo(sum / w.length, 12);
    }
    expect(coherentGain(makeWindow('rectangular', 64))).toBeCloseTo(1, 12);
    // Hann throws away half the amplitude of a coherent tone; the scope has to
    // divide it back out before it can report a peak amplitude correctly.
    expect(coherentGain(makeWindow('hann', 4096))).toBeCloseTo(0.5, 3);
  });

  it('noise power bandwidth is 1 bin for rectangular and 1.5 for Hann', () => {
    expect(noisePowerBandwidth(makeWindow('rectangular', 4096))).toBeCloseTo(1, 10);
    expect(noisePowerBandwidth(makeWindow('hann', 4096))).toBeCloseTo(1.5, 2);
    expect(noisePowerBandwidth(makeWindow('hamming', 4096))).toBeCloseTo(1.3628, 2);
    expect(noisePowerBandwidth(makeWindow('blackman', 4096))).toBeCloseTo(1.7269, 2);
  });

  it('every window widens the noise bandwidth relative to rectangular', () => {
    for (const name of NAMES) {
      if (name === 'rectangular') continue;
      expect(noisePowerBandwidth(makeWindow(name, 4096))).toBeGreaterThan(1);
    }
  });
});

describe('the sidelobe trade the scope FFT menu is really offering', () => {
  // Measure the actual peak sidelobe of each window and confirm it is at least as
  // good as the figure quoted in the UI. This is the reason a bench engineer picks
  // Blackman-Harris to see a small spur sitting next to a large carrier.
  function peakSidelobeDb(name: WindowName, param?: number): number {
    const n = 2048;
    const pad = 16;
    const w = param === undefined ? makeWindow(name, n) : makeWindow(name, n, param);
    const x = new Float64Array(n * pad);
    x.set(w, 0);
    const s = rfft(x);
    const mags = new Float64Array(s.re.length);
    let peak = 0;
    for (let k = 0; k < mags.length; k++) {
      mags[k] = Math.hypot(s.re[k], s.im[k]);
      peak = Math.max(peak, mags[k]);
    }
    // Leave the main lobe: the first turning point that is already well below the
    // peak. A bare local minimum is not enough - flat-top ripples at its top.
    let k = 1;
    while (k < mags.length - 1 && !(mags[k] < peak * 0.05 && mags[k] < mags[k + 1])) k++;
    let side = 0;
    for (let i = k; i < mags.length; i++) side = Math.max(side, mags[i]);
    return 20 * Math.log10(side / peak);
  }

  it('measured peak sidelobes meet the figures quoted in the UI', () => {
    for (const name of NAMES) {
      const measured = peakSidelobeDb(name);
      // Tukey's entry describes its intended taper, not the alpha = 1 default.
      const quoted = name === 'tukey' ? -15 : WINDOW_INFO[name].sidelobeDb;
      expect(measured).toBeLessThan(quoted + 3);
    }
  });

  it('rectangular leaks at -13 dB, which is why an off-bin tone smears', () => {
    expect(peakSidelobeDb('rectangular')).toBeCloseTo(-13.26, 1);
  });

  it('orders the windows the way the trade-off says they should be ordered', () => {
    const rect = peakSidelobeDb('rectangular');
    const hann = peakSidelobeDb('hann');
    const bh = peakSidelobeDb('blackman-harris');
    expect(hann).toBeLessThan(rect);
    expect(bh).toBeLessThan(hann);
    // ... and pay for it in main lobe width.
    expect(noisePowerBandwidth(makeWindow('blackman-harris', 4096))).toBeGreaterThan(
      noisePowerBandwidth(makeWindow('hann', 4096)),
    );
  });

  it('Kaiser beta trades sidelobe level against main lobe width continuously', () => {
    const low = peakSidelobeDb('kaiser', 2);
    const high = peakSidelobeDb('kaiser', 12);
    expect(high).toBeLessThan(low);
    expect(noisePowerBandwidth(makeWindow('kaiser', 4096, 12))).toBeGreaterThan(
      noisePowerBandwidth(makeWindow('kaiser', 4096, 2)),
    );
  });
});

describe('amplitude accuracy: why the flat-top window exists', () => {
  function measuredAmplitude(name: WindowName, offset: number): number {
    const n = 4096;
    const w = makeWindow(name, n);
    const cg = coherentGain(w);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.cos((2 * Math.PI * (100 + offset) * i) / n);
    const s = rfft(applyWindow(x, w));
    let peak = 0;
    for (let k = 0; k < s.re.length; k++) peak = Math.max(peak, Math.hypot(s.re[k], s.im[k]));
    return (2 * peak) / (n * cg);
  }

  it('flat-top reads a unit tone correctly wherever it falls between bins', () => {
    for (const offset of [0, 0.25, 0.5]) {
      expect(measuredAmplitude('flat-top', offset)).toBeCloseTo(1, 2);
    }
  });

  it('Hann loses about 1.4 dB on a worst-case off-bin tone', () => {
    expect(20 * Math.log10(measuredAmplitude('hann', 0))).toBeGreaterThan(-0.05);
    const scalloping = 20 * Math.log10(measuredAmplitude('hann', 0.5));
    expect(scalloping).toBeLessThan(-1.3);
    expect(scalloping).toBeGreaterThan(-1.5);
  });

  it('rectangular is the worst of all, at nearly 4 dB', () => {
    const scalloping = 20 * Math.log10(measuredAmplitude('rectangular', 0.5));
    expect(scalloping).toBeLessThan(-3.8);
    expect(scalloping).toBeGreaterThan(-4.0);
  });
});

describe('window metadata', () => {
  it('every window carries a sidelobe figure, a main lobe width and a bench note', () => {
    for (const name of NAMES) {
      const info = WINDOW_INFO[name];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.sidelobeDb).toBeLessThan(0);
      expect(info.mainLobeBins).toBeGreaterThan(0);
      expect(info.note.length).toBeGreaterThan(20);
    }
  });
});
