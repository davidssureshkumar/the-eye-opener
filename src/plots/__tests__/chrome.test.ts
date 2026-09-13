import { describe, expect, it } from 'vitest';
import {
  legendEntries,
  divisionReadout,
  validateChrome,
  assertChrome,
  drawChrome,
  drawOverlay,
  withChrome,
  type ChromeSpec,
  type TraceSpec,
} from '../chrome';
import { linearScale, logScale } from '../scale';
import { recorder, surfaceOf } from './recorder';

/* ------------------------------------------------------------- fixtures */

function specOf(over: Partial<ChromeSpec> = {}): ChromeSpec {
  return {
    x: { scale: linearScale([0, 2e-9], [62, 662]), unit: 's', title: 'Time' },
    y: { scale: linearScale([-0.5, 0.5], [412, 12]), unit: 'V', title: 'Voltage' },
    traces: [
      { key: 'tx', label: 'Transmitted', color: '#0f0' },
      { key: 'rx', label: 'Received', color: '#0ff', dash: [4, 3] },
    ],
    caption: 'Transmitted and received waveform at the receiver pin',
    metrics: [{ key: 'vpp', label: 'Amplitude', value: 0.5, unit: 'V' }],
    ...over,
  };
}

/* -------------------------------------------------------------- legend */

describe('legendEntries', () => {
  it('names every visible trace, in draw order', () => {
    expect(legendEntries(specOf().traces).map((e) => e.label)).toEqual(['Transmitted', 'Received']);
  });

  it('carries the dash through, so the swatch matches the trace', () => {
    expect(legendEntries(specOf().traces)[1].dash).toEqual([4, 3]);
  });

  it('omits a hidden trace, because it is not on the plot to be identified', () => {
    const traces: TraceSpec[] = [
      { key: 'a', label: 'A', color: '#f00' },
      { key: 'b', label: 'B', color: '#0f0', hidden: true },
    ];
    expect(legendEntries(traces).map((e) => e.label)).toEqual(['A']);
  });

  it('is empty when everything is hidden', () => {
    expect(legendEntries([{ key: 'a', label: 'A', color: '#f00', hidden: true }])).toEqual([]);
  });
});

/* ------------------------------------------------------------ readout */

describe('divisionReadout', () => {
  it('divides the domain by the divisions, in engineering units', () => {
    // 2 ns across ten divisions, 1 V across eight.
    expect(divisionReadout(specOf().x, specOf().y)).toEqual(['200 ps/div', '125 mV/div']);
  });

  it('follows the scales rather than a remembered setting', () => {
    const s = specOf({ x: { scale: linearScale([0, 1e-9], [0, 100]), unit: 's', title: 'Time' } });
    expect(divisionReadout(s.x, s.y)[0]).toBe('100 ps/div');
  });

  it('honours a non-standard division count', () => {
    expect(divisionReadout(specOf().x, specOf().y, 4, 4)[0]).toBe('500 ps/div');
  });

  it('is unaffected by an inverted pixel range, since only the domain matters', () => {
    const flipped = { scale: linearScale([0, 2e-9], [662, 62]), unit: 's', title: 'Time' };
    expect(divisionReadout(flipped, specOf().y)[0]).toBe('200 ps/div');
  });

  /**
   * A decade axis has no constant value per division, so quoting one would be
   * arithmetic applied to the wrong kind of axis - the same error as averaging
   * decibels.
   */
  it('omits a log axis', () => {
    const s = specOf({
      x: { scale: logScale([1e6, 1e10], [62, 662]), unit: 'Hz', title: 'Frequency', log: true },
      y: { scale: linearScale([-60, 0], [412, 12]), unit: 'dB', title: 'Insertion loss' },
    });
    expect(divisionReadout(s.x, s.y)).toEqual(['7.5 dB/div']);
  });

  it('omits a dimensionless axis rather than printing a bare number per division', () => {
    const s = specOf({
      y: { scale: linearScale([-1, 1], [412, 12]), unit: '1', title: 'Reflection coefficient' },
    });
    expect(divisionReadout(s.x, s.y)).toEqual(['200 ps/div']);
  });
});

/* ----------------------------------------------------------- validation */

describe('validateChrome', () => {
  it('passes a well-formed plot', () => {
    expect(validateChrome(specOf())).toEqual([]);
  });

  it('catches an axis with no title', () => {
    const s = specOf({ y: { scale: linearScale([0, 1], [0, 1]), unit: 'V', title: '  ' } });
    expect(validateChrome(s)).toContain('y axis has no title');
  });

  it('catches a missing unit', () => {
    const s = specOf({ y: { scale: linearScale([0, 1], [0, 1]), unit: '', title: 'Amplitude' } });
    expect(validateChrome(s).join()).toMatch(/y axis "Amplitude" has no unit/);
  });

  it("accepts '1' as a deliberate statement that the quantity is dimensionless", () => {
    const s = specOf({
      y: { scale: linearScale([0, 1], [0, 1]), unit: '1', title: 'Reflection coefficient' },
    });
    expect(validateChrome(s)).toEqual([]);
  });

  it('accepts a bare count axis, which genuinely has no unit', () => {
    const s = specOf({
      y: { scale: linearScale([0, 500], [0, 1]), unit: '', title: 'Hit count' },
    });
    expect(validateChrome(s)).toEqual([]);
  });

  it('catches an unlabelled trace', () => {
    const s = specOf({ traces: [{ key: 'rx', label: '', color: '#0f0' }] });
    expect(validateChrome(s)).toContain('trace "rx" has no label');
  });

  it('catches duplicate trace keys', () => {
    const s = specOf({
      traces: [
        { key: 'rx', label: 'A', color: '#f00' },
        { key: 'rx', label: 'B', color: '#0f0' },
      ],
    });
    expect(validateChrome(s)).toContain('duplicate trace key "rx"');
  });

  it('catches two traces with the same label', () => {
    const s = specOf({
      traces: [
        { key: 'a', label: 'Received', color: '#f00' },
        { key: 'b', label: 'Received', color: '#0f0' },
      ],
    });
    expect(validateChrome(s)).toContain('duplicate trace label "Received"');
  });

  /**
   * The failure this whole helper exists to prevent: a legend that maps two names
   * onto one appearance, which tells the reader less than no legend would.
   */
  it('catches two traces drawn identically', () => {
    const s = specOf({
      traces: [
        { key: 'a', label: 'Ideal', color: '#0f0' },
        { key: 'b', label: 'Measured', color: '#0f0' },
      ],
    });
    expect(validateChrome(s)).toContain('traces "a" and "b" are drawn identically');
  });

  it('allows the same colour when the dash tells them apart', () => {
    const s = specOf({
      traces: [
        { key: 'a', label: 'Ideal', color: '#0f0', dash: [4, 3] },
        { key: 'b', label: 'Measured', color: '#0f0' },
      ],
    });
    expect(validateChrome(s)).toEqual([]);
  });

  it('ignores a hidden trace when checking appearances', () => {
    const s = specOf({
      traces: [
        { key: 'a', label: 'Ideal', color: '#0f0' },
        { key: 'b', label: 'Measured', color: '#0f0', hidden: true },
      ],
    });
    expect(validateChrome(s)).toEqual([]);
  });

  it('refuses to suppress the legend on a multi-trace plot', () => {
    expect(validateChrome(specOf({ legend: 'none' }))).toContain(
      '2 visible traces but the legend is suppressed',
    );
  });

  it('allows the legend off when there is only one trace to identify', () => {
    const s = specOf({ legend: 'none', traces: [{ key: 'a', label: 'A', color: '#f00' }] });
    expect(validateChrome(s)).toEqual([]);
  });

  it('reports every problem at once rather than the first', () => {
    const s = specOf({
      x: { scale: linearScale([0, 1], [0, 1]), unit: '', title: '' },
      traces: [
        { key: 'a', label: '', color: '#f00' },
        { key: 'a', label: '', color: '#f00' },
      ],
    });
    expect(validateChrome(s).length).toBeGreaterThanOrEqual(4);
  });
});

describe('assertChrome', () => {
  it('says nothing about a valid plot', () => {
    expect(() => assertChrome(specOf())).not.toThrow();
  });

  it('names the plot and lists the problems', () => {
    expect(() => assertChrome(specOf({ legend: 'none' }), 'spectrum')).toThrow(/spectrum:.*legend/);
  });
});

/* -------------------------------------------------------------- drawing */

describe('drawChrome', () => {
  it('paints a background, a grid, both axes and a frame', () => {
    const r = recorder();
    drawChrome(surfaceOf(r), specOf());
    expect(r.calls).toContain('fillRect');
    expect(r.calls).toContain('stroke');
    // The unit rides on the tick labels, in engineering notation, so the title is
    // the bare quantity rather than "Time (s)" repeated against "500 ps".
    expect(r.texts).toContain('Time');
    expect(r.texts).toContain('Voltage');
    expect(r.texts.some((t) => t.endsWith(' ns'))).toBe(true);
    expect(r.texts.some((t) => t.endsWith(' mV'))).toBe(true);
  });

  it('balances every save with a restore', () => {
    const r = recorder();
    drawChrome(surfaceOf(r), specOf());
    expect(r.depth).toBe(0);
  });

  it('titles a dimensionless axis without a stray "(1)"', () => {
    const r = recorder();
    drawChrome(
      surfaceOf(r),
      specOf({
        y: { scale: linearScale([-1, 1], [412, 12]), unit: '1', title: 'Reflection coefficient' },
      }),
    );
    expect(r.texts).toContain('Reflection coefficient');
    // '1' is a marker that the quantity is dimensionless, not a unit to print.
    expect(r.texts.some((t) => t.includes('1') && t.includes('coefficient'))).toBe(false);
    expect(r.texts.some((t) => /^-?[\d.]+ 1$/.test(t))).toBe(false);
  });

  it('draws a log axis when asked', () => {
    const r = recorder();
    drawChrome(
      surfaceOf(r),
      specOf({
        x: { scale: logScale([1e6, 1e10], [62, 662]), unit: 'Hz', title: 'Frequency', log: true },
        y: { scale: linearScale([-60, 0], [412, 12]), unit: 'dB', title: 'Insertion loss' },
      }),
    );
    expect(r.texts).toContain('Frequency');
    expect(r.texts).toContain('Insertion loss');
    expect(r.depth).toBe(0);
  });
});

describe('drawOverlay', () => {
  it('draws the legend labels and the per-division readout', () => {
    const r = recorder();
    drawOverlay(surfaceOf(r), specOf());
    expect(r.texts).toContain('Transmitted');
    expect(r.texts).toContain('Received');
    expect(r.texts).toContain('200 ps/div');
    expect(r.texts).toContain('125 mV/div');
  });

  it('appends notes under the readout', () => {
    const r = recorder();
    drawOverlay(surfaceOf(r), specOf({ notes: ['Illustrative values'] }));
    expect(r.texts).toContain('Illustrative values');
  });

  it('uses an explicit readout instead of the divisions when given one', () => {
    const r = recorder();
    drawOverlay(surfaceOf(r), specOf({ readout: ['1e5 bits'] }));
    expect(r.texts).toContain('1e5 bits');
    expect(r.texts).not.toContain('200 ps/div');
  });

  it('draws nothing at all when both are suppressed', () => {
    const r = recorder();
    drawOverlay(surfaceOf(r), specOf({ legend: 'none', readout: 'none' }));
    expect(r.texts).toEqual([]);
  });
});

describe('withChrome', () => {
  it('draws traces between the chrome and the overlay, clipped', () => {
    const r = recorder();
    let drewAt = -1;
    withChrome(surfaceOf(r), specOf(), () => {
      drewAt = r.calls.length;
      r.calls.push('traces');
    });
    const legendAt = r.texts.indexOf('Transmitted');
    expect(drewAt).toBeGreaterThan(0);
    expect(legendAt).toBeGreaterThanOrEqual(0);
    // The legend text is emitted after the trace callback ran.
    expect(r.calls.indexOf('traces')).toBeLessThan(r.calls.lastIndexOf('fillText'));
    expect(r.clips).toBe(1);
    expect(r.depth).toBe(0);
  });

  it('restores the context even when the trace callback throws', () => {
    const r = recorder();
    expect(() =>
      withChrome(surfaceOf(r), specOf(), () => {
        throw new Error('bad data');
      }),
    ).toThrow('bad data');
    expect(r.depth).toBe(0);
  });
});

/* ------------------------------------------------- caption and metrics */

describe('validateChrome: description', () => {
  it('accepts a plot that says what it shows', () => {
    expect(validateChrome(specOf())).toEqual([]);
  });

  it('rejects a plot with no caption', () => {
    expect(validateChrome(specOf({ caption: '   ' }))).toContain('plot has no caption');
  });

  it('rejects a plot that never declares its metrics', () => {
    const s = specOf();
    delete (s as { metrics?: unknown }).metrics;
    expect(validateChrome(s)).toContain('plot declares no metrics (use [] if it genuinely has none)');
  });

  it('accepts an explicit statement that there are no numbers', () => {
    expect(validateChrome(specOf({ metrics: [] }))).toEqual([]);
  });

  it('rejects a metric with no unit unless it is a count', () => {
    expect(
      validateChrome(specOf({ metrics: [{ key: 'x', label: 'Margin', value: 1, unit: '' }] })),
    ).toContain('metric "x" has no unit (use \'1\' if dimensionless)');
    expect(
      validateChrome(specOf({ metrics: [{ key: 'n', label: 'Bit count', value: 20, unit: '' }] })),
    ).toEqual([]);
    expect(
      validateChrome(specOf({ metrics: [{ key: 'r', label: 'Reflection', value: 0.2, unit: '1' }] })),
    ).toEqual([]);
  });

  it('rejects a NaN that would otherwise reach the reader', () => {
    expect(
      validateChrome(specOf({ metrics: [{ key: 'h', label: 'Eye height', value: NaN, unit: 'V' }] })),
    ).toContain('metric "h" is not finite');
  });

  it('rejects duplicate metric keys and labels', () => {
    const problems = validateChrome(
      specOf({
        metrics: [
          { key: 'h', label: 'Eye height', value: 0.1, unit: 'V' },
          { key: 'h', label: 'Eye height', value: 0.2, unit: 'V' },
        ],
      }),
    );
    expect(problems).toContain('duplicate metric key "h"');
    expect(problems).toContain('duplicate metric label "Eye height"');
  });

  it('rejects a verdict with nothing to judge it against', () => {
    expect(
      validateChrome(
        specOf({
          metrics: [{ key: 'h', label: 'Eye height', value: 0.1, unit: 'V', status: 'fail' }],
        }),
      ),
    ).toContain('metric "h" has a verdict but no target to judge it against');
  });

  it('accepts a verdict that names its target', () => {
    expect(
      validateChrome(
        specOf({
          metrics: [{ key: 'h', label: 'Eye height', value: 0.1, unit: 'V', target: 0.08, status: 'pass' }],
        }),
      ),
    ).toEqual([]);
  });
});

describe('metrics on the canvas', () => {
  it('are off by default, because they belong in the DOM', () => {
    const r = recorder();
    drawOverlay(surfaceOf(r), specOf());
    expect(r.texts.some((t) => t.includes('Amplitude'))).toBe(false);
  });

  it('are painted when the plot asks for them', () => {
    const r = recorder();
    drawOverlay(surfaceOf(r), specOf({ metricsCorner: 'tl' }));
    expect(r.texts.some((t) => t.includes('Amplitude: 500 mV'))).toBe(true);
  });

  it('are not painted when there are none to paint', () => {
    const r = recorder();
    const before = recorder();
    drawOverlay(surfaceOf(before), specOf({ metricsCorner: 'none', metrics: [] }));
    drawOverlay(surfaceOf(r), specOf({ metricsCorner: 'tl', metrics: [] }));
    expect(r.texts).toEqual(before.texts);
  });
});
