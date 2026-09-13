import { describe, expect, it } from 'vitest';
import { cursorReadouts, hitTestCursor, moveCursor, type CursorSet } from '../cursors';
import { divisionsOf } from '../grid';
import { linearScale } from '../scale';
import type { Rect } from '../canvas';

// A plot area the size the site actually uses: 800 x 400 inside the default insets.
const PLOT: Rect = { x: 62, y: 12, width: 800, height: 400 };
// 2 ns across, +/- 500 mV. Note the inverted y range every canvas uses.
const X = linearScale([0, 2e-9], [PLOT.x, PLOT.x + PLOT.width]);
const Y = linearScale([-0.5, 0.5], [PLOT.y + PLOT.height, PLOT.y]);

describe('cursor readouts', () => {
  it('reports each cursor position in engineering units', () => {
    const r = cursorReadouts({ x: [4e-10], y: [] });
    expect(r[0]).toEqual({ label: 'A', value: '400 ps' });
  });

  /**
   * The second most common bench measurement after "how far apart are these edges"
   * is "so what frequency is that", and a scope shows both next to its time cursors.
   */
  it('reports the reciprocal of a time difference as a frequency', () => {
    const r = cursorReadouts({ x: [0, 2.5e-10], y: [] });
    const labels = r.map((e) => e.label);
    expect(labels).toContain('dX');
    expect(labels).toContain('1/dX');
    expect(r.find((e) => e.label === 'dX')?.value).toBe('250 ps');
    expect(r.find((e) => e.label === '1/dX')?.value).toBe('4 GHz');
  });

  it('reports the reciprocal of a magnitude, so cursor order does not flip the sign', () => {
    const forward = cursorReadouts({ x: [0, 1e-9], y: [] });
    const backward = cursorReadouts({ x: [1e-9, 0], y: [] });
    expect(forward.find((e) => e.label === '1/dX')?.value).toBe(
      backward.find((e) => e.label === '1/dX')?.value,
    );
    // The difference itself keeps its sign, because direction is information.
    expect(backward.find((e) => e.label === 'dX')?.value).toBe('-1 ns');
  });

  it('omits the frequency when the cursors coincide, rather than reporting infinity', () => {
    const r = cursorReadouts({ x: [1e-9, 1e-9], y: [] });
    expect(r.map((e) => e.label)).not.toContain('1/dX');
  });

  it('does not compute a frequency from a non-time axis', () => {
    const r = cursorReadouts({ x: [1, 2], y: [] }, 'V');
    expect(r.map((e) => e.label)).not.toContain('1/dX');
  });

  it('reports a voltage difference for horizontal cursors', () => {
    const r = cursorReadouts({ x: [], y: [-0.2, 0.15] });
    expect(r.find((e) => e.label === 'dY')?.value).toBe('350 mV');
  });

  it('reports nothing at all when there are no cursors', () => {
    expect(cursorReadouts({ x: [], y: [] })).toEqual([]);
  });
});

describe('cursor hit testing', () => {
  const cursors: CursorSet = { x: [5e-10, 1.5e-9], y: [0.25] };

  it('finds a vertical cursor under the pointer', () => {
    const px = X(5e-10);
    expect(hitTestCursor(cursors, X, Y, px, 200, PLOT)).toEqual({ axis: 'x', index: 0 });
  });

  it('finds a horizontal cursor under the pointer', () => {
    const py = Y(0.25);
    expect(hitTestCursor(cursors, X, Y, 400, py, PLOT)).toEqual({ axis: 'y', index: 0 });
  });

  it('has a forgiving but bounded grab radius', () => {
    const px = X(1.5e-9);
    expect(hitTestCursor(cursors, X, Y, px + 7, 200, PLOT)).toEqual({ axis: 'x', index: 1 });
    expect(hitTestCursor(cursors, X, Y, px + 20, 200, PLOT)).toBeNull();
  });

  it('picks the nearer of two cursors when both are in range', () => {
    const close: CursorSet = { x: [1e-9, 1.02e-9], y: [] };
    const px = X(1.02e-9);
    expect(hitTestCursor(close, X, Y, px, 200, PLOT, 20)).toEqual({ axis: 'x', index: 1 });
  });

  it('ignores a pointer outside the plot area', () => {
    const px = X(5e-10);
    expect(hitTestCursor(cursors, X, Y, px, PLOT.y - 20, PLOT)).toBeNull();
    expect(hitTestCursor(cursors, X, Y, 10, 200, PLOT)).toBeNull();
  });

  it('finds nothing when there are no cursors', () => {
    expect(hitTestCursor({ x: [], y: [] }, X, Y, 400, 200, PLOT)).toBeNull();
  });
});

describe('dragging a cursor', () => {
  const cursors: CursorSet = { x: [5e-10, 1.5e-9], y: [0.25] };

  it('moves the dragged cursor to the pointer and leaves the others alone', () => {
    const next = moveCursor(cursors, 'x', 0, X(1.2e-9), 200, X, Y, PLOT);
    expect(next.x[0]).toBeCloseTo(1.2e-9, 21);
    expect(next.x[1]).toBe(cursors.x[1]);
    expect(next.y).toEqual(cursors.y);
  });

  it('does not mutate the input, so undo and React state stay honest', () => {
    const before = JSON.stringify(cursors);
    moveCursor(cursors, 'x', 0, 500, 200, X, Y, PLOT);
    expect(JSON.stringify(cursors)).toBe(before);
  });

  it('clamps to the plot so a cursor cannot be dragged off and lost', () => {
    const left = moveCursor(cursors, 'x', 0, -5000, 200, X, Y, PLOT);
    expect(left.x[0]).toBeCloseTo(0, 18);
    const right = moveCursor(cursors, 'x', 0, 99999, 200, X, Y, PLOT);
    expect(right.x[0]).toBeCloseTo(2e-9, 18);
  });

  it('clamps vertically too, respecting the inverted y range', () => {
    const top = moveCursor(cursors, 'y', 0, 400, -1000, X, Y, PLOT);
    expect(top.y[0]).toBeCloseTo(0.5, 12);
    const bottom = moveCursor(cursors, 'y', 0, 400, 99999, X, Y, PLOT);
    expect(bottom.y[0]).toBeCloseTo(-0.5, 12);
  });
});

describe('per-division readouts', () => {
  /**
   * The "s/div" and "V/div" numbers beside a scope screen. Derived from the scales
   * rather than stored separately, so the readout can never drift from the picture.
   */
  it('divides the visible span by the graticule divisions', () => {
    const d = divisionsOf(X, Y);
    expect(d.perXDivision).toBeCloseTo(2e-10, 21); // 2 ns over 10 divisions
    expect(d.perYDivision).toBeCloseTo(0.125, 12); // 1 V over 8 divisions
  });

  it('is positive even when a scale runs backwards', () => {
    const reversed = linearScale([2e-9, 0], [0, 800]);
    expect(divisionsOf(reversed, Y).perXDivision).toBeCloseTo(2e-10, 21);
  });

  it('honours a non-standard graticule', () => {
    const d = divisionsOf(X, Y, 8, 10);
    expect(d.perXDivision).toBeCloseTo(2.5e-10, 21);
    expect(d.perYDivision).toBeCloseTo(0.1, 12);
  });
});
