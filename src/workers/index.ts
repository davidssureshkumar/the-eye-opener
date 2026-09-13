/**
 * Running DSP off the main thread.
 *
 *   protocol.ts   what a request and a reply look like
 *   dsp.worker.ts the worker: a message loop around the job registry
 *   client.ts     the main thread's end, and where cancellation is real
 *   use-job.ts    a job's result as React state
 *
 * The computation itself is not here. It lives in `src/dsp/jobs`, as pure
 * functions that run identically on either thread and are tested in node.
 */

export * from './protocol';
export * from './client';
export * from './use-job';
