/**
 * Draw-call transcripts for a whole plot.
 *
 * `chrome.test.ts` checks the pieces. This checks the sequence: that the
 * background is painted before the grid, the grid before the axes, the traces
 * inside a clip, and the legend after the traces rather than under them. Those are
 * the defects that survive unit tests of the parts - every piece correct, the
 * picture still wrong.
 *
 * The snapshot at the end is a condensed transcript: op counts and the text drawn.
 * It is small enough to review in a diff, and it fails when a plot silently stops
 * drawing something.
 */

import { describe, expect, it } from 'vitest';
import { withChrome, drawChrome, type ChromeSpec } from '../chrome';
import { drawXY } from '../trace';
import { linearScale, logScale } from '../scale';
import { recorder, surfaceOf, outline, opCounts, colorSequence, indexOfOp, indexOfText } from './recorder';

const TX = '#39d353';
const RX = '#58a6ff';

function waveformSpec(over: Partial<ChromeSpec> = {}): ChromeSpec {
  return {
    x: { scale: linearScale([0, 2e-9], [62, 662]), unit: 's', title: 'Time' },
    y: { scale: linearScale([-0.5, 0.5], [412, 12]), unit: 'V', title: 'Voltage' },
    traces: [
      { key: 'tx', label: 'Transmitted', color: TX },
      { key: 'rx', label: 'Received', color: RX, dash: [4, 3] },
    ],
    caption: 'Transmitted and received waveform at the receiver pin',
    metrics: [
      { key: 'vpp', label: 'Amplitude', value: 0.5, unit: 'V' },
      { key: 'tr', label: 'Rise time', value: 25e-12, unit: 's' },
    ],
    grid: 'graticule',
    notes: ['Illustrative values'],
    ...over,
  };
}

function bodeSpec(): ChromeSpec {
  return {
    x: { scale: logScale([1e6, 1e11], [62, 662]), unit: 'Hz', title: 'Frequency', log: true },
    y: { scale: linearScale([-40, 5], [412, 12]), unit: 'dB', title: 'Insertion loss' },
    traces: [{ key: 'sdd21', label: 'Sdd21', color: RX }],
    caption: 'Insertion loss of 300 mm of lossy stripline',
    metrics: [{ key: 'nyq', label: 'Loss at Nyquist', value: -12.4, unit: 'dB' }],
    grid: 'auto',
    legend: 'none',
  };
}

/** Two traces drawn the way a module draws them. */
function drawBoth(spec: ChromeSpec, r: ReturnType<typeof recorder>): void {
  const s = surfaceOf(r);
  const t = [0, 0.5e-9, 1e-9, 1.5e-9, 2e-9];
  const a = [-0.4, 0.4, 0.4, -0.4, -0.4];
  const b = [-0.3, 0.25, 0.3, -0.28, -0.3];
  drawXY(s, t, a, spec.x.scale, spec.y.scale, { color: TX });
  drawXY(s, t, b, spec.x.scale, spec.y.scale, { color: RX, dash: [4, 3] });
}

describe('drawing order', () => {
  it('paints the background before anything else', () => {
    const r = recorder();
    drawChrome(surfaceOf(r), waveformSpec());
    expect(r.calls[0] === 'save' || r.calls[0] === 'fillRect' || r.calls[0].startsWith('set')).toBe(true);
    expect(indexOfOp(r, 'fillRect')).toBeLessThan(indexOfOp(r, 'fillText'));
  });

  it('labels the axes after the grid is under them', () => {
    const r = recorder();
    drawChrome(surfaceOf(r), waveformSpec());
    expect(indexOfOp(r, 'stroke')).toBeLessThan(indexOfOp(r, 'fillText'));
  });

  it('clips the traces to the plot area', () => {
    const r = recorder();
    const spec = waveformSpec();
    withChrome(surfaceOf(r), spec, () => drawBoth(spec, r));
    expect(r.clips).toBeGreaterThanOrEqual(1);
  });

  it('draws the legend after the traces, not under them', () => {
    const r = recorder();
    const spec = waveformSpec();
    let tracesEndedAt = -1;
    withChrome(surfaceOf(r), spec, () => {
      drawBoth(spec, r);
      tracesEndedAt = r.ops.length;
    });
    expect(indexOfText(r, 'Transmitted')).toBeGreaterThan(tracesEndedAt);
  });

  it('restores every save it makes', () => {
    const r = recorder();
    const spec = waveformSpec();
    withChrome(surfaceOf(r), spec, () => drawBoth(spec, r));
    expect(r.depth).toBe(0);
    expect(r.maxDepth).toBeGreaterThan(0);
  });

  it('restores the context even when the trace drawing throws', () => {
    const r = recorder();
    expect(() =>
      withChrome(surfaceOf(r), waveformSpec(), () => {
        throw new Error('bad data');
      }),
    ).toThrow('bad data');
    expect(r.depth).toBe(0);
  });
});

describe('what reaches the canvas', () => {
  it('names every trace in the legend', () => {
    const r = recorder();
    const spec = waveformSpec();
    withChrome(surfaceOf(r), spec, () => drawBoth(spec, r));
    expect(r.texts).toContain('Transmitted');
    expect(r.texts).toContain('Received');
  });

  it('draws the legend swatch in the colour the trace was drawn in', () => {
    const r = recorder();
    const spec = waveformSpec();
    withChrome(surfaceOf(r), spec, () => drawBoth(spec, r));
    const colors = colorSequence(r);
    expect(colors).toContain(TX);
    expect(colors).toContain(RX);
    // Once for the trace, once for the swatch: a legend keyed to a colour nobody
    // used is the failure this catches.
    expect(colors.filter((c) => c === TX).length).toBeGreaterThanOrEqual(2);
  });

  it('states the timebase and the volts per division', () => {
    const r = recorder();
    const spec = waveformSpec();
    withChrome(surfaceOf(r), spec, () => drawBoth(spec, r));
    expect(r.texts.some((t) => t.endsWith('/div') && t.includes('s'))).toBe(true);
    expect(r.texts.some((t) => t.endsWith('/div') && t.includes('V'))).toBe(true);
  });

  it('carries the illustrative warning onto the picture', () => {
    const r = recorder();
    const spec = waveformSpec();
    withChrome(surfaceOf(r), spec, () => drawBoth(spec, r));
    expect(r.texts).toContain('Illustrative values');
  });

  it('omits a per-division readout on a logarithmic axis, where it would be a lie', () => {
    const r = recorder();
    withChrome(surfaceOf(r), bodeSpec(), () => undefined);
    expect(r.texts.some((t) => t.includes('Hz/div'))).toBe(false);
    expect(r.texts.some((t) => t.endsWith('/div'))).toBe(true);
  });

  it('labels a logarithmic axis by decade', () => {
    const r = recorder();
    withChrome(surfaceOf(r), bodeSpec(), () => undefined);
    // Decades, not engineering prefixes: a five-decade sweep labelled
    // "1 MHz, 10 MHz, 100 MHz, 1 GHz" mixes units on one axis.
    expect(r.texts).toContain('10^6');
    expect(r.texts).toContain('10^11');
  });

  it('draws no legend for a single trace that suppressed it', () => {
    const r = recorder();
    withChrome(surfaceOf(r), bodeSpec(), () => undefined);
    expect(r.texts).not.toContain('Sdd21');
  });
});

describe('condensed transcripts', () => {
  it('a waveform plot', () => {
    const r = recorder();
    const spec = waveformSpec();
    withChrome(surfaceOf(r), spec, () => drawBoth(spec, r));
    expect({ ops: opCounts(r), texts: r.texts }).toMatchSnapshot();
  });

  it('a Bode plot', () => {
    const r = recorder();
    withChrome(surfaceOf(r), bodeSpec(), () => undefined);
    expect({ ops: opCounts(r), texts: r.texts }).toMatchSnapshot();
  });

  it('an outline is short enough to read', () => {
    const r = recorder();
    drawChrome(surfaceOf(r), waveformSpec({ grid: 'none' }));
    expect(outline(r).length).toBeLessThan(200);
  });
});
