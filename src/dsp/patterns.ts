/**
 * Test pattern library.
 *
 * Every module that drives a channel draws its bit stream from here, so the
 * pattern is part of the shared Scenario and survives navigation between modules.
 *
 * Patterns are not interchangeable and the site should make that obvious. A
 * clock pattern exercises only the fundamental and tells you nothing about ISI. A
 * lone pulse isolates the pulse response and hides everything about DC wander. A
 * PRBS13 stresses a 13-UI ISI memory that a PRBS7 cannot reach. The computed
 * worst-case ISI pattern closes the eye further than any PRBS of practical length
 * will, because it is constructed rather than sampled.
 */

import { type PrbsName, PRBS_SPECS, makePrbs } from './prbs';

export type PatternKind =
  | 'prbs'
  | 'clock'
  | 'clock-div-n'
  | 'lone-one'
  | 'lone-zero'
  | 'walking-one'
  | 'walking-zero'
  | 'all-ones'
  | 'all-zeros'
  | 'burst-idle'
  | 'custom'
  | 'worst-case-isi';

export interface PatternSpec {
  kind: PatternKind;
  /** For kind 'prbs'. */
  prbs?: PrbsName;
  /** LFSR seed, so a permalink reproduces the identical stream. */
  seed?: number;
  /** For 'clock-div-n': bits per half period. 1 gives 1010, 2 gives 11001100. */
  divN?: number;
  /** For 'lone-*', 'walking-*' and 'burst-idle': the field/frame length in bits. */
  frame?: number;
  /** For 'burst-idle': active bits per burst. */
  burst?: number;
  /** For 'custom': a string of 0/1 characters, repeated to length. */
  custom?: string;
  /** Invert the whole stream. Some standards specify an inverted PRBS. */
  invert?: boolean;
}

/** Context a pattern may need from the simulation, currently only for worst-case ISI. */
export interface PatternContext {
  /** Pulse response sampled at 1 sample per UI, cursor-aligned. */
  cursorTaps?: Float64Array;
  /** Index of the main cursor within cursorTaps. */
  cursorIndex?: number;
}

export interface PatternInfo {
  label: string;
  /** Repetition period in bits, or null for aperiodic/very long. */
  period: number | null;
  /** One-line statement of what this pattern is good for. */
  purpose: string;
}

export const DEFAULT_PATTERN: PatternSpec = { kind: 'prbs', prbs: 'prbs13', seed: 0x1fff };

/**
 * Generate n bits. Always returns exactly n entries of 0 or 1, repeating the
 * underlying pattern as needed, so callers never have to handle short reads.
 */
export function generateBits(spec: PatternSpec, n: number, ctx: PatternContext = {}): Uint8Array {
  const out = generateRaw(spec, n, ctx);
  if (spec.invert) {
    for (let i = 0; i < out.length; i++) out[i] ^= 1;
  }
  return out;
}

function generateRaw(spec: PatternSpec, n: number, ctx: PatternContext): Uint8Array {
  switch (spec.kind) {
    case 'prbs': {
      const name = spec.prbs ?? 'prbs13';
      return makePrbs(name, spec.seed).take(n);
    }
    case 'clock':
      return repeatUnit(new Uint8Array([1, 0]), n);
    case 'clock-div-n': {
      const d = Math.max(1, Math.floor(spec.divN ?? 2));
      const unit = new Uint8Array(2 * d);
      unit.fill(1, 0, d);
      return repeatUnit(unit, n);
    }
    case 'lone-one': {
      const f = Math.max(2, Math.floor(spec.frame ?? 32));
      const unit = new Uint8Array(f);
      unit[f >> 1] = 1;
      return repeatUnit(unit, n);
    }
    case 'lone-zero': {
      const f = Math.max(2, Math.floor(spec.frame ?? 32));
      const unit = new Uint8Array(f).fill(1);
      unit[f >> 1] = 0;
      return repeatUnit(unit, n);
    }
    case 'walking-one': {
      const f = Math.max(2, Math.floor(spec.frame ?? 8));
      const unit = new Uint8Array(f * f);
      for (let i = 0; i < f; i++) unit[i * f + i] = 1;
      return repeatUnit(unit, n);
    }
    case 'walking-zero': {
      const f = Math.max(2, Math.floor(spec.frame ?? 8));
      const unit = new Uint8Array(f * f).fill(1);
      for (let i = 0; i < f; i++) unit[i * f + i] = 0;
      return repeatUnit(unit, n);
    }
    case 'all-ones':
      return new Uint8Array(n).fill(1);
    case 'all-zeros':
      return new Uint8Array(n);
    case 'burst-idle': {
      const f = Math.max(2, Math.floor(spec.frame ?? 64));
      const b = Math.min(f, Math.max(1, Math.floor(spec.burst ?? 16)));
      const unit = new Uint8Array(f);
      for (let i = 0; i < b; i++) unit[i] = i % 2 === 0 ? 1 : 0;
      return repeatUnit(unit, n);
    }
    case 'custom': {
      const src = (spec.custom ?? '10').replace(/[^01]/g, '');
      if (src.length === 0) return new Uint8Array(n);
      const unit = new Uint8Array(src.length);
      for (let i = 0; i < src.length; i++) unit[i] = src.charCodeAt(i) === 49 ? 1 : 0;
      return repeatUnit(unit, n);
    }
    case 'worst-case-isi': {
      const taps = ctx.cursorTaps;
      const ci = ctx.cursorIndex ?? 0;
      if (!taps || taps.length === 0) return repeatUnit(new Uint8Array([1, 0]), n);
      const unit = worstCaseIsiPattern(taps, ci, 1);
      return repeatUnit(unit.bits, n);
    }
    default: {
      const exhaustive: never = spec.kind;
      throw new Error(`generateBits: unhandled pattern kind ${String(exhaustive)}`);
    }
  }
}

function repeatUnit(unit: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (unit.length === 0) return out;
  for (let i = 0; i < n; i++) out[i] = unit[i % unit.length];
  return out;
}

export interface WorstCaseIsiResult {
  /** The constructed bit sequence, in transmit order. */
  bits: Uint8Array;
  /** Index within `bits` of the bit whose cursor is being attacked. */
  cursorBit: number;
  /**
   * Worst-case sampled level at the cursor, in the same units as the pulse
   * response. For a target of 1 this is h[0] - sum_{m != 0} |h[m]|.
   */
  worstLevel: number;
  /** Total ISI magnitude available to close the eye: sum_{m != 0} |h[m]|. */
  totalIsi: number;
}

/**
 * Peak-distortion analysis: construct the data pattern that maximally closes the
 * eye at one cursor.
 *
 * Received sample at the cursor of bit 0 is r = sum_k a_k * h[-k], where a_k is
 * the bipolar symbol of bit k and h[m] is the pulse response sampled m UI after
 * the cursor. Bit k therefore contributes through tap m = -k: post-cursor taps
 * (m > 0) are driven by bits transmitted *before* the cursor bit, pre-cursor taps
 * (m < 0) by bits transmitted after it.
 *
 * To minimise r for a transmitted 1, every other bit takes the sign that
 * subtracts: a_{-m} = -sign(h[m]). The resulting level is the classic
 * peak-distortion bound h[0] - sum|h[m]|, and an eye closed by this pattern is
 * closed by construction - no PRBS of finite length is guaranteed to contain it.
 *
 * @param taps        Pulse response sampled at 1 sample/UI.
 * @param cursorIndex Index of the main cursor within taps.
 * @param target      1 to attack the one level, 0 to attack the zero level.
 */
export function worstCaseIsiPattern(
  taps: Float64Array,
  cursorIndex: number,
  target: 0 | 1 = 1,
): WorstCaseIsiResult {
  const n = taps.length;
  if (cursorIndex < 0 || cursorIndex >= n) throw new Error('worstCaseIsiPattern: cursor out of range');
  const bits = new Uint8Array(n);
  const sign = target === 1 ? 1 : -1;
  let totalIsi = 0;

  for (let i = 0; i < n; i++) {
    const m = i - cursorIndex; // tap offset in UI
    if (m === 0) {
      bits[cursorIndex] = target;
      continue;
    }
    // Bit index k = -m relative to the cursor bit, i.e. array index cursorIndex - m.
    const k = cursorIndex - m;
    const want = -sign * Math.sign(taps[i]); // bipolar value that subtracts
    if (k >= 0 && k < n) bits[k] = want >= 0 ? 1 : 0;
    totalIsi += Math.abs(taps[i]);
  }

  const h0 = taps[cursorIndex];
  const worstLevel = target === 1 ? h0 - totalIsi : -h0 + totalIsi;
  return { bits, cursorBit: cursorIndex, worstLevel, totalIsi };
}

/**
 * Map bits to bipolar NRZ symbols in [-1, +1].
 * Separate from level scaling so the driver owns amplitude and common mode.
 */
export function bitsToNrz(bits: Uint8Array): Float64Array {
  const out = new Float64Array(bits.length);
  for (let i = 0; i < bits.length; i++) out[i] = bits[i] ? 1 : -1;
  return out;
}

/**
 * Map bit pairs to Gray-coded PAM4 symbols in [-1, -1/3, +1/3, +1].
 *
 * PAM4 is confined to the M11 sandbox and the generic SerDes preset - every
 * memory interface in this site is NRZ - but the symbol mapper lives here so the
 * eye, slicer and BER engines can stay level-generic rather than being retrofitted.
 *
 * Gray mapping (MSB first): 00 -> -1, 01 -> -1/3, 11 -> +1/3, 10 -> +1. Adjacent
 * levels differ in one bit, so a single-level slicing error costs one bit, not two.
 */
export function bitsToPam4(bits: Uint8Array): Float64Array {
  const nSym = bits.length >> 1;
  const out = new Float64Array(nSym);
  const levels = [-1, -1 / 3, 1 / 3, 1];
  const grayToLevel = [0, 1, 3, 2]; // index by (msb<<1)|lsb
  for (let i = 0; i < nSym; i++) {
    const code = (bits[2 * i] << 1) | bits[2 * i + 1];
    out[i] = levels[grayToLevel[code]];
  }
  return out;
}

/** Describe a pattern for the UI: label, period, and what it is actually for. */
export function describePattern(spec: PatternSpec): PatternInfo {
  switch (spec.kind) {
    case 'prbs': {
      const name = spec.prbs ?? 'prbs13';
      const s = PRBS_SPECS[name];
      return {
        label: `PRBS${s.order}`,
        period: Math.pow(2, s.order) - 1,
        purpose: `Exercises every ${s.order}-bit combination, so it stresses ISI with a memory up to ${s.order} UI. ${s.polynomial}.`,
      };
    }
    case 'clock':
      return {
        label: 'Clock (1010)',
        period: 2,
        purpose:
          'Pure fundamental at half the bit rate. Shows channel loss at Nyquist and nothing about ISI, because every bit has the same history.',
      };
    case 'clock-div-n': {
      const d = Math.max(1, Math.floor(spec.divN ?? 2));
      return {
        label: `Clock /${d} (${'1'.repeat(d)}${'0'.repeat(d)})`,
        period: 2 * d,
        purpose: `Fundamental at f_b/(2*${d}). Useful for walking a single tone across the channel response.`,
      };
    }
    case 'lone-one':
      return {
        label: 'Lone 1',
        period: Math.max(2, Math.floor(spec.frame ?? 32)),
        purpose:
          'Isolated pulse in a field of zeros. This is the single-bit response - the cleanest way to read pre-cursor and post-cursor ISI taps directly off the waveform.',
      };
    case 'lone-zero':
      return {
        label: 'Lone 0',
        period: Math.max(2, Math.floor(spec.frame ?? 32)),
        purpose:
          'Isolated zero in a field of ones. Reveals asymmetry between the rising and falling edge response and any baseline wander.',
      };
    case 'walking-one':
      return {
        label: 'Walking 1',
        period: Math.pow(Math.max(2, Math.floor(spec.frame ?? 8)), 2),
        purpose:
          'One active bit stepping through each position of a frame. The classic memory pattern for isolating a single failing bit position.',
      };
    case 'walking-zero':
      return {
        label: 'Walking 0',
        period: Math.pow(Math.max(2, Math.floor(spec.frame ?? 8)), 2),
        purpose: 'Inverse of walking 1; catches stuck-high faults and asymmetric termination.',
      };
    case 'all-ones':
      return {
        label: 'All 1s',
        period: 1,
        purpose:
          'DC. No transitions at all, so a CDR has nothing to lock to and an AC-coupled link droops. Use it to see baseline wander, not ISI.',
      };
    case 'all-zeros':
      return { label: 'All 0s', period: 1, purpose: 'DC low. Same purpose as all 1s, opposite rail.' };
    case 'burst-idle':
      return {
        label: 'Burst + idle',
        period: Math.max(2, Math.floor(spec.frame ?? 64)),
        purpose:
          'Active burst followed by idle. Stresses PDN droop and recovery, AC-coupling settling, and CDR re-acquisition - the conditions a steady PRBS never creates.',
      };
    case 'custom':
      return {
        label: 'Custom',
        period: (spec.custom ?? '10').replace(/[^01]/g, '').length || null,
        purpose: 'User-defined repeating sequence.',
      };
    case 'worst-case-isi':
      return {
        label: 'Worst-case ISI (computed)',
        period: null,
        purpose:
          'Constructed from the channel pulse response by peak-distortion analysis, not sampled. Every ISI tap is aligned to subtract from the cursor, producing the lowest one level the channel can physically deliver.',
      };
  }
}

/** The pattern menu, in the order it should appear in the UI. */
export const PATTERN_MENU: readonly PatternSpec[] = [
  { kind: 'prbs', prbs: 'prbs7' },
  { kind: 'prbs', prbs: 'prbs9' },
  { kind: 'prbs', prbs: 'prbs11' },
  { kind: 'prbs', prbs: 'prbs13' },
  { kind: 'prbs', prbs: 'prbs15' },
  { kind: 'prbs', prbs: 'prbs23' },
  { kind: 'prbs', prbs: 'prbs31' },
  { kind: 'clock' },
  { kind: 'clock-div-n', divN: 2 },
  { kind: 'clock-div-n', divN: 4 },
  { kind: 'lone-one', frame: 32 },
  { kind: 'lone-zero', frame: 32 },
  { kind: 'walking-one', frame: 8 },
  { kind: 'walking-zero', frame: 8 },
  { kind: 'burst-idle', frame: 64, burst: 16 },
  { kind: 'all-ones' },
  { kind: 'all-zeros' },
  { kind: 'worst-case-isi' },
  { kind: 'custom', custom: '1100101000' },
] as const;
