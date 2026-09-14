/**
 * `useJob`: a job's result as React state, kept current with the Scenario.
 *
 * The rule the rest of the site depends on is that every plot is a pure function
 * of the Scenario. This hook is what makes that affordable when the function is
 * expensive: give it a Scenario and it gives back the latest result, the progress
 * of the run that will replace it, and whether that run is still going.
 *
 * Three behaviours are deliberate.
 *
 * The previous result is kept while the next one computes. Blanking the plot on
 * every slider movement makes a smooth control feel like a stutter, and worse, it
 * removes the very thing the reader is trying to compare against. The stale result
 * stays on screen, `running` is true, and the caller can dim it.
 *
 * `JobCancelled` is swallowed. It is not an error: it means the reader moved the
 * control again, which is the normal case during a drag, and surfacing it would
 * paint an error banner over a perfectly good plot.
 *
 * Progress is throttled to animation frames. A job that reports forty times in
 * eighty milliseconds would otherwise cause forty renders of a progress bar, and
 * the renders would cost more than the ticks are worth.
 *
 * Each hook has a client, and so a worker, of its own. A client supersedes its
 * previous request whatever job that was, so two plots sharing one would cancel
 * each other whenever a control changed both, and the cancelled one would wait for
 * a result that never came. A page has a handful of these hooks, not hundreds.
 *
 * Params may carry typed arrays - a measured network, for one. They are keyed by
 * identity, not contents: a caller holds a loaded file in state and passes the same
 * array until the file changes, and hashing megabytes on every render would cost
 * more than the job.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobKind, JobParams, JobResults } from '../dsp/jobs';
import type { JobProgress } from '../dsp/jobs/types';
import type { Scenario } from '../state/scenario';
import { JobCancelled, JobClient } from './client';

export interface JobState<R> {
  /** The most recent successful result, kept while the next one computes. */
  data: R | null;
  /** True from the moment a run starts until it settles. */
  running: boolean;
  /** Progress of the run in flight, or null between runs. */
  progress: JobProgress | null;
  /** The last failure, cleared when a run succeeds. Cancellation is not a failure. */
  error: Error | null;
  /** True once at least one run has produced a result. */
  ready: boolean;
  /** Re-run with the same inputs. For a retry button. */
  refresh(): void;
}

export interface UseJobOptions {
  /** Skip running at all. For a plot that is off screen or behind a closed panel. */
  enabled?: boolean;
  /** Supply a client, for tests. Defaults to one owned by this hook. */
  client?: JobClient;
}

/** Identity tokens for typed arrays in params, so a key changes exactly when an array is replaced. */
const arrayTokens = new WeakMap<object, number>();
let nextArrayToken = 1;

/** A string that changes when params change: by value for plain data, by identity for typed arrays. */
export function paramsKeyOf(params: unknown): string {
  return JSON.stringify(params, (_key, value: unknown) => {
    if (ArrayBuffer.isView(value)) {
      let token = arrayTokens.get(value);
      if (token === undefined) {
        token = nextArrayToken++;
        arrayTokens.set(value, token);
      }
      return { $array: token };
    }
    return value;
  });
}

export function useJob<K extends JobKind>(
  kind: K,
  scenario: Scenario,
  params: Partial<JobParams[K]> = {},
  options: UseJobOptions = {},
): JobState<JobResults[K]> {
  const { enabled = true } = options;

  const [data, setData] = useState<JobResults[K] | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  // Params are compared by value, not identity: a caller that builds its params
  // object inline - which is the natural way to write the call - would otherwise
  // re-run the job on every render forever.
  const paramsKey = paramsKeyOf(params);
  // The params object that produced the key, handed to the job as it is, since a
  // JSON round trip would turn its typed arrays into plain objects.
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const scenarioKey = JSON.stringify(scenario);

  const clientRef = useRef<JobClient | null>(null);
  const owned = options.client === undefined;
  if (options.client) clientRef.current = options.client;
  else if (!clientRef.current) clientRef.current = new JobClient();
  const client = clientRef.current;

  // Release this hook's worker when the component goes. The client starts a new one
  // if it is used again, which is what a development double mount does.
  useEffect(() => (owned ? () => client.dispose() : undefined), [client, owned]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let live = true;
    let frame = 0;
    let latest: JobProgress | null = null;

    setRunning(true);
    setProgress(null);

    const onProgress = (p: JobProgress): void => {
      latest = p;
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (live && latest) setProgress(latest);
      });
    };

    client
      .run(kind, JSON.parse(scenarioKey) as Scenario, paramsRef.current, {
        onProgress,
      })
      .then((result) => {
        if (!live) return;
        setData(result);
        setError(null);
        setRunning(false);
        setProgress(null);
      })
      .catch((e: unknown) => {
        // Superseded by a newer request: the reader moved a control. The run that
        // replaced this one owns `running` now, so leave it alone.
        if (e instanceof JobCancelled) return;
        if (!live) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setRunning(false);
        setProgress(null);
      });

    return (): void => {
      live = false;
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // scenarioKey and paramsKey are the value-equality stand-ins described above.
  }, [client, kind, scenarioKey, paramsKey, enabled, nonce]);

  return { data, running, progress, error, ready: data !== null, refresh };
}
