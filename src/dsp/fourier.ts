/**
 * Fourier series synthesis of periodic waveforms, and the Gibbs phenomenon.
 *
 * This is the engine behind M1, but it lives in the DSP layer because the same
 * partial-sum machinery is reused later: truncating a Fourier series to N
 * harmonics and low-pass filtering a square wave at the Nth harmonic are the same
 * operation, and M1 makes that equivalence its central point.
 *
 * Gibbs constant, stated exactly because the commonly quoted figures disagree:
 *
 *   lim_{N->inf} max S_N(x)  =  (2/pi) * Si(pi)  =  1.1789797444...
 *
 * for a square wave of amplitude 1 (jump discontinuity of 2). The overshoot is
 * therefore 0.1789797... in absolute terms, which is
 *
 *   17.8980% of the amplitude, or
 *    8.9490% of the jump discontinuity
 *
 * The familiar "about 9%" refers to the jump. The overshoot does not diminish as
 * N increases - it only moves closer to the discontinuity - which is the entire
 * point of the phenomenon and the reason a band-limited edge always overshoots.
 */

/** Wilbraham-Gibbs overshoot as a fraction of the jump discontinuity. */
export const GIBBS_OVERSHOOT_OF_JUMP = 0.0894898722360836;

/** Wilbraham-Gibbs overshoot as a fraction of the waveform amplitude (twice the above). */
export const GIBBS_OVERSHOOT_OF_AMPLITUDE = 0.1789797444721672;

/** Limiting peak of the partial sum for a unit-amplitude square wave. */
export const GIBBS_PEAK = 1 + GIBBS_OVERSHOOT_OF_AMPLITUDE;

/**
 * Sine integral Si(x) = integral_0^x sin(t)/t dt.
 * Series expansion for small x, asymptotic auxiliary functions for large x.
 * Present so the Gibbs constant above can be re-derived by the test suite rather
 * than trusted as a literal.
 */
export function sineIntegral(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1e-12) return x;

  if (ax <= 16) {
    // Alternating series: Si(x) = sum_{k=0}^inf (-1)^k x^(2k+1) / ((2k+1) (2k+1)!)
    let term = ax;
    let sum = ax;
    for (let k = 1; k < 200; k++) {
      const n = 2 * k + 1;
      term *= (-ax * ax) / ((n - 1) * n);
      const inc = term / n;
      sum += inc;
      if (Math.abs(inc) < 1e-17 * Math.abs(sum)) break;
    }
    return x < 0 ? -sum : sum;
  }

  // Si(x) = pi/2 - f(x) cos(x) - g(x) sin(x), with rational approximations for
  // the auxiliary functions f and g (Rowe et al. / Boost formulation).
  const y = 1 / (ax * ax);
  const f =
    (1 +
      y *
        (7.44437068161936700618e2 +
          y * (1.96396372895146869801e5 + y * (2.37750310125431834034e7 + y * 1.43073403821274636888e9)))) /
    (ax *
      (1 +
        y *
          (7.46437068161927678031e2 +
            y * (1.9786524703158395145e5 + y * (2.41535670165126845144e7 + y * 1.47478952192985464958e9)))));
  const g =
    y *
    ((1 + y * (8.1359520115168615e2 + y * (2.352391816264782e5 + y * 3.12557570795778731e7))) /
      (1 + y * (8.19595201151451564e2 + y * (2.40036752835578777e5 + y * 3.26026661647090822e7))));
  const s = Math.PI / 2 - f * Math.cos(ax) - g * Math.sin(ax);
  return x < 0 ? -s : s;
}

export type WaveShape = 'square' | 'triangle' | 'sawtooth' | 'pulse';

export interface HarmonicTerm {
  /** Harmonic number n, so frequency is n * f0. */
  n: number;
  /** Coefficient amplitude. */
  amplitude: number;
  /** Phase in radians. */
  phase: number;
}

/**
 * Harmonic content of an ideal periodic waveform of unit amplitude.
 *
 *   Square (odd harmonics only): a_n = 4/(n*pi), n = 1, 3, 5, ...
 *   Triangle (odd, alternating): a_n = 8/(n^2 pi^2), n = 1, 3, 5, ...
 *   Sawtooth (all harmonics):    a_n = 2/(n*pi), n = 1, 2, 3, ...
 *   Pulse of duty d:             a_n = (4/(n*pi)) * sin(n*pi*d), plus DC 2d-1
 *
 * All four are unit-amplitude and bipolar (+1/-1). The pulse carries a DC term
 * whenever its duty is not 50%, returned as the n = 0 entry; its harmonics are
 * phased so that, like the square wave, its rising edge sits at t = 0. At d = 0.5
 * the pulse therefore reduces term for term to the square wave.
 *
 * The square wave rolls off at 1/n, i.e. -20 dB/decade, which is why a channel
 * with a first-order roll-off can strip a recognisable edge so quickly. The
 * triangle rolls off at 1/n^2 and is correspondingly harder to distort.
 *
 * @param duty pulse duty cycle, used only by shape 'pulse'.
 */
export function harmonics(shape: WaveShape, maxN: number, duty = 0.5): HarmonicTerm[] {
  const out: HarmonicTerm[] = [];
  if (shape === 'pulse') {
    // Mean value of a bipolar pulse: +1 for a fraction d of the period, -1 for
    // the rest. Emitted as n = 0 so synthesize() adds it as a constant.
    const dc = 2 * duty - 1;
    if (Math.abs(dc) > 1e-15) out.push({ n: 0, amplitude: dc, phase: Math.PI / 2 });
  }
  for (let n = 1; n <= maxN; n++) {
    switch (shape) {
      case 'square':
        if (n % 2 === 1) out.push({ n, amplitude: 4 / (n * Math.PI), phase: 0 });
        break;
      case 'triangle':
        if (n % 2 === 1) {
          const sign = ((n - 1) / 2) % 2 === 0 ? 1 : -1;
          out.push({ n, amplitude: (sign * 8) / (n * n * Math.PI * Math.PI), phase: 0 });
        }
        break;
      case 'sawtooth':
        out.push({ n, amplitude: 2 / (n * Math.PI), phase: n % 2 === 0 ? Math.PI : 0 });
        break;
      case 'pulse': {
        // Cosine-basis coefficient (4/(n pi)) sin(n pi d) about the pulse centre,
        // shifted by half a pulse width so the rising edge lands on t = 0. In the
        // sine basis used by synthesize() that shift is a phase of pi/2 - n pi d.
        const a = (4 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
        if (Math.abs(a) > 1e-12) {
          out.push({ n, amplitude: a, phase: Math.PI / 2 - n * Math.PI * duty });
        }
        break;
      }
    }
  }
  return out;
}

/**
 * Evaluate the partial sum of a harmonic series on a uniform grid over one period.
 * Phase convention is sine-based: the waveform is odd about t = 0, so a square
 * wave rises through zero at the origin.
 */
export function synthesize(terms: readonly HarmonicTerm[], samples: number): Float64Array {
  const out = new Float64Array(samples);
  for (const t of terms) {
    const w = (2 * Math.PI * t.n) / samples;
    for (let i = 0; i < samples; i++) out[i] += t.amplitude * Math.sin(w * i + t.phase);
  }
  return out;
}

/** Each harmonic evaluated separately, for the faint per-harmonic traces in M1. */
export function synthesizeEach(terms: readonly HarmonicTerm[], samples: number): Float64Array[] {
  return terms.map((t) => {
    const y = new Float64Array(samples);
    const w = (2 * Math.PI * t.n) / samples;
    for (let i = 0; i < samples; i++) y[i] = t.amplitude * Math.sin(w * i + t.phase);
    return y;
  });
}

export interface OvershootMeasurement {
  /** Maximum value of the partial sum. */
  peak: number;
  /** Overshoot above the ideal amplitude, as a fraction of the amplitude. */
  fractionOfAmplitude: number;
  /** Overshoot as a fraction of the jump discontinuity (2x the amplitude for a square). */
  fractionOfJump: number;
  /** Sample index of the peak, so the UI can mark how it migrates toward the edge. */
  peakIndex: number;
}

/**
 * Measure the Gibbs overshoot of a synthesised partial sum.
 *
 * The peak sits at a distance of roughly one half-period of the highest harmonic
 * from the discontinuity, so as N grows it slides toward the edge while its
 * height stays put. Measuring rather than asserting is the point of M1: the
 * learner watches this number fail to converge to zero.
 *
 * @param idealAmplitude the flat-top level the series is approximating.
 */
export function measureOvershoot(y: Float64Array, idealAmplitude = 1): OvershootMeasurement {
  let peak = -Infinity;
  let peakIndex = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i] > peak) {
      peak = y[i];
      peakIndex = i;
    }
  }
  const over = peak - idealAmplitude;
  return {
    peak,
    peakIndex,
    fractionOfAmplitude: over / idealAmplitude,
    fractionOfJump: over / (2 * idealAmplitude),
  };
}

/**
 * Knee frequency: the frequency above which a digital edge has little spectral
 * content. F_knee = 0.5 / t_r, with t_r the 10-90% rise time.
 *
 * This is Johnson and Graham's definition and it is a rule of thumb about
 * *edges*, deliberately distinct from the -3 dB bandwidth of a filter. It answers
 * "how much bandwidth does this edge occupy", where BW = k/t_r answers "what
 * bandwidth do I need to reproduce this edge". They are related but not the same
 * number, and conflating them is a common source of over- or under-specified
 * channels.
 */
export function kneeFrequency(riseTime10to90: number): number {
  return 0.5 / riseTime10to90;
}

/**
 * Nyquist frequency of a serial link: half the bit rate.
 * A 1010 pattern at bit rate f_b has its fundamental here, which is why channel
 * loss is almost always quoted at this frequency.
 */
export function nyquistFrequency(bitRate: number): number {
  return bitRate / 2;
}

/**
 * The ideal waveform a harmonic series converges to, on the same grid as
 * `synthesize`.
 *
 * This is the reference the partial sum is compared against, so it has to follow
 * the same conventions: unit amplitude, bipolar, sine basis, odd about t = 0 with
 * the square wave's rising edge at the origin.
 *
 * At a jump the value returned is the midpoint of the two one-sided limits, i.e.
 * zero. That is not a cosmetic choice: Dirichlet's theorem says a Fourier series
 * converges at a jump to exactly that midpoint, so it is the only value against
 * which an error metric is meaningful. Using +1 there instead would report an
 * error of 1 at the discontinuity for every N, forever, and drown the Gibbs
 * behaviour the metric is meant to expose.
 *
 * @param duty pulse duty cycle, used only by shape 'pulse'. At 0.5 the pulse is
 *        the square wave, sample for sample.
 */
export function idealWave(shape: WaveShape, samples: number, duty = 0.5): Float64Array {
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const u = i / samples;
    switch (shape) {
      case 'square':
        out[i] = u === 0 || u === 0.5 ? 0 : u < 0.5 ? 1 : -1;
        break;
      case 'triangle':
        out[i] = u <= 0.25 ? 4 * u : u <= 0.75 ? 2 - 4 * u : 4 * u - 4;
        break;
      case 'sawtooth':
        // Ramps -1 -> +1 across the period with the jump at the half point; the
        // series sums to theta/pi on (-pi, pi).
        out[i] = u === 0.5 ? 0 : u < 0.5 ? 2 * u : 2 * u - 2;
        break;
      case 'pulse':
        out[i] = u === 0 || u === duty ? 0 : u < duty ? 1 : -1;
        break;
    }
  }
  return out;
}

/**
 * RMS difference between a partial sum and the waveform it approximates.
 *
 * Unlike the peak overshoot, which does not converge, this *does* go to zero as
 * N grows - the Gibbs lobe narrows even though it does not shorten, so it carries
 * ever less energy. Showing the two numbers side by side is what separates
 * "the series converges" (in the mean) from "the edge stops overshooting" (it
 * never does).
 */
export function rmsError(y: ArrayLike<number>, ideal: ArrayLike<number>): number {
  const n = Math.min(y.length, ideal.length);
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = y[i] - ideal[i];
    acc += d * d;
  }
  return Math.sqrt(acc / n);
}

/**
 * The coefficient magnitude of `harmonics`, read as a continuous function of
 * frequency rather than only at the integers.
 *
 * This is the *envelope* a stem plot is drawn against, and it is the same algebra
 * as §2.1 with n replaced by a real ν = f / f₀:
 *
 *   Square    4/(πν)
 *   Triangle  8/(π²ν²)
 *   Sawtooth  2/(πν)
 *   Pulse     |4·sin(πνd)/(πν)|
 *
 * At an integer ν where the series has a term, this equals that term's magnitude
 * exactly, and the test suite asserts it. Where the series has no term - the even
 * harmonics of a square wave, the nulls of a pulse - the envelope is an upper bound
 * that the harmonics touch but do not reach, which is precisely what makes it worth
 * drawing: a square wave's missing even harmonics and a 50% pulse's spectral nulls
 * are the same fact, and the envelope is where you can see that they are.
 *
 * Returns a magnitude, never a signed coefficient: the triangle's alternating sign
 * is a phase, and a phase has no place on an amplitude envelope.
 *
 * @param nu frequency as a multiple of the fundamental. Zero returns the limit of
 *        the envelope at DC, which is 0 for the shapes with no DC term and 4d for
 *        a pulse - not the DC coefficient 2d−1, which is a different quantity.
 */
export function harmonicEnvelope(shape: WaveShape, nu: number, duty = 0.5): number {
  if (!Number.isFinite(nu) || nu < 0) return NaN;
  const pi = Math.PI;
  switch (shape) {
    case 'square':
      return nu === 0 ? Infinity : 4 / (pi * nu);
    case 'triangle':
      return nu === 0 ? Infinity : 8 / (pi * pi * nu * nu);
    case 'sawtooth':
      return nu === 0 ? Infinity : 2 / (pi * nu);
    case 'pulse':
      // sin(x)/x -> 1, so the envelope is finite at DC even though 1/nu is not.
      return nu === 0 ? 4 * duty : Math.abs((4 * Math.sin(pi * nu * duty)) / (pi * nu));
  }
}

/**
 * Second-harmonic level of a rectangular pulse train, relative to its fundamental.
 *
 * From the pulse coefficients of `harmonics`, aₙ = (4/(nπ))·sin(nπd):
 *
 *   |a₂| / |a₁|  =  |(2/π)·sin(2πd)| / |(4/π)·sin(πd)|
 *                =  |2·sin(πd)·cos(πd)| / |2·sin(πd)|
 *                =  |cos(πd)|
 *
 * Exact, not a small-signal approximation, and independent of amplitude - which is
 * what makes it useful on an instrument, where the absolute level is whatever the
 * attenuator happened to be set to. A perfect 50% duty cycle puts a null on the
 * second harmonic, and every departure from 50% fills it back in.
 *
 * @param duty duty cycle as a fraction, 0 to 1.
 */
export function secondHarmonicRatio(duty: number): number {
  return Math.abs(Math.cos(Math.PI * duty));
}

/**
 * Duty cycle implied by a measured second-harmonic ratio. The inverse of
 * `secondHarmonicRatio`, and the reason that function is worth having.
 *
 * The mapping is two-to-one: a mark of d and a mark of 1 − d put the same level on
 * the second harmonic, because they are the same waveform inverted. This returns
 * the root in [0, 0.5]; the caller decides from the DC level, or from looking at
 * the trace, which of the two it has.
 *
 * Near d = 0.5 the relation linearises to |a₂/a₁| ≈ π·|d − 0.5|, so a second
 * harmonic 30 dB below the fundamental is about a 1% duty error. The exact form is
 * used here rather than that approximation, because it costs one `Math.acos`.
 *
 * @param ratio |a₂| / |a₁|, a magnitude ratio and not a dB value. Clamped to [0, 1]:
 *        a measured ratio above 1 is not a duty cycle at all, it is a sign that
 *        something other than a rectangular pulse train is being measured.
 */
export function dutyFromSecondHarmonic(ratio: number): number {
  if (!Number.isFinite(ratio)) return NaN;
  return Math.acos(Math.min(1, Math.max(0, ratio))) / Math.PI;
}
