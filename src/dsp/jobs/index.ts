/**
 * The job registry.
 *
 * One table, keyed by job kind, mapping to a pure function and its transfer list.
 * The worker shell, the main-thread fallback and the tests all go through this
 * table, so there is exactly one place where a job is looked up and no way for
 * the three paths to know about different sets of jobs.
 *
 * The type machinery below exists to make `runJob('spectrum', scenario, params)`
 * check its parameters and infer its result. Without it the worker boundary -
 * which erases types, because a message is just data - would erase them on the
 * main thread too, and the whole point of keeping the DSP in TypeScript would be
 * lost at the one place it matters most.
 */

import type { Scenario } from '../../state/scenario';
import { assertFinite } from '../guard';
import type { JobDefinition, JobInput, ProgressFn } from './types';
import { edgeJob, type EdgeParams, type EdgeResult } from './edge-job';
import { fourierJob, type FourierParams, type FourierResult } from './fourier-job';
import { lossyJob, type LossyParams, type LossyResult } from './lossy-job';
import { patternJob, type PatternParams, type PatternResult } from './pattern-job';
import { spectrumJob, type SpectrumParams, type SpectrumResult } from './spectrum-job';
import { tlineJob, type TlineParams, type TlineResult } from './tline-job';
import { waveformJob, type WaveformParams, type WaveformResult } from './waveform-job';

export * from './types';
export * from './adapt';
export * from './edge-job';
export * from './fourier-job';
export * from './lossy-job';
export * from './pattern-job';
export * from './spectrum-job';
export * from './tline-job';
export * from './waveform-job';

/** Parameters each job kind takes. */
export interface JobParams {
  edge: EdgeParams;
  fourier: FourierParams;
  lossy: LossyParams;
  pattern: PatternParams;
  spectrum: SpectrumParams;
  tline: TlineParams;
  waveform: WaveformParams;
}

/** What each job kind returns. */
export interface JobResults {
  edge: EdgeResult;
  fourier: FourierResult;
  lossy: LossyResult;
  pattern: PatternResult;
  spectrum: SpectrumResult;
  tline: TlineResult;
  waveform: WaveformResult;
}

export type JobKind = keyof JobParams;

type Registry = { [K in JobKind]: JobDefinition<JobParams[K], JobResults[K]> };

export const JOBS: Registry = {
  edge: edgeJob,
  fourier: fourierJob,
  lossy: lossyJob,
  pattern: patternJob,
  spectrum: spectrumJob,
  tline: tlineJob,
  waveform: waveformJob,
};

export const JOB_KINDS = Object.keys(JOBS) as JobKind[];

/** Whether a string names a job. Used to reject a malformed worker message. */
export function isJobKind(kind: string): kind is JobKind {
  return Object.prototype.hasOwnProperty.call(JOBS, kind);
}

/**
 * Run a job. Synchronous, on whichever thread calls it.
 *
 * Parameters are merged over the job's defaults, so a caller states only what it
 * cares about and a new parameter added to a job does not break every call site.
 */
export function runJob<K extends JobKind>(
  kind: K,
  scenario: Scenario,
  params: Partial<JobParams[K]> = {},
  report?: ProgressFn,
): JobResults[K] {
  const job = JOBS[kind];
  const input: JobInput<JobParams[K]> = {
    scenario,
    params: { ...job.defaults, ...params },
  };
  const result = job.run(input, report);
  // Development only, and compiled out of the production build. A NaN that reaches
  // a canvas draws nothing and is reported as "the trace stops halfway"; caught
  // here it names the field that produced it. See `src/dsp/guard.ts`.
  assertFinite(result, `job '${kind}'`);
  return result;
}

/** The buffers in a result that may be moved rather than copied to another thread. */
export function transferablesOf<K extends JobKind>(kind: K, result: JobResults[K]): ArrayBufferLike[] {
  return JOBS[kind].transferables(result);
}
