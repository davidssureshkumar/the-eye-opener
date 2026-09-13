/**
 * The DSP worker: a message loop around the job registry, and nothing else.
 *
 * There is no computation in this file. It receives a request, looks the job up,
 * runs it, and posts the result back with the large buffers transferred rather
 * than copied. Keeping it this thin is what lets the numerical work be tested in
 * node, where a worker does not exist and would only get in the way.
 *
 * Note what is absent: cancellation. A synchronous job cannot be interrupted by
 * a message, because the message cannot be delivered until the job returns and
 * the event loop turns. A "cancel" message here would sit in the queue until the
 * work it was meant to stop had already finished. Cancellation therefore lives in
 * the client, which can stop listening immediately and terminate the worker if the
 * job is genuinely long. See `client.ts`.
 */

import { isJobKind, runJob, transferablesOf, type JobKind } from '../dsp/jobs';
import { isJobRequest, type ErrorMessage, type ProgressMessage, type ResultMessage } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', (event: MessageEvent) => {
  const request = event.data;
  if (!isJobRequest(request)) return;

  const { id, kind } = request;

  if (!isJobKind(kind)) {
    const error: ErrorMessage = { type: 'error', id, message: `Unknown job kind: ${String(kind)}` };
    ctx.postMessage(error);
    return;
  }

  const started = Date.now();
  try {
    const result = runJob(kind as JobKind, request.scenario, request.params, (p) => {
      const progress: ProgressMessage = { type: 'progress', id, ...p };
      ctx.postMessage(progress);
    });

    const message: ResultMessage = {
      type: 'result',
      id,
      kind,
      result,
      elapsedMs: Date.now() - started,
    };
    // Transferring detaches these buffers from the worker. That is safe only
    // because every job allocates its output fresh and holds no reference to it
    // after returning; nothing in the worker reads them again.
    ctx.postMessage(message, transferablesOf(kind, result as never) as Transferable[]);
  } catch (e) {
    const error: ErrorMessage = {
      type: 'error',
      id,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    };
    ctx.postMessage(error);
  }
});
