/**
 * The message protocol between the main thread and the DSP worker.
 *
 * Deliberately small. Everything that could be computed is computed in
 * `src/dsp/jobs`, which is pure and tested; this file describes only how a
 * request and a reply are shaped so that both ends agree. If a bug can live in
 * the plumbing, the plumbing is too clever.
 *
 * Every message carries the id of the request it belongs to. Replies to a
 * superseded request are discarded on arrival rather than trusted to never
 * appear: a slider produces requests faster than a worker can answer them, and
 * the answer to the previous position is not merely late, it is wrong.
 */

import type { JobKind, JobParams } from '../dsp/jobs';
import type { Scenario } from '../state/scenario';

export interface JobRequest<K extends JobKind = JobKind> {
  type: 'run';
  id: number;
  kind: K;
  scenario: Scenario;
  params: Partial<JobParams[K]>;
}

export interface ProgressMessage {
  type: 'progress';
  id: number;
  done: number;
  total: number;
  label: string;
}

export interface ResultMessage {
  type: 'result';
  id: number;
  kind: JobKind;
  /** Typed on the main thread by the client, which knows what it asked for. */
  result: unknown;
  /** Wall-clock time the job took inside the worker, milliseconds. */
  elapsedMs: number;
}

export interface ErrorMessage {
  type: 'error';
  id: number;
  message: string;
  stack?: string;
}

export type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;

/** Narrow an arbitrary `MessageEvent.data` to a request, rejecting anything else. */
export function isJobRequest(data: unknown): data is JobRequest {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.type === 'run' && typeof d.id === 'number' && typeof d.kind === 'string';
}
