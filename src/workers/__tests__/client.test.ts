/**
 * The job client, against a fake worker.
 *
 * The numerical work is tested in `src/dsp/jobs`. What is left here is the part
 * that can only be wrong in motion: which reply is believed, which is discarded,
 * and what happens to a job nobody wants any more. Those are exactly the defects
 * that survive a unit test of the DSP and then show up as a plot that lags a
 * slider by one position, or a progress bar belonging to a run that ended.
 *
 * The fake worker is driven by hand rather than by a timer, so every test states
 * the interleaving it is about instead of hoping for one.
 */

import { describe, expect, it, vi } from 'vitest';
import { JobCancelled, JobClient } from '../client';
import { isJobRequest, type JobRequest, type WorkerResponse } from '../protocol';
import { defaultScenario } from '../../state/scenario';

/**
 * A Worker that records what it was sent and replies only when told to.
 *
 * Not an approximation of the real worker's timing: the point is to make the
 * orderings explicit. A real worker's replies arrive whenever they arrive, and
 * every one of these interleavings does happen under a dragged slider.
 */
class FakeWorker {
  readonly sent: JobRequest[] = [];
  terminated = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};

  postMessage(message: unknown): void {
    if (isJobRequest(message)) this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: (e: never) => void): void {
    (this.listeners[type] ??= []).push(listener as (e: unknown) => void);
  }

  removeEventListener(): void {
    /* not needed: a fake worker is discarded, never unsubscribed */
  }

  /** Deliver a reply, as the real worker would. */
  reply(message: WorkerResponse): void {
    for (const l of this.listeners.message ?? []) l({ data: message });
  }

  /** Raise an uncaught error inside the worker. */
  fail(message: string): void {
    for (const l of this.listeners.error ?? []) l({ message });
  }

  /** The id of the request still in flight. */
  get lastId(): number {
    return this.sent[this.sent.length - 1]?.id ?? -1;
  }
}

function clientWith(): { client: JobClient; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const client = new JobClient({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
    budgetMs: -1, // every supersede counts as "already running", so restarts are testable
  });
  return { client, workers };
}

const scenario = defaultScenario();

/* ------------------------------------------------------------------ the happy path */

describe('running a job in a worker', () => {
  it('sends one request and resolves with its reply', async () => {
    const { client, workers } = clientWith();
    const promise = client.run('pattern', scenario, { bits: 64 });

    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toHaveLength(1);
    expect(workers[0].sent[0].kind).toBe('pattern');
    expect(workers[0].sent[0].params).toEqual({ bits: 64 });

    workers[0].reply({
      type: 'result',
      id: workers[0].lastId,
      kind: 'pattern',
      result: { onesDensity: 0.5 },
      elapsedMs: 3,
    });

    await expect(promise).resolves.toEqual({ onesDensity: 0.5 });
  });

  it('reuses the same worker for a job that follows a completed one', async () => {
    const { client, workers } = clientWith();
    const first = client.run('pattern', scenario);
    workers[0].reply({ type: 'result', id: 1, kind: 'pattern', result: 1, elapsedMs: 1 });
    await first;

    const second = client.run('pattern', scenario);
    expect(workers).toHaveLength(1);
    workers[0].reply({ type: 'result', id: 2, kind: 'pattern', result: 2, elapsedMs: 1 });
    await expect(second).resolves.toBe(2);
  });

  it('gives each request a distinct id', async () => {
    const { client, workers } = clientWith();
    void client.run('pattern', scenario).catch(() => undefined);
    void client.run('pattern', scenario).catch(() => undefined);
    void client.run('pattern', scenario).catch(() => undefined);
    const ids = workers.flatMap((w) => w.sent.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('forwards progress to the caller while the job runs', async () => {
    const { client, workers } = clientWith();
    const ticks: string[] = [];
    const promise = client.run('spectrum', scenario, {}, { onProgress: (p) => ticks.push(p.label) });

    const id = workers[0].lastId;
    workers[0].reply({ type: 'progress', id, done: 10, total: 100, label: 'Windowing' });
    workers[0].reply({ type: 'progress', id, done: 70, total: 100, label: 'Scaling bins' });
    workers[0].reply({ type: 'result', id, kind: 'spectrum', result: {}, elapsedMs: 9 });

    await promise;
    expect(ticks).toEqual(['Windowing', 'Scaling bins']);
  });
});

/* ----------------------------------------------------------------- superseding */

describe('a superseded request', () => {
  it('rejects with JobCancelled rather than resolving late', async () => {
    const { client } = clientWith();
    const first = client.run('pattern', scenario, { bits: 64 });
    void client.run('pattern', scenario, { bits: 128 }).catch(() => undefined);
    await expect(first).rejects.toBeInstanceOf(JobCancelled);
  });

  it('discards the answer to the question that was replaced', async () => {
    const { client, workers } = clientWith();
    const first = client.run('pattern', scenario, { bits: 64 });
    const firstId = workers[0].lastId;
    first.catch(() => undefined);

    const second = client.run('pattern', scenario, { bits: 128 });
    const live = workers[workers.length - 1];

    // The old worker's answer arrives anyway - it was already computing. It
    // describes a slider position the reader has left, so it must not win.
    workers[0].reply({ type: 'result', id: firstId, kind: 'pattern', result: 'stale', elapsedMs: 1 });
    live.reply({ type: 'result', id: live.lastId, kind: 'pattern', result: 'fresh', elapsedMs: 1 });

    await expect(second).resolves.toBe('fresh');
    await expect(first).rejects.toBeInstanceOf(JobCancelled);
  });

  it('ignores progress belonging to a run that has been replaced', async () => {
    const { client, workers } = clientWith();
    const ticks: string[] = [];
    const first = client.run('spectrum', scenario, {}, { onProgress: (p) => ticks.push(p.label) });
    const firstId = workers[0].lastId;
    first.catch(() => undefined);

    void client.run('spectrum', scenario).catch(() => undefined);
    workers[0].reply({ type: 'progress', id: firstId, done: 50, total: 100, label: 'stale tick' });

    expect(ticks).toEqual([]);
  });

  it('terminates a worker still chewing on work nobody wants', async () => {
    const { client, workers } = clientWith();
    void client.run('spectrum', scenario).catch(() => undefined);
    expect(workers[0].terminated).toBe(false);

    void client.run('spectrum', scenario).catch(() => undefined);
    // The budget here is negative, so the first run always counts as long-running:
    // a synchronous job cannot be asked to stop, so ending the thread is the only way.
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it('waits instead of restarting when the job started within the budget', async () => {
    const workers: FakeWorker[] = [];
    const client = new JobClient({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      budgetMs: 10_000, // nothing will exceed this during the test
    });

    void client.run('pattern', scenario).catch(() => undefined);
    void client.run('pattern', scenario).catch(() => undefined);

    // A job that has barely started will finish sooner than a new worker can be
    // spun up and handed the module, so the result is dropped rather than the
    // worker torn down.
    expect(workers).toHaveLength(1);
    expect(workers[0].terminated).toBe(false);
    expect(workers[0].sent).toHaveLength(2);
  });

  it('cancels on request, with no replacement job', async () => {
    const { client } = clientWith();
    const promise = client.run('pattern', scenario);
    client.cancel();
    await expect(promise).rejects.toBeInstanceOf(JobCancelled);
  });

  it('names the cancelled job in the error, so a log says which one', async () => {
    const { client } = clientWith();
    const promise = client.run('pattern', scenario);
    client.cancel();
    await promise.catch((e: JobCancelled) => {
      expect(e.id).toBe(1);
      expect(e.name).toBe('JobCancelled');
    });
  });
});

/* --------------------------------------------------------------------- failure */

describe('when a job fails', () => {
  it('rejects with the message the worker sent', async () => {
    const { client, workers } = clientWith();
    const promise = client.run('pattern', scenario);
    workers[0].reply({ type: 'error', id: workers[0].lastId, message: 'seed must be positive' });
    await expect(promise).rejects.toThrow('seed must be positive');
  });

  it('replaces a worker that died, rather than sending into a corpse', async () => {
    const { client, workers } = clientWith();
    const promise = client.run('pattern', scenario);
    workers[0].fail('out of memory');
    await expect(promise).rejects.toThrow('out of memory');
    expect(workers[0].terminated).toBe(true);

    const next = client.run('pattern', scenario);
    expect(workers).toHaveLength(2);
    workers[1].reply({ type: 'result', id: 2, kind: 'pattern', result: 'ok', elapsedMs: 1 });
    await expect(next).resolves.toBe('ok');
  });

  it('does not leave the client stuck after a failure', async () => {
    const { client, workers } = clientWith();
    const failed = client.run('pattern', scenario);
    workers[0].reply({ type: 'error', id: 1, message: 'bad input' });
    await expect(failed).rejects.toThrow('bad input');

    const after = client.run('pattern', scenario);
    const live = workers[workers.length - 1];
    live.reply({ type: 'result', id: live.lastId, kind: 'pattern', result: 'recovered', elapsedMs: 1 });
    await expect(after).resolves.toBe('recovered');
  });
});

/* ---------------------------------------------------------------------- inline */

describe('the inline fallback', () => {
  it('runs the real job when no worker is available', async () => {
    const client = new JobClient({ inline: true });
    expect(client.isInline).toBe(true);
    const result = await client.run('pattern', scenario, { bits: 128 });
    expect(result.bits.length).toBe(128);
    expect(result.onesDensity).toBeGreaterThan(0);
  });

  it('falls back rather than failing when the worker cannot be constructed', async () => {
    const client = new JobClient({
      createWorker: () => {
        throw new Error('Worker is not defined');
      },
    });
    const result = await client.run('pattern', scenario, { bits: 64 });
    expect(result.bits.length).toBe(64);
    expect(client.isInline).toBe(true);
  });

  it('gives the same numbers as the worker path would, because it is the same code', async () => {
    const client = new JobClient({ inline: true });
    const a = await client.run('fourier', scenario, { samples: 256, maxN: 9 });
    const b = await client.run('fourier', scenario, { samples: 256, maxN: 9 });
    expect(a.overshoot.fractionOfJump).toBe(b.overshoot.fractionOfJump);
  });

  it('never resolves during the turn of the event loop that started it', async () => {
    const client = new JobClient({ inline: true });
    const order: string[] = [];
    const promise = client.run('pattern', scenario, { bits: 16 }).then(() => order.push('result'));
    order.push('after call');
    await promise;
    // A result delivered synchronously would arrive during render and set state
    // on a component that has not mounted. The worker path cannot do that; the
    // inline path must not either.
    expect(order).toEqual(['after call', 'result']);
  });

  it('reports progress on the inline path too', async () => {
    const client = new JobClient({ inline: true });
    const ticks: number[] = [];
    await client.run('spectrum', scenario, { uis: 16 }, { onProgress: (p) => ticks.push(p.done / p.total) });
    expect(ticks.length).toBeGreaterThan(0);
    expect(Math.max(...ticks)).toBeGreaterThan(0.9);
  });
});

/* ------------------------------------------------------------------- protocol */

describe('the message guard', () => {
  it('accepts a well-formed request', () => {
    expect(isJobRequest({ type: 'run', id: 1, kind: 'pattern', scenario, params: {} })).toBe(true);
  });

  it('rejects anything else, so a stray message cannot reach the registry', () => {
    for (const bad of [null, undefined, 0, 'run', [], {}, { type: 'run' }, { type: 'run', id: 1 }]) {
      expect(isJobRequest(bad)).toBe(false);
    }
    expect(isJobRequest({ type: 'stop', id: 1, kind: 'pattern' })).toBe(false);
    expect(isJobRequest({ type: 'run', id: '1', kind: 'pattern' })).toBe(false);
  });
});

/* -------------------------------------------------------------------- disposal */

describe('disposal', () => {
  it('ends the worker and rejects whatever was running', async () => {
    const { client, workers } = clientWith();
    const promise = client.run('pattern', scenario);
    client.dispose();
    await expect(promise).rejects.toBeInstanceOf(JobCancelled);
    expect(workers[0].terminated).toBe(true);
  });

  it('still works afterwards, starting a fresh worker', async () => {
    const { client, workers } = clientWith();
    client.dispose();
    const promise = client.run('pattern', scenario);
    const live = workers[workers.length - 1];
    live.reply({ type: 'result', id: live.lastId, kind: 'pattern', result: 'ok', elapsedMs: 1 });
    await expect(promise).resolves.toBe('ok');
  });

  it('is safe to call when nothing is running', () => {
    const { client } = clientWith();
    expect(() => client.dispose()).not.toThrow();
    expect(() => client.dispose()).not.toThrow();
  });
});

/* ------------------------------------------------------------- what it sends */

describe('the request it sends', () => {
  it('carries the whole Scenario, so the worker needs no other state', () => {
    const { client, workers } = clientWith();
    void client.run('waveform', scenario, { uis: 4 }).catch(() => undefined);
    const sent = workers[0].sent[0];
    expect(sent.scenario).toEqual(scenario);
    expect(JSON.parse(JSON.stringify(sent))).toEqual(sent);
  });

  it('sends only the parameters the caller gave, leaving defaults to the job', () => {
    const { client, workers } = clientWith();
    void client.run('spectrum', scenario, { uis: 32 }).catch(() => undefined);
    expect(workers[0].sent[0].params).toEqual({ uis: 32 });
  });
});

/* ------------------------------------------------------------ no hidden timers */

describe('the client holds no timers', () => {
  it('settles every promise without the clock advancing', async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = clientWith();
      const promise = client.run('pattern', scenario);
      workers[0].reply({ type: 'result', id: 1, kind: 'pattern', result: 'done', elapsedMs: 1 });
      await expect(promise).resolves.toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});
