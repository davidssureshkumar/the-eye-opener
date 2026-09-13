/**
 * CSV export.
 *
 * `toCsv` and `chromeToCsv` are pure string building and are tested here. The two
 * download helpers are not: they need a DOM and a Blob, and the vitest environment
 * is node. What they do is four lines of anchor-click, and testing that against a
 * jsdom stub would only assert that the stub was called.
 *
 * The properties worth pinning are the ones that make an exported file usable a
 * week later by someone who did not take the measurement: it carries units, it
 * carries the setup that produced it, and it does not silently drop rows.
 */

import { describe, expect, it } from 'vitest';
import { chromeToCsv, exportFilename, toCsv, type ExportColumn } from '../export';
import type { ChromeSpec } from '../chrome';
import { linearScale } from '../scale';

const t: ExportColumn = { label: 'Time', unit: 's', values: [0, 1e-9, 2e-9] };
const v: ExportColumn = { label: 'Received', unit: 'V', values: [0, 0.4, 0.78] };

describe('toCsv', () => {
  it('puts the unit in the header, where a spreadsheet will keep it', () => {
    const lines = toCsv([t, v]).split('\n');
    expect(lines[0]).toBe('Time (s),Received (V)');
  });

  it('writes a dimensionless column without a parenthetical', () => {
    const csv = toCsv([{ label: 'Reflection coefficient', unit: '1', values: [0.1] }]);
    expect(csv.split('\n')[0]).toBe('Reflection coefficient');
  });

  it('writes one row per sample', () => {
    const lines = toCsv([t, v]).trim().split('\n');
    expect(lines).toHaveLength(4); // header + 3
    expect(lines[1]).toBe('0,0');
    expect(lines[2]).toBe('1e-9,0.4');
  });

  it('pads a short column instead of truncating a long one', () => {
    // A spectrum and a waveform legitimately differ in length. Cutting the longer
    // one to match would lose data with no error and no warning.
    const csv = toCsv([t, { label: 'Short', unit: 'V', values: [1] }]);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe('1e-9,');
    expect(lines[3]).toBe('2e-9,');
  });

  it('rounds to a stated number of significant figures', () => {
    const csv = toCsv([{ label: 'x', unit: '1', values: [1 / 3] }], { sig: 4 });
    expect(csv.trim().split('\n')[1]).toBe('0.3333');
  });

  it('writes non-finite values as words rather than as empty cells', () => {
    // An empty cell reads as "no data". A NaN that reached the export is a defect,
    // and the file should say so rather than disguise it as a gap.
    const csv = toCsv([{ label: 'x', unit: '1', values: [NaN, Infinity, -Infinity] }]);
    const rows = csv.trim().split('\n').slice(1);
    expect(rows).toEqual(['NaN', 'Inf', '-Inf']);
  });

  it('quotes a label containing a comma, so the columns stay aligned', () => {
    const csv = toCsv([{ label: 'Voltage, differential', unit: 'V', values: [1] }]);
    expect(csv.split('\n')[0]).toBe('"Voltage, differential (V)"');
  });

  it('escapes an embedded quote by doubling it', () => {
    const csv = toCsv([{ label: 'The "eye" height', unit: 'V', values: [1] }]);
    expect(csv.split('\n')[0]).toBe('"The ""eye"" height (V)"');
  });

  it('writes the preamble and the permalink as comments above the header', () => {
    const csv = toCsv([t], { preamble: ['300 mm lossy line'], permalink: 'https://x/#/m4?s=v1~a:1' });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('# 300 mm lossy line');
    expect(lines[1]).toBe('# setup: https://x/#/m4?s=v1~a:1');
    expect(lines[2]).toBe('Time (s)');
  });

  it('ends with a newline, as a text file should', () => {
    expect(toCsv([t]).endsWith('\n')).toBe(true);
  });

  it('produces a header-only file for no rows rather than throwing', () => {
    expect(toCsv([{ label: 'x', unit: '1', values: [] }])).toBe('x\n');
  });
});

describe('chromeToCsv', () => {
  const spec: ChromeSpec = {
    x: { scale: linearScale([0, 1e-8], [0, 800]), unit: 's', title: 'Time' },
    y: { scale: linearScale([-0.5, 0.5], [300, 0]), unit: 'V', title: 'Amplitude' },
    traces: [
      { key: 'tx', label: 'Transmitted', color: '#fff' },
      { key: 'rx', label: 'Received', color: '#0f0' },
    ],
    caption: 'the received waveform after 300 mm of lossy line',
    metrics: [
      { key: 'eh', label: 'Eye height', value: 0.184, unit: 'V' },
      { key: 'n', label: 'Symbols', value: 40000, unit: '1' },
    ],
    notes: ['Illustrative values, not a specification.'],
  };

  const csv = chromeToCsv(
    spec,
    [0, 1e-9],
    [
      { key: 'tx', values: [1, -1] },
      { key: 'rx', values: [0.9, -0.85] },
    ],
  );
  const lines = csv.split('\n');

  it('takes its column names from the legend, so the file cannot disagree with the plot', () => {
    expect(lines[lines.findIndex((l) => !l.startsWith('#'))]).toBe('Time (s),Transmitted (V),Received (V)');
  });

  it('carries the caption, the metrics and the notes into the preamble', () => {
    const preamble = lines.filter((l) => l.startsWith('#')).join('\n');
    expect(preamble).toContain('the received waveform after 300 mm of lossy line');
    expect(preamble).toContain('Eye height: 0.184 V');
    // A dimensionless metric gets no unit appended.
    expect(preamble).toContain('Symbols: 40000');
    expect(preamble).toContain('Illustrative values');
  });

  it('falls back to the series key when a trace was never declared', () => {
    const odd = chromeToCsv(spec, [0], [{ key: 'ghost', values: [1] }]);
    expect(odd.split('\n').find((l) => !l.startsWith('#'))).toBe('Time (s),ghost (V)');
  });
});

describe('exportFilename', () => {
  const when = new Date('2026-09-13T12:34:56Z');

  it('stamps the time, so two exports of the same plot do not collide', () => {
    expect(exportFilename('Eye diagram', 'csv', when)).toBe('eye-diagram-2026-09-13-12-34-56.csv');
  });

  it('strips characters a filesystem would reject', () => {
    expect(exportFilename('S21 / insertion loss (dB)', 'png', when)).toBe(
      's21-insertion-loss-db-2026-09-13-12-34-56.png',
    );
  });

  it('still produces a usable name from an empty or symbolic title', () => {
    expect(exportFilename('', 'csv', when)).toBe('plot-2026-09-13-12-34-56.csv');
    expect(exportFilename('///', 'csv', when)).toBe('plot-2026-09-13-12-34-56.csv');
  });

  it('truncates a very long title rather than producing an unopenable name', () => {
    const name = exportFilename('x'.repeat(200), 'csv', when);
    expect(name.length).toBeLessThan(90);
  });
});
