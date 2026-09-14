/**
 * The measured-channel job, checked where the answer is known without it.
 *
 * A lossless woven pair is two pure delays, so the P and N steps cross 50% apart by
 * the closed-form skew, the differential step arrives at their mean, and the
 * minimum-phase transfer of a flat magnitude has no delay at all. Each corruption
 * trips the check it is meant to, and nothing else does. A network written to a
 * Touchstone file and read back drives the simulator exactly as the network did.
 */

import { describe, expect, it } from 'vitest';
import { SPEED_OF_LIGHT } from '../../../sim/channel/tline';
import { WEAVE_DEFAULTS, linearSweep, weavePairNetwork } from '../../../sim/touchstone/examples';
import { integratedCrosstalkNoise } from '../../../sim/touchstone/metrics';
import { parseTouchstone, writeTouchstone } from '../../../sim/touchstone/parser';
import { defaultScenario, type Scenario } from '../../../state/scenario';
import { edgeResponseOf } from '../adapt';
import { runJob, transferablesOf } from '../index';
import { corruptNetwork, launchedLevel } from '../index';

type Lossy = Scenario['channel']['lossy'];
type Touch = Scenario['channel']['touchstone'];

function scenarioWith(line: Partial<Lossy>, touch: Partial<Touch> = {}): Scenario {
  const s = defaultScenario();
  return {
    ...s,
    channel: {
      ...s.channel,
      lossy: { ...s.channel.lossy, ...line },
      touchstone: { ...s.channel.touchstone, ...touch },
    },
  };
}

const LOSSLESS: Partial<Lossy> = {
  z0: 50,
  length: 0.2,
  conductorLossEnabled: false,
  dielectricLossEnabled: false,
  viaCount: 0,
};

describe('measured job on a lossless woven pair', () => {
  const scenario = scenarioWith(LOSSLESS, { mixedMode: true, txPort: 1, rxPort: 2 });
  const r = runJob('measured', scenario, { source: 'weave', minimumPhase: true });
  const legs = r.weaveLegs!;

  it('sees one differential pair and passes every check', () => {
    expect(r.mode).toBe('differential');
    expect(r.pairCount).toBe(1);
    expect(r.passive).toBe(true);
    // A lossless 4-port is unitary, and the trace estimate of sigma_max overstates it by
    // at most N^(1 / 2^(p+1)) = 4^(1 / 2^25), about 1 + 4.1e-8.
    expect(r.passivityMax).toBeGreaterThan(1 - 1e-12);
    expect(r.passivityMax).toBeLessThan(1 + Math.log(4) / 2 ** 25 + 1e-12);
    expect(r.reciprocityMax).toBeLessThan(1e-12);
    expect(r.acausal).toBe(false);
    expect(r.coarse).toBe(false);
  });

  it('measures the closed-form skew between the legs, and the mean delay differentially', () => {
    const tP = (0.2 * Math.sqrt(legs.dkP)) / SPEED_OF_LIGHT;
    const tN = (0.2 * Math.sqrt(legs.dkN)) / SPEED_OF_LIGHT;
    expect(Math.abs(legs.skew)).toBeGreaterThan(10e-12);
    expect(Math.abs(r.measuredSkew - legs.skew)).toBeLessThan(0.5e-12);
    expect(Math.abs(r.pulseDelay - (tP + tN) / 2)).toBeLessThan(0.5e-12);
  });

  it('loses the delay, and keeps the magnitude, in the minimum-phase view', () => {
    expect(Math.abs(r.minPhaseDelay)).toBeLessThan(0.1 * Math.abs(r.pulseDelay));
    let areaMp = 0;
    let areaOut = 0;
    for (let i = 0; i < r.pulseOut.length; i++) {
      areaMp += r.pulseMinPhase[i];
      areaOut += r.pulseOut[i];
    }
    expect(areaMp).toBeCloseTo(areaOut, 6);
  });

  it('hands out distinct buffers', () => {
    const buffers = transferablesOf('measured', r);
    expect(new Set(buffers).size).toBe(buffers.length);
  });
});

describe('measured job checks', () => {
  const scenario = scenarioWith({ length: 0.1 }, { mixedMode: false, txPort: 1, rxPort: 2 });

  it('passes a lossy synthetic line, and finds ripple only where vias put it', () => {
    const smooth = runJob('measured', scenarioWith({ length: 0.1, viaCount: 0 }, { mixedMode: false }), {
      source: 'weave',
    });
    const r = runJob('measured', scenario, { source: 'weave' });
    for (const x of [smooth, r]) {
      expect(x.passive).toBe(true);
      expect(x.acausal).toBe(false);
      expect(x.ildValid).toBe(true);
    }
    expect(smooth.ildRms).toBeLessThan(0.02);
    expect(r.ildRms).toBeGreaterThan(3 * smooth.ildRms);
  });

  it('flags gain as not passive, by the gain', () => {
    const clean = runJob('measured', scenario, { source: 'weave' });
    const r = runJob('measured', scenario, { source: 'weave', corruption: 'gain', corruptionGain: 1.1 });
    expect(r.passive).toBe(false);
    expect(r.passivityMax).toBeCloseTo(1.1 * clean.passivityMax, 9);
    expect(r.acausal).toBe(false);
  });

  it('flags a conjugated phase and a discarded phase as not causal', () => {
    for (const corruption of ['conjugate', 'magnitude'] as const) {
      const r = runJob('measured', scenario, { source: 'weave', corruption });
      expect(r.acausal).toBe(true);
    }
  });

  it('copies rather than alters the network it corrupts', () => {
    const net = weavePairNetwork(
      defaultScenario().channel.lossy,
      WEAVE_DEFAULTS,
      linearSweep(1e8, 8),
    ).network;
    const before = Float64Array.from(net.im);
    corruptNetwork(net, 'conjugate');
    expect(net.im).toEqual(before);
  });
});

describe('measured job crosstalk', () => {
  it('classifies the coupled pair and integrates each aggressor as metrics.ts does', () => {
    const scenario = scenarioWith({ length: 0.1 }, { mixedMode: false, txPort: 1, rxPort: 2 });
    const r = runJob('measured', scenario, { source: 'coupled' });
    expect(r.aggressors.map((a) => [a.label, a.kind])).toEqual([
      ['port 3', 'fext'],
      ['port 4', 'next'],
    ]);
    const src = scenario.source;
    for (const a of r.aggressors) {
      const mag = a.xtDb.map((d) => 10 ** (d / 20));
      const direct = integratedCrosstalkNoise(r.freq, mag, {
        level: launchedLevel(src.amplitude),
        symbolTime: 1 / src.symbolRate,
        edge: edgeResponseOf(src),
        rxBandwidth: 0.75 * src.symbolRate,
      });
      expect(a.icn).toBeCloseTo(direct, 12);
      expect(a.icn).toBeGreaterThan(0);
    }
    expect(r.icnTotal).toBeCloseTo(Math.hypot(r.icnNext, r.icnFext), 15);
  });
});

describe('measured job from a file', () => {
  it('drives a written and re-read network exactly as the network itself', () => {
    const scenario = scenarioWith({ length: 0.1 }, { mixedMode: true });
    const synthetic = runJob('measured', scenario, { source: 'weave' });
    const freq = linearSweep(10e6, Math.ceil((6 * scenario.source.symbolRate) / 2 / 10e6));
    const { network } = weavePairNetwork(scenario.channel.lossy, WEAVE_DEFAULTS, freq);
    const file = parseTouchstone(writeTouchstone(network), 'pair.s4p');
    const r = runJob('measured', scenario, { source: 'file', network: file.network });
    expect(r.source).toBe('file');
    let worstDb = 0;
    for (let k = 0; k < r.thruDb.length; k++)
      worstDb = Math.max(worstDb, Math.abs(r.thruDb[k] - synthetic.thruDb[k]));
    expect(worstDb).toBeLessThan(1e-9);
    let worst = 0;
    for (let i = 0; i < r.pulseOut.length; i++)
      worst = Math.max(worst, Math.abs(r.pulseOut[i] - synthetic.pulseOut[i]));
    expect(worst).toBeLessThan(1e-9);
  });

  it('falls back to the synthetic pair when no file is loaded', () => {
    expect(runJob('measured', defaultScenario(), { source: 'file', network: null }).source).toBe('weave');
  });
});
