/**
 * Grids and graticules.
 *
 * Two styles, for two different jobs:
 *
 *  - A data grid, drawn at the same positions as the axis ticks. This is for plots
 *    where the reader reads values off the axes.
 *  - A scope graticule: ten divisions across by eight down, with a centre crosshair
 *    and tick marks along the centre lines. This is not decoration. On a real scope
 *    the horizontal control is seconds per division and the vertical is volts per
 *    division, and reading a rise time by counting divisions is the first thing
 *    anyone learns at a bench. Plots that stand in for a scope screen use it, so
 *    the habit transfers.
 */

import { crisp, type Surface } from './canvas';
import { surface } from '../design/tokens';
import { linearTicks, logTicks, type Scale } from './scale';

export interface GridStyle {
  major?: string;
  minor?: string;
  /** Line width in CSS pixels. */
  width?: number;
}

const DEFAULT_GRID: Required<GridStyle> = {
  major: surface.ink700,
  minor: surface.rule,
  width: 1,
};

/** Grid lines at the given x and y data positions. */
export function drawGrid(
  s: Surface,
  xScale: Scale,
  yScale: Scale,
  xTicks: readonly number[],
  yTicks: readonly number[],
  style: GridStyle = {},
): void {
  const st = { ...DEFAULT_GRID, ...style };
  const { ctx, plot } = s;
  ctx.save();
  ctx.strokeStyle = st.major;
  ctx.lineWidth = st.width;
  ctx.beginPath();
  for (const t of xTicks) {
    const px = crisp(xScale(t));
    if (px < plot.x || px > plot.x + plot.width) continue;
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y + plot.height);
  }
  for (const t of yTicks) {
    const py = crisp(yScale(t));
    if (py < plot.y || py > plot.y + plot.height) continue;
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.x + plot.width, py);
  }
  ctx.stroke();
  ctx.restore();
}

/** The same, choosing tick positions automatically from the scales' domains. */
export function drawAutoGrid(s: Surface, xScale: Scale, yScale: Scale, style: GridStyle = {}): void {
  drawGrid(s, xScale, yScale, linearTicks(xScale.domain, 8), linearTicks(yScale.domain, 6), style);
}

/** Decade grid for a log x axis, with faint lines on the 2-9 subdivisions. */
export function drawLogGrid(s: Surface, xScale: Scale, yScale: Scale, style: GridStyle = {}): void {
  const st = { ...DEFAULT_GRID, ...style };
  const { ctx, plot } = s;
  const { major, minor } = logTicks(xScale.domain);

  ctx.save();
  ctx.lineWidth = st.width;
  ctx.strokeStyle = st.minor;
  ctx.beginPath();
  for (const t of minor) {
    const px = crisp(xScale(t));
    if (px < plot.x || px > plot.x + plot.width) continue;
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y + plot.height);
  }
  ctx.stroke();

  ctx.strokeStyle = st.major;
  ctx.beginPath();
  for (const t of major) {
    const px = crisp(xScale(t));
    if (px < plot.x || px > plot.x + plot.width) continue;
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y + plot.height);
  }
  for (const t of linearTicks(yScale.domain, 6)) {
    const py = crisp(yScale(t));
    if (py < plot.y || py > plot.y + plot.height) continue;
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.x + plot.width, py);
  }
  ctx.stroke();
  ctx.restore();
}

export interface GraticuleOptions {
  /** Divisions across. Ten is the near-universal convention. */
  xDivisions?: number;
  /** Divisions down. Eight on almost every scope. */
  yDivisions?: number;
  /** Tick marks per division along the centre lines. Five is conventional. */
  subTicks?: number;
  color?: string;
  centreColor?: string;
}

/**
 * A scope graticule: N by M divisions with a brighter centre crosshair carrying
 * minor tick marks.
 *
 * Drawn in pixel space rather than data space on purpose. The whole point of a
 * graticule is that it is fixed to the screen while the signal moves through it,
 * which is how a scope's timebase and vertical controls behave.
 */
export function drawGraticule(s: Surface, opts: GraticuleOptions = {}): void {
  const xd = opts.xDivisions ?? 10;
  const yd = opts.yDivisions ?? 8;
  const sub = opts.subTicks ?? 5;
  const { ctx, plot } = s;

  ctx.save();
  ctx.lineWidth = 1;

  ctx.strokeStyle = opts.color ?? surface.rule;
  ctx.beginPath();
  for (let i = 1; i < xd; i++) {
    const px = crisp(plot.x + (plot.width * i) / xd);
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y + plot.height);
  }
  for (let i = 1; i < yd; i++) {
    const py = crisp(plot.y + (plot.height * i) / yd);
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.x + plot.width, py);
  }
  ctx.stroke();

  // Centre crosshair with its minor ticks.
  const cx = crisp(plot.x + plot.width / 2);
  const cy = crisp(plot.y + plot.height / 2);
  ctx.strokeStyle = opts.centreColor ?? surface.ink700;
  ctx.beginPath();
  ctx.moveTo(cx, plot.y);
  ctx.lineTo(cx, plot.y + plot.height);
  ctx.moveTo(plot.x, cy);
  ctx.lineTo(plot.x + plot.width, cy);

  const tick = 4;
  const xStep = plot.width / (xd * sub);
  for (let i = 1; i < xd * sub; i++) {
    if (i % sub === 0) continue;
    const px = crisp(plot.x + i * xStep);
    ctx.moveTo(px, cy - tick);
    ctx.lineTo(px, cy + tick);
  }
  const yStep = plot.height / (yd * sub);
  for (let i = 1; i < yd * sub; i++) {
    if (i % sub === 0) continue;
    const py = crisp(plot.y + i * yStep);
    ctx.moveTo(cx - tick, py);
    ctx.lineTo(cx + tick, py);
  }
  ctx.stroke();
  ctx.restore();
}

/** A hairline border around the plot area. */
export function drawFrame(s: Surface, color: string = surface.rule): void {
  const { ctx, plot } = s;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(crisp(plot.x), crisp(plot.y), Math.round(plot.width), Math.round(plot.height));
  ctx.restore();
}

/**
 * The per-division values a graticule implies, for the "s/div" and "V/div" readouts
 * that sit beside a scope screen. Reported rather than assumed so the number in the
 * corner is always the number the picture is actually drawn at.
 */
export function divisionsOf(
  xScale: Scale,
  yScale: Scale,
  xDivisions = 10,
  yDivisions = 8,
): { perXDivision: number; perYDivision: number } {
  const [x0, x1] = xScale.domain;
  const [y0, y1] = yScale.domain;
  return {
    perXDivision: Math.abs(x1 - x0) / xDivisions,
    perYDivision: Math.abs(y1 - y0) / yDivisions,
  };
}
