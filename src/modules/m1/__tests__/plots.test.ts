/**
 * M1's figures, checked against the job that feeds them.
 *
 * The specs are built from a real `runJob('fourier', ...)` result rather than from a
 * hand-written fixture. A fixture would let the figure and the job drift apart in
 * exactly the way this file exists to prevent: the plot claims a metric is finite,
 * the job starts returning -Infinity for it, and nothing notices until a reader sees
 * "-inf dB" where a duty cycle should be.
 *
 * `validateChrome` carries most of the weight - unlabelled axes, duplicate keys,
 * indistinguishable traces, non-finite metrics. The rest of the assertions are about
 * the physics the picture is supposed to be showing.
 */

import { describe, expect, it } from 'vitest';
import { runJob, type FourierResult } from '../../../dsp/jobs';
import { GIBBS_OVERSHOOT_OF_JUMP, type WaveShape } from '../../../dsp/fourier';
import { validateChrome } from '../../../plots/chrome';
import { defaultScenario } from '../../../state/scenario';
import { colorSequence, recorder, surfaceOf } from '../../../plots/__tests__/recorder';
import { spectrumRender, synthesisRender } from '../plots';

const SCENARIO = defaultScenario();

function fourier(shape: WaveShape, maxN: number, duty = 0.5, perHarmonic = false): FourierResult {
  return runJob('fourier', SCENARIO, { shape, maxN, duty, perHarmonic, samples: 1024 });
}

function surface(): ReturnType<typeof surfaceOf> {
  return surfaceOf(recorder());
}

const SHAPES: WaveShape[] = ['square', 'triangle', 'sawtooth', 'pulse'];

/* --------------------------------------------------------------- synthesis */

describe('synthesis figure', () => {
  it.each(SHAPES)('declares a valid plot for a %s', (shape) => {
    const r = fourier(shape, 15, 0.35, true);
    const { spec } = synthesisRender(r, { shape, showEach: true })(surface());
    expect(validateChrome(spec)).toEqual([]);
  });

  it('spans exactly one period of the fundamental', () => {
    const r = fourier('square', 9);
    const { spec } = synthesisRender(r, { shape: 'square', showEach: false })(surface());
    expect(spec.x.scale.domain[0]).toBe(0);
    expect(spec.x.scale.domain[1]).toBeCloseTo(1 / r.f0, 18);
  });

  it('leaves room for an overshoot that exceeds the ideal amplitude', () => {
    // One harmonic of a square wave peaks at 4/pi. A fixed +-1 axis would clip it,
    // and the clipped picture would contradict the overshoot metric beside it.
    const r = fourier('square', 1);
    const { spec } = synthesisRender(r, { shape: 'square', showEach: false })(surface());
    expect(spec.y.scale.domain[1]).toBeGreaterThan(4 / Math.PI);
  });

  it('judges the overshoot against the Wilbraham-Gibbs limit for a shape that jumps', () => {
    const { spec } = synthesisRender(fourier('square', 99), {
      shape: 'square',
      showEach: false,
    })(surface());
    const overshoot = spec.metrics.find((m) => m.key === 'overshoot');
    expect(overshoot?.target).toBeCloseTo(GIBBS_OVERSHOOT_OF_JUMP, 15);
    // 99 harmonics is well into the asymptote.
    expect(overshoot?.value).toBeCloseTo(GIBBS_OVERSHOOT_OF_JUMP, 3);
  });

  it('offers no Gibbs target for a triangle, which has nothing to overshoot', () => {
    const { spec } = synthesisRender(fourier('triangle', 15), {
      shape: 'triangle',
      showEach: false,
    })(surface());
    const overshoot = spec.metrics.find((m) => m.key === 'overshoot');
    expect(overshoot?.target).toBeUndefined();
    expect(overshoot?.value).toBeLessThan(0.001);
  });

  it('reports an overshoot peak that moves toward the edge as harmonics are added', () => {
    const offsetAt = (maxN: number): number => {
      const { spec } = synthesisRender(fourier('square', maxN), {
        shape: 'square',
        showEach: false,
      })(surface());
      return spec.metrics.find((m) => m.key === 'peak-offset')?.value ?? NaN;
    };
    // Roughly one half-period of the highest harmonic, so it falls like 1/N.
    expect(offsetAt(41)).toBeLessThan(offsetAt(9));
    expect(offsetAt(9)).toBeLessThan(offsetAt(3));
  });

  it('hides the per-harmonic trace when the job did not return them', () => {
    const { spec } = synthesisRender(fourier('square', 9, 0.5, false), {
      shape: 'square',
      showEach: true,
    })(surface());
    expect(spec.traces.find((t) => t.key === 'each')?.hidden).toBe(true);
    expect(validateChrome(spec)).toEqual([]);
  });

  it('draws the sum on top of the ideal, and both on top of the harmonics', () => {
    const r = fourier('square', 5, 0.5, true);
    const rec = recorder();
    const s = surfaceOf(rec);
    synthesisRender(r, { shape: 'square', showEach: true })(s).drawTraces(s);
    // Muted harmonics first, then the ideal in ch1, then the partial sum in ch3.
    expect(colorSequence(rec)).toEqual(['#2D5673', '#3DDC97', '#5AA9E6']);
  });
});

/* ---------------------------------------------------------------- spectrum */

describe('spectrum figure', () => {
  it.each(SHAPES)('declares a valid plot for a %s', (shape) => {
    const r = fourier(shape, 15, 0.35);
    const { spec } = spectrumRender(r, { shape, duty: 0.35 })(surface());
    expect(validateChrome(spec)).toEqual([]);
  });

  it('marks the fundamental on the frequency axis', () => {
    const r = fourier('square', 9);
    const { spec } = spectrumRender(r, { shape: 'square', duty: 0.5 })(surface());
    // A 1010 stream is a square wave at half the symbol rate.
    expect(spec.x.target).toBeCloseTo(SCENARIO.source.symbolRate / 2, 6);
    expect(r.f0).toBeCloseTo(SCENARIO.source.symbolRate / 2, 6);
  });

  it('reports -20 dB/decade for a square wave and -40 for a triangle', () => {
    const rolloff = (shape: WaveShape): number => {
      const { spec } = spectrumRender(fourier(shape, 15), { shape, duty: 0.5 })(surface());
      return spec.metrics.find((m) => m.key === 'rolloff')?.value ?? NaN;
    };
    expect(rolloff('square')).toBeCloseTo(-20, 9);
    expect(rolloff('sawtooth')).toBeCloseTo(-20, 9);
    expect(rolloff('triangle')).toBeCloseTo(-40, 9);
  });

  it('offers no roll-off figure for a pulse, whose envelope is not a power law', () => {
    const { spec } = spectrumRender(fourier('pulse', 15, 0.25), {
      shape: 'pulse',
      duty: 0.25,
    })(surface());
    expect(spec.metrics.find((m) => m.key === 'rolloff')).toBeUndefined();
  });

  it('recovers the duty cycle from the second harmonic, to the value that made it', () => {
    for (const duty of [0.2, 0.3, 0.42]) {
      const { spec } = spectrumRender(fourier('pulse', 9, duty), { shape: 'pulse', duty })(surface());
      const m = spec.metrics.find((k) => k.key === 'duty-h2');
      expect(m).toBeDefined();
      expect(m?.value).toBeCloseTo(duty, 9);
      expect(m?.target).toBeCloseTo(duty, 9);
    }
  });

  it('says nothing about duty when the second harmonic is a null', () => {
    // At exactly 50% there is no second harmonic to measure, and an infinite dB
    // value would be both true and useless.
    const { spec } = spectrumRender(fourier('pulse', 9, 0.5), { shape: 'pulse', duty: 0.5 })(surface());
    expect(spec.metrics.find((m) => m.key === 'duty-h2')).toBeUndefined();
    expect(spec.metrics.find((m) => m.key === 'h2')).toBeUndefined();
    expect(validateChrome(spec)).toEqual([]);
  });

  it('puts every stem at an integer multiple of the fundamental', () => {
    const r = fourier('square', 11);
    for (const term of r.terms) {
      expect(term.frequency / r.f0).toBeCloseTo(term.n, 9);
    }
  });

  it('clamps a level below the floor rather than drawing off the axis', () => {
    // The 199th harmonic of a square wave is 46 dB down; the 1999th would be past a
    // -60 dB floor. Nothing should be asked to draw below the axis.
    const r = fourier('square', 2001);
    const { spec } = spectrumRender(r, { shape: 'square', duty: 0.5 })(surface());
    const floor = spec.y.scale.domain[0];
    const rec = recorder();
    const s = surfaceOf(rec);
    spectrumRender(r, { shape: 'square', duty: 0.5 })(s).drawTraces(s);
    expect(floor).toBe(-60);
    expect(r.terms.some((t) => t.relativeDb < floor)).toBe(true);
    expect(rec.calls).toContain('stroke');
  });
});
