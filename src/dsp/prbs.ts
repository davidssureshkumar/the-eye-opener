/**
 * PRBS generators - Fibonacci linear-feedback shift registers.
 *
 * A PRBS-n built on a primitive polynomial of degree n is maximal length: it
 * cycles through every non-zero n-bit state exactly once, giving period 2^n - 1.
 * That property is what makes it useful for signal integrity work - it guarantees
 * the pattern contains every n-bit sequence, so it exercises every combination of
 * ISI taps within an n-bit memory. A PRBS7 cannot stress a channel whose pulse
 * response rings for 12 UI; you need PRBS13 or longer. That is the whole reason
 * the choice of PRBS order is a real engineering decision and not a preference.
 *
 * Convention: feedback bit is taken from taps on the shift register and inserted
 * at the LSB; the emitted bit is the feedback bit. Taps are 1-indexed powers of
 * the generator polynomial, excluding the constant 1 term.
 */

export interface PrbsSpec {
  /** Register length n, so period is 2^n - 1. */
  readonly order: number;
  /**
   * Polynomial exponents other than the constant term, 1-indexed.
   * x^7 + x^6 + 1 is [7, 6].
   */
  readonly taps: readonly number[];
  /** Human-readable polynomial, shown in the UI. */
  readonly polynomial: string;
  /** Where this polynomial is conventionally specified. */
  readonly source: string;
}

/**
 * Standard PRBS polynomials.
 *
 * PRBS 9, 11, 15, 20 and 23 are the ITU-T O.150 sequences. PRBS7 and PRBS31 are
 * the near-universal SerDes conventions (PRBS31 is the IEEE 802.3 scrambler
 * polynomial). PRBS13 is not in O.150; the polynomial below is the one used by
 * the OIF-CEI and PCIe PAM4 test patterns. Where a standard defines the sequence
 * with a specific inversion or seed, that is a property of the standard, not of
 * the polynomial - this library generates the raw maximal-length sequence.
 */
export const PRBS_SPECS = {
  prbs7: { order: 7, taps: [7, 6], polynomial: 'x^7 + x^6 + 1', source: 'SerDes convention' },
  prbs9: { order: 9, taps: [9, 5], polynomial: 'x^9 + x^5 + 1', source: 'ITU-T O.150' },
  prbs11: { order: 11, taps: [11, 9], polynomial: 'x^11 + x^9 + 1', source: 'ITU-T O.150' },
  prbs13: {
    order: 13,
    taps: [13, 12, 2, 1],
    polynomial: 'x^13 + x^12 + x^2 + x + 1',
    source: 'OIF-CEI / PCIe',
  },
  prbs15: { order: 15, taps: [15, 14], polynomial: 'x^15 + x^14 + 1', source: 'ITU-T O.150' },
  prbs20: { order: 20, taps: [20, 3], polynomial: 'x^20 + x^3 + 1', source: 'ITU-T O.150' },
  prbs23: { order: 23, taps: [23, 18], polynomial: 'x^23 + x^18 + 1', source: 'ITU-T O.150' },
  prbs31: { order: 31, taps: [31, 28], polynomial: 'x^31 + x^28 + 1', source: 'IEEE 802.3' },
} as const satisfies Record<string, PrbsSpec>;

export type PrbsName = keyof typeof PRBS_SPECS;

export const PRBS_NAMES = Object.keys(PRBS_SPECS) as PrbsName[];

/**
 * Maximal-length LFSR.
 *
 * State is held in a 32-bit integer, so orders up to 31 are supported. Bit i of
 * the state is register stage i+1, i.e. tap k reads bit (k-1).
 */
export class Lfsr {
  readonly order: number;
  private readonly tapMask: number;
  private readonly stateMask: number;
  private state: number;
  private readonly seed: number;

  constructor(spec: PrbsSpec, seed?: number) {
    if (spec.order < 2 || spec.order > 31) {
      throw new Error(`Lfsr: order ${spec.order} outside supported range 2..31`);
    }
    this.order = spec.order;
    this.stateMask = spec.order === 31 ? 0x7fffffff : (1 << spec.order) - 1;
    let m = 0;
    for (const t of spec.taps) {
      if (t < 1 || t > spec.order) throw new Error(`Lfsr: tap ${t} outside 1..${spec.order}`);
      m |= 1 << (t - 1);
    }
    this.tapMask = m;
    const s = (seed === undefined ? this.stateMask : seed) & this.stateMask;
    // An all-zero state is an absorbing fixed point; fall back to all-ones.
    this.seed = s === 0 ? this.stateMask : s;
    this.state = this.seed;
  }

  /** Period of the sequence, 2^n - 1. */
  get period(): number {
    return this.stateMask;
  }

  reset(): void {
    this.state = this.seed;
  }

  /** Current register contents, for display or for resuming a worker job. */
  getState(): number {
    return this.state;
  }

  setState(s: number): void {
    const v = s & this.stateMask;
    this.state = v === 0 ? this.stateMask : v;
  }

  /** Emit the next bit and advance the register. */
  next(): 0 | 1 {
    // Parity of the tapped bits is the feedback bit.
    let x = this.state & this.tapMask;
    x ^= x >>> 16;
    x ^= x >>> 8;
    x ^= x >>> 4;
    x ^= x >>> 2;
    x ^= x >>> 1;
    const fb = (x & 1) as 0 | 1;
    this.state = ((this.state << 1) | fb) & this.stateMask;
    return fb;
  }

  /** Emit n bits into a Uint8Array of 0/1 values. */
  take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.next();
    return out;
  }
}

/** Construct an LFSR by standard name. */
export function makePrbs(name: PrbsName, seed?: number): Lfsr {
  return new Lfsr(PRBS_SPECS[name], seed);
}

/** Generate n bits of a named PRBS as 0/1 values. */
export function prbsBits(name: PrbsName, n: number, seed?: number): Uint8Array {
  return makePrbs(name, seed).take(n);
}

/**
 * Periodic autocorrelation of a bipolar-mapped binary sequence.
 *
 * For a maximal-length sequence of period N = 2^n - 1 mapped to +/-1, this is
 * exactly N at lag 0 and exactly -1 at every other lag. That two-valued result is
 * a complete test of maximality, which is why it is the primary check in the test
 * suite rather than a table of golden bytes: it validates the polynomial itself,
 * not just that the code still does what it did yesterday.
 */
export function periodicAutocorrelation(bits: Uint8Array): Int32Array {
  const n = bits.length;
  const s = new Int8Array(n);
  for (let i = 0; i < n; i++) s[i] = bits[i] ? 1 : -1;
  const out = new Int32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += s[i] * s[(i + lag) % n];
    out[lag] = acc;
  }
  return out;
}

/**
 * Run-length histogram of a bit sequence, treated as periodic.
 * A maximal-length sequence has 2^(n-k-1) runs of length k for k < n-1, which is
 * what makes a long PRBS contain the long runs that stress DC wander and baseline
 * restoration. Useful to display next to the pattern selector.
 */
export function runLengthHistogram(bits: Uint8Array): Map<number, number> {
  const hist = new Map<number, number>();
  const n = bits.length;
  if (n === 0) return hist;
  let i = 0;
  // Rotate to a run boundary so the wrap-around run is not split in two.
  while (i < n && bits[i] === bits[(i - 1 + n) % n]) i++;
  if (i === n) {
    hist.set(n, 1);
    return hist;
  }
  const start = i;
  let count = 1;
  for (let k = 1; k <= n; k++) {
    const cur = bits[(start + k) % n];
    const prev = bits[(start + k - 1) % n];
    if (k < n && cur === prev) {
      count++;
    } else {
      hist.set(count, (hist.get(count) ?? 0) + 1);
      count = 1;
      if (k === n) break;
    }
  }
  return hist;
}

/** Fraction of ones. A maximal-length PRBS is very slightly ones-heavy: 2^(n-1)/(2^n - 1). */
export function onesDensity(bits: Uint8Array): number {
  if (bits.length === 0) return 0;
  let ones = 0;
  for (let i = 0; i < bits.length; i++) ones += bits[i];
  return ones / bits.length;
}

/**
 * Longest run of identical bits - the quantity that drives DC wander, AC-coupling
 * droop and CDR drift between transitions. Worth showing whenever a pattern is chosen.
 */
export function longestRun(bits: Uint8Array): number {
  let best = 0;
  let cur = 0;
  for (let i = 0; i < bits.length; i++) {
    cur = i > 0 && bits[i] === bits[i - 1] ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}
