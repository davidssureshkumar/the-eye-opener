import { describe, expect, it } from 'vitest';
import {
  gridAt,
  gridExtent,
  gridToRgba,
  largestPassingWindow,
  makeGrid,
  setGridAt,
  windowExtent,
  type Grid2D,
} from '../heatmap';
import { buildLut } from '../colormaps';

function fromRows(rows: number[][], xRange: [number, number], yRange: [number, number]): Grid2D {
  const ny = rows.length;
  const nx = rows[0].length;
  const g = makeGrid(nx, ny, xRange, yRange);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) setGridAt(g, ix, iy, rows[iy][ix]);
  }
  return g;
}

/** Exhaustive reference for the maximal-rectangle scan. O(n^4), fine for small grids. */
function bruteForceWindow(g: Grid2D, ok: (v: number) => boolean): number {
  let best = 0;
  for (let y0 = 0; y0 < g.ny; y0++) {
    for (let y1 = y0; y1 < g.ny; y1++) {
      for (let x0 = 0; x0 < g.nx; x0++) {
        for (let x1 = x0; x1 < g.nx; x1++) {
          let all = true;
          for (let y = y0; y <= y1 && all; y++) {
            for (let x = x0; x <= x1 && all; x++) {
              const v = gridAt(g, x, y);
              if (!Number.isFinite(v) || !ok(v)) all = false;
            }
          }
          if (all) best = Math.max(best, (y1 - y0 + 1) * (x1 - x0 + 1));
        }
      }
    }
  }
  return best;
}

describe('grid construction', () => {
  it('spreads cell centres across the requested ranges inclusively', () => {
    const g = makeGrid(5, 3, [0, 4], [-1, 1]);
    expect(Array.from(g.x)).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(g.y)).toEqual([-1, 0, 1]);
    expect(g.values.length).toBe(15);
  });

  it('puts a single-cell axis at the middle of its range', () => {
    const g = makeGrid(1, 1, [10, 20], [0, 100]);
    expect(g.x[0]).toBe(15);
    expect(g.y[0]).toBe(50);
  });

  it('addresses cells row-major with y as the row', () => {
    const g = makeGrid(3, 2, [0, 1], [0, 1]);
    setGridAt(g, 2, 1, 7);
    expect(g.values[1 * 3 + 2]).toBe(7);
    expect(gridAt(g, 2, 1)).toBe(7);
  });
});

describe('grid extent', () => {
  it('ignores non-finite cells, which mark settings that were never measured', () => {
    const g = fromRows(
      [
        [1, Number.NaN, 3],
        [Number.NaN, 5, Number.NaN],
      ],
      [0, 1],
      [0, 1],
    );
    expect(gridExtent(g)).toEqual([1, 5]);
  });

  it('never returns a zero-width range, which would divide by zero downstream', () => {
    const flat = fromRows([[2, 2, 2]], [0, 1], [0, 1]);
    const [lo, hi] = gridExtent(flat);
    expect(hi).toBeGreaterThan(lo);
  });

  it('falls back to a unit range when nothing has been measured', () => {
    const empty = fromRows([[Number.NaN, Number.NaN]], [0, 1], [0, 1]);
    expect(gridExtent(empty)).toEqual([0, 1]);
  });
});

describe('grid to pixels', () => {
  it('emits one RGBA quad per cell', () => {
    const g = makeGrid(4, 3, [0, 1], [0, 1]);
    expect(gridToRgba(g).length).toBe(4 * 3 * 4);
  });

  /**
   * The flip is easy to get wrong and the mistake is subtle: a vertically mirrored
   * shmoo still looks like a plausible shmoo. Row 0 of the image is the TOP of the
   * plot, which is the LAST row of the grid.
   */
  it('puts the highest y row at the top of the image', () => {
    const g = fromRows(
      [
        [0, 0],
        [1, 1],
      ],
      [0, 1],
      [0, 1],
    );
    const rgba = gridToRgba(g, 'grayscale', [0, 1]);
    const lut = buildLut('grayscale');
    // Image row 0 must carry the value from grid row 1 (the higher y).
    expect(rgba[0]).toBe(lut[255 * 4]);
    // Image row 1 (offset nx * 4) carries grid row 0.
    expect(rgba[2 * 4]).toBe(lut[0]);
  });

  it('leaves unmeasured cells fully transparent by default', () => {
    const g = fromRows([[Number.NaN, 1]], [0, 1], [0, 1]);
    const rgba = gridToRgba(g, 'viridis', [0, 1]);
    expect(rgba[3]).toBe(0);
    expect(rgba[7]).toBe(255);
  });

  it('clamps values outside the colour range instead of wrapping', () => {
    const g = fromRows([[-100, 100]], [0, 1], [0, 1]);
    const rgba = gridToRgba(g, 'grayscale', [0, 1]);
    const lut = buildLut('grayscale');
    expect(rgba[0]).toBe(lut[0]);
    expect(rgba[4]).toBe(lut[255 * 4]);
  });
});

describe('largest passing window', () => {
  const pass = (v: number) => v > 0;

  it('finds nothing when nothing passes', () => {
    expect(
      largestPassingWindow(
        fromRows(
          [
            [0, 0],
            [0, 0],
          ],
          [0, 1],
          [0, 1],
        ),
        pass,
      ),
    ).toBeNull();
  });

  it('finds a single passing cell', () => {
    const g = fromRows(
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 0],
      ],
      [0, 2],
      [0, 2],
    );
    expect(largestPassingWindow(g, pass)).toEqual({ ix0: 1, ix1: 1, iy0: 1, iy1: 1, cells: 1 });
  });

  it('prefers a wide rectangle over a taller narrow one of smaller area', () => {
    // A 4x2 block (8 cells) against a 1x3 column (3 cells).
    const g = fromRows(
      [
        [1, 1, 1, 1, 0],
        [1, 1, 1, 1, 1],
        [0, 0, 0, 0, 1],
      ],
      [0, 4],
      [0, 2],
    );
    const w = largestPassingWindow(g, pass);
    expect(w).not.toBeNull();
    expect(w?.cells).toBe(8);
    expect(w).toMatchObject({ ix0: 0, ix1: 3, iy0: 0, iy1: 1 });
  });

  /**
   * The failure mode this guards against is a hole in the middle of an otherwise
   * passing region - the classic signature of a resonance or a marginal DLL step.
   * A window reported across the hole would be a false pass in a validation report.
   */
  it('does not report a window that spans a hole', () => {
    const g = fromRows(
      [
        [1, 1, 1],
        [1, 0, 1],
        [1, 1, 1],
      ],
      [0, 2],
      [0, 2],
    );
    const w = largestPassingWindow(g, pass);
    expect(w?.cells).toBe(3);
  });

  it('treats an unmeasured cell as not passing', () => {
    const g = fromRows(
      [
        [1, 1],
        [1, Number.NaN],
      ],
      [0, 1],
      [0, 1],
    );
    expect(largestPassingWindow(g, pass)?.cells).toBe(2);
  });

  it('agrees with brute force on random grids', () => {
    // A deterministic pseudo-random fill: the point is coverage of awkward shapes,
    // not statistics, so a fixed LCG keeps failures reproducible.
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let trial = 0; trial < 40; trial++) {
      const nx = 3 + Math.floor(next() * 6);
      const ny = 3 + Math.floor(next() * 6);
      const rows: number[][] = [];
      for (let iy = 0; iy < ny; iy++) {
        rows.push(Array.from({ length: nx }, () => (next() < 0.6 ? 1 : 0)));
      }
      const g = fromRows(rows, [0, nx - 1], [0, ny - 1]);
      const w = largestPassingWindow(g, pass);
      expect(w?.cells ?? 0).toBe(bruteForceWindow(g, pass));
    }
  });

  it('reports a window whose bounds really are all passing', () => {
    const g = fromRows(
      [
        [0, 1, 1, 1],
        [1, 1, 1, 0],
        [0, 1, 1, 1],
      ],
      [0, 3],
      [0, 2],
    );
    const w = largestPassingWindow(g, pass);
    expect(w).not.toBeNull();
    if (!w) return;
    for (let iy = w.iy0; iy <= w.iy1; iy++) {
      for (let ix = w.ix0; ix <= w.ix1; ix++) expect(pass(gridAt(g, ix, iy))).toBe(true);
    }
    expect((w.ix1 - w.ix0 + 1) * (w.iy1 - w.iy0 + 1)).toBe(w.cells);
  });
});

describe('window extent in data units', () => {
  /**
   * The number a report quotes. A window of k cells spans k cell widths edge to edge,
   * not k-1: off by one here understates the margin by one step, which for a 64-step
   * delay sweep is a real 1.6% error in the quoted timing window.
   */
  it('measures a window edge to edge, not centre to centre', () => {
    // Cell centres 0, 10, 20, 30, 40 ps: a 10 ps step.
    const g = makeGrid(5, 5, [0, 40e-12], [0, 400e-3]);
    const w = windowExtent(g, { ix0: 1, ix1: 3, iy0: 0, iy1: 1 });
    expect(w.width).toBeCloseTo(30e-12, 18);
    expect(w.height).toBeCloseTo(200e-3, 12);
  });

  it('reports the centre of the window, which is where a strobe would be set', () => {
    const g = makeGrid(5, 5, [0, 40], [0, 400]);
    const w = windowExtent(g, { ix0: 1, ix1: 3, iy0: 1, iy1: 3 });
    expect(w.xCentre).toBe(20);
    expect(w.yCentre).toBe(200);
  });

  it('gives a single cell one full step of extent', () => {
    const g = makeGrid(5, 5, [0, 40], [0, 40]);
    const w = windowExtent(g, { ix0: 2, ix1: 2, iy0: 2, iy1: 2 });
    expect(w.width).toBe(10);
    expect(w.height).toBe(10);
  });
});
