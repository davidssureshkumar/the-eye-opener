import { describe, expect, it } from 'vitest';
import {
  defaultFormat,
  formatMetricValue,
  describeMetric,
  metricLines,
  describeAxis,
  describeTraces,
  describePlot,
} from '../describe';
import type { ChromeSpec, MetricSpec } from '../chrome';
import { linearScale, logScale } from '../scale';

function metric(over: Partial<MetricSpec> = {}): MetricSpec {
  return { key: 'h', label: 'Eye height', value: 0.142, unit: 'V', ...over };
}

function spec(over: Partial<ChromeSpec> = {}): ChromeSpec {
  return {
    x: { scale: linearScale([0, 2e-9], [62, 662]), unit: 's', title: 'Time' },
    y: { scale: linearScale([-0.5, 0.5], [412, 12]), unit: 'V', title: 'Voltage' },
    traces: [
      { key: 'tx', label: 'Transmitted', color: '#0f0' },
      { key: 'rx', label: 'Received', color: '#0ff', dash: [4, 3] },
    ],
    caption: 'Received waveform after 300 mm of lossy line',
    metrics: [metric()],
    ...over,
  };
}

describe('defaultFormat', () => {
  it('gives physical quantities engineering prefixes', () => {
    expect(defaultFormat('s')).toBe('eng');
    expect(defaultFormat('V')).toBe('eng');
    expect(defaultFormat('Hz')).toBe('eng');
  });

  it('keeps prefixes away from units that do not take them', () => {
    expect(defaultFormat('dB')).toBe('db');
    expect(defaultFormat('UI')).toBe('ui');
    expect(defaultFormat('%')).toBe('percent');
  });

  it('treats a dimensionless quantity as a plain number', () => {
    expect(defaultFormat('1')).toBe('plain');
    expect(defaultFormat('')).toBe('plain');
  });
});

describe('formatMetricValue', () => {
  it('uses an engineering prefix for a physical quantity', () => {
    expect(formatMetricValue(metric({ value: 0.142, unit: 'V' }))).toBe('142 mV');
    expect(formatMetricValue(metric({ value: 25e-12, unit: 's' }))).toBe('25 ps');
  });

  it('never writes a decibel as a milli-decibel', () => {
    expect(formatMetricValue(metric({ value: 0.5, unit: 'dB' }))).toBe('0.5 dB');
    expect(formatMetricValue(metric({ value: -12.34, unit: 'dB', sig: 4 }))).toBe('-12.34 dB');
  });

  it('writes a unit interval as a fraction, not a prefix', () => {
    expect(formatMetricValue(metric({ value: 0.023, unit: 'UI' }))).toBe('0.023 UI');
  });

  it('writes a percentage as a percentage', () => {
    expect(formatMetricValue(metric({ value: 0.0894898, unit: '%', sig: 4 }))).toBe('8.949 %');
  });

  it('writes a bit error rate in decades', () => {
    expect(formatMetricValue(metric({ value: 1e-12, unit: '1', format: 'exp', sig: 1 }))).toBe('1e-12');
  });

  it('writes a count as a count', () => {
    expect(formatMetricValue(metric({ value: 20000, unit: '', format: 'integer' }))).toBe('20,000');
  });

  it('drops trailing zeros from a plain number', () => {
    expect(formatMetricValue(metric({ value: 0.25, unit: '1' }))).toBe('0.25');
    expect(formatMetricValue(metric({ value: 2, unit: '1' }))).toBe('2');
    expect(formatMetricValue(metric({ value: 0, unit: '1' }))).toBe('0');
  });

  it('says so rather than printing nothing when a value is not finite', () => {
    expect(formatMetricValue(metric({ value: NaN }))).toBe('NaN');
    expect(formatMetricValue(metric({ value: Infinity }))).toBe('∞');
    expect(formatMetricValue(metric({ value: -Infinity }))).toBe('-∞');
  });

  it('honours the requested significant figures', () => {
    // Engineering notation counts significant figures on the mantissa and never
    // shows fewer than its three digits: 143 mV, not 0.14 V.
    expect(formatMetricValue(metric({ value: 0.14285, unit: 'V', sig: 2 }))).toBe('143 mV');
    expect(formatMetricValue(metric({ value: 0.14285, unit: 'V', sig: 5 }))).toBe('142.85 mV');
  });
});

describe('describeMetric', () => {
  it('reads as a sentence fragment', () => {
    expect(describeMetric(metric())).toBe('Eye height: 142 mV');
  });

  it('states the target in the same unit as the value', () => {
    expect(describeMetric(metric({ target: 0.1 }))).toBe('Eye height: 142 mV (target 100 mV)');
  });

  it('carries the verdict', () => {
    expect(describeMetric(metric({ target: 0.1, status: 'pass' }))).toBe(
      'Eye height: 142 mV (target 100 mV, pass)',
    );
  });

  it('carries a qualifier the number would be misread without', () => {
    expect(describeMetric(metric({ note: 'statistical extrapolation' }))).toBe(
      'Eye height: 142 mV - statistical extrapolation',
    );
  });

  it('ignores an empty note rather than trailing a dash', () => {
    expect(describeMetric(metric({ note: '  ' }))).toBe('Eye height: 142 mV');
  });

  it('renders one line per metric', () => {
    expect(
      metricLines([metric(), metric({ key: 'w', label: 'Eye width', value: 0.62, unit: 'UI' })]),
    ).toEqual(['Eye height: 142 mV', 'Eye width: 0.620 UI']);
  });
});

describe('describeAxis', () => {
  it('names the quantity and its span', () => {
    expect(describeAxis({ scale: linearScale([0, 2e-9], [0, 600]), unit: 's', title: 'Time' })).toBe(
      'Time, 0 s to 2 ns',
    );
  });

  it('says when a span is logarithmic', () => {
    expect(
      describeAxis({
        scale: logScale([1e6, 1e10], [0, 600]),
        unit: 'Hz',
        title: 'Frequency',
        log: true,
      }),
    ).toBe('Frequency, 1 MHz to 10 GHz, logarithmic');
  });

  it('drops the dimensionless marker rather than reading it out', () => {
    expect(describeAxis({ scale: linearScale([-1, 1], [0, 400]), unit: '1', title: 'Reflection' })).toBe(
      'Reflection, -1 to 1',
    );
  });

  it('mentions a marked target', () => {
    expect(
      describeAxis({
        scale: linearScale([-0.5, 0.5], [400, 0]),
        unit: 'V',
        title: 'Voltage',
        target: 0.1,
      }),
    ).toBe('Voltage, -500 mV to 500 mV, marked at 100 mV');
  });
});

describe('describeTraces', () => {
  it('counts and names them', () => {
    expect(describeTraces(spec().traces)).toBe('2 traces: Transmitted; Received (dashed).');
  });

  it('uses the singular for one', () => {
    expect(describeTraces([{ key: 'a', label: 'Ideal', color: '#fff' }])).toBe('One trace: Ideal.');
  });

  it('describes the picture, not the code: hidden traces are absent', () => {
    expect(
      describeTraces([
        { key: 'a', label: 'Ideal', color: '#fff' },
        { key: 'b', label: 'Equalized', color: '#f0f', hidden: true },
      ]),
    ).toBe('One trace: Ideal.');
  });

  it('says so when there is nothing drawn', () => {
    expect(describeTraces([])).toBe('No traces.');
  });
});

describe('describePlot', () => {
  it('starts with the caption, punctuated once', () => {
    expect(describePlot(spec()).aria.startsWith('Received waveform after 300 mm of lossy line.')).toBe(true);
    expect(describePlot(spec({ caption: 'Already punctuated.' })).aria).toContain(
      'Already punctuated. Horizontal',
    );
  });

  it('states both axes with their spans', () => {
    const d = describePlot(spec());
    expect(d.aria).toContain('Horizontal axis: Time, 0 s to 2 ns.');
    expect(d.aria).toContain('Vertical axis: Voltage, -500 mV to 500 mV.');
  });

  it('gives a reader who cannot see the canvas the same numbers', () => {
    const d = describePlot(spec());
    expect(d.aria).toContain('Eye height: 142 mV');
    expect(d.metrics).toEqual(['Eye height: 142 mV']);
  });

  it('carries the notes, so a warning is not sighted-only', () => {
    const d = describePlot(spec({ notes: ['Illustrative values'] }));
    expect(d.notes).toEqual(['Illustrative values']);
    expect(d.aria.endsWith('Illustrative values.')).toBe(true);
  });

  it('is one flat utterance, with no line breaks for a screen reader to lose', () => {
    expect(describePlot(spec({ notes: ['Illustrative values'] })).aria).not.toContain('\n');
  });

  it('offers a multi-line form for copying out', () => {
    expect(describePlot(spec({ notes: ['Illustrative values'] })).text.split('\n')).toEqual([
      'Received waveform after 300 mm of lossy line',
      'Eye height: 142 mV',
      'Illustrative values',
    ]);
  });

  it('describes a plot that carries no numbers without pretending it does', () => {
    const d = describePlot(spec({ metrics: [] }));
    expect(d.metrics).toEqual([]);
    expect(d.aria).toContain('2 traces:');
  });

  it('is a pure function of the declaration', () => {
    expect(describePlot(spec())).toEqual(describePlot(spec()));
  });
});
