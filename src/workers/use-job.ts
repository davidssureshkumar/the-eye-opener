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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobKind, JobParams, JobResults } from '../dsp/jobs';
import type { JobProgress } from '../dsp/jobs/types';
import type { Scenario } from '../state/scenario';
import { JobCancelled, JobClient, sharedJobClient } from './client';

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
  /** Supply a client, for tests. Defaults to the shared one. */
  client?: JobClient;
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
  const paramsKey = JSON.stringify(params);
  const scenarioKey = JSON.stringify(scenario);

  const clientRef = useRef<JobClient | null>(null);
  if (options.client) clientRef.current = options.client;
  else if (!clientRef.current) clientRef.current = sharedJobClient();
  const client = clientRef.current;

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
      .run(kind, JSON.parse(scenarioKey) as Scenario, JSON.parse(paramsKey) as Partial<JobParams[K]>, {
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
