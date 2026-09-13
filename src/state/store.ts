/**
 * The application store.
 *
 * Two pieces of state, kept deliberately separate because they have different
 * lifetimes and different owners:
 *
 *   - The route and its Scenario live in the URL. They are shareable, they survive
 *     a refresh, and the back button steps through them. Nothing about what a plot
 *     shows is stored anywhere else.
 *   - Reading progress lives in localStorage. It is personal, it is not worth
 *     putting in a link, and losing it costs nothing.
 *
 * Implemented on useSyncExternalStore rather than a context provider so that a
 * canvas component can subscribe to the scenario without re-rendering a page full
 * of prose on every slider tick.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { buildHash, decodeScenario, encodeScenario, parseHash, type RouteState } from './url-codec';
import { defaultScenario, type Scenario } from './scenario';
import { defaultScenarioForModule } from './presets';

/* --------------------------------------------------------------- URL state */

export interface AppState {
  route: RouteState;
  scenario: Scenario;
  /** Problems found while decoding the link, shown once and dismissible. */
  warnings: string[];
}

function readLocation(): AppState {
  const route = parseHash(typeof window === 'undefined' ? '' : window.location.hash);
  if (route.payload === '') {
    return {
      route,
      scenario: route.module ? defaultScenarioForModule(route.module) : defaultScenario(),
      warnings: [],
    };
  }
  const { scenario, warnings } = decodeScenario(route.payload);
  return { route, scenario, warnings };
}

let current: AppState = readLocation();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('hashchange', onHashChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', onHashChange);
    }
  };
}

function onHashChange(): void {
  current = readLocation();
  emit();
}

function getSnapshot(): AppState {
  return current;
}

/**
 * Write a new state to the URL.
 *
 * `replace` is the important flag. A slider drag produces dozens of states a second
 * and none of them belong in the history stack, so controls replace; navigation and
 * preset choices push. Getting this backwards makes the back button useless, which
 * is a real usability bug and not a cosmetic one.
 */
function commit(next: AppState, replace: boolean): void {
  current = next;
  if (typeof window !== 'undefined') {
    const url = `${window.location.pathname}${window.location.search}${buildHash(next.route)}`;
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }
  emit();
}

/** Replace the scenario, leaving the route alone. */
export function setScenario(s: Scenario, replace = true): void {
  const encoded = encodeScenario(s);
  const payload = encoded === `v${s.version}` ? '' : encoded;
  commit({ route: { ...current.route, payload }, scenario: s, warnings: [] }, replace);
}

/** Navigate, optionally carrying a scenario with you. */
export function navigate(module: string, section = '', scenario?: Scenario): void {
  const s = scenario ?? defaultScenarioForModule(module);
  const encoded = encodeScenario(s);
  const payload = encoded === `v${s.version}` ? '' : encoded;
  commit({ route: { module, section, payload }, scenario: s, warnings: [] }, false);
}

/** Drop the payload and return the module to the scenario it opens on. */
export function resetScenario(): void {
  const s = defaultScenarioForModule(current.route.module);
  commit({ route: { ...current.route, payload: '' }, scenario: s, warnings: [] }, false);
}

export function dismissWarnings(): void {
  current = { ...current, warnings: [] };
  emit();
}

/* --------------------------------------------------------------- the hooks */

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useRoute(): RouteState {
  return useAppState().route;
}

/**
 * The scenario, plus a setter that takes either a Scenario or a function of the
 * previous one. Matches useState so a control reads the way a React control reads.
 */
export function useScenario(): [Scenario, (next: Scenario | ((prev: Scenario) => Scenario)) => void] {
  const state = useAppState();
  const set = useCallback((next: Scenario | ((prev: Scenario) => Scenario)) => {
    const value = typeof next === 'function' ? next(current.scenario) : next;
    setScenario(value, true);
  }, []);
  return [state.scenario, set];
}

/* ------------------------------------------------------ progress, in storage */

const PROGRESS_KEY = 'eye-opener.progress.v1';

export interface Progress {
  /** Module ids the reader has scrolled to the end of. */
  completed: string[];
  /** Module id the reader was last on, for a "resume" link on the home page. */
  last: string;
  /** Self-check answers, keyed 'moduleId:questionId'. */
  answers: Record<string, string>;
}

const EMPTY_PROGRESS: Progress = { completed: [], last: '', answers: {} };

function readProgress(): Progress {
  if (typeof localStorage === 'undefined') return EMPTY_PROGRESS;
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return EMPTY_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      completed: Array.isArray(parsed.completed) ? parsed.completed.filter((x) => typeof x === 'string') : [],
      last: typeof parsed.last === 'string' ? parsed.last : '',
      answers:
        parsed.answers && typeof parsed.answers === 'object'
          ? (parsed.answers as Record<string, string>)
          : {},
    };
  } catch {
    // Private browsing, a full quota, or a value some other tab corrupted. None of
    // these are worth breaking the page over.
    return EMPTY_PROGRESS;
  }
}

let progress: Progress = readProgress();
const progressListeners = new Set<() => void>();

function writeProgress(next: Progress): void {
  progress = next;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
    }
  } catch {
    // Keep the in-memory copy; the reader still sees their progress this session.
  }
  for (const l of progressListeners) l();
}

function subscribeProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function useProgress(): Progress {
  return useSyncExternalStore(
    subscribeProgress,
    () => progress,
    () => EMPTY_PROGRESS,
  );
}

export function markVisited(moduleId: string): void {
  if (!moduleId || progress.last === moduleId) return;
  writeProgress({ ...progress, last: moduleId });
}

export function markCompleted(moduleId: string): void {
  if (!moduleId || progress.completed.includes(moduleId)) return;
  writeProgress({ ...progress, completed: [...progress.completed, moduleId] });
}

export function recordAnswer(moduleId: string, questionId: string, answer: string): void {
  writeProgress({
    ...progress,
    answers: { ...progress.answers, [`${moduleId}:${questionId}`]: answer },
  });
}

export function clearProgress(): void {
  writeProgress({ ...EMPTY_PROGRESS });
}

/* ------------------------------------------------------------ test support */

/** Reset the module-level singletons. Exported for tests, not for the UI. */
export function __resetStoreForTests(): void {
  current = readLocation();
  progress = readProgress();
  emit();
}
