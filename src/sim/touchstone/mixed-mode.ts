/**
 * Which port is which, and the differential and common modes of a pair.
 *
 * A measured file says nothing about its own wiring. Two conventions for a
 * four-port pair are common, and a figure drawn with the wrong one shows the
 * crosstalk as the through path:
 *
 *   ports 1 and 2 at one end, 3 and 4 at the other:  thrus 1-3 and 2-4
 *   ports 1 and 3 at one end, 2 and 4 at the other:  thrus 1-2 and 3-4
 *
 * Rather than ask, the wiring is read from the data. At the lowest frequencies a
 * through path passes almost everything and a coupled path almost nothing, so the
 * thrus are the pairing of ports that maximises the summed log magnitude of the
 * paired transmissions there: a maximum-weight perfect matching, found exactly by
 * dynamic programming over subsets, which for 12 ports is 4096 states. The page
 * shows the pairing it found, so a reader whose file is wired unusually sees it.
 *
 * Every thru then has an input, its lower-numbered port, and an output. Lines are
 * ordered by input, and consecutive lines form a differential pair, the first the
 * P leg. For both conventions above this gives P = the thru from port 1 and N = the
 * other, which is what the files mean.
 *
 * The mixed-mode transfers follow from writing the differential and common waves
 * as (a_P - a_N) / sqrt 2 and (a_P + a_N) / sqrt 2 at each end. From input pair
 * (iP, iN) to output pair (oP, oN):
 *
 *   Sdd = (S_oP,iP - S_oP,iN - S_oN,iP + S_oN,iN) / 2
 *   Scd = (S_oP,iP - S_oP,iN + S_oN,iP - S_oN,iN) / 2     common out, differential in
 *   Sdc = (S_oP,iP + S_oP,iN - S_oN,iP - S_oN,iN) / 2
 *   Scc = (S_oP,iP + S_oP,iN + S_oN,iP + S_oN,iN) / 2
 *
 * The change of basis is an orthogonal matrix, so the mixed-mode matrix has the
 * singular values of the single-ended one: converting cannot make a passive file
 * look active, or the reverse.
 *
 * Physics: PHYSICS.md section 14.3.
 */

import type { Complex } from '../../dsp/complex';
import { matrixAt, sIndex, type CMatrix, type Network } from './network';

/** One through path, 0-based ports. */
export interface ThruLine {
  input: number;
  output: number;
}

export interface Topology {
  /** Through paths, ordered by input port. */
  lines: ThruLine[];
  /** Consecutive lines taken two at a time: [P, N]. A last odd line is left out. */
  pairs: [ThruLine, ThruLine][];
  /** A port with no partner, for an odd port count, or -1. */
  unmatched: number;
  /** For each port: which line it is on, and whether it is that line's input. */
  lineOf: Int32Array;
  isInput: Uint8Array;
}

/** Log magnitude floor for the matching, so an exactly zero path is finite. */
const LOG_FLOOR = Math.log(1e-12);

/** How many of the lowest frequencies the matching looks at. */
export const THRU_DETECTION_POINTS = 8;

/** Mean over the lowest frequencies of (ln|S_ij| + ln|S_ji|) / 2, the weight of pairing i with j. */
function pairWeight(net: Network, i: number, j: number, points: number): number {
  let sum = 0;
  for (let k = 0; k < points; k++) {
    const a = sIndex(net, k, i, j);
    const b = sIndex(net, k, j, i);
    sum += Math.max(LOG_FLOOR, Math.log(Math.hypot(net.re[a], net.im[a])));
    sum += Math.max(LOG_FLOOR, Math.log(Math.hypot(net.re[b], net.im[b])));
  }
  return sum / (2 * points);
}

/**
 * The maximum-weight perfect matching of `ports` vertices under `weight`, excluding
 * `skip` (or none when -1). best[mask] is the best matching of the ports in mask;
 * the lowest port in the mask is matched with each other in turn.
 */
function bestMatching(ports: number, weight: number[][], skip: number): { value: number; mates: Int32Array } {
  const full = ((1 << ports) - 1) & ~(skip >= 0 ? 1 << skip : 0);
  const best = new Float64Array(1 << ports).fill(-Infinity);
  const choice = new Int32Array(1 << ports).fill(-1);
  best[0] = 0;
  // Masks in increasing order only ever look at smaller masks.
  for (let mask = 1; mask <= full; mask++) {
    if ((mask & full) !== mask) continue;
    let count = 0;
    for (let m = mask; m; m &= m - 1) count++;
    if (count % 2) continue;
    const low = 31 - Math.clz32(mask & -mask);
    for (let j = low + 1; j < ports; j++) {
      if (!(mask & (1 << j))) continue;
      const rest = mask & ~(1 << low) & ~(1 << j);
      const v = best[rest] + weight[low][j];
      if (v > best[mask]) {
        best[mask] = v;
        choice[mask] = j;
      }
    }
  }
  const mates = new Int32Array(ports).fill(-1);
  let mask = full;
  while (mask) {
    const low = 31 - Math.clz32(mask & -mask);
    const j = choice[mask];
    mates[low] = j;
    mates[j] = low;
    mask &= ~(1 << low) & ~(1 << j);
  }
  return { value: best[full], mates };
}

/** Read the wiring of a network from its low-frequency transmissions. */
export function detectTopology(net: Network): Topology {
  const n = net.ports;
  const lineOf = new Int32Array(n).fill(-1);
  const isInput = new Uint8Array(n);
  if (n < 2) return { lines: [], pairs: [], unmatched: n === 1 ? 0 : -1, lineOf, isInput };

  const points = Math.min(THRU_DETECTION_POINTS, net.freq.length);
  const weight: number[][] = [];
  for (let i = 0; i < n; i++) {
    weight.push([]);
    for (let j = 0; j < n; j++) weight[i].push(i === j ? -Infinity : pairWeight(net, i, j, points));
  }

  let chosen: { value: number; mates: Int32Array } = { value: -Infinity, mates: new Int32Array(n).fill(-1) };
  let unmatched = -1;
  const skips = n % 2 === 0 ? [-1] : Array.from({ length: n }, (_, i) => i);
  for (const skip of skips) {
    const m = bestMatching(n, weight, skip);
    if (m.value > chosen.value) {
      chosen = m;
      unmatched = skip;
    }
  }

  const lines: ThruLine[] = [];
  for (let i = 0; i < n; i++) {
    const j = chosen.mates[i];
    if (j > i) lines.push({ input: i, output: j });
  }
  lines.sort((a, b) => a.input - b.input);
  lines.forEach((line, index) => {
    lineOf[line.input] = index;
    lineOf[line.output] = index;
    isInput[line.input] = 1;
  });
  const pairs: [ThruLine, ThruLine][] = [];
  for (let l = 0; l + 1 < lines.length; l += 2) pairs.push([lines[l], lines[l + 1]]);
  return { lines, pairs, unmatched, lineOf, isInput };
}

export type Mode = 'd' | 'c';

/** A pair of ports at one end: the P leg's port and the N leg's port. */
export interface PortPair {
  p: number;
  n: number;
}

/**
 * Mixed-mode transfer from `input` pair in mode `inMode` to `output` pair in mode
 * `outMode`, at frequency index k.
 */
export function modalTransfer(
  net: Network,
  k: number,
  output: PortPair,
  input: PortPair,
  outMode: Mode,
  inMode: Mode,
): Complex {
  const so = outMode === 'd' ? -1 : 1;
  const si = inMode === 'd' ? -1 : 1;
  const terms: [number, number, number][] = [
    [output.p, input.p, 1],
    [output.p, input.n, si],
    [output.n, input.p, so],
    [output.n, input.n, so * si],
  ];
  let re = 0;
  let im = 0;
  for (const [o, i, sign] of terms) {
    const x = sIndex(net, k, o, i);
    re += sign * net.re[x];
    im += sign * net.im[x];
  }
  return { re: re / 2, im: im / 2 };
}

/** The same transfer at every frequency. */
export function modalColumn(
  net: Network,
  output: PortPair,
  input: PortPair,
  outMode: Mode,
  inMode: Mode,
): { re: Float64Array; im: Float64Array } {
  const nf = net.freq.length;
  const re = new Float64Array(nf);
  const im = new Float64Array(nf);
  for (let k = 0; k < nf; k++) {
    const v = modalTransfer(net, k, output, input, outMode, inMode);
    re[k] = v.re;
    im[k] = v.im;
  }
  return { re, im };
}

/**
 * The whole mixed-mode matrix at frequency index k, for ports grouped into `groups`
 * that together cover every port once: T S T^T, where T has rows (e_P - e_N)/sqrt 2
 * and (e_P + e_N)/sqrt 2 for each group, differential first. Used to show that the
 * conversion preserves singular values.
 */
export function mixedModeMatrix(net: Network, k: number, groups: readonly PortPair[]): CMatrix {
  const n = net.ports;
  if (groups.length * 2 !== n) throw new Error('mixedModeMatrix: the groups must cover every port once');
  const t = new Float64Array(n * n);
  const r = Math.SQRT1_2;
  groups.forEach((g, m) => {
    t[2 * m * n + g.p] = r;
    t[2 * m * n + g.n] = -r;
    t[(2 * m + 1) * n + g.p] = r;
    t[(2 * m + 1) * n + g.n] = r;
  });
  const s = matrixAt(net, k);
  const out: CMatrix = { n, re: new Float64Array(n * n), im: new Float64Array(n * n) };
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i++) {
        const ta = t[a * n + i];
        if (ta === 0) continue;
        for (let j = 0; j < n; j++) {
          const tb = t[b * n + j];
          if (tb === 0) continue;
          re += ta * tb * s.re[i * n + j];
          im += ta * tb * s.im[i * n + j];
        }
      }
      out.re[a * n + b] = re;
      out.im[a * n + b] = im;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- the view */

export type CrosstalkKind = 'next' | 'fext';

/** One path by which another line reaches the victim's receiver. */
export interface AggressorPath {
  /** Shown to the reader, 1-based: "port 3" or "pair 3-4 / 7-8". */
  label: string;
  kind: CrosstalkKind;
  /** Driven port (single-ended) or the P port of the driven pair, 0-based. */
  port: number;
  re: Float64Array;
  im: Float64Array;
}

/**
 * What the rest of the simulator needs from a network: one through transfer, the
 * reflection at its input, and every path that couples into its output.
 */
export interface ChannelView {
  mode: 'single' | 'differential';
  /** Driven and observed ports, 0-based; for a pair, the P ports. */
  txPort: number;
  rxPort: number;
  /** For a pair, the N ports; otherwise -1. */
  txPortN: number;
  rxPortN: number;
  thru: { re: Float64Array; im: Float64Array };
  reflection: { re: Float64Array; im: Float64Array };
  /** Differential in, common out, at the far end. Absent for a single-ended view. */
  conversion?: { re: Float64Array; im: Float64Array };
  /** Common in, differential out. */
  conversionDc?: { re: Float64Array; im: Float64Array };
  /** The single-ended P and N legs' own transmissions, for skew. */
  legP?: { re: Float64Array; im: Float64Array };
  legN?: { re: Float64Array; im: Float64Array };
  aggressors: AggressorPath[];
  /** Plain-language notes on how the view was chosen, for the page. */
  notes: string[];
}

function column(net: Network, o: number, i: number): { re: Float64Array; im: Float64Array } {
  const nf = net.freq.length;
  const re = new Float64Array(nf);
  const im = new Float64Array(nf);
  for (let k = 0; k < nf; k++) {
    const x = sIndex(net, k, o, i);
    re[k] = net.re[x];
    im[k] = net.im[x];
  }
  return { re, im };
}

/**
 * Choose the through path, and its aggressors, from the Scenario's 1-based ports.
 *
 * Single-ended: the thru is S(rx, tx). Every other port q is an aggressor driven
 * at q; its path is S(rx, q). It is near-end crosstalk when q sits at the same end
 * as the receiver, and far-end when it sits at the transmitter's end.
 *
 * Differential: the pair holding `txPort` is the victim, driven from the end
 * `txPort` is on; `rxPort` is not needed and is reported if it disagrees. Every
 * other pair is a differential aggressor, driven at either end, with the same
 * near and far rule.
 */
export function channelView(
  net: Network,
  topology: Topology,
  txPort1: number,
  rxPort1: number,
  differential: boolean,
): ChannelView {
  const n = net.ports;
  const tx = Math.min(n - 1, Math.max(0, Math.round(txPort1) - 1));
  let rx = Math.min(n - 1, Math.max(0, Math.round(rxPort1) - 1));
  const notes: string[] = [];
  const oneBased = (p: number) => p + 1;

  const pairIndexOf = (port: number): number => {
    const line = topology.lineOf[port];
    return line < 0 ? -1 : line >> 1 < topology.pairs.length ? line >> 1 : -1;
  };

  if (differential && pairIndexOf(tx) >= 0) {
    const victim = topology.pairs[pairIndexOf(tx)];
    const fromInputs = topology.isInput[tx] === 1;
    const end = (pair: [ThruLine, ThruLine], inputs: boolean): PortPair =>
      inputs ? { p: pair[0].input, n: pair[1].input } : { p: pair[0].output, n: pair[1].output };
    const vIn = end(victim, fromInputs);
    const vOut = end(victim, !fromInputs);
    if (rx !== vOut.p && rx !== vOut.n) {
      notes.push(
        `Receive port ${oneBased(rx)} is not on the far end of the pair holding transmit port ${oneBased(tx)}; the pair's far end, ports ${oneBased(vOut.p)} and ${oneBased(vOut.n)}, is used.`,
      );
    }
    const aggressors: AggressorPath[] = [];
    topology.pairs.forEach((pair, index) => {
      if (pair === victim) return;
      for (const inputs of [true, false]) {
        const drive = end(pair, inputs);
        // The victim's receiver is on its output side; a pair driven on that side is near end.
        const sameEndAsReceiver = inputs === !fromInputs;
        aggressors.push({
          label: `pair ${oneBased(drive.p)}–${oneBased(drive.n)} (pair ${index + 1})`,
          kind: sameEndAsReceiver ? 'next' : 'fext',
          port: drive.p,
          ...modalColumn(net, vOut, drive, 'd', 'd'),
        });
      }
    });
    rx = vOut.p;
    return {
      mode: 'differential',
      txPort: vIn.p,
      rxPort: vOut.p,
      txPortN: vIn.n,
      rxPortN: vOut.n,
      thru: modalColumn(net, vOut, vIn, 'd', 'd'),
      reflection: modalColumn(net, vIn, vIn, 'd', 'd'),
      conversion: modalColumn(net, vOut, vIn, 'c', 'd'),
      conversionDc: modalColumn(net, vOut, vIn, 'd', 'c'),
      legP: column(net, vOut.p, vIn.p),
      legN: column(net, vOut.n, vIn.n),
      aggressors,
      notes,
    };
  }

  if (differential) {
    notes.push(
      `Transmit port ${oneBased(tx)} is not on a differential pair the file's wiring allows, so the single-ended view is shown.`,
    );
  }
  if (rx === tx) {
    const line = topology.lineOf[tx];
    const partner =
      line >= 0 ? (topology.isInput[tx] ? topology.lines[line].output : topology.lines[line].input) : -1;
    if (partner >= 0) {
      notes.push(
        `Transmit and receive were both port ${oneBased(tx)}; its thru partner, port ${oneBased(partner)}, is used as the receiver.`,
      );
      rx = partner;
    }
  }
  const txLine = topology.lineOf[tx];
  if (txLine < 0 || topology.lineOf[rx] !== txLine) {
    notes.push(
      `Ports ${oneBased(tx)} and ${oneBased(rx)} are not a through path in this file's wiring, so the "channel" shown is a coupled path.`,
    );
  }
  const rxIsInput = topology.isInput[rx] === 1;
  const aggressors: AggressorPath[] = [];
  for (let q = 0; q < n; q++) {
    if (q === tx || q === rx) continue;
    const qLine = topology.lineOf[q];
    const sameEnd = qLine >= 0 ? (topology.isInput[q] === 1) === rxIsInput : false;
    aggressors.push({
      label: `port ${oneBased(q)}`,
      kind: sameEnd ? 'next' : 'fext',
      port: q,
      ...column(net, rx, q),
    });
  }
  return {
    mode: 'single',
    txPort: tx,
    rxPort: rx,
    txPortN: -1,
    rxPortN: -1,
    thru: column(net, rx, tx),
    reflection: column(net, tx, tx),
    aggressors,
    notes,
  };
}
