import { describe, expect, it } from 'vitest';
import { defaultScenario } from '../../../state/scenario';
import { routeBudgets } from '../budgets';

describe('route loss budgets', () => {
  const base = defaultScenario().channel.lossy;
  const rows = routeBudgets(base, 3.2e9);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  it('loses at DC exactly what its series resistance divides off between 50 ohm ports', () => {
    for (const r of rows) {
      // A route far shorter than a wavelength at 1 Hz is its series resistance: S21 = 2 R0 / (2 R0 + R).
      expect(r.ilDc).toBeCloseTo(20 * Math.log10(1 + r.seriesResistance / 100), 4);
    }
  });

  it('puts the interposer in the skin transition and the board deep in the skin regime', () => {
    expect(byKey.dimm.skinOverThickness).toBeLessThan(0.1);
    expect(byKey.hbm.skinOverThickness).toBeGreaterThan(0.5);
    expect(byKey.hbm.skinOverThickness).toBeLessThan(2);
  });

  it('finds the interposer loss mostly resistive, and the board loss mostly frequency dependent', () => {
    expect(byKey.hbm.ilDc / byKey.hbm.ilAt).toBeGreaterThan(0.5);
    expect(byKey.dimm.ilDc / byKey.dimm.ilAt).toBeLessThan(0.1);
    for (const r of rows) expect(r.ilAt).toBeGreaterThan(0);
  });
});
