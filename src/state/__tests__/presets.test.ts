import { describe, it, expect } from 'vitest';
import { PRESETS, defaultScenarioForModule, getPreset, presetsForModule } from '../presets';
import { decodeScenario, encodeScenario } from '../url-codec';
import { defaultScenario, scenarioSchema, unitInterval } from '../scenario';

describe('preset catalogue', () => {
  it('has unique ids', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset is a valid scenario', () => {
    for (const p of PRESETS) expect(() => scenarioSchema.parse(p.scenario)).not.toThrow();
  });

  it('every preset carries a label, a blurb and at least one module', () => {
    for (const p of PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(30);
      expect(p.modules.length).toBeGreaterThan(0);
      for (const m of p.modules) expect(m).toMatch(/^m(1[01]|[1-9])$/);
    }
  });

  it('every preset survives the permalink round trip', () => {
    for (const p of PRESETS) {
      const back = decodeScenario(encodeScenario(p.scenario));
      expect(back.warnings).toEqual([]);
      expect(back.scenario).toEqual(p.scenario);
    }
  });

  it('a preset that names a real interface is flagged illustrative', () => {
    // The working agreement is explicit: no JEDEC numbers are invented here. Any
    // preset that mentions a real part family must say in the UI that its values
    // are stand-ins, and that promise is enforced by this test rather than by memory.
    for (const p of PRESETS) {
      if (/ddr|hbm|lpddr|pcie|gddr/i.test(`${p.id} ${p.label} ${p.blurb}`)) {
        expect(p.illustrative).toBe(true);
        expect(p.label + p.blurb).toMatch(/illustrative|stand-in|stand-ins|not spec/i);
      }
    }
  });

  it('lookup by id and by module works', () => {
    expect(getPreset('clean-slate')?.label).toBe('Clean slate');
    expect(getPreset('no-such-preset')).toBeUndefined();
    expect(presetsForModule('m1').length).toBeGreaterThan(0);
    expect(presetsForModule('m99')).toEqual([]);
  });

  it('a module with no presets still opens on a valid scenario', () => {
    expect(defaultScenarioForModule('m99')).toEqual(defaultScenario());
    expect(() => scenarioSchema.parse(defaultScenarioForModule('m8'))).not.toThrow();
  });
});

describe('presets are physically sensible', () => {
  it('every rise time is a fraction of the unit interval it belongs to', () => {
    // A source whose edge is longer than a bit does not have an eye to look at, and
    // a preset that ships like that wastes the reader's first impression.
    for (const p of PRESETS) {
      const ui = unitInterval(p.scenario);
      expect(p.scenario.source.riseTime).toBeLessThan(ui * 0.6);
      expect(p.scenario.source.fallTime).toBeLessThan(ui * 0.6);
    }
  });

  it('Monte-Carlo bit counts stay inside the two-second budget', () => {
    // The brief allows 2 s for a 100k-bit eye with a progress indicator. No preset
    // should open on something slower than that.
    for (const p of PRESETS) expect(p.scenario.analysis.bits).toBeLessThanOrEqual(100000);
  });

  it('the before/after equalization pair differ only in the equalizer', () => {
    const before = getPreset('eq-before');
    const after = getPreset('eq-after');
    expect(before && after).toBeTruthy();
    if (!before || !after) return;
    // Same channel and same source: the teaching point is that nothing but the
    // receiver changed.
    expect(after.scenario.channel).toEqual(before.scenario.channel);
    expect(after.scenario.source).toEqual(before.scenario.source);
    expect(after.scenario.eq.ctleEnabled).toBe(true);
    expect(before.scenario.eq.ctleEnabled).toBe(false);
  });

  it('the two scope presets differ only in the instrument', () => {
    const bad = getPreset('scope-limited');
    const good = getPreset('scope-adequate');
    expect(bad && good).toBeTruthy();
    if (!bad || !good) return;
    expect(good.scenario.source).toEqual(bad.scenario.source);
    expect(good.scenario.channel).toEqual(bad.scenario.channel);
    expect(good.scenario.scope.bandwidth).toBeGreaterThan(bad.scenario.scope.bandwidth);
    // And both obey Nyquist on the scope's own sample rate.
    for (const p of [bad, good]) {
      expect(p.scenario.scope.sampleRate).toBeGreaterThan(2 * p.scenario.scope.bandwidth);
    }
  });

  it('the clean-slate preset really is clean', () => {
    const s = getPreset('clean-slate')?.scenario;
    expect(s).toBeTruthy();
    if (!s) return;
    expect(s.impairments.noiseRms).toBe(0);
    expect(s.impairments.randomJitterRms).toBe(0);
    expect(s.channel.kind).toBe('ideal');
    expect(s.crosstalk.enabled).toBe(false);
    expect(s.eq.ffeEnabled).toBe(false);
    expect(s.eq.ctleEnabled).toBe(false);
    expect(s.eq.dfeEnabled).toBe(false);
    expect(s.scope.enabled).toBe(false);
  });
});
