/**
 * Taking a plot away with you: CSV of the numbers, PNG of the picture.
 *
 * A reader who finds something interesting on a plot generally wants it somewhere
 * else - in a spreadsheet next to a measurement, in a slide, in a bug report. The
 * permalink already carries the *setup*, and it is the better thing to share
 * because it reproduces. These two carry the *result*, for the cases where the
 * recipient has no browser open.
 *
 * Everything here is client-side. The CSV is built as a string and handed to the
 * browser as a Blob; the PNG comes from the canvas the plot already drew into.
 * Nothing is uploaded, which is a requirement of the site rather than a choice.
 *
 * Two decisions worth stating.
 *
 * The CSV carries the values that were *plotted*, not the values that were
 * computed. If a trace was decimated to the pixel grid before drawing, exporting
 * the undecimated array would hand over a file that does not match the picture it
 * came from, and a reader comparing the two would be chasing a difference that is
 * an artefact of the export. So the caller passes what it drew.
 *
 * The header carries the units and the scenario permalink. A column of bare
 * numbers is not a measurement: a file that says `2.4e-11` without saying seconds
 * is a trap, and one that cannot be traced back to the setup that produced it
 * cannot be checked by the person who receives it.
 */

import type { ChromeSpec } from './chrome';

/** One exported column: a name, a unit, and the samples as they were drawn. */
export interface ExportColumn {
  label: string;
  /** SI unit symbol, or '1' for dimensionless. Same convention as `AxisSpec.unit`. */
  unit: string;
  values: ArrayLike<number>;
}

export interface CsvOptions {
  /** Significant figures per value. Six is well past canvas resolution and still short. */
  sig?: number;
  /** Lines placed above the header, each prefixed with '#'. */
  preamble?: readonly string[];
  /** The permalink that reproduces this plot. Written into the preamble. */
  permalink?: string;
}

function cell(x: number, sig: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
  if (x === 0) return '0';
  // toPrecision gives a fixed significant-figure count, which is what a column of
  // numbers wants; the exponent is normalised so a spreadsheet reads it as a number.
  return Number(x.toPrecision(sig)).toString();
}

function quote(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV from columns of equal-or-differing length.
 *
 * Short columns are padded with empty cells rather than truncating the file: a
 * spectrum and a waveform can legitimately appear side by side with different
 * lengths, and dropping the tail of the longer one would lose data silently.
 */
export function toCsv(columns: readonly ExportColumn[], options: CsvOptions = {}): string {
  const sig = options.sig ?? 6;
  const rows = columns.reduce((n, c) => Math.max(n, c.values.length), 0);

  const lines: string[] = [];
  for (const note of options.preamble ?? []) lines.push(`# ${note}`);
  if (options.permalink) lines.push(`# setup: ${options.permalink}`);
  // The unit belongs in the header, not in a separate row: a spreadsheet that
  // imports this should see one header line and then numbers.
  lines.push(columns.map((c) => quote(c.unit === '1' ? c.label : `${c.label} (${c.unit})`)).join(','));

  for (let r = 0; r < rows; r++) {
    const row: string[] = [];
    for (const c of columns) row.push(r < c.values.length ? cell(c.values[r], sig) : '');
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Build a CSV from a plot's declared chrome plus the arrays it drew.
 *
 * Takes the axis units and the trace labels from the same `ChromeSpec` the plot
 * was drawn from, so the file cannot disagree with the legend. The measured
 * numbers go into the preamble, because a reader opening the file a week later
 * needs the eye height that was on screen, not only the samples behind it.
 */
export function chromeToCsv(
  spec: ChromeSpec,
  x: ArrayLike<number>,
  series: readonly { key: string; values: ArrayLike<number> }[],
  options: CsvOptions = {},
): string {
  const columns: ExportColumn[] = [{ label: spec.x.title, unit: spec.x.unit, values: x }];
  for (const s of series) {
    const trace = spec.traces.find((t) => t.key === s.key);
    columns.push({ label: trace?.label ?? s.key, unit: spec.y.unit, values: s.values });
  }

  const preamble = [
    spec.caption,
    ...spec.metrics.map((m) => `${m.label}: ${cell(m.value, 4)}${m.unit === '1' ? '' : ' ' + m.unit}`),
    ...(spec.notes ?? []),
    ...(options.preamble ?? []),
  ];

  return toCsv(columns, { ...options, preamble });
}

/* ------------------------------------------------------------------ delivery */

/** A filename that is safe on every filesystem and still says what it is. */
export function exportFilename(base: string, extension: string, when = new Date()): string {
  const stamp = when.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${safe || 'plot'}-${stamp}.${extension}`;
}

/**
 * Hand a blob to the browser as a download.
 *
 * The object URL is revoked on the next turn of the event loop rather than
 * immediately: revoking it in the same turn as the click races the download in
 * some browsers and produces a silently empty file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Byte-order mark. Excel opens a UTF-8 CSV as the system codepage unless the file
 * starts with one, which turns every micro sign in a header into mojibake.
 */
const BOM = '\uFEFF';

/** Save a CSV string. The BOM is what makes Excel read UTF-8 rather than guess. */
export function downloadCsv(csv: string, base: string): void {
  downloadBlob(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' }), exportFilename(base, 'csv'));
}

/**
 * Save a canvas as a PNG.
 *
 * `toBlob` rather than `toDataURL`: a data URL for a 2000x1200 device-pixel canvas
 * is a several-megabyte string that has to be built, held and parsed, and some
 * browsers cap the length of a URL a link can carry.
 *
 * PNG rather than JPEG deliberately. A plot is line art on a flat background,
 * which is the case PNG compresses well and JPEG ruins: the ringing artefacts JPEG
 * puts around a one-pixel trace look exactly like the ringing the plot is there to
 * show, which makes the exported image actively misleading.
 */
export function downloadPng(canvas: HTMLCanvasElement, base: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas could not be encoded as PNG'));
        return;
      }
      downloadBlob(blob, exportFilename(base, 'png'));
      resolve();
    }, 'image/png');
  });
}
