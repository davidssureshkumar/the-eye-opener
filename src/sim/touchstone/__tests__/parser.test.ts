/**
 * The Touchstone reader, checked on small hand-written files whose every number is
 * known, and against its own writer on a network with no symmetry to hide a
 * misplaced index.
 */

import { describe, expect, it } from 'vitest';
import { emptyNetwork, sAt } from '../network';
import { parseTouchstone, portsFromName, TouchstoneError, writeTouchstone } from '../parser';

describe('portsFromName', () => {
  it('reads the port count from the extension', () => {
    expect(portsFromName('chan.s4p')).toBe(4);
    expect(portsFromName('A.S12P')).toBe(12);
    expect(Number.isNaN(portsFromName('chan.txt'))).toBe(true);
  });
});

describe('parseTouchstone, version 1', () => {
  it('reads a two-port file in 11 21 12 22 order, in MHz and MA', () => {
    const text = [
      '! a comment',
      '# MHZ S MA R 50',
      '100 0.1 0 0.9 -90 0.8 -45 0.2 180',
      '200 0.1 0 0.9 -180 0.8 -90 0.2 180',
    ].join('\n');
    const { network, meta } = parseTouchstone(text, 'x.s2p');
    expect(network.ports).toBe(2);
    expect(Array.from(network.freq)).toEqual([1e8, 2e8]);
    expect(sAt(network, 0, 1, 0).re).toBeCloseTo(0, 12);
    expect(sAt(network, 0, 1, 0).im).toBeCloseTo(-0.9, 12);
    expect(sAt(network, 0, 0, 1).re).toBeCloseTo(0.8 * Math.SQRT1_2, 12);
    expect(sAt(network, 1, 1, 1).re).toBeCloseTo(-0.2, 12);
    expect(meta.comments).toEqual(['a comment']);
    expect(meta.version).toBe(1);
  });

  it('reads DB as twenty log ten of the magnitude and RI as it stands', () => {
    const db = parseTouchstone(
      '# GHZ S DB R 50\n1 -20 0 -6 90 -6 90 -20 0\n2 -20 0 -6 90 -6 90 -20 0\n',
      'x.s2p',
    );
    expect(sAt(db.network, 0, 1, 0).im).toBeCloseTo(Math.pow(10, -6 / 20), 12);
    const ri = parseTouchstone(
      '# HZ S RI R 50\n1 0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8\n2 0 0 0 0 0 0 0 0\n',
      'x.s2p',
    );
    expect(sAt(ri.network, 0, 1, 0)).toEqual({ re: 0.3, im: 0.4 });
    expect(sAt(ri.network, 0, 0, 1)).toEqual({ re: 0.5, im: 0.6 });
  });

  it('uses the Touchstone defaults when there is no option line, and says so', () => {
    const { network, meta } = parseTouchstone('1 0 0 1 0 1 0 0 0\n2 0 0 1 0 1 0 0 0\n', 'x.s2p');
    expect(network.freq[1]).toBe(2e9);
    expect(network.reference[0]).toBe(50);
    expect(meta.warnings.some((w) => /defaults/.test(w))).toBe(true);
  });

  it('reads a four-port file row first, with rows wrapped over lines', () => {
    const lines = ['# HZ S RI R 50'];
    for (let k = 0; k < 2; k++) {
      lines.push(`${k + 1}`);
      for (let i = 0; i < 4; i++) {
        // Entry (i, j) holds i + j/10 and k in the imaginary part; split each row in two lines.
        const row = [0, 1, 2, 3].map((j) => `${i + j / 10} ${k}`);
        lines.push(row.slice(0, 2).join(' '), row.slice(2).join(' '));
      }
    }
    const { network } = parseTouchstone(lines.join('\n'), 'x.s4p');
    expect(sAt(network, 1, 2, 3)).toEqual({ re: 2.3, im: 1 });
    expect(sAt(network, 0, 3, 0)).toEqual({ re: 3, im: 0 });
  });

  it('skips a two-port noise block and reports it', () => {
    const text =
      '# GHZ S MA R 50\n1 0 0 1 0 1 0 0 0\n2 0 0 1 0 1 0 0 0\n1 2.0 0.5 30 0.3\n2 2.1 0.5 40 0.3\n';
    const { network, meta } = parseTouchstone(text, 'amp.s2p');
    expect(network.freq.length).toBe(2);
    expect(meta.warnings.some((w) => /Noise/.test(w))).toBe(true);
  });

  it('refuses other parameter types, missing port counts and ragged data, with the line', () => {
    expect(() => parseTouchstone('# GHZ Y MA R 50\n', 'x.s2p')).toThrow(/Y-parameters/);
    expect(() => parseTouchstone('# GHZ S MA R 50\n1 0 0 1 0 1 0 0 0\n', 'x.txt')).toThrow(/extension/);
    const ragged = '# GHZ S MA R 50\n1 0 0 1 0 1 0 0 0\n2 0 0 1 0 1 0\n';
    expect(() => parseTouchstone(ragged, 'x.s2p')).toThrow(TouchstoneError);
    expect(() => parseTouchstone(ragged, 'x.s2p')).toThrow(/Line 3/);
    expect(() => parseTouchstone('# GHZ S MA R 50\n1 0 0\n', 'x.s1p')).toThrow(/fewer than two/);
    expect(() => parseTouchstone('# GHZ S MA R 50\n1 x\n', 'x.s1p')).toThrow(/not a number/);
    expect(() => parseTouchstone('# GHZ S MA R 50\n2 0 0\n1 0 0\n', 'x.s1p')).toThrow(/increase/);
  });
});

describe('parseTouchstone, version 2', () => {
  const header = (extra: string[]) =>
    ['[Version] 2.0', '# GHz S RI R 50', ...extra, '[Network Data]'].join('\n') + '\n';

  it('honours the two-port data order keyword', () => {
    const order12 = header([
      '[Number of Ports] 2',
      '[Two-Port Data Order] 12_21',
      '[Number of Frequencies] 2',
    ]);
    const a = parseTouchstone(order12 + '1 1 0 2 0 3 0 4 0\n2 1 0 2 0 3 0 4 0\n[End]\n', 'x.ts');
    expect(sAt(a.network, 0, 0, 1).re).toBe(2);
    expect(sAt(a.network, 0, 1, 0).re).toBe(3);
    const order21 = order12.replace('12_21', '21_12');
    const b = parseTouchstone(order21 + '1 1 0 2 0 3 0 4 0\n2 1 0 2 0 3 0 4 0\n', 'x.ts');
    expect(sAt(b.network, 0, 1, 0).re).toBe(2);
    expect(() => parseTouchstone(order12.replace('[Two-Port Data Order] 12_21\n', ''), 'x.ts')).toThrow(
      /Two-Port Data Order/,
    );
  });

  it('fills a lower or upper triangular matrix symmetrically', () => {
    const lower = header(['[Number of Ports] 3', '[Matrix Format] Lower', '[Number of Frequencies] 2']);
    // Lower triangle, row first: (0,0) (1,0) (1,1) (2,0) (2,1) (2,2).
    const row = '1 0 2 0 3 0 4 0 5 0 6 0';
    const { network } = parseTouchstone(`${lower}1 ${row}\n2 ${row}\n`, 'x.ts');
    expect(sAt(network, 0, 0, 2).re).toBe(4);
    expect(sAt(network, 0, 2, 0).re).toBe(4);
    expect(sAt(network, 1, 1, 2).re).toBe(5);
    const upper = lower.replace('Lower', 'Upper');
    // Upper triangle, row first: (0,0) (0,1) (0,2) (1,1) (1,2) (2,2).
    const up = parseTouchstone(`${upper}1 ${row}\n2 ${row}\n`, 'x.ts');
    expect(sAt(up.network, 0, 2, 0).re).toBe(3);
    expect(sAt(up.network, 0, 2, 1).re).toBe(5);
  });

  it('reads per-port references over several lines and skips information blocks', () => {
    const text = [
      '[Version] 2.0',
      '# GHz S RI R 50',
      '[Number of Ports] 2',
      '[Two-Port Data Order] 21_12',
      '[Reference] 50',
      '75',
      '[Begin Information]',
      '[Mystery] 3',
      '[End Information]',
      '[Network Data]',
      '1 0 0 1 0 1 0 0 0',
      '2 0 0 1 0 1 0 0 0',
      '[Noise Data]',
      '1 2 0.5 30 0.3',
    ].join('\n');
    const { network, meta } = parseTouchstone(text, 'x.ts');
    expect(Array.from(network.reference)).toEqual([50, 75]);
    expect(meta.warnings.some((w) => /Noise/.test(w))).toBe(true);
    expect(meta.warnings.some((w) => /Mystery/.test(w))).toBe(false);
  });

  it('checks the declared frequency count and refuses mixed-mode files', () => {
    const bad = header(['[Number of Ports] 1', '[Number of Frequencies] 3']);
    expect(() => parseTouchstone(`${bad}1 0 0\n2 0 0\n`, 'x.ts')).toThrow(/says 3/);
    const mm = header(['[Number of Ports] 4', '[Mixed-Mode Order] D2,1 C2,1 D4,3 C4,3']);
    expect(() => parseTouchstone(mm, 'x.ts')).toThrow(/Mixed-mode/);
    expect(() => parseTouchstone('[Version] 2.0\n# GHz S RI R 50\n1 0 0\n', 'x.ts')).toThrow(
      /Number of Ports|Network Data/,
    );
  });
});

describe('writeTouchstone', () => {
  for (const ports of [1, 2, 3, 4]) {
    for (const format of ['RI', 'MA', 'DB'] as const) {
      it(`round-trips a ${ports}-port network in ${format}`, () => {
        const net = emptyNetwork(ports, Float64Array.from([1e6, 2.5e9, 7e9]), 50);
        for (let i = 0; i < net.re.length; i++) {
          net.re[i] = 0.01 + Math.sin(i * 1.7) * 0.4;
          net.im[i] = Math.cos(i * 0.9) * 0.3;
        }
        const back = parseTouchstone(writeTouchstone(net, format, ['synthetic']), `n.s${ports}p`).network;
        for (let i = 0; i < net.re.length; i++) {
          expect(back.re[i]).toBeCloseTo(net.re[i], 12);
          expect(back.im[i]).toBeCloseTo(net.im[i], 12);
        }
        expect(Array.from(back.freq)).toEqual(Array.from(net.freq));
      });
    }
  }

  it('refuses mixed references, which version 1 cannot express', () => {
    const net = emptyNetwork(2, Float64Array.from([1, 2]), 50);
    net.reference[1] = 75;
    expect(() => writeTouchstone(net)).toThrow(/reference/);
  });
});
