/**
 * The spectrum of the transmitted stream, computed the way a scope's FFT math
 * function computes it.
 *
 * Two things the picture is meant to teach. First, where the energy of a data
 * stream actually is: a random NRZ stream held for one UI has a sinc-squared
 * envelope with nulls at every multiple of the symbol rate, and its first lobe -
 * DC to f_s - carries almost all of it. That is why channel loss is quoted at
 * f_s/2 and why a 1010 clock, whose energy is a single line at f_s/2, is the
 * wrong pattern for finding a bandwidth problem.
 *
 * Second, that an FFT is a measurement with its own error budget. The window is
 * not a cosmetic choice: a rectangular window on a record that is not an exact
 * number of periods smears a single tone across the whole span, and the reader
 * can watch the noise floor of this plot move by tens of dB without the signal
 * changing at all.
 *
 * At the bench: this is the difference between a scope's FFT and a spectrum
 * analyser. The scope computes a DFT of a finite captured record, so its
 * resolution bandwidth is set by the capture length and its dynamic range by the
 * ADC and the window. A swept analyser tunes a real filter and will show a floor
 * tens of dB lower. Neither is lying; they are measuring differently.
 */

import { magnitude, nextPow2, rfft } from '../fft';
import {
  applyWindow,
  coherentGain,
  makeWindow,
  noisePowerBandwidth,
  WINDOW_INFO,
  type WindowInfo,
  type WindowName,
} from '../window';
import { toDb } from '../filters';
import { nyquist } from '../../state/scenario';
import { buffersOf, phaseProgress, PROGRESS_TOTAL, type JobDefinition, type JobInput } from './types';
import { waveformJob, type WaveformParams } from './waveform-job';

export interface SpectrumParams {
  /** Which transmitted waveform to transform. */
  source: 'ideal' | 'shaped';
  /** Unit intervals to capture. A longer record gives a finer resolution bandwidth. */
  uis: number;
  /** Kaiser beta, or Tukey taper fraction. Ignored by the other windows. */
  windowParam: number;
  /** Shift the display so the largest bin sits at 0 dB. */
  normalize: boolean;
  /**
   * A signal to transform instead of generating one. Present so a module can show
   * the spectrum of something it already has on screen, rather than of a second
   * separately generated stream that would not match it sample for sample.
   */
  signal?: Float64Array;
  /** Sample rate of `signal`. Required whenever `signal` is given. */
  sampleRate?: number;
}

export interface SpectrumResult {
  /** Bin frequencies, Hz, DC through Nyquist of the sample rate. */
  freqs: Float64Array;
  /** Magnitude in dB, amplitude-corrected for the window's coherent gain. */
  magDb: Float64Array;
  /** Sample rate of the transformed record, samples per second. */
  sampleRate: number;
  /** Transform length after zero padding. */
  fftSize: number;
  /** Resolution bandwidth, Hz: sampleRate / fftSize. */
  resolutionBandwidth: number;
  /** Equivalent noise bandwidth of the window, Hz. */
  enbw: number;
  /** Window used, and what it costs. */
  window: WindowName;
  windowInfo: WindowInfo;
  /** Largest bin, and where it is. */
  peakDb: number;
  peakFrequency: number;
  /** Level at the Nyquist frequency of the data, f_s/2, dB. */
  levelAtNyquist: number;
  /** Frequencies where a stream of held symbols has a spectral null, Hz. */
  nullFrequencies: Float64Array;
  /** Fraction of the total power below the symbol rate: the first sinc lobe. */
  powerInFirstLobe: number;
}

/** Nearest bin index to a frequency. */
function binAt(freqs: Float64Array, f: number): number {
  if (freqs.length === 0) return 0;
  const df = freqs.length > 1 ? freqs[1] - freqs[0] : 1;
  return Math.max(0, Math.min(freqs.length - 1, Math.round(f / df)));
}

export const spectrumJob: JobDefinition<SpectrumParams, SpectrumResult> = {
  kind: 'spectrum',

  defaults: { source: 'shaped', uis: 512, windowParam: 8.6, normalize: true },

  run({ scenario, params }: JobInput<SpectrumParams>, report): SpectrumResult {
    let x: Float64Array;
    let sampleRate: number;

    if (params.signal && params.sampleRate) {
      x = Float64Array.from(params.signal);
      sampleRate = params.sampleRate;
    } else {
      const wfParams: WaveformParams = { uis: params.uis, shapeEdges: params.source === 'shaped' };
      // Generating the record is the first 40% of this job, not a job of its own
      // with its own bar. See `phaseProgress`.
      const wf = waveformJob.run({ scenario, params: wfParams }, phaseProgress(report, 0, 40));
      x = params.source === 'shaped' ? wf.shaped : wf.ideal;
      sampleRate = wf.sampleRate;
    }

    const n = x.length;
    report?.({ done: 45, total: PROGRESS_TOTAL, label: 'Windowing' });

    // The mean is removed first. A stream with a DC offset puts a large line at
    // bin 0 whose window leakage sits on top of the low-frequency content, and the
    // reader would read that skirt as signal. Scopes offer the same switch.
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i];
    mean = n > 0 ? mean / n : 0;
    const rec = new Float64Array(n);
    for (let i = 0; i < n; i++) rec[i] = x[i] - mean;

    const windowName = scenario.scope.fftWindow as WindowName;
    const w = makeWindow(windowName, n, params.windowParam);
    applyWindow(rec, w);

    const gain = coherentGain(w);
    const enbwBins = noisePowerBandwidth(w);

    report?.({ done: 55, total: PROGRESS_TOTAL, label: 'Transforming' });

    const N = nextPow2(n);
    const padded = new Float64Array(N);
    padded.set(rec);
    const mag = magnitude(rfft(padded));

    const half = mag.length;
    const freqs = new Float64Array(half);
    const magDb = new Float64Array(half);
    const df = sampleRate / N;

    // Single-sided amplitude: 2/n for every bin except DC and Nyquist, which are
    // not mirrored, then divided by the window's coherent gain so a tone reads at
    // its true amplitude rather than at the amplitude the window let through.
    const scale = 2 / (n * Math.max(gain, Number.MIN_VALUE));
    let peakDb = -Infinity;
    let peakFrequency = 0;
    const tick = phaseProgress(report, 70, PROGRESS_TOTAL);
    const every = Math.max(1, Math.floor(half / 20));
    for (let k = 0; k < half; k++) {
      freqs[k] = k * df;
      const edge = k === 0 || k === half - 1;
      const amp = mag[k] * scale * (edge ? 0.5 : 1);
      magDb[k] = toDb(amp);
      if (magDb[k] > peakDb) {
        peakDb = magDb[k];
        peakFrequency = freqs[k];
      }
      if (k % every === 0 || k === half - 1) {
        tick?.({ done: k + 1, total: half, label: 'Scaling bins' });
      }
    }

    if (params.normalize && Number.isFinite(peakDb)) {
      for (let k = 0; k < half; k++) magDb[k] -= peakDb;
    }

    // Nulls of a symbol held for one UI: sin(pi f T)/(pi f T) vanishes at every
    // nonzero multiple of the symbol rate. They are a property of the pulse shape,
    // not of this particular bit sequence, so they are computed rather than found.
    const fs = scenario.source.symbolRate;
    const nulls: number[] = [];
    for (let m = 1; m * fs <= sampleRate / 2; m++) nulls.push(m * fs);

    let totalPower = 0;
    let lobePower = 0;
    const lobeEnd = binAt(freqs, fs);
    for (let k = 0; k < half; k++) {
      const p = mag[k] * mag[k];
      totalPower += p;
      if (k <= lobeEnd) lobePower += p;
    }

    return {
      freqs,
      magDb,
      sampleRate,
      fftSize: N,
      resolutionBandwidth: df,
      enbw: enbwBins * df,
      window: windowName,
      windowInfo: WINDOW_INFO[windowName],
      peakDb: params.normalize ? 0 : peakDb,
      peakFrequency,
      levelAtNyquist: magDb[binAt(freqs, nyquist(scenario))],
      nullFrequencies: Float64Array.from(nulls),
      powerInFirstLobe: totalPower > 0 ? lobePower / totalPower : 0,
    };
  },

  transferables(r) {
    return buffersOf(r.freqs, r.magDb, r.nullFrequencies);
  },
};
