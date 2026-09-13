/**
 * Heatmaps: a 2D grid of values painted as coloured cells.
 *
 * This is the shmoo plot. On a real part you sweep two knobs - typically a strobe
 * delay against a reference voltage, or a voltage against a temperature - and at each
 * cell you run a pattern and record whether it passed, or how many bits failed, or
 * the measured margin. The picture that comes out is how a validation engineer sees
 * the shape of a failure: a corner that closes, a band that walks with temperature,
 * a hole in the middle of an otherwise passing region.
 *
 * Two rendering paths, and the difference matters:
 *
 *  - `drawHeatmap` fills one rectangle per cell. Correct for a coarse sweep, where
 *    cells are tens of pixels across and the cell boundaries are meaningful.
 *  - `drawHeatmapImage` builds an ImageData at grid resolution and lets the canvas
 *    scale it. Correct for a fine sweep, where cells are sub-pixel and one fillRect
 *    per cell would be tens of thousands of calls for the same picture.
 */

import { crisp, type Surface } from './canvas';
import { buildLut, type ColormapName } from './colormaps';
import { font, fontSize, semantic, surface } from '../design/tokens';
import { formatEng, linearScale, type Scale } from './scale';

export interface Grid2D {
  /** Row-major, length nx * ny. Index (ix, iy) is at iy * nx + ix. */
  values: Float64Array;
  nx: number;
  ny: number;
  /** Data coordinates of the cell centres along each axis. */
  x: Float64Array;
  y: Float64Array;
}

/** Allocate an empty grid with cell centres spread evenly over the two ranges. */
export function makeGrid(
  nx: number,
  ny: number,
  xRange: readonly [number, number],
  yRange: readonly [number, number],
): Grid2D {
  const x = new Float64Array(nx);
  const y = new Float64Array(ny);
  // Cell centres, not edges: a sweep measures *at* a setting, and the cell drawn
  // around it represents the settings closer to it than to its neighbours.
  for (let i = 0; i < nx; i++) {
    x[i] = nx === 1 ? (xRange[0] + xRange[1]) / 2 : xRange[0] + ((xRange[1] - xRange[0]) * i) / (nx - 1);
  }
  for (let i = 0; i < ny; i++) {
    y[i] = ny === 1 ? (yRange[0] + yRange[1]) / 2 : yRange[0] + ((yRange[1] - yRange[0]) * i) / (ny - 1);
  }
  return { values: new Float64Array(nx * ny), nx, ny, x, y };
}

export function gridAt(g: Grid2D, ix: number, iy: number): number {
  return g.values[iy * g.nx + ix];
}

export function setGridAt(g: Grid2D, ix: number, iy: number, v: number): void {
  g.values[iy * g.nx + ix] = v;
}

/** Min and max over the finite cells, for auto-scaling the colour range. */
export function gridExtent(g: Grid2D): [number, number] {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i];
    if (!Number.isFinite(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (mn === Infinity) return [0, 1];
  if (mn === mx) return [mn - 0.5, mx + 0.5];
  return [mn, mx];
}

export interface HeatmapOptions {
  colormap?: ColormapName;
  /** Value range mapped across the colormap. Defaults to the grid's own extent. */
  range?: readonly [number, number];
  /** Colour for a non-finite cell - a point that was never measured. */
  missing?: string;
  /** Hairline between cells. Only useful on a coarse grid. */
  cellBorder?: boolean;
}

function edgePosition(centres: Float64Array, i: number, scale: Scale): number {
  const n = centres.length;
  if (n === 1) return scale(centres[0]);
  const step = (centres[n - 1] - centres[0]) / (n - 1);
  return scale(centres[0] + (i - 0.5) * step);
}

function cellEdges(centres: Float64Array, i: number, scale: Scale): [number, number] {
  return [edgePosition(centres, i, scale), edgePosition(centres, i + 1, scale)];
}

/** One filled rectangle per cell. For coarse grids. */
export function drawHeatmap(
  s: Surface,
  g: Grid2D,
  xScale: Scale,
  yScale: Scale,
  opts: HeatmapOptions = {},
): void {
  const lut = buildLut(opts.colormap ?? 'viridis');
  const [lo, hi] = opts.range ?? gridExtent(g);
  const span = hi - lo || 1;
  const { ctx } = s;

  ctx.save();
  for (let iy = 0; iy < g.ny; iy++) {
    const [y0, y1] = cellEdges(g.y, iy, yScale);
    for (let ix = 0; ix < g.nx; ix++) {
      const [x0, x1] = cellEdges(g.x, ix, xScale);
      const v = gridAt(g, ix, iy);
      if (!Number.isFinite(v)) {
        if (!opts.missing) continue;
        ctx.fillStyle = opts.missing;
      } else {
        const t = Math.min(255, Math.max(0, Math.round(((v - lo) / span) * 255)));
        ctx.fillStyle = `rgb(${lut[t * 4]},${lut[t * 4 + 1]},${lut[t * 4 + 2]})`;
      }
      // Ceil the size so adjacent cells overlap by a fraction of a pixel rather than
      // leaving background-coloured seams between them.
      ctx.fillRect(
        Math.min(x0, x1),
        Math.min(y0, y1),
        Math.ceil(Math.abs(x1 - x0)),
        Math.ceil(Math.abs(y1 - y0)),
      );
    }
  }
  if (opts.cellBorder) {
    ctx.strokeStyle = surface.ink900;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let ix = 0; ix <= g.nx; ix++) {
      const e = edgePosition(g.x, ix, xScale);
      ctx.moveTo(crisp(e), s.plot.y);
      ctx.lineTo(crisp(e), s.plot.y + s.plot.height);
    }
    for (let iy = 0; iy <= g.ny; iy++) {
      const e = edgePosition(g.y, iy, yScale);
      ctx.moveTo(s.plot.x, crisp(e));
      ctx.lineTo(s.plot.x + s.plot.width, crisp(e));
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Build the grid as RGBA pixels at one pixel per cell.
 *
 * Separated from the drawing so it can be unit-tested without a canvas, and so a
 * worker could hand back the pixels directly.
 */
export function gridToRgba(
  g: Grid2D,
  colormap: ColormapName = 'viridis',
  range?: readonly [number, number],
  missing: readonly [number, number, number, number] = [0, 0, 0, 0],
): Uint8ClampedArray {
  const lut = buildLut(colormap);
  const [lo, hi] = range ?? gridExtent(g);
  const span = hi - lo || 1;
  const out = new Uint8ClampedArray(g.nx * g.ny * 4);
  for (let iy = 0; iy < g.ny; iy++) {
    // Image rows run top-down while the grid's y index runs bottom-up, matching the
    // y scale's inverted range. Flip here so the image is the right way up.
    const row = g.ny - 1 - iy;
    for (let ix = 0; ix < g.nx; ix++) {
      const v = g.values[iy * g.nx + ix];
      const o = (row * g.nx + ix) * 4;
      if (!Number.isFinite(v)) {
        out[o] = missing[0];
        out[o + 1] = missing[1];
        out[o + 2] = missing[2];
        out[o + 3] = missing[3];
        continue;
      }
      const t = Math.min(255, Math.max(0, Math.round(((v - lo) / span) * 255))) * 4;
      out[o] = lut[t];
      out[o + 1] = lut[t + 1];
      out[o + 2] = lut[t + 2];
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Paint a grid by scaling an image over the plot area. For fine sweeps.
 *
 * `smooth` chooses the interpolation. Off by default and it should stay off for a
 * shmoo: a smoothed shmoo invents passing settings between two measured points, and
 * the whole value of the plot is that every coloured cell is a measurement.
 */
export function drawHeatmapImage(
  s: Surface,
  g: Grid2D,
  opts: HeatmapOptions & { smooth?: boolean } = {},
): void {
  if (g.nx < 1 || g.ny < 1) return;
  const rgba = gridToRgba(g, opts.colormap ?? 'viridis', opts.range);
  const { ctx, plot } = s;
  const image = ctx.createImageData(g.nx, g.ny);
  image.data.set(rgba);

  // Image data can only be blitted 1:1, so stage it on an offscreen canvas and draw
  // that scaled.
  const stage = document.createElement('canvas');
  stage.width = g.nx;
  stage.height = g.ny;
  const sctx = stage.getContext('2d');
  if (!sctx) return;
  sctx.putImageData(image, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = opts.smooth ?? false;
  ctx.drawImage(stage, plot.x, plot.y, plot.width, plot.height);
  ctx.restore();
}

/**
 * A pass/fail shmoo drawn as two colours rather than a continuous map.
 *
 * `predicate` decides pass from the cell value, so the same grid can be shown as a
 * continuous margin map and as the pass/fail region a spec limit carves out of it.
 */
export function drawPassFail(
  s: Surface,
  g: Grid2D,
  xScale: Scale,
  yScale: Scale,
  predicate: (v: number) => boolean,
  passColor: string = semantic.pass,
  failColor: string = semantic.fail,
): void {
  const { ctx } = s;
  ctx.save();
  ctx.globalAlpha = 0.75;
  for (let iy = 0; iy < g.ny; iy++) {
    const [y0, y1] = cellEdges(g.y, iy, yScale);
    for (let ix = 0; ix < g.nx; ix++) {
      const [x0, x1] = cellEdges(g.x, ix, xScale);
      const v = gridAt(g, ix, iy);
      if (!Number.isFinite(v)) continue;
      ctx.fillStyle = predicate(v) ? passColor : failColor;
      ctx.fillRect(
        Math.min(x0, x1),
        Math.min(y0, y1),
        Math.ceil(Math.abs(x1 - x0)),
        Math.ceil(Math.abs(y1 - y0)),
      );
    }
  }
  ctx.restore();
}

export interface PassWindow {
  ix0: number;
  ix1: number;
  iy0: number;
  iy1: number;
  cells: number;
}

/**
 * The largest axis-aligned rectangle of passing cells, in grid indices.
 *
 * This is the number a validation report actually quotes: not "it passed somewhere"
 * but "the passing window was this many picoseconds by this many millivolts". Exact,
 * via the standard maximal-rectangle-in-a-histogram scan, O(nx * ny).
 */
export function largestPassingWindow(g: Grid2D, predicate: (v: number) => boolean): PassWindow | null {
  const heights = new Int32Array(g.nx);
  let best: PassWindow = { ix0: 0, ix1: 0, iy0: 0, iy1: 0, cells: 0 };

  for (let iy = 0; iy < g.ny; iy++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const v = gridAt(g, ix, iy);
      heights[ix] = Number.isFinite(v) && predicate(v) ? heights[ix] + 1 : 0;
    }
    // Maximal rectangle in this row's histogram, by monotonic stack.
    const stack: number[] = [];
    for (let ix = 0; ix <= g.nx; ix++) {
      const h = ix === g.nx ? 0 : heights[ix];
      while (stack.length > 0 && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop() as number;
        const height = heights[top];
        const left = stack.length === 0 ? 0 : stack[stack.length - 1] + 1;
        const area = height * (ix - left);
        if (height > 0 && area > best.cells) {
          best = { ix0: left, ix1: ix - 1, iy0: iy - height + 1, iy1: iy, cells: area };
        }
      }
      stack.push(ix);
    }
  }
  return best.cells > 0 ? best : null;
}

/** The data-unit width and height of a window of cells, edge to edge. */
export function windowExtent(
  g: Grid2D,
  window: { ix0: number; ix1: number; iy0: number; iy1: number },
): { width: number; height: number; xCentre: number; yCentre: number } {
  const dx = g.nx > 1 ? (g.x[g.nx - 1] - g.x[0]) / (g.nx - 1) : 0;
  const dy = g.ny > 1 ? (g.y[g.ny - 1] - g.y[0]) / (g.ny - 1) : 0;
  return {
    width: Math.abs(dx) * (window.ix1 - window.ix0 + 1),
    height: Math.abs(dy) * (window.iy1 - window.iy0 + 1),
    xCentre: (g.x[window.ix0] + g.x[window.ix1]) / 2,
    yCentre: (g.y[window.iy0] + g.y[window.iy1]) / 2,
  };
}

/**
 * Outline a window on the plot and label its extent in data units. The label is the
 * measurement; the box is only there to say where it came from.
 */
export function drawWindow(
  s: Surface,
  g: Grid2D,
  window: { ix0: number; ix1: number; iy0: number; iy1: number },
  xScale: Scale,
  yScale: Scale,
  xUnit = 's',
  yUnit = 'V',
  color: string = semantic.marker,
): void {
  const { ctx } = s;
  const x0 = edgePosition(g.x, window.ix0, xScale);
  const x1 = edgePosition(g.x, window.ix1 + 1, xScale);
  const y0 = edgePosition(g.y, window.iy0, yScale);
  const y1 = edgePosition(g.y, window.iy1 + 1, yScale);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  ctx.fillStyle = color;
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const w = windowExtent(g, window);
  ctx.fillText(
    `${formatEng(w.width, xUnit, 3)} x ${formatEng(w.height, yUnit, 3)}`,
    (x0 + x1) / 2,
    Math.min(y0, y1) - 4,
  );
  ctx.restore();
}

/** A vertical colour bar with a labelled scale, drawn in the right inset. */
export function drawColorbar(
  s: Surface,
  range: readonly [number, number],
  colormap: ColormapName = 'viridis',
  unit = '',
  width = 10,
): void {
  const { ctx, plot } = s;
  const lut = buildLut(colormap);
  const x = plot.x + plot.width + 8;
  const steps = Math.max(1, Math.round(plot.height));
  ctx.save();
  for (let i = 0; i < steps; i++) {
    // Top of the bar is the top of the range, matching the inverted y of the plot.
    const t = Math.round((1 - i / (steps - 1 || 1)) * 255) * 4;
    ctx.fillStyle = `rgb(${lut[t]},${lut[t + 1]},${lut[t + 2]})`;
    ctx.fillRect(x, plot.y + i, width, 1);
  }
  ctx.strokeStyle = surface.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(crisp(x), crisp(plot.y), width, Math.round(plot.height));

  ctx.fillStyle = surface.textLo;
  ctx.font = `${fontSize.tick}px ${font.mono}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const barScale = linearScale([range[0], range[1]], [plot.y + plot.height, plot.y]);
  for (const v of [range[0], (range[0] + range[1]) / 2, range[1]]) {
    ctx.fillText(formatEng(v, unit, 3), x + width + 4, barScale(v));
  }
  ctx.restore();
}
