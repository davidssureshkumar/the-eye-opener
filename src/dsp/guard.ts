/**
 * A tripwire for values that should never have left a DSP routine.
 *
 * A NaN in a Float64Array is silent. It propagates through every arithmetic
 * operation that touches it, survives every `if (x > 0)` unnoticed, and finally
 * arrives at a canvas, where `lineTo(NaN, NaN)` draws nothing at all. The symptom
 * a reader reports is "the trace stops halfway", and the cause is a divide by zero
 * four layers up in a function that ran twenty minutes of tests without complaint.
 *
 * So every job's output is swept before it is handed out. The sweep is a linear
 * scan, and it runs only where it is affordable:
 *
 *   - In development and under test it throws, naming the field and the first bad
 *     index, so the failure lands on the line that produced it.
 *   - In a production build it is compiled out. `import.meta.env.DEV` is a literal
 *     to the bundler, so the whole call disappears rather than being skipped at
 *     runtime, and a 100k-bit eye pays nothing for it.
 *
 * Infinity is treated as a defect too. There is no quantity in this course whose
 * correct value is infinite: an ideal brickwall filter has a finite response, a
 * BER floor is reported as a small number rather than as a divide by zero, and an
 * open-circuit termination is modelled with a large impedance rather than an
 * infinite one. Anything infinite here got there by accident.
 */

/** A numeric field of a job result that failed the sweep. */
export interface FiniteViolation {
  /** Dotted path to the offending field within the result. */
  path: string;
  /** Index of the first bad element, or -1 for a scalar. */
  index: number;
  /** The value found: NaN, Infinity or -Infinity. */
  value: number;
}

function isBad(x: number): boolean {
  return !Number.isFinite(x);
}

/**
 * Walk a value and report every non-finite number in it.
 *
 * Returns rather than throws, so a caller can decide what a violation means: the
 * job guard throws, a test may want to assert on the list, and a diagnostic panel
 * may want to display it.
 *
 * Only own enumerable properties, arrays and typed arrays are walked. Functions,
 * Maps and class instances are skipped: nothing a job returns is one of those, and
 * walking them would turn a cheap sweep into a reflection exercise.
 */
export function findNonFinite(value: unknown, path = '', out: FiniteViolation[] = []): FiniteViolation[] {
  if (typeof value === 'number') {
    if (isBad(value)) out.push({ path: path || '(value)', index: -1, value });
    return out;
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const a = value as unknown as { length: number; [i: number]: number };
    for (let i = 0; i < a.length; i++) {
      if (isBad(a[i])) {
        // First offender only. A NaN usually fills the rest of the buffer, and a
        // report of 65536 violations says nothing the first one did not.
        out.push({ path: path || '(array)', index: i, value: a[i] });
        break;
      }
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) findNonFinite(value[i], `${path}[${i}]`, out);
    return out;
  }

  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      findNonFinite(v, path ? `${path}.${k}` : k, out);
    }
  }

  return out;
}

/** One violation, rendered for a developer rather than for a reader. */
export function describeViolation(v: FiniteViolation): string {
  const what = Number.isNaN(v.value) ? 'NaN' : v.value > 0 ? 'Infinity' : '-Infinity';
  return v.index < 0 ? `${v.path} is ${what}` : `${v.path}[${v.index}] is ${what}`;
}

/**
 * Throw if `value` contains a non-finite number. A no-op outside development.
 *
 * `context` should name the thing that produced the value - a job kind, a function
 * name - because the path in the message locates the field, and the context
 * locates the code.
 */
export function assertFinite(value: unknown, context: string): void {
  if (!import.meta.env.DEV) return;
  const bad = findNonFinite(value);
  if (bad.length === 0) return;
  const listed = bad.slice(0, 4).map(describeViolation).join('; ');
  const more = bad.length > 4 ? ` (and ${bad.length - 4} more)` : '';
  throw new Error(`${context} produced a non-finite value: ${listed}${more}`);
}

/**
 * Throw if any element of `a` is non-finite. The hot-path form of `assertFinite`,
 * for a routine that wants to check one buffer without walking an object.
 */
export function assertFiniteArray(a: ArrayLike<number>, context: string): void {
  if (!import.meta.env.DEV) return;
  for (let i = 0; i < a.length; i++) {
    if (isBad(a[i])) {
      throw new Error(`${context} produced a non-finite value at index ${i}: ${a[i]}`);
    }
  }
}
