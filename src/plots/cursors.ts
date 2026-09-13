/**
 * Measurement cursors.
 *
 * Modelled on scope cursors deliberately, including the readout. A pair of vertical
 * cursors reports dt, and next to it 1/dt, because the second most common thing
 * anyone does with a pair of time cursors is measure a period and want the frequency.
 * A pair of horizontal cursors reports dV. Both report the absolute position of each
 * cursor as well as the difference, because a difference alone hides an offset.
 */

import { crisp, inPlot, type Rect, type Surface } from './canvas';
import { font, fontSize, semantic, surface } from '../design/tokens';
import { formatEng, type Scale } from './scale';

export type CursorAxis = 'x' | 'y';

export interface CursorSet {
  /** Vertical cursors, in x data units. */
  x: number[];
  /** Horizontal cursors, in y data units. */
  y: number[];
}

export interface CursorStyle {
  color?: string;
  /** Dash pattern. Scope cursors are dashed so they read as overlay, not signal. */
  dash?: number[];
  /** Show the labelled handle at the end of each cursor. */
  handles?: boolean;
}

const DEFAULT_STYLE: Required<CursorStyle> = {
  color: semantic.cursor,
  dash: [4, 4],
  handles: true,
};

/** Draw a set of cursors over the plot area. */
export function drawCursors(
  s: Surface,
  cursors: CursorSet,
  xScale: Scale,
  yScale: Scale,
  style: CursorStyle = {},
): void {
  const st = { ...DEFAULT_STYLE, ...style };
  const { ctx, plot } = s;

  ctx.save();
  ctx.strokeStyle = st.color;
  ctx.lineWidth = 1;
  ctx.setLineDash(st.dash);

  ctx.beginPath();
  cursors.x.forEach((v) => {
    const px = crisp(xScale(v));
    if (px < plot.x || px > plot.x + plot.width) return;
    ctx.moveTo(px, plot.y);
    ctx.lineTo(px, plot.y + plot.height);
  });
  cursors.y.forEach((v) => {
    const py = crisp(yScale(v));
    if (py < plot.y || py > plot.y + plot.height) return;
    ctx.moveTo(plot.x, py);
    ctx.lineTo(plot.x + plot.width, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  if (st.handles) {
    ctx.fillStyle = st.color;
    ctx.font = `${fontSize.tick}px ${font.mono}`;
    ctx.textBaseline = 'middle';
    cursors.x.forEach((v, i) => {
      const px = xScale(v);
      if (px < plot.x || px > plot.x + plot.width) return;
      drawHandle(ctx, px, plot.y, String.fromCharCode(65 + i), 'top');
    });
    cursors.y.forEach((v, i) => {
      const py = yScale(v);
      if (py < plot.y || py > plot.y + plot.height) return;
      drawHandle(ctx, plot.x, py, String(i + 1), 'left');
    });
  }
  ctx.restore();
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  side: 'top' | 'left',
): void {
  const w = 14;
  const h = 12;
  ctx.save();
  if (side === 'top') {
    ctx.fillRect(x - w / 2, y - h, w, h);
    ctx.fillStyle = surface.ink900;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y - h / 2);
  } else {
    ctx.fillRect(x, y - h / 2, w, h);
    ctx.fillStyle = surface.ink900;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y);
  }
  ctx.restore();
}

export interface CursorReadout {
  label: string;
  value: string;
}

/**
 * The numbers a scope would show beside its cursors.
 *
 * `xUnit` and `yUnit` are SI unit symbols. When the x axis is time, the reciprocal
 * of the difference is reported as a frequency, which is the measurement everyone
 * actually wants when they put two cursors on a period.
 */
export function cursorReadouts(cursors: CursorSet, xUnit = 's', yUnit = 'V'): CursorReadout[] {
  const out: CursorReadout[] = [];

  cursors.x.forEach((v, i) => {
    out.push({ label: String.fromCharCode(65 + i), value: formatEng(v, xUnit, 4) });
  });
  if (cursors.x.length >= 2) {
    const d = cursors.x[1] - cursors.x[0];
    out.push({ label: 'dX', value: formatEng(d, xUnit, 4) });
    if (xUnit === 's' && d !== 0) {
      out.push({ label: '1/dX', value: formatEng(1 / Math.abs(d), 'Hz', 4) });
    }
  }

  cursors.y.forEach((v, i) => {
    out.push({ label: String(i + 1), value: formatEng(v, yUnit, 4) });
  });
  if (cursors.y.length >= 2) {
    out.push({ label: 'dY', value: formatEng(cursors.y[1] - cursors.y[0], yUnit, 4) });
  }

  return out;
}

/**
 * Which cursor, if any, is under the pointer.
 *
 * `tolerance` is in CSS pixels. Grab targets need to be forgiving: a 1-pixel line is
 * not a 1-pixel target, and an 8-pixel tolerance is roughly a fingertip on a
 * trackpad without being so wide that two adjacent cursors become ambiguous.
 */
export function hitTestCursor(
  cursors: CursorSet,
  xScale: Scale,
  yScale: Scale,
  px: number,
  py: number,
  plot: Rect,
  tolerance = 8,
): { axis: CursorAxis; index: number } | null {
  if (!inPlot(plot, px, py)) return null;
  // Plain loops rather than forEach: a closure defeats the narrowing on `best`.
  let axis: CursorAxis = 'x';
  let index = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < cursors.x.length; i++) {
    const d = Math.abs(xScale(cursors.x[i]) - px);
    if (d <= tolerance && d < bestDistance) {
      axis = 'x';
      index = i;
      bestDistance = d;
    }
  }
  for (let i = 0; i < cursors.y.length; i++) {
    const d = Math.abs(yScale(cursors.y[i]) - py);
    if (d <= tolerance && d < bestDistance) {
      axis = 'y';
      index = i;
      bestDistance = d;
    }
  }
  return index < 0 ? null : { axis, index };
}

/**
 * Move a cursor to a pixel position, clamped to the plot area so a cursor cannot be
 * dragged off the plot and lost.
 */
export function moveCursor(
  cursors: CursorSet,
  axis: CursorAxis,
  index: number,
  px: number,
  py: number,
  xScale: Scale,
  yScale: Scale,
  plot: Rect,
): CursorSet {
  const next: CursorSet = { x: [...cursors.x], y: [...cursors.y] };
  if (axis === 'x') {
    const clamped = Math.min(plot.x + plot.width, Math.max(plot.x, px));
    next.x[index] = xScale.invert(clamped);
  } else {
    const clamped = Math.min(plot.y + plot.height, Math.max(plot.y, py));
    next.y[index] = yScale.invert(clamped);
  }
  return next;
}

/**
 * Shade the region between a pair of cursors, the way a scope highlights a
 * measurement gate. Purely to make the measured interval unmistakable.
 */
export function shadeBetween(
  s: Surface,
  axis: CursorAxis,
  a: number,
  b: number,
  scale: Scale,
  color: string = semantic.cursor,
  alpha = 0.07,
): void {
  const { ctx, plot } = s;
  const p0 = scale(Math.min(a, b));
  const p1 = scale(Math.max(a, b));
  const lo = Math.min(p0, p1);
  const hi = Math.max(p0, p1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  if (axis === 'x') {
    const x0 = Math.max(plot.x, lo);
    const x1 = Math.min(plot.x + plot.width, hi);
    if (x1 > x0) ctx.fillRect(x0, plot.y, x1 - x0, plot.height);
  } else {
    const y0 = Math.max(plot.y, lo);
    const y1 = Math.min(plot.y + plot.height, hi);
    if (y1 > y0) ctx.fillRect(plot.x, y0, plot.width, y1 - y0);
  }
  ctx.restore();
}
