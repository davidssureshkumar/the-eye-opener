/**
 * The NaN tripwire.
 *
 * The point of these tests is that the guard finds the value in the place it will
 * actually occur - buried three levels into a result object, or at index 40000 of a
 * Float64Array - and that it says where, because a guard that reports "something
 * was NaN" has only moved the debugging problem rather than solved it.
 */

import { describe, expect, it } from 'vitest';
import { assertFinite, assertFiniteArray, describeViolation, findNonFinite } from '../guard';
import { runJob } from '../jobs';
import { defaultScenario } from '../../state/scenario';

describe('findNonFinite', () => {
  it('accepts a clean result', () => {
    expect(findNonFinite({ a: 1, b: new Float64Array([1, 2, 3]), c: [4, 5] })).toEqual([]);
  });

  it('finds a bare NaN', () => {
    expect(findNonFinite(NaN)).toEqual([{ path: '(value)', index: -1, value: NaN }]);
  });

  it('finds both infinities, which are defects here too', () => {
    // Nothing in this course has a correct value of infinity. An open termination
    // is a large impedance, a BER floor is a small number. Infinity means a divide.
    expect(findNonFinite({ z: Infinity })).toEqual([{ path: 'z', index: -1, value: Infinity }]);
    expect(findNonFinite({ z: -Infinity })[0].value).toBe(-Infinity);
  });

  it('names the dotted path of a nested field', () => {
    const found = findNonFinite({ eye: { height: NaN, width: 0.4 } });
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe('eye.height');
  });

  it('indexes into arrays of objects', () => {
    const found = findNonFinite({ taps: [{ gain: 1 }, { gain: NaN }] });
    expect(found[0].path).toBe('taps[1].gain');
  });

  it('finds a NaN deep inside a large typed array', () => {
    const a = new Float64Array(65536);
    a[40000] = NaN;
    const found = findNonFinite({ y: a });
    expect(found).toEqual([{ path: 'y', index: 40000, value: NaN }]);
  });

  it('reports the first bad element only, not sixty thousand of them', () => {
    // A NaN normally poisons everything after it. Listing each one buries the
    // single piece of information that matters: where it started.
    const a = new Float64Array(1024).fill(NaN);
    expect(findNonFinite({ y: a })).toHaveLength(1);
  });

  it('walks several fields and reports each', () => {
    const found = findNonFinite({ a: NaN, b: new Float64Array([1, Infinity]), c: 3 });
    expect(found.map((v) => v.path).sort()).toEqual(['a', 'b']);
  });

  it('leaves strings, booleans and nulls alone', () => {
    expect(findNonFinite({ window: 'hann', ok: true, none: null, missing: undefined })).toEqual([]);
  });

  it('handles the empty cases without inventing a violation', () => {
    expect(findNonFinite({})).toEqual([]);
    expect(findNonFinite([])).toEqual([]);
    expect(findNonFinite(new Float64Array(0))).toEqual([]);
  });

  it('does not choke on an integer typed array', () => {
    expect(findNonFinite({ bits: new Uint8Array([0, 1, 1, 0]) })).toEqual([]);
  });
});

describe('describeViolation', () => {
  it('distinguishes the three ways a number can be wrong', () => {
    expect(describeViolation({ path: 'y', index: -1, value: NaN })).toBe('y is NaN');
    expect(describeViolation({ path: 'y', index: 7, value: Infinity })).toBe('y[7] is Infinity');
    expect(describeViolation({ path: 'y', index: 7, value: -Infinity })).toBe('y[7] is -Infinity');
  });
});

describe('assertFinite', () => {
  it('says nothing about a clean value', () => {
    expect(() => assertFinite({ y: new Float64Array([1, 2, 3]) }, 'test')).not.toThrow();
  });

  it('names the context and the field, so the message locates the bug', () => {
    expect(() => assertFinite({ eye: { height: NaN } }, "job 'eye'")).toThrow(
      /job 'eye'.*eye\.height is NaN/,
    );
  });

  it('truncates a long list rather than printing a wall of text', () => {
    const bad = { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN };
    expect(() => assertFinite(bad, 'test')).toThrow(/and 2 more/);
  });
});

describe('assertFiniteArray', () => {
  it('passes a clean buffer and names the index of a bad one', () => {
    expect(() => assertFiniteArray(new Float64Array([0, 1, 2]), 'filter')).not.toThrow();
    expect(() => assertFiniteArray(new Float64Array([0, NaN]), 'filter')).toThrow(/index 1/);
  });
});

describe('the guard is wired into every job', () => {
  it('lets the real jobs through, which is the regression this exists to catch', () => {
    // `runJob` calls assertFinite on its result. If a job ever starts emitting a
    // NaN - a divide by a zero-length record, a log of zero - this fails here
    // rather than drawing a trace that stops halfway.
    const scenario = defaultScenario();
    expect(() => runJob('fourier', scenario, { samples: 256 })).not.toThrow();
    expect(() => runJob('pattern', scenario, { bits: 256 })).not.toThrow();
    expect(() => runJob('waveform', scenario, { uis: 8 })).not.toThrow();
    expect(() => runJob('spectrum', scenario, { uis: 32 })).not.toThrow();
    expect(() => runJob('edge', scenario, { samples: 512 })).not.toThrow();
  });
});
