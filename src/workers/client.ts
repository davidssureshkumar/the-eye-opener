/**
 * The main thread's end of the DSP worker, and where cancellation is real.
 *
 * A slider produces a request per frame. The worker answers them in order, and
 * every answer but the last is stale by the time it lands - not late, wrong, since
 * it describes a position the control has already left. So the client tracks the
 * id of the request it is still interested in and discards everything else on
 * arrival. That alone keeps the display correct.
 *
 * Keeping it *fast* needs one more thing. A job that takes a second blocks the
 * worker for a second whether or not anyone still wants the answer, and the next
 * request waits behind it. When a request is superseded while it is still running,
 * this client terminates the worker and starts a fresh one. That is abrupt, and it
 * is the only mechanism that actually works: a synchronous function cannot be
 * interrupted by a message, because the message is not delivered until the
 * function returns.
 *
 * `budgetMs` decides which of the two applies. Under it, waiting is cheaper than
 * a restart - a worker costs a few milliseconds to spin up and has to re-parse the
 * module - so the result is simply dropped. Over it, the restart wins.
 *
 * If Worker construction fails or is unavailable - a node test, a browser with
 * workers disabled - the client runs jobs inline instead. The numbers are
 * identical, because both paths call the same `runJob`; only the main thread
 * stalls. A site that draws the wrong picture is broken, a site that janks is not.
 */

import { runJob, type JobKind, type JobParams, type JobResults } from '../dsp/jobs';
import type { Scenario } from '../state/scenario';
import type { JobRequest, WorkerResponse } from './protocol';
import type { JobProgress } from '../dsp/jobs/types';

export interface RunOptions {
  /** Called with coarse progress ticks while the job runs. */
  onProgress?: (p: JobProgress) => void;
  /**
   * How long a job may be left running after it has been superseded before the
   * worker is torn down instead. Below this, restarting costs more than waiting.
   */
  budgetMs?: number;
}

export interface JobClientOptions {
  /**
   * Build the worker. Overridable so a test can supply a fake, and so the
   * `new URL(...)` call that Vite rewrites at build time stays in one place.
   */
  createWorker?: () => Worker;
  /** Force the inline path, for tests and for measuring what the worker buys. */
  inline?: boolean;
  budgetMs?: number;
}

const DEFAULT_BUDGET_MS = 150;

/** Error thrown into a pending promise when its request is superseded or cancelled. */
export class JobCancelled extends Error {
  constructor(public readonly id: number) {
    super(`Job ${id} was cancelled`);
    this.name = 'JobCancelled';
  }
}

interface Pending {
  id: number;
  kind: JobKind;
  startedAt: number;
  onProgress?: (p: JobProgress) => void;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function defaultCreateWorker(): Worker {
  // `new URL('./dsp.worker.ts', import.meta.url)` is the form Vite recognises and
  // rewrites into a hashed asset URL at build time. It must be written inline,
  // not assembled from variables, or the bundler cannot see it.
  return new Worker(new URL('./dsp.worker.ts', import.meta.url), {
    type: 'module',
    name: 'dsp',
  });
}

export class JobClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private nextId = 1;
  private readonly create: () => Worker;
  private readonly budgetMs: number;
  private inlineOnly: boolean;

  constructor(options: JobClientOptions = {}) {
    this.create = options.createWorker ?? defaultCreateWorker;
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
    // An explicitly supplied factory is a statement that a worker can be had, so
    // it outranks the environment check - otherwise a caller that brings its own
    // Worker implementation (a test, a polyfill) would be quietly run inline and
    // the worker path would never execute. A factory that throws still falls back.
    this.inlineOnly = options.inline ?? (options.createWorker === undefined && typeof Worker === 'undefined');
  }

  /** True when jobs are running on the main thread rather than in a worker. */
  get isInline(): boolean {
    return this.inlineOnly;
  }

  /**
   * Run a job, superseding whatever was running.
   *
   * The previous request's promise rejects with `JobCancelled`, which callers
   * are expected to ignore: it means someone asked a better question, not that
   * anything went wrong.
   */
  run<K extends JobKind>(
    kind: K,
    scenario: Scenario,
    params: Partial<JobParams[K]> = {},
    options: RunOptions = {},
  ): Promise<JobResults[K]> {
    this.supersede(options.budgetMs ?? this.budgetMs);

    const id = this.nextId++;

    if (this.inlineOnly) {
      return this.runInline(id, kind, scenario, params, options);
    }

    return new Promise<JobResults[K]>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this.ensureWorker();
      } catch {
        // A browser that cannot give us a worker still gets correct pictures.
        this.inlineOnly = true;
        this.runInline(id, kind, scenario, params, options).then(resolve, reject);
        return;
      }

      this.pending = {
        id,
        kind,
        startedAt: Date.now(),
        onProgress: options.onProgress,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      const request: JobRequest<K> = { type: 'run', id, kind, scenario, params };
      worker.postMessage(request);
    });
  }

  /** Abandon the running job. Its promise rejects with `JobCancelled`. */
  cancel(): void {
    this.supersede(this.budgetMs);
  }

  /** Release the worker. The client still works afterwards; it starts a new one. */
  dispose(): void {
    this.supersede(0);
    this.terminate();
  }

  /* --------------------------------------------------------------- internals */

  private runInline<K extends JobKind>(
    id: number,
    kind: K,
    scenario: Scenario,
    params: Partial<JobParams[K]>,
    options: RunOptions,
  ): Promise<JobResults[K]> {
    // Deferred by a microtask so that an inline run and a worker run have the
    // same shape from the caller's side: nothing resolves before the current turn
    // of the event loop finishes, so a component cannot see a result during its
    // own render.
    return Promise.resolve().then(() => {
      if (this.pending !== null && this.pending.id !== id) throw new JobCancelled(id);
      return runJob(kind, scenario, params, options.onProgress);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.create();
    worker.addEventListener('message', (e: MessageEvent) => this.onMessage(e));
    worker.addEventListener('error', (e: ErrorEvent) => this.onError(e));
    this.worker = worker;
    return worker;
  }

  private onMessage(event: MessageEvent): void {
    const message = event.data as WorkerResponse;
    const pending = this.pending;
    // Not the request we are waiting for: an answer to a question already
    // superseded. Dropping it here is what keeps a dragged slider correct.
    if (!pending || !message || message.id !== pending.id) return;

    switch (message.type) {
      case 'progress':
        pending.onProgress?.({
          done: message.done,
          total: message.total,
          label: message.label,
        });
        break;
      case 'result':
        this.pending = null;
        pending.resolve(message.result);
        break;
      case 'error':
        this.pending = null;
        pending.reject(new Error(message.message));
        break;
    }
  }

  private onError(event: ErrorEvent): void {
    const pending = this.pending;
    this.pending = null;
    // The worker is in an unknown state after an uncaught error; replace it.
    this.terminate();
    pending?.reject(new Error(event.message || 'DSP worker failed'));
  }

  /**
   * Stop caring about the running job, and stop it outright if it has been going
   * long enough that waiting would delay the next one.
   */
  private supersede(budgetMs: number): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;

    if (Date.now() - pending.startedAt > budgetMs) this.terminate();

    pending.reject(new JobCancelled(pending.id));
  }

  private terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

/**
 * The client the app uses. One worker for the whole site: the jobs are short and
 * a queue of one is exactly the semantics wanted, since only the newest request
 * is ever of interest.
 */
let shared: JobClient | null = null;

export function sharedJobClient(): JobClient {
  if (!shared) shared = new JobClient();
  return shared;
}

/** Drop the shared client. Tests use this; nothing in the app should need it. */
export function __resetSharedClient(): void {
  shared?.dispose();
  shared = null;
}
