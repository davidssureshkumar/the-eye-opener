/**
 * The lossy-line job, checked where the answer is known without it.
 *
 * A launched pulse has the area of one UI and its step settles to 1. A matched
 * lossless line is a pure delay, so the received pulse is the launched one built
 * again with its start moved by l sqrt(er) / c, and the received bit stream is the
 * launched one. At DC the route is a series resistor between 50 ohm ports. Nothing
 * arrives before the fastest wave could, once roughness is causal; with the real
 * roughness factor something does, and the test holds the job to showing it.
 */

import { describe, expect, it } from 'vitest';
import {
  dcResistancePerMetre,
  hammerstadCausalFactor,
  hammerstadFactor,
  hurayFactor,
  insertionLossDb,
  METRES_PER_INCH,
  prepareLine,
  sParametersAt,
} from '../../../sim/channel/lossy';
import { SPEED_OF_LIGHT } from '../../../sim/channel/tline';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import { edgeResponseOf } from '../adapt';
import { runJob } from '../index';
import {
  LOSSY_REFERENCE_OHMS,
  logGrid,
  plateauCentre,
  pulseFromSpectrum,
  risingCrossing,
  stepFromPulse,
} from '../lossy-job';

type Lossy = Scenario['channel']['lossy'];

function withLine(patch: Partial<Lossy>): Scenario {
  const s = defaultScenario();
  return { ...s, channel: { ...s.channel, lossy: { ...s.channel.lossy, ...patch } } };
}

const LOSSLESS: Partial<Lossy> = {
  z0: 50,
  conductorLossEnabled: false,
  dielectricLossEnabled: false,
  viaCount: 0,
};
const CONDUCTOR_ONLY: Partial<Lossy> = { dielectricLossEnabled: false, viaCount: 0 };

function rel(a: number, b: number): number {
  return Math.abs(a - b) / Math.abs(b);
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe('helpers', () => {
  it('a log grid runs from f0 to f1 with a constant ratio', () => {
    const g = logGrid(1e6, 1e10, 5);
    [6, 7, 8, 9, 10].forEach((d, i) => expect(Math.log10(g[i])).toBeCloseTo(d, 12));
    expect(logGrid(3, 7, 1)[0]).toBe(3);
  });

  it('the plateau centre is the middle of the flat top, not its first sample', () => {
    expect(plateauCentre(new Float64Array([0, 1, 1, 1, 1, 1, 0]))).toBe(3);
    expect(plateauCentre(new Float64Array([0, 0.5, 2, 0.5]))).toBe(2);
  });

  it('a rising crossing is linearly interpolated, and NaN when there is none', () => {
    const x = new Float64Array([0, 0, 1, 2, 3]);
    expect(risingCrossing(x, 1.5)).toBeCloseTo(2.5, 12);
    expect(risingCrossing(x, 0.25, 3)).toBeNaN();
    expect(risingCrossing(x, 9)).toBeNaN();
  });

  it('the step is the running sum of one-UI pulses', () => {
    const pulse = new Float64Array([0, 1, 1, 0, 0, 0, 0, 0]);
    expect(Array.from(stepFromPulse(pulse, 2))).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
  });
});

describe('launched pulse', () => {
  const s = defaultScenario();
  const r = runJob('lossy', s);
  const ui = 1 / s.source.symbolRate;

  it('has the area of one UI, and its step settles to 1', () => {
    let area = 0;
    for (const v of r.pulseIn) area += v * r.dt;
    expect(rel(area, ui)).toBeLessThan(1e-9);
    expect(Math.abs(r.stepIn[r.stepIn.length - 1] - 1)).toBeLessThan(1e-9);
  });

  it('is centred half a UI after its start, since the Gaussian edge has no phase', () => {
    const centre = r.startIndex + r.samplesPerUi / 2;
    expect(centre + 3 * r.samplesPerUi).toBeLessThan(r.pulseIn.length);
    for (let k = 1; k < 3 * r.samplesPerUi; k++) {
      expect(Math.abs(r.pulseIn[centre + k] - r.pulseIn[centre - k])).toBeLessThan(1e-9);
    }
    expect(Math.abs(r.pulseIn[centre] - 1)).toBeLessThan(1e-6);
  });
});

describe('a matched lossless line', () => {
  it('delays the pulse by l sqrt(er) / c and changes nothing else', () => {
    const s = withLine(LOSSLESS);
    const r = runJob('lossy', s);
    const line = s.channel.lossy;
    const td = (line.length * Math.sqrt(line.er)) / SPEED_OF_LIGHT;
    const ui = 1 / s.source.symbolRate;
    const n = r.pulseOut.length;
    const expected = pulseFromSpectrum(n, r.dt, ui, r.startIndex * r.dt + td, edgeResponseOf(s.source));
    expect(maxAbsDiff(r.pulseOut, expected)).toBeLessThan(1e-9);
    expect(Math.abs(r.mainCursor - 1)).toBeLessThan(1e-6);
    expect(r.isiSum).toBeLessThan(1e-5);
    // Linear interpolation of the 50% point on a sampled edge is good to a small fraction of a sample.
    expect(Math.abs(r.pulseDelay - td)).toBeLessThan(1e-2 * r.dt);
    expect(Math.abs(r.dcGain - 1)).toBeLessThan(1e-12);
    expect(r.ilNyquist).toBeLessThan(1e-9);
    expect(r.precursorLeak).toBeLessThan(1e-6);
  });

  it('delivers the launched bit stream when the delay is a whole number of samples', () => {
    const s0 = defaultScenario();
    const dt = 1 / s0.source.symbolRate / 32;
    const er = s0.channel.lossy.er;
    const s = withLine({ ...LOSSLESS, length: (400 * dt * SPEED_OF_LIGHT) / Math.sqrt(er) });
    const r = runJob('lossy', s, { samplesPerUi: 32 });
    expect(rel(r.dt, dt)).toBeLessThan(1e-12);
    expect(Math.round(r.pulseDelay / r.dt)).toBe(400);
    expect(maxAbsDiff(r.streamOut, r.streamIn)).toBeLessThan(1e-9 * s.source.amplitude);
    let swing = 0;
    for (const v of r.streamIn) swing = Math.max(swing, Math.abs(v));
    expect(swing).toBeGreaterThan(0.4 * s.source.amplitude);
  });
});

describe('a lossy line', () => {
  it('passes DC as a series resistor between the reference ports, and its step settles there', () => {
    const s = withLine(CONDUCTOR_ONLY);
    const r = runJob('lossy', s);
    const line = s.channel.lossy;
    const series = dcResistancePerMetre(line) * line.length;
    const expected = (2 * LOSSY_REFERENCE_OHMS) / (2 * LOSSY_REFERENCE_OHMS + series);
    expect(rel(r.dcGain, expected)).toBeLessThan(1e-12);
    expect(rel(r.stepOut[r.stepOut.length - 1], expected)).toBeLessThan(1e-4);
  });

  it('with causal roughness, sends nothing before the fastest wave beyond what smooth copper leaks from the record wrap', () => {
    const smooth = runJob('lossy', withLine({ ...CONDUCTOR_ONLY, roughnessEnabled: false })).precursorLeak;
    for (const model of ['hammerstad', 'huray'] as const) {
      const s = withLine({ ...CONDUCTOR_ONLY, roughnessModel: model });
      const causal = runJob('lossy', s).precursorLeak;
      const real = runJob('lossy', s, { causalRoughness: false }).precursorLeak;
      expect(causal, model).toBeLessThan(1.2 * smooth);
      expect(real, model).toBeGreaterThan(20 * smooth);
    }
  });

  it('takes its breakdown apart consistently', () => {
    const s = withLine({ viaCount: 0 });
    const r = runJob('lossy', s);
    const line = s.channel.lossy;
    for (let i = 0; i < r.freq.length; i++) {
      const f = r.freq[i];
      expect(r.ilSmooth[i]).toBeLessThanOrEqual(r.ilHammerstad[i] + 1e-12);
      expect(r.ilSmooth[i]).toBeLessThanOrEqual(r.ilHuray[i] + 1e-12);
      expect(r.kHammerstad[i]).toBe(hammerstadFactor(f, line.roughnessRms, line.conductivity));
      expect(r.kHuray[i]).toBe(hurayFactor(f, line.hurayRadius, line.hurayRatio, line.conductivity));
      expect(r.kHammerstadIm[i]).toBe(hammerstadCausalFactor(f, line.roughnessRms, line.conductivity).im);
      expect(r.kHammerstadIm[i]).toBeGreaterThan(0);
      expect(r.kHurayIm[i]).toBeGreaterThan(0);
    }
    const direct = insertionLossDb(sParametersAt(prepareLine(line), r.nyquist, LOSSY_REFERENCE_OHMS).s21);
    expect(rel(r.ilNyquist, direct)).toBeLessThan(1e-12);
    expect(rel(r.ilNyquistPerInch, r.ilNyquist / (line.length / METRES_PER_INCH))).toBeLessThan(1e-12);
    // Loss in dB very nearly adds between mechanisms, and the low-loss formula is close.
    expect(rel(r.conductorNyquist + r.dielectricNyquist, r.ilNyquist)).toBeLessThan(0.02);
    expect(rel(r.approxNyquist, r.ilNyquist)).toBeLessThan(0.02);
  });

  it('never measures a delay shorter than the fastest wave allows', () => {
    for (const length of [0.01, 0.3]) {
      const r = runJob('lossy', withLine({ length }));
      expect(r.pulseDelay, `${length} m`).toBeGreaterThanOrEqual(r.earliestArrival);
      expect(r.mainCursor).toBeLessThanOrEqual(1);
    }
  });

  it('runs the default route well inside the time budget without truncating its record', () => {
    const t = performance.now();
    const r = runJob('lossy', defaultScenario());
    expect(performance.now() - t).toBeLessThan(2000);
    expect(r.recordTruncated).toBe(false);
    expect(r.tailResidual).toBeLessThan(1e-3);
    expect(r.precursorLeak).toBeLessThan(1e-3);
  });
});
