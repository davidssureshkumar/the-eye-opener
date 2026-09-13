import { describe, expect, it } from 'vitest';
import {
  buildAlphaLut,
  buildLut,
  colormapCss,
  COLORMAP_INFO,
  luminance,
  sampleColormap,
  type ColormapName,
  type Rgb,
} from '../colormaps';

const NAMES: ColormapName[] = ['viridis', 'inferno', 'ember', 'grayscale'];

function channels(c: Rgb): number[] {
  return [c.r, c.g, c.b];
}

describe('colormap sampling', () => {
  it('returns channels in range for every map at every position', () => {
    for (const name of NAMES) {
      for (let i = 0; i <= 100; i++) {
        for (const c of channels(sampleColormap(name, i / 100))) {
          expect(Number.isFinite(c)).toBe(true);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('clamps out-of-range positions to the endpoints', () => {
    for (const name of NAMES) {
      expect(sampleColormap(name, -5)).toEqual(sampleColormap(name, 0));
      expect(sampleColormap(name, 5)).toEqual(sampleColormap(name, 1));
    }
  });

  it('treats a non-finite position as zero rather than producing undefined channels', () => {
    // A NaN would otherwise index the anchor table with NaN, and undefined channels
    // paint as transparent black: a silently blank plot rather than a loud failure.
    for (const name of NAMES) {
      expect(sampleColormap(name, Number.NaN)).toEqual(sampleColormap(name, 0));
    }
  });

  it('is continuous: no visible jump between adjacent LUT entries', () => {
    for (const name of NAMES) {
      let prev = sampleColormap(name, 0);
      for (let i = 1; i <= 255; i++) {
        const cur = sampleColormap(name, i / 255);
        const a = channels(prev);
        const b = channels(cur);
        for (let c = 0; c < 3; c++) expect(Math.abs(b[c] - a[c])).toBeLessThan(12);
        prev = cur;
      }
    }
  });
});

describe('perceptual ordering', () => {
  /**
   * The property that makes viridis and inferno right for density plots: luminance
   * increases with the value. A rainbow map fails this, which is why a rainbow eye
   * diagram shows bands that are not in the data.
   */
  it('luminance rises monotonically across viridis, inferno and grayscale', () => {
    for (const name of ['viridis', 'inferno', 'grayscale'] as ColormapName[]) {
      let prev = -Infinity;
      for (let i = 0; i <= 255; i++) {
        const l = luminance(sampleColormap(name, i / 255));
        // A hair of slack for the piecewise-linear interpolation between published
        // anchors; a genuine inversion would be orders of magnitude larger.
        expect(l).toBeGreaterThan(prev - 0.005);
        prev = Math.max(prev, l);
      }
    }
  });

  it('spans a wide luminance range end to end', () => {
    for (const name of ['viridis', 'inferno', 'grayscale'] as ColormapName[]) {
      const lo = luminance(sampleColormap(name, 0));
      const hi = luminance(sampleColormap(name, 1));
      expect(hi - lo).toBeGreaterThan(0.55);
    }
  });

  it('starts dark, because the background is dark', () => {
    for (const name of NAMES) {
      expect(luminance(sampleColormap(name, 0))).toBeLessThan(0.35);
    }
  });
});

describe('lookup tables', () => {
  it('builds 256 opaque RGBA entries', () => {
    for (const name of NAMES) {
      const lut = buildLut(name);
      expect(lut.length).toBe(256 * 4);
      expect(lut[3]).toBe(255);
      expect(lut[255 * 4 + 3]).toBe(255);
    }
  });

  it('agrees with direct sampling at the endpoints and the middle', () => {
    const lut = buildLut('viridis');
    for (const i of [0, 128, 255]) {
      const c = sampleColormap('viridis', i / 255);
      expect(lut[i * 4]).toBe(c.r);
      expect(lut[i * 4 + 1]).toBe(c.g);
      expect(lut[i * 4 + 2]).toBe(c.b);
    }
  });

  it('ramps alpha from transparent so an unvisited bin shows the graticule', () => {
    const lut = buildAlphaLut('inferno');
    expect(lut[3]).toBe(0);
    expect(lut[255 * 4 + 3]).toBe(255);
    // Monotonic, otherwise a mid-density region would be more transparent than a
    // sparse one and the density gradient would read backwards.
    let prev = -1;
    for (let i = 0; i < 256; i++) {
      const a = lut[i * 4 + 3];
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it('reaches full opacity at the knee', () => {
    const lut = buildAlphaLut('inferno', 0.5);
    // t = 0.5 is index 127.5 of 255; the first fully opaque entry is at or just past it.
    expect(lut[127 * 4 + 3]).toBeLessThan(255);
    expect(lut[128 * 4 + 3]).toBe(255);
  });

  it('keeps the same colours as the opaque table', () => {
    const solid = buildLut('ember');
    const alpha = buildAlphaLut('ember');
    for (let i = 0; i < 256; i++) {
      expect(alpha[i * 4]).toBe(solid[i * 4]);
      expect(alpha[i * 4 + 1]).toBe(solid[i * 4 + 1]);
      expect(alpha[i * 4 + 2]).toBe(solid[i * 4 + 2]);
    }
  });
});

describe('css output', () => {
  it('is an opaque rgb() by default', () => {
    const css = colormapCss('viridis', 0.5);
    expect(css).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it('carries alpha through when asked', () => {
    expect(colormapCss('viridis', 0.5, 0.4)).toMatch(/^rgba\(\d+,\d+,\d+,0\.4\)$/);
  });
});

describe('documentation', () => {
  it('describes every map so the picker can explain the choice', () => {
    for (const name of NAMES) {
      const info = COLORMAP_INFO[name];
      expect(info).toBeDefined();
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.note.length).toBeGreaterThan(20);
    }
  });
});
