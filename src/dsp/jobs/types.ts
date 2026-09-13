/**
 * What a job is, and what makes one testable.
 *
 * A job is a pure function of a Scenario and a small parameter object. It takes
 * no DOM, no canvas, no React, no clock and no global state, and it returns plain
 * data. That is the whole contract, and it buys three things:
 *
 *   - it runs identically in a Web Worker, on the main thread, and in a node test;
 *   - it can be pinned to a numerical golden, because the same input gives the
 *     same output on every machine;
 *   - the worker shell around it stays trivial, so there is nothing in the
 *     message plumbing that can be wrong in a way tests cannot see.
 *
 * Progress is reported through a callback rather than returned, because a job may
 * run for a second or more and the UI has to stay honest about it. Jobs call
 * `report` at coarse intervals - a few dozen times over a long run, not per
 * sample - so the callback never dominates the work it is measuring.
 *
 * Cancellation is deliberately NOT part of this contract. A synchronous function
 * cannot be interrupted from outside, and pretending otherwise with a token that
 * the job politely checks would be a lie in exactly the cases that matter. The
 * worker client handles cancellation at the level where it is real: it stops
 * listening, and terminates the worker if the job is still running. See
 * `src/workers/client.ts`.
 */

import type { Scenario } from '../../state/scenario';

/**
 * A coarse progress tick. `done` and `total` are in whatever unit the job counts.
 *
 * The one rule: `done / total` never decreases over a single run. A job is free
 * to change its unit between phases - bins in one, symbols in another - but the
 * fraction has to keep moving forward, because that fraction is a progress bar
 * and a bar that jumps backwards is worse than no bar at all. A job that calls
 * another job must therefore remap the child's ticks into a slice of its own
 * range rather than forward them; `phaseProgress` does exactly that.
 */
export interface JobProgress {
  done: number;
  total: number;
  /** What the job is doing right now, for the status line. */
  label: string;
}

/** The scale a composed job reports on, so its phases can be given as percentages. */
export const PROGRESS_TOTAL = 100;

export type ProgressFn = (p: JobProgress) => void;

/** Everything a job is given. Serialisable in full, so it survives postMessage. */
export interface JobInput<P> {
  scenario: Scenario;
  params: P;
}

/**
 * A job: its identity, its implementation, and how to hand its result across a
 * worker boundary without copying the large arrays.
 */
export interface JobDefinition<P, R> {
  kind: string;
  /** Parameters used when the caller supplies none. Keeps call sites short. */
  defaults: P;
  run(input: JobInput<P>, report?: ProgressFn): R;
  /**
   * The buffers in a result that may be moved rather than copied.
   *
   * A transferred buffer is detached from the sender, so this must list only
   * buffers the job has just created and will never touch again. Every job here
   * allocates its output fresh, which is what makes that safe.
   */
  transferables(result: R): ArrayBufferLike[];
}

/** Collect the backing buffers of a set of typed arrays, skipping absent ones. */
export function buffersOf(...arrays: readonly (ArrayBufferView | undefined | null)[]): ArrayBufferLike[] {
  const out: ArrayBufferLike[] = [];
  for (const a of arrays) {
    if (a && !out.includes(a.buffer)) out.push(a.buffer);
  }
  return out;
}

/**
 * Map a called job's progress into a slice of the caller's range.
 *
 * The child counts in its own units and thinks it runs from 0 to 100% of the
 * work; the caller knows it is one phase of several. This adapter rescales the
 * child's fraction into [from, to] on the caller's PROGRESS_TOTAL scale, keeping
 * the child's label, so the bar advances once through the whole composition
 * instead of restarting at each stage.
 */
export function phaseProgress(
  report: ProgressFn | undefined,
  from: number,
  to: number,
): ProgressFn | undefined {
  if (!report) return undefined;
  return ({ done, total, label }: JobProgress): void => {
    const fraction = total > 0 ? Math.min(1, Math.max(0, done / total)) : 1;
    report({ done: from + fraction * (to - from), total: PROGRESS_TOTAL, label });
  };
}

/**
 * Emit at most `steps` progress ticks over a loop of `total` iterations.
 *
 * Returns a function to call every iteration; it forwards only on tick
 * boundaries. Without this every job would grow its own modulo arithmetic and
 * some of them would get it wrong on short runs.
 */
export function throttleProgress(
  report: ProgressFn | undefined,
  total: number,
  label: string,
  steps = 40,
): (done: number) => void {
  if (!report || total <= 0) return () => undefined;
  const every = Math.max(1, Math.floor(total / Math.max(1, steps)));
  return (done: number): void => {
    if (done % every === 0 || done === total) report({ done, total, label });
  };
}
