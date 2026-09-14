/**
 * Touchstone files, read and written entirely in the browser.
 *
 * Two versions are in use. Version 1 has no keywords: an option line, then numbers,
 * with the port count taken from the extension, .s2p, .s4p. Version 2 announces
 * itself with [Version] and states the port count, the frequency count, per-port
 * reference impedances and, optionally, only half of a symmetric matrix. Both are
 * read here, with the rules that trip people up handled explicitly:
 *
 *   - A two-port file lists S11 S21 S12 S22 in version 1, and whatever
 *     [Two-Port Data Order] says in version 2. Every other port count is row first.
 *   - A version 1 file with more than two ports wraps each row over several lines,
 *     and nothing but the count of numbers says where a frequency ends. The reader
 *     therefore works on the stream of numbers, not on lines.
 *   - A version 1 two-port file may end with noise parameters, which begin where the
 *     frequency stops increasing. They are skipped and the skip is reported.
 *   - DB is 20 log10 of the magnitude, and every angle is in degrees.
 *
 * Only S-parameters are accepted. Y, Z, H and G files are refused with a message
 * rather than converted, because their normalisation differs between versions and a
 * silently wrong conversion is worse than none. Mixed-mode version 2.1 files are
 * refused the same way: the conversion from single-ended data is done here, in one
 * place, and is shown on screen.
 *
 * The file never leaves the page. It is read with the File API and held in memory.
 */

import { emptyNetwork, sIndex, type Network } from './network';

export type TouchstoneFormat = 'RI' | 'MA' | 'DB';

export interface TouchstoneMeta {
  /** 1 for keyword-free files, 2 for [Version] 2.x. */
  version: 1 | 2;
  format: TouchstoneFormat;
  /** Frequency unit as written in the option line. */
  unit: string;
  /** Comment lines, without the leading '!', in file order. At most 64 are kept. */
  comments: string[];
  /** Things the reader should know that did not stop the file loading. */
  warnings: string[];
}

export interface TouchstoneFile {
  network: Network;
  meta: TouchstoneMeta;
}

/** A file that cannot be read, with the line where reading stopped when there is one. */
export class TouchstoneError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line === undefined ? message : `Line ${line}: ${message}`);
    this.name = 'TouchstoneError';
  }
}

const UNITS: Record<string, number> = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 };

/** Port count from a version 1 extension: `.s4p` gives 4. NaN when there is none. */
export function portsFromName(name: string): number {
  const m = /\.s(\d+)p$/i.exec(name.trim());
  return m ? Number(m[1]) : NaN;
}

interface NumberToken {
  value: number;
  line: number;
}

/**
 * Parse Touchstone text.
 *
 * @param text The whole file.
 * @param name The file name, for the version 1 port count.
 */
export function parseTouchstone(text: string, name: string): TouchstoneFile {
  const lines = text.split(/\r\n|\r|\n/);
  const comments: string[] = [];
  const warnings: string[] = [];

  let version: 1 | 2 = 1;
  let unit = 'GHZ';
  let format: TouchstoneFormat = 'MA';
  let optionR = 50;
  let optionSeen = false;
  let ports = NaN;
  let twoPortOrder: '12_21' | '21_12' | null = null;
  let declaredFrequencies = NaN;
  let matrixFormat: 'FULL' | 'LOWER' | 'UPPER' = 'FULL';
  let reference: number[] | null = null;
  let collectingReference = false;
  let inInformation = false;
  let networkStarted = false;
  let stopped = false;
  const numbers: NumberToken[] = [];

  for (let li = 0; li < lines.length && !stopped; li++) {
    const lineNo = li + 1;
    let raw = lines[li];
    const bang = raw.indexOf('!');
    if (bang >= 0) {
      if (comments.length < 64) comments.push(raw.slice(bang + 1).trim());
      raw = raw.slice(0, bang);
    }
    let body = raw.trim();
    if (body === '') continue;

    if (body.startsWith('[')) {
      const close = body.indexOf(']');
      if (close < 0) throw new TouchstoneError('Unclosed keyword bracket.', lineNo);
      const keyword = body.slice(1, close).trim().toUpperCase().replace(/\s+/g, ' ');
      const rest = body.slice(close + 1).trim();
      collectingReference = false;
      if (inInformation && keyword !== 'END INFORMATION') continue;
      switch (keyword) {
        case 'VERSION': {
          const v = Number(rest);
          if (!(v >= 2 && v < 3)) throw new TouchstoneError(`Unsupported [Version] ${rest}.`, lineNo);
          version = 2;
          break;
        }
        case 'NUMBER OF PORTS':
          ports = Number(rest);
          if (!Number.isInteger(ports) || ports < 1) {
            throw new TouchstoneError(`[Number of Ports] must be a positive integer, not "${rest}".`, lineNo);
          }
          break;
        case 'TWO-PORT DATA ORDER': {
          const order = rest.toUpperCase();
          if (order !== '12_21' && order !== '21_12') {
            throw new TouchstoneError(`[Two-Port Data Order] must be 12_21 or 21_12, not "${rest}".`, lineNo);
          }
          twoPortOrder = order;
          break;
        }
        case 'NUMBER OF FREQUENCIES':
          declaredFrequencies = Number(rest);
          break;
        case 'NUMBER OF NOISE FREQUENCIES':
          break;
        case 'REFERENCE':
          reference = [];
          collectingReference = true;
          body = rest;
          break;
        case 'MATRIX FORMAT': {
          const mf = rest.toUpperCase();
          if (mf !== 'FULL' && mf !== 'LOWER' && mf !== 'UPPER') {
            throw new TouchstoneError(`[Matrix Format] must be Full, Lower or Upper, not "${rest}".`, lineNo);
          }
          matrixFormat = mf;
          break;
        }
        case 'MIXED-MODE ORDER':
          throw new TouchstoneError(
            'Mixed-mode files are not read here. Load the single-ended file; the page converts it.',
            lineNo,
          );
        case 'BEGIN INFORMATION':
          inInformation = true;
          break;
        case 'END INFORMATION':
          inInformation = false;
          break;
        case 'NETWORK DATA':
          networkStarted = true;
          break;
        case 'NOISE DATA':
          warnings.push('Noise parameters in the file were skipped.');
          stopped = true;
          break;
        case 'END':
          stopped = true;
          break;
        default:
          warnings.push(`Keyword [${keyword}] was not recognised and was skipped.`);
      }
      if (!collectingReference || body === '') continue;
    }
    if (inInformation) continue;

    if (body.startsWith('#')) {
      if (optionSeen) continue; // Only the first option line counts.
      optionSeen = true;
      const tokens = body.slice(1).trim().split(/\s+/).filter(Boolean);
      for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t].toUpperCase();
        if (tok in UNITS) unit = tok;
        else if (tok === 'S') continue;
        else if (tok === 'Y' || tok === 'Z' || tok === 'H' || tok === 'G') {
          throw new TouchstoneError(
            `This file holds ${tok}-parameters. Only S-parameter files are read; export S-parameters from the tool that wrote it.`,
            lineNo,
          );
        } else if (tok === 'RI' || tok === 'MA' || tok === 'DB') format = tok;
        else if (tok === 'R') {
          const r = Number(tokens[t + 1]);
          if (!(r > 0)) throw new TouchstoneError('The option line R must be a positive resistance.', lineNo);
          optionR = r;
          t++;
        } else throw new TouchstoneError(`Unrecognised option "${tokens[t]}".`, lineNo);
      }
      continue;
    }

    const parts = body.split(/\s+/).filter(Boolean);
    if (collectingReference && reference) {
      for (const p of parts) {
        const v = Number(p);
        if (!(v > 0))
          throw new TouchstoneError(`[Reference] impedance "${p}" is not a positive number.`, lineNo);
        reference.push(v);
      }
      if (Number.isFinite(ports) && reference.length >= ports) collectingReference = false;
      continue;
    }
    if (version === 2 && !networkStarted) {
      throw new TouchstoneError('Data before [Network Data].', lineNo);
    }
    for (const p of parts) {
      const v = Number(p);
      if (!Number.isFinite(v)) throw new TouchstoneError(`"${p}" is not a number.`, lineNo);
      numbers.push({ value: v, line: lineNo });
    }
  }

  if (version === 1) {
    ports = portsFromName(name);
    if (!Number.isFinite(ports)) {
      throw new TouchstoneError(
        'A file without [Version] 2.0 takes its port count from the extension, and this name has none (.s2p, .s4p).',
      );
    }
  } else if (!Number.isFinite(ports)) {
    throw new TouchstoneError('A version 2 file must state [Number of Ports].');
  }
  if (ports > 12) throw new TouchstoneError(`${ports} ports is more than the 12 this site reads.`);
  if (version === 2 && ports === 2 && twoPortOrder === null) {
    throw new TouchstoneError('A version 2 two-port file must state [Two-Port Data Order].');
  }
  if (!optionSeen) warnings.push('No option line; read as GHz, S, MA, R 50, the Touchstone defaults.');

  const n = ports;
  // Which (i, j) each pair of numbers fills, in file order.
  const cells: [number, number][] = [];
  if (n === 2 && (version === 1 || twoPortOrder === '21_12')) {
    cells.push([0, 0], [1, 0], [0, 1], [1, 1]);
  } else {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (matrixFormat === 'LOWER' && j > i) continue;
        if (matrixFormat === 'UPPER' && j < i) continue;
        cells.push([i, j]);
      }
    }
  }
  const perFrequency = 1 + 2 * cells.length;

  const freqs: number[] = [];
  const values: number[] = [];
  const scale = UNITS[unit];
  let at = 0;
  let noiseSkipped = false;
  for (; at < numbers.length; at += perFrequency) {
    const f = numbers[at].value * scale;
    if (freqs.length > 0 && f <= freqs[freqs.length - 1]) {
      // A version 1 two-port noise block restarts the frequency, and its rows are
      // five numbers long, so it is recognised before the row length is checked.
      if (version === 1 && n === 2) {
        warnings.push('Noise parameters at the end of the file were skipped.');
        noiseSkipped = true;
        break;
      }
      throw new TouchstoneError('Frequencies must strictly increase.', numbers[at].line);
    }
    if (at + perFrequency > numbers.length) break;
    if (!(f >= 0)) throw new TouchstoneError('Frequencies must not be negative.', numbers[at].line);
    freqs.push(f);
    for (let c = 1; c < perFrequency; c++) values.push(numbers[at + c].value);
  }
  const leftover = numbers.length - at;
  if (leftover > 0 && !noiseSkipped) {
    throw new TouchstoneError(
      `The data ends part-way through a frequency: ${leftover} numbers left over, where each frequency takes ${perFrequency}.`,
      numbers[at].line,
    );
  }
  if (freqs.length < 2) throw new TouchstoneError('The file has fewer than two frequencies.');
  if (Number.isFinite(declaredFrequencies) && declaredFrequencies !== freqs.length) {
    throw new TouchstoneError(
      `[Number of Frequencies] says ${declaredFrequencies}, but the data has ${freqs.length}.`,
    );
  }

  const network = emptyNetwork(n, Float64Array.from(freqs), optionR);
  if (reference) {
    if (reference.length !== n) {
      throw new TouchstoneError(`[Reference] lists ${reference.length} impedances for ${n} ports.`);
    }
    network.reference.set(reference);
  }
  const degrees = Math.PI / 180;
  for (let k = 0; k < freqs.length; k++) {
    for (let c = 0; c < cells.length; c++) {
      const a = values[k * 2 * cells.length + 2 * c];
      const b = values[k * 2 * cells.length + 2 * c + 1];
      let re: number;
      let im: number;
      if (format === 'RI') {
        re = a;
        im = b;
      } else {
        const mag = format === 'DB' ? Math.pow(10, a / 20) : a;
        re = mag * Math.cos(b * degrees);
        im = mag * Math.sin(b * degrees);
      }
      const [i, j] = cells[c];
      const o = sIndex(network, k, i, j);
      network.re[o] = re;
      network.im[o] = im;
      if (matrixFormat !== 'FULL' && i !== j) {
        const m = sIndex(network, k, j, i);
        network.re[m] = re;
        network.im[m] = im;
      }
    }
  }

  const unique = new Set(network.reference);
  if (unique.size > 1)
    warnings.push('The ports have different reference impedances; they are renormalised before use.');

  return { network, meta: { version, format, unit, comments, warnings } };
}

/**
 * Write a network as a version 1 file, frequencies in Hz.
 *
 * Every port must share one reference impedance, because version 1 has only the
 * option line's R. Used to save a synthesised example so it can be loaded back like
 * a measured one, and to test the reader against the writer.
 */
export function writeTouchstone(
  net: Network,
  format: TouchstoneFormat = 'RI',
  header: string[] = [],
): string {
  const r = net.reference[0];
  if (!net.reference.every((z) => z === r)) {
    throw new Error('writeTouchstone: version 1 needs one reference impedance for every port');
  }
  const n = net.ports;
  const out: string[] = header.map((h) => `! ${h}`);
  out.push(`# HZ S ${format} R ${r}`);
  const cells: [number, number][] = [];
  if (n === 2) cells.push([0, 0], [1, 0], [0, 1], [1, 1]);
  else for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cells.push([i, j]);
  const perLine = n === 2 ? 4 : Math.min(4, n);

  const pair = (i: number, j: number, k: number): string => {
    const o = sIndex(net, k, i, j);
    const re = net.re[o];
    const im = net.im[o];
    if (format === 'RI') return `${re.toPrecision(17)} ${im.toPrecision(17)}`;
    const mag = Math.hypot(re, im);
    const ang = (Math.atan2(im, re) * 180) / Math.PI;
    const m = format === 'DB' ? 20 * Math.log10(mag) : mag;
    return `${m.toPrecision(17)} ${ang.toPrecision(17)}`;
  };

  for (let k = 0; k < net.freq.length; k++) {
    let line = `${net.freq[k].toPrecision(17)}`;
    let count = 0;
    for (let c = 0; c < cells.length; c++) {
      const [i, j] = cells[c];
      // Version 1 files of three or more ports start each matrix row on a new line
      // and wrap after four pairs.
      if (n > 2 && c > 0 && (j === 0 || count === perLine)) {
        out.push(line);
        line = ' ';
        count = 0;
      }
      line += ` ${pair(i, j, k)}`;
      count++;
    }
    out.push(line);
  }
  return out.join('\n') + '\n';
}
