/**
 * Named starting points.
 *
 * A preset is a Scenario plus a sentence saying what it is for. Modules open on one
 * and the reader edits from there; "Try this" boxes link to others.
 *
 * On the numbers: every value here is ILLUSTRATIVE. They are chosen to be of the
 * right order for the class of interface named, so that the physics behaves the way
 * the real thing behaves, and they are not taken from any JEDEC document or vendor
 * datasheet. Each preset carries `illustrative: true` and the UI renders that as a
 * visible badge. Where a real programme needs real numbers, they come from the
 * relevant JEDEC standard (JESD79-5 for DDR5, JESD209-5 for LPDDR5, JESD238 for
 * HBM3) and from the silicon vendor, not from a teaching site.
 */

import { withPatch } from './url-codec';
import { defaultScenario, type Scenario } from './scenario';

export interface Preset {
  id: string;
  label: string;
  /** One line: what this preset is for and what the reader should watch. */
  blurb: string;
  /** Modules that offer this preset in their picker. */
  modules: string[];
  /** True whenever any number in the scenario is a plausible stand-in, not a spec value. */
  illustrative: boolean;
  scenario: Scenario;
}

function make(patch: Record<string, number | string | boolean | number[]>): Scenario {
  return withPatch(defaultScenario(), patch);
}

export const PRESETS: Preset[] = [
  {
    id: 'clean-slate',
    label: 'Clean slate',
    blurb:
      'An ideal driver into an ideal channel. Nothing is wrong yet - the baseline everything else is measured against.',
    modules: ['m1', 'm2', 'm5', 'm11'],
    illustrative: false,
    scenario: make({
      'channel.kind': 'ideal',
      'impairments.noiseRms': 0,
      'impairments.randomJitterRms': 0,
      'source.riseTime': 10e-12,
      'source.fallTime': 10e-12,
      'view.spanUi': 8,
    }),
  },
  {
    id: 'square-wave',
    label: 'Square wave, first harmonic',
    blurb:
      'A single sine standing in for a square wave. Add harmonics one at a time and watch the edge appear.',
    modules: ['m1'],
    illustrative: false,
    scenario: make({
      'source.pattern.kind': 'clock',
      'channel.kind': 'ideal',
      'impairments.noiseRms': 0,
      'impairments.randomJitterRms': 0,
      'view.spanUi': 4,
    }),
  },
  {
    id: 'rc-limited',
    label: 'RC-limited edge',
    blurb:
      'One pole, nothing else. The simplest thing that can round an edge, and the reference case for rise time against bandwidth.',
    modules: ['m2', 'm5'],
    illustrative: false,
    scenario: make({
      'channel.kind': 'rc',
      'channel.rc.bw': 4e9,
      'source.riseTime': 10e-12,
      'source.fallTime': 10e-12,
      'impairments.noiseRms': 0,
      'impairments.randomJitterRms': 0,
      'view.spanUi': 8,
    }),
  },
  {
    id: 'underdamped',
    label: 'Underdamped package',
    blurb:
      'Series L with shunt C and too little R. Ringing and overshoot that look like a reflection but are not.',
    modules: ['m2', 'm10'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'rlc',
      'channel.rlc.r': 4,
      'channel.rlc.l': 3e-9,
      'channel.rlc.c': 1.5e-12,
      'source.riseTime': 15e-12,
      'source.fallTime': 15e-12,
      'view.spanUi': 12,
    }),
  },
  {
    id: 'unterminated-stub',
    label: 'Unterminated stub',
    blurb:
      'An open far end. The full reflection comes back and lands on the next bit; the bounce diagram says exactly when.',
    modules: ['m3'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'tline',
      'channel.tline.loadZ': 1e6,
      'channel.tline.length': 0.05,
      'channel.tline.z0': 50,
      'source.sourceZ': 20,
      'source.symbolRate': 2e9,
      'view.spanUi': 12,
    }),
  },
  {
    id: 'impedance-mismatch',
    label: 'Impedance mismatch',
    blurb:
      'A 50 ohm driver into a 75 ohm line into a 50 ohm load. Two discontinuities, two reflections, and a staircase on the edge.',
    modules: ['m3', 'm10'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'tline',
      'channel.tline.z0': 75,
      'channel.tline.loadZ': 50,
      'channel.tline.length': 0.08,
      'source.sourceZ': 50,
      'source.symbolRate': 3e9,
      'view.spanUi': 16,
    }),
  },
  {
    id: 'lossy-fr4',
    label: 'Lossy FR-4 route',
    blurb:
      'Skin effect and dielectric loss over a long route. Loss that rises with frequency is what turns an edge into a ramp.',
    modules: ['m4', 'm5', 'm7'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.3,
      'channel.lossy.er': 4.3,
      'channel.lossy.lossTangent': 0.02,
      'channel.lossy.roughnessRms': 2e-6,
      'source.symbolRate': 6.4e9,
    }),
  },
  {
    id: 'low-loss-laminate',
    label: 'Low-loss laminate',
    blurb:
      'The same length on better material with smoother copper. Compare the insertion loss at Nyquist against the FR-4 case.',
    modules: ['m4'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.3,
      'channel.lossy.er': 3.0,
      'channel.lossy.lossTangent': 0.004,
      'channel.lossy.roughnessRms': 0.4e-6,
      'source.symbolRate': 6.4e9,
    }),
  },
  {
    id: 'isi-dominant',
    label: 'ISI-dominant eye',
    blurb:
      'Almost no noise, almost no jitter, and the eye is still closing. Everything you see here is the channel remembering the last bit.',
    modules: ['m5', 'm7'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.4,
      'source.symbolRate': 8e9,
      'impairments.noiseRms': 0.5e-3,
      'impairments.randomJitterRms': 0.2e-12,
      'analysis.bits': 40000,
    }),
  },
  {
    id: 'jitter-decomposition',
    label: 'RJ plus PJ plus DCD',
    blurb:
      'Three named jitter components at once. The histogram is the sum; decomposition is the job of pulling them apart again.',
    modules: ['m5', 'm10'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'rc',
      'channel.rc.bw': 12e9,
      'impairments.randomJitterRms': 0.8e-12,
      'impairments.periodicJitterAmp': 2.5e-12,
      'impairments.periodicJitterFreq': 120e6,
      'impairments.dcdFraction': 0.04,
      'analysis.bits': 60000,
    }),
  },
  {
    id: 'crosstalk-victim',
    label: 'Victim between two aggressors',
    blurb: 'The victim pattern never changes. Everything that moves in the eye came from the neighbours.',
    modules: ['m6'],
    illustrative: true,
    scenario: make({
      'crosstalk.enabled': true,
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.25,
      'source.symbolRate': 6.4e9,
      'analysis.bits': 40000,
    }),
  },
  {
    id: 'sso-ground-bounce',
    label: 'Simultaneous switching',
    blurb:
      'A wide bus turning over at once, pulling the return path with it. The quiet line moves even though it is not switching.',
    modules: ['m6'],
    illustrative: true,
    scenario: make({
      'crosstalk.enabled': true,
      'crosstalk.ssoCount': 16,
      'crosstalk.ssoLoopInductance': 0.8e-9,
      'impairments.supplyDroop': 0.06,
      'source.symbolRate': 3.2e9,
    }),
  },
  {
    id: 'eq-before',
    label: 'Before equalization',
    blurb: 'A closed eye on a long channel, with every equalizer switched off. This is the input to M7.',
    modules: ['m7'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.45,
      'source.symbolRate': 9.6e9,
      'analysis.bits': 40000,
      'view.showEqualized': false,
    }),
  },
  {
    id: 'eq-after',
    label: 'After CTLE and DFE',
    blurb: 'The same closed eye with a CTLE peak and two DFE taps. Same channel, same bits, open eye.',
    modules: ['m7'],
    illustrative: true,
    scenario: make({
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.45,
      'source.symbolRate': 9.6e9,
      'eq.ctleEnabled': true,
      'eq.ctlePeakGainDb': 9,
      'eq.ctlePole1': 4.8e9,
      'eq.ctlePole2': 9.6e9,
      'eq.dfeEnabled': true,
      'analysis.bits': 40000,
      'view.showEqualized': true,
    }),
  },
  {
    id: 'ddr5-class',
    label: 'DDR5-class lane (illustrative)',
    blurb:
      'A single-ended lane at a DDR5-like rate over a short module route. Rates and margins here are stand-ins, not spec values.',
    modules: ['m8'],
    illustrative: true,
    scenario: make({
      'source.symbolRate': 6.4e9,
      'source.amplitude': 0.5,
      'source.riseTime': 22e-12,
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.12,
      'channel.lossy.er': 4.0,
      'sampling.setupTime': 15e-12,
      'sampling.holdTime': 15e-12,
      'analysis.bits': 40000,
    }),
  },
  {
    id: 'lpddr5-class',
    label: 'LPDDR5-class lane (illustrative)',
    blurb:
      'A shorter, lower-swing package-level route. Less loss, less margin, and a much tighter voltage budget.',
    modules: ['m8'],
    illustrative: true,
    scenario: make({
      'source.symbolRate': 6.4e9,
      'source.amplitude': 0.3,
      'source.riseTime': 18e-12,
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.03,
      'sampling.sensitivity': 15e-3,
      'analysis.bits': 40000,
    }),
  },
  {
    id: 'hbm-class',
    label: 'HBM-class interposer lane (illustrative)',
    blurb:
      'Very short, very wide, very slow per pin. The bandwidth comes from the pin count, so the per-lane problem is a different one.',
    modules: ['m8'],
    illustrative: true,
    scenario: make({
      'source.symbolRate': 2e9,
      'source.amplitude': 0.4,
      'source.riseTime': 40e-12,
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.005,
      'crosstalk.enabled': true,
      'crosstalk.ssoCount': 32,
      'analysis.bits': 40000,
    }),
  },
  {
    id: 'scope-limited',
    label: 'The scope is the problem',
    blurb:
      'A fast edge measured on a scope with too little bandwidth and a loading probe. The signal is fine; the picture is not.',
    modules: ['m10'],
    illustrative: true,
    scenario: make({
      'source.riseTime': 12e-12,
      'source.fallTime': 12e-12,
      'channel.kind': 'ideal',
      'scope.enabled': true,
      'scope.bandwidth': 4e9,
      'scope.sampleRate': 10e9,
      'scope.probeC': 1.5e-12,
      'scope.adcBits': 8,
      'view.spanUi': 8,
    }),
  },
  {
    id: 'scope-adequate',
    label: 'Enough scope',
    blurb:
      'The same edge through a front end with headroom. Everything that changed between these two presets is measurement, not signal.',
    modules: ['m10'],
    illustrative: true,
    scenario: make({
      'source.riseTime': 12e-12,
      'source.fallTime': 12e-12,
      'channel.kind': 'ideal',
      'scope.enabled': true,
      'scope.bandwidth': 25e9,
      'scope.sampleRate': 80e9,
      'scope.probeC': 0.2e-12,
      'scope.adcBits': 12,
      'view.spanUi': 8,
    }),
  },
  {
    id: 'pam4',
    label: 'PAM4, three eyes',
    blurb:
      'Two bits per symbol on the same channel. Three eyes, a third of the amplitude each, and 9.5 dB of level-separation penalty to pay for it.',
    modules: ['m11'],
    illustrative: true,
    scenario: make({
      'source.levels': 'pam4',
      'source.symbolRate': 6.4e9,
      'channel.kind': 'lossy',
      'channel.lossy.length': 0.3,
      'analysis.bits': 60000,
      'view.spanUi': 8,
    }),
  },
];

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): Preset | undefined {
  return BY_ID.get(id);
}

export function presetsForModule(moduleId: string): Preset[] {
  return PRESETS.filter((p) => p.modules.includes(moduleId));
}

/**
 * The scenario a module opens on: its first listed preset, or the bare defaults if
 * it has none yet.
 */
export function defaultScenarioForModule(moduleId: string): Scenario {
  return presetsForModule(moduleId)[0]?.scenario ?? defaultScenario();
}
