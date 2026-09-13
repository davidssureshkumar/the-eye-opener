/**
 * Axes: tick marks, tick labels and axis titles.
 *
 * Labels come from formatTicks() in scale.ts, which picks one SI prefix and one
 * decimal count for the whole axis. That is the difference between an axis that
 * reads "0, 500 ps, 1 ns, 1.5 ns" and one that reads "0.0, 0.5, 1.0, 1.5 ns".
 */

import { crisp, type Surface } from './canvas';
import { font, fontSize, surface } from '../design/tokens';
import { formatDecade, formatTicks, linearTicks, logTicks, type Scale } from './scale';

export interface AxisOptions {
  /** Unit symbol appended to every label: 's', 'Hz', 'V', 'dB', 'UI'. */
  unit?: string;
  /** Axis title, drawn outside the ticks. */
  title?: string;
  /** Explicit tick positions. Omit to choose automatically. */
  ticks?: readonly number[];
  /** Roughly how many ticks to aim for when choosing automatically. */
  target?: number;
  color?: string;
  labelColor?: string;
  /** Tick mark length in CSS pixels. */
  tickLength?: number;
}

/** Draw the x axis along the bottom of the plot area. */
export function drawXAxis(s: Surface, scale: Scale, opts: AxisOptions = {}): void {
  const { ctx, plot } = s;
  const ticks = opts.ticks ?? linearTicks(scale.domain, opts.target ?? 8);
  const labels = formatTicks(ticks, opts.unit ?? '');
  const tickLength = opts.tickLength ?? 4;
  const y = plot.y + plot.height;

  ctx.save();
  ctx.strokeStyle = opts.color ?? surface.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, crisp(y));
  ctx.lineTo(plot.x + plot.width, crisp(y));
  for (const t of ticks) {
    const px = crisp(scale(t));
    if (px < plot.x - 0.5 || px > plot.x + plot.width + 0.5) continue;
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + tickLength);
  }
  ctx.stroke();

  ctx.fillStyle = opts.labelColor ?? surface.textLo;
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ticks.forEach((t, i) => {
    const px = scale(t);
    if (px < plot.x - 0.5 || px > plot.x + plot.width + 0.5) return;
    ctx.fillText(labels[i], px, y + tickLength + 3);
  });

  if (opts.title) {
    ctx.textAlign = 'center';
    ctx.fillStyle = opts.labelColor ?? surface.textLo;
    ctx.font = `${fontSize.micro}px ${font.sans}`;
    ctx.fillText(opts.title, plot.x + plot.width / 2, y + tickLength + fontSize.tick + 8);
  }
  ctx.restore();
}

/** Draw the y axis down the left of the plot area. */
export function drawYAxis(s: Surface, scale: Scale, opts: AxisOptions = {}): void {
  const { ctx, plot } = s;
  const ticks = opts.ticks ?? linearTicks(scale.domain, opts.target ?? 6);
  const labels = formatTicks(ticks, opts.unit ?? '');
  const tickLength = opts.tickLength ?? 4;
  const x = plot.x;

  ctx.save();
  ctx.strokeStyle = opts.color ?? surface.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(crisp(x), plot.y);
  ctx.lineTo(crisp(x), plot.y + plot.height);
  for (const t of ticks) {
    const py = crisp(scale(t));
    if (py < plot.y - 0.5 || py > plot.y + plot.height + 0.5) continue;
    ctx.moveTo(x, py);
    ctx.lineTo(x - tickLength, py);
  }
  ctx.stroke();

  ctx.fillStyle = opts.labelColor ?? surface.textLo;
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ticks.forEach((t, i) => {
    const py = scale(t);
    if (py < plot.y - 0.5 || py > plot.y + plot.height + 0.5) return;
    ctx.fillText(labels[i], x - tickLength - 4, py);
  });

  if (opts.title) {
    // Rotated, because a vertical unit label stacked letter by letter is unreadable.
    ctx.save();
    ctx.translate(12, plot.y + plot.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${fontSize.micro}px ${font.sans}`;
    ctx.fillText(opts.title, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** Log x axis, labelled at the decades only. */
export function drawLogXAxis(s: Surface, scale: Scale, opts: AxisOptions = {}): void {
  const { ctx, plot } = s;
  const { major, minor } = logTicks(scale.domain);
  const tickLength = opts.tickLength ?? 4;
  const y = plot.y + plot.height;

  ctx.save();
  ctx.strokeStyle = opts.color ?? surface.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, crisp(y));
  ctx.lineTo(plot.x + plot.width, crisp(y));
  for (const t of minor) {
    const px = crisp(scale(t));
    if (px < plot.x || px > plot.x + plot.width) continue;
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + tickLength / 2);
  }
  for (const t of major) {
    const px = crisp(scale(t));
    if (px < plot.x || px > plot.x + plot.width) continue;
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + tickLength);
  }
  ctx.stroke();

  ctx.fillStyle = opts.labelColor ?? surface.textLo;
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labels = formatTicks(major, opts.unit ?? '');
  major.forEach((t, i) => {
    const px = scale(t);
    if (px < plot.x || px > plot.x + plot.width) return;
    // Over more than four decades, exponent labels are shorter and clearer.
    const text = major.length > 5 ? formatDecade(t) : labels[i];
    ctx.fillText(text, px, y + tickLength + 3);
  });

  if (opts.title) {
    ctx.font = `${fontSize.micro}px ${font.sans}`;
    ctx.fillText(opts.title, plot.x + plot.width / 2, y + tickLength + fontSize.tick + 8);
  }
  ctx.restore();
}

/** Log y axis, for a bathtub's BER. */
export function drawLogYAxis(s: Surface, scale: Scale, opts: AxisOptions = {}): void {
  const { ctx, plot } = s;
  const { major, minor } = logTicks(scale.domain);
  const tickLength = opts.tickLength ?? 4;
  const x = plot.x;

  ctx.save();
  ctx.strokeStyle = opts.color ?? surface.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(crisp(x), plot.y);
  ctx.lineTo(crisp(x), plot.y + plot.height);
  for (const t of minor) {
    const py = crisp(scale(t));
    if (py < plot.y || py > plot.y + plot.height) continue;
    ctx.moveTo(x, py);
    ctx.lineTo(x - tickLength / 2, py);
  }
  for (const t of major) {
    const py = crisp(scale(t));
    if (py < plot.y || py > plot.y + plot.height) continue;
    ctx.moveTo(x, py);
    ctx.lineTo(x - tickLength, py);
  }
  ctx.stroke();

  ctx.fillStyle = opts.labelColor ?? surface.textLo;
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of major) {
    const py = scale(t);
    if (py < plot.y || py > plot.y + plot.height) continue;
    ctx.fillText(formatDecade(t), x - tickLength - 4, py);
  }

  if (opts.title) {
    ctx.save();
    ctx.translate(12, plot.y + plot.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.font = `${fontSize.micro}px ${font.sans}`;
    ctx.fillText(opts.title, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * A small legend in a corner of the plot.
 *
 * Kept on the canvas rather than in DOM beside it so that a saved image of the plot
 * still says what each trace is - which matters the moment someone pastes one of
 * these into a bug report.
 */
export function drawLegend(
  s: Surface,
  entries: ReadonlyArray<{ label: string; color: string; dash?: number[] }>,
  corner: 'tl' | 'tr' | 'bl' | 'br' = 'tr',
): void {
  if (entries.length === 0) return;
  const { ctx, plot } = s;
  const pad = 8;
  const lineH = fontSize.readout + 4;
  const swatch = 16;

  ctx.save();
  ctx.font = `${fontSize.micro}px ${font.sans}`;
  let maxW = 0;
  for (const e of entries) maxW = Math.max(maxW, ctx.measureText(e.label).width);
  const boxW = swatch + 6 + maxW + pad * 2;
  const boxH = entries.length * lineH + pad * 2 - 4;

  const x = corner === 'tl' || corner === 'bl' ? plot.x + 8 : plot.x + plot.width - boxW - 8;
  const y = corner === 'tl' || corner === 'tr' ? plot.y + 8 : plot.y + plot.height - boxH - 8;

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = surface.ink900;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = surface.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(crisp(x), crisp(y), Math.round(boxW), Math.round(boxH));

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  entries.forEach((e, i) => {
    const cy = y + pad + i * lineH + lineH / 2 - 2;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(e.dash ?? []);
    ctx.beginPath();
    ctx.moveTo(x + pad, cy);
    ctx.lineTo(x + pad + swatch, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = surface.textHi;
    ctx.fillText(e.label, x + pad + swatch + 6, cy);
  });
  ctx.restore();
}

/**
 * A short line of text in a corner: the "2 ns/div, 100 mV/div" readout, a sample
 * count, a warning that a plot is showing an approximation.
 */
export function drawCornerText(
  s: Surface,
  lines: readonly string[],
  corner: 'tl' | 'tr' | 'bl' | 'br' = 'br',
  color: string = surface.textLo,
): void {
  if (lines.length === 0) return;
  const { ctx, plot } = s;
  ctx.save();
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.fillStyle = color;
  const lineH = fontSize.tick + 3;
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  ctx.textAlign = left ? 'left' : 'right';
  ctx.textBaseline = top ? 'top' : 'bottom';
  const x = left ? plot.x + 6 : plot.x + plot.width - 6;
  lines.forEach((line, i) => {
    const y = top ? plot.y + 6 + i * lineH : plot.y + plot.height - 6 - (lines.length - 1 - i) * lineH;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}
