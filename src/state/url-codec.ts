/**
 * Scenario <-> URL codec.
 *
 * A permalink has to reproduce someone else's screen exactly, so this round trip
 * must be lossless for every field of a Scenario. Three design choices follow from
 * that, plus one from the audience:
 *
 *  1. Encode only what differs from the defaults. A link to a page where the reader
 *     moved one slider carries one key, not two hundred.
 *  2. Encode dotted paths in full ('source.riseTime'), not short aliases. An alias
 *     table is shorter but it is a second schema to keep in step, and a stale alias
 *     silently decodes to the wrong field. Full paths also mean a reader can edit
 *     the URL by hand, which for a teaching site is a feature, not an accident.
 *  3. Type the decode from the defaults rather than from the text. '1' is a number
 *     if the default at that path is a number and a string if it is a string, so
 *     there is no guessing and no JSON quoting noise.
 *  4. Unknown paths are dropped with a warning rather than throwing. A link made by
 *     a future version of the site should still open, minus whatever it is that
 *     this version does not have.
 *
 * Format:   v1~path:value~path:value~...
 * Example:  v1~source.riseTime:1.2e-11~impairments.randomJitterRms:8e-13
 *
 * Separators are '~' between pairs and ':' between key and value. Both are legal
 * unescaped in a URL fragment; string values escape them via percent-encoding.
 * Number arrays are comma-separated in place ('eq.ffeTaps:-0.1,1,-0.2'). Arrays of
 * objects carry an explicit '.n' length key followed by indexed paths.
 */

import {
  aggressorSchema,
  cloneScenario,
  defaultScenario,
  parseScenario,
  SCENARIO_VERSION,
  type Scenario,
} from './scenario';

/** Prefix identifying the encoding. Bumped only if the *format* changes. */
const CODEC_TAG = `v${SCENARIO_VERSION}`;

const PAIR_SEP = '~';
const KV_SEP = ':';

/**
 * Arrays whose elements are objects. Each needs a factory for a default element so
 * the encoder can diff element by element instead of dumping every field of every
 * element into the link.
 */
const OBJECT_ARRAYS: Record<string, () => unknown> = {
  'crosstalk.aggressors': () => aggressorSchema.parse({}),
};

type Leaf = number | string | boolean | number[];

/* ------------------------------------------------------------------ flatten */

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((e) => typeof e === 'number');
}

function flatten(value: unknown, path: string, out: Map<string, Leaf>): void {
  if (Array.isArray(value)) {
    if (isNumberArray(value)) {
      out.set(path, value);
      return;
    }
    out.set(`${path}.n`, value.length);
    value.forEach((el, i) => flatten(el, `${path}.${i}`, out));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(v, path === '' ? k : `${path}.${k}`, out);
    }
    return;
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    out.set(path, value);
  }
}

/**
 * The object a Scenario is diffed against: the defaults, but with every
 * object-array padded to the length this Scenario actually has, using element
 * defaults. Without the padding, adding one aggressor would force every field of
 * that aggressor into the URL even where it sits at its default.
 */
function referenceFor(s: Scenario): Scenario {
  const ref = defaultScenario();
  for (const [path, makeElement] of Object.entries(OBJECT_ARRAYS)) {
    const actual = getPath(s, path);
    const target = getPath(ref, path);
    if (!Array.isArray(actual) || !Array.isArray(target)) continue;
    while (target.length < actual.length) target.push(makeElement());
    target.length = actual.length;
  }
  return ref;
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (next === null || typeof next !== 'object') return;
    cur = next as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/* ----------------------------------------------------------- number format */

/**
 * Shortest round-trippable text for a number.
 *
 * Picosecond and gigahertz values dominate a Scenario, so plain decimal is often
 * far longer than exponential ('0.000000000025' against '2.5e-11'). Whichever is
 * shorter wins; both parse back to the identical double, which is the only
 * property that matters.
 */
export function numToStr(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : Number.isNaN(x) ? 'nan' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  const plain = String(x);
  const exp = x.toExponential().replace('e+', 'e');
  const best = exp.length < plain.length ? exp : plain;
  return Number(best) === x ? best : plain;
}

function strToNum(s: string): number {
  if (s === 'inf') return Infinity;
  if (s === '-inf') return -Infinity;
  if (s === 'nan') return NaN;
  const x = Number(s);
  return Number.isNaN(x) && s.trim() !== '' ? NaN : x;
}

function escapeString(s: string): string {
  // encodeURIComponent leaves '~' alone, and '~' is our pair separator.
  return encodeURIComponent(s).replace(/~/g, '%7E');
}

function unescapeString(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function leafToStr(v: Leaf): string {
  if (typeof v === 'number') return numToStr(v);
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  if (Array.isArray(v)) return v.map(numToStr).join(',');
  return escapeString(v);
}

/** Decode text against the type of the corresponding default value. */
function strToLeaf(text: string, template: Leaf): Leaf | undefined {
  if (typeof template === 'number') {
    const x = strToNum(text);
    return Number.isNaN(x) && text !== 'nan' ? undefined : x;
  }
  if (typeof template === 'boolean') {
    if (text === 'T' || text === '1' || text === 'true') return true;
    if (text === 'F' || text === '0' || text === 'false') return false;
    return undefined;
  }
  if (Array.isArray(template)) {
    if (text === '') return [];
    const parts = text.split(',');
    const out: number[] = [];
    for (const p of parts) {
      const x = strToNum(p);
      if (Number.isNaN(x) && p !== 'nan') return undefined;
      out.push(x);
    }
    return out;
  }
  return unescapeString(text);
}

function leafEquals(a: Leaf, b: Leaf): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  return Object.is(a, b);
}

/* ------------------------------------------------------------------ encode */

/**
 * Encode a Scenario as a compact permalink payload. Only fields that differ from
 * the defaults appear, and keys are sorted so the same Scenario always produces the
 * same string - which is what makes a permalink comparable and cacheable.
 */
export function encodeScenario(s: Scenario): string {
  const actual = new Map<string, Leaf>();
  const reference = new Map<string, Leaf>();
  flatten(s, '', actual);
  flatten(referenceFor(s), '', reference);

  // referenceFor() pads object arrays to the actual length so element fields can be
  // diffed against element defaults. That padding would also make the length key
  // agree with itself and never be emitted, so restore the true default length here.
  for (const path of Object.keys(OBJECT_ARRAYS)) {
    const defaultLength = getPath(defaultScenario(), path);
    if (Array.isArray(defaultLength)) reference.set(`${path}.n`, defaultLength.length);
  }

  const parts: string[] = [CODEC_TAG];
  for (const key of Array.from(actual.keys()).sort()) {
    if (key === 'version') continue;
    const v = actual.get(key) as Leaf;
    const ref = reference.get(key);
    if (ref !== undefined && leafEquals(v, ref)) continue;
    parts.push(`${key}${KV_SEP}${leafToStr(v)}`);
  }
  return parts.join(PAIR_SEP);
}

/* ------------------------------------------------------------------ decode */

export interface DecodeResult {
  scenario: Scenario;
  /** Paths that could not be applied. Surfaced in the UI rather than swallowed. */
  warnings: string[];
}

/**
 * Decode a permalink payload. Always returns a valid Scenario: anything the payload
 * does not mention keeps its default, and anything unrecognised is reported as a
 * warning instead of failing the whole link.
 */
export function decodeScenario(text: string | null | undefined): DecodeResult {
  const warnings: string[] = [];
  const draft = defaultScenario() as unknown as Record<string, unknown>;
  if (!text) return { scenario: defaultScenario(), warnings };

  const tokens = text.split(PAIR_SEP).filter((t) => t.length > 0);
  if (tokens.length === 0) return { scenario: defaultScenario(), warnings };

  let i = 0;
  if (/^v\d+$/.test(tokens[0])) {
    const v = Number(tokens[0].slice(1));
    if (v !== SCENARIO_VERSION) {
      warnings.push(
        `Link was written by scenario format v${v}; this build reads v${SCENARIO_VERSION}. ` +
          'Unknown settings were ignored.',
      );
    }
    i = 1;
  } else {
    warnings.push('Link has no format tag; decoding it as the current format.');
  }

  // Object-array lengths come first so the indexed element paths have somewhere
  // to land, whatever order the rest of the keys arrive in.
  const pairs: Array<[string, string]> = [];
  for (; i < tokens.length; i++) {
    const at = tokens[i].indexOf(KV_SEP);
    if (at < 0) {
      warnings.push(`Ignored malformed entry "${tokens[i]}".`);
      continue;
    }
    pairs.push([tokens[i].slice(0, at), tokens[i].slice(at + 1)]);
  }

  for (const [key, value] of pairs) {
    if (!key.endsWith('.n')) continue;
    const arrayPath = key.slice(0, -2);
    const make = OBJECT_ARRAYS[arrayPath];
    if (!make) continue;
    const target = getPath(draft, arrayPath);
    if (!Array.isArray(target)) continue;
    const want = Math.max(0, Math.min(64, Math.trunc(strToNum(value))));
    if (!Number.isFinite(want)) {
      warnings.push(`Ignored bad array length "${key}".`);
      continue;
    }
    while (target.length < want) target.push(make());
    target.length = want;
  }

  for (const [key, value] of pairs) {
    if (key.endsWith('.n') && OBJECT_ARRAYS[key.slice(0, -2)]) continue;
    const template = getPath(draft, key);
    if (
      template === undefined ||
      (typeof template !== 'number' &&
        typeof template !== 'string' &&
        typeof template !== 'boolean' &&
        !isNumberArray(template))
    ) {
      warnings.push(`Ignored unknown setting "${key}".`);
      continue;
    }
    const parsed = strToLeaf(value, template as Leaf);
    if (parsed === undefined) {
      warnings.push(`Ignored unreadable value for "${key}".`);
      continue;
    }
    setPath(draft, key, parsed);
  }

  // Final gate: zod clamps and rejects anything out of range, so a hand-edited URL
  // cannot drive the DSP with a negative bandwidth or a million-bit simulation.
  try {
    return { scenario: parseScenario(draft), warnings };
  } catch (err) {
    warnings.push(
      `Some values were out of range and the defaults were used instead: ${
        err instanceof Error ? err.message.split('\n')[0] : 'validation failed'
      }`,
    );
    return { scenario: defaultScenario(), warnings };
  }
}

/* -------------------------------------------------------------- hash routing */

export interface RouteState {
  /** Module id, e.g. 'm1'. Empty string is the home page. */
  module: string;
  /** Section anchor within the module, or empty. */
  section: string;
  /** Encoded scenario payload, or empty for the module's own preset. */
  payload: string;
}

/**
 * Hash form:  #/m5/eye?s=v1~source.riseTime:1.2e-11
 *
 * The scenario rides in a query string inside the hash rather than in the real
 * query string, so the whole URL stays a single static-host request with no server
 * rewrite rules and no 404 on refresh.
 */
export function parseHash(hash: string): RouteState {
  let h = hash ?? '';
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('/')) h = h.slice(1);

  const q = h.indexOf('?');
  const pathPart = q < 0 ? h : h.slice(0, q);
  const queryPart = q < 0 ? '' : h.slice(q + 1);

  const segments = pathPart.split('/').filter((x) => x.length > 0);
  let payload = '';
  for (const kv of queryPart.split('&')) {
    if (kv.startsWith('s=')) payload = kv.slice(2);
  }

  return {
    module: segments[0] ?? '',
    section: segments[1] ?? '',
    payload,
  };
}

export function buildHash(route: Partial<RouteState>): string {
  const parts = [route.module ?? '', route.section ?? ''].filter((x) => x.length > 0);
  const path = `#/${parts.join('/')}`;
  return route.payload ? `${path}?s=${route.payload}` : path;
}

/** Full shareable link for a scenario, given the current document location. */
export function permalinkFor(
  module: string,
  section: string,
  s: Scenario,
  origin: string,
  pathname: string,
): string {
  const encoded = encodeScenario(s);
  // A scenario at its defaults needs no payload; the bare module link is cleaner.
  const payload = encoded === CODEC_TAG ? '' : encoded;
  return `${origin}${pathname}${buildHash({ module, section, payload })}`;
}

/**
 * Apply a sparse patch to a Scenario and return a new one. Used by every control:
 * sliders never mutate, so React sees a new object and a worker job can be keyed on
 * identity.
 */
export function withPatch(s: Scenario, patch: Record<string, Leaf>): Scenario {
  const next = cloneScenario(s) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) setPath(next, k, v);
  return parseScenario(next);
}

/** Dotted paths at which two Scenarios differ. Drives "what changed" readouts. */
export function diffScenarios(a: Scenario, b: Scenario): string[] {
  const fa = new Map<string, Leaf>();
  const fb = new Map<string, Leaf>();
  flatten(a, '', fa);
  flatten(b, '', fb);
  const keys = new Set([...fa.keys(), ...fb.keys()]);
  const out: string[] = [];
  for (const k of Array.from(keys).sort()) {
    const va = fa.get(k);
    const vb = fb.get(k);
    if (va === undefined || vb === undefined || !leafEquals(va, vb)) out.push(k);
  }
  return out;
}
