/**
 * The glossary.
 *
 * Two rules, both enforced by tests in `__tests__/glossary.test.ts`:
 *
 *   1. Every definition is precise enough to compute with, and every quantity
 *      that has a unit carries one. A signal integrity number without a unit is
 *      a rumour.
 *   2. Every `see` target exists. Cross-links are how a reader who lands on
 *      "bathtub curve" gets to "BER" and "total jitter" without a search box.
 *
 * On numbers in here: nothing is quoted from JEDEC, from a vendor datasheet, or
 * from any standard. Where an order of magnitude is given it is a teaching aid
 * and is worded as one. Real limits come from the relevant standard (JESD79-5,
 * JESD209-5, JESD238) and from the silicon vendor.
 */

export interface GlossaryEntry {
  /** Stable kebab-case id. Used in URLs (#/glossary/eye-height) and in `see`. */
  id: string;
  term: string;
  /** Abbreviations and alternative spellings the search box should match. */
  aka?: string[];
  /** SI unit symbol, or '1' for an explicitly dimensionless quantity. */
  unit?: string;
  /** The definition. Precise enough to compute with; no hand-waving. */
  definition: string;
  /** What it means in practice, at the bench or in a validation report. */
  note?: string;
  /** Related entries, by id. */
  see?: string[];
  /** Module that introduces the term. */
  module?: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  /* ------------------------------------------------- M1: frequency content */
  {
    id: 'harmonic',
    term: 'Harmonic',
    unit: 'Hz',
    definition:
      'An integer multiple of the fundamental frequency of a periodic signal. A 50% duty-cycle square wave contains only odd harmonics, with amplitude falling as 1/n.',
    note: 'This is why a square wave needs so much more bandwidth than a sine of the same rate: the edge is built from harmonics far above the fundamental.',
    see: ['fundamental', 'fourier-series', 'knee-frequency'],
    module: 'm1',
  },
  {
    id: 'fundamental',
    term: 'Fundamental frequency',
    unit: 'Hz',
    definition:
      'The lowest frequency component of a periodic signal, equal to the reciprocal of its period. For an alternating 1010 pattern at symbol rate fs, the fundamental is fs/2.',
    see: ['harmonic', 'nyquist-frequency', 'unit-interval'],
    module: 'm1',
  },
  {
    id: 'fourier-series',
    term: 'Fourier series',
    definition:
      'The decomposition of a periodic signal into a sum of sinusoids at integer multiples of its fundamental, each with its own amplitude and phase. For a voltage waveform the coefficients are in volts.',
    note: 'The series converges in energy, not pointwise, which is exactly why the overshoot at a discontinuity never goes away.',
    see: ['harmonic', 'gibbs-phenomenon', 'dft'],
    module: 'm1',
  },
  {
    id: 'gibbs-phenomenon',
    term: 'Gibbs phenomenon',
    unit: '1',
    definition:
      'The fixed-height overshoot a truncated Fourier series produces at a jump discontinuity. As the number of terms grows the ripple narrows but its peak converges to 8.9490% of the size of the jump, not to zero.',
    note: 'Adding harmonics makes the overshoot narrower, never smaller. An overshoot that shrinks as bandwidth is added is a different effect, usually a real filter response rather than Gibbs.',
    see: ['fourier-series', 'ringing', 'brickwall-filter'],
    module: 'm1',
  },
  {
    id: 'knee-frequency',
    term: 'Knee frequency',
    aka: ['Fknee'],
    unit: 'Hz',
    definition:
      'The frequency above which a signal’s harmonic content contributes little to its edge shape, commonly estimated as 0.5 divided by the 10-90% rise time. A channel flat to the knee reproduces the edge; one that rolls off well below it does not.',
    note: 'A rule of thumb with a factor-of-two spread depending on whose rise-time definition and whose threshold you use. Good for sizing a problem, not for signing off a design.',
    see: ['rise-time', 'bandwidth', 'insertion-loss'],
    module: 'm1',
  },
  {
    id: 'dft',
    term: 'DFT / FFT',
    aka: ['Discrete Fourier transform', 'Fast Fourier transform'],
    unit: 'Hz',
    definition:
      'The discrete Fourier transform maps N time samples to N complex frequency bins spaced fs/N hertz apart. The FFT is an O(N log N) algorithm that computes it; the two are the same transform.',
    note: 'A scope’s math FFT is this, applied to a finite record, which is why the window choice matters.',
    see: ['window-function', 'spectral-leakage', 'nyquist-frequency'],
    module: 'm1',
  },
  {
    id: 'window-function',
    term: 'Window function',
    unit: '1',
    definition:
      'A dimensionless taper applied to a finite record before an FFT, trading main-lobe width against side-lobe height. Hann and Blackman-Harris suppress leakage; flat-top preserves amplitude accuracy; rectangular does neither but gives the narrowest main lobe.',
    note: 'On a scope, pick flat-top when you need the amplitude of a tone and Blackman-Harris when you need to see a small tone beside a big one.',
    see: ['spectral-leakage', 'dft'],
    module: 'm10',
  },
  {
    id: 'spectral-leakage',
    term: 'Spectral leakage',
    unit: 'dB',
    definition:
      'Energy from a tone appearing in FFT bins other than its own, caused by the tone not completing an integer number of cycles within the record. Measured as the level of the spurious bins relative to the true one, in decibels.',
    see: ['window-function', 'dft'],
    module: 'm10',
  },

  /* ------------------------------------------------------- M2: edges, time */
  {
    id: 'rise-time',
    term: 'Rise time',
    aka: ['Tr'],
    unit: 's',
    definition:
      'The time for a transition to move between two stated fractions of its final value. 10-90% and 20-80% are both in common use and are not interchangeable: for a Gaussian edge the 20-80% time is about 0.64 of the 10-90% time.',
    note: 'Always state the thresholds. A rise-time number without them cannot be compared with anything.',
    see: ['knee-frequency', 'slew-rate', 'bandwidth'],
    module: 'm2',
  },
  {
    id: 'slew-rate',
    term: 'Slew rate',
    unit: 'V/s',
    definition:
      'The rate of change of voltage on a transition, in volts per second. For a linear ramp it is the swing divided by the transition time.',
    note: 'Receiver input requirements are often written against slew rate rather than rise time, because it is the slope at the threshold that sets the timing uncertainty produced by voltage noise.',
    see: ['rise-time', 'noise-to-jitter'],
    module: 'm2',
  },
  {
    id: 'bandwidth',
    term: 'Bandwidth',
    aka: ['BW', '-3 dB bandwidth'],
    unit: 'Hz',
    definition:
      'The frequency at which a system’s response has fallen 3 dB from its low-frequency value. For a single-pole response the 10-90% rise time is 0.35/BW; for other response shapes the constant differs.',
    note: 'The 0.35 constant assumes a first-order response. A Bessel scope front end is closer to 0.4 and a brickwall closer to 0.3, which is why a scope datasheet states its own number.',
    see: ['rise-time', 'knee-frequency', 'bessel-response'],
    module: 'm2',
  },
  {
    id: 'ringing',
    term: 'Ringing',
    unit: 'V',
    definition:
      'Damped oscillation following a transition, at the resonant frequency of an underdamped network and decaying with its time constant. Amplitude is quoted as a percentage of the swing.',
    note: 'Ringing from an RLC package resonance and ringing from an unterminated stub look alike on a scope but have different periods: the first is set by sqrt(LC), the second by the round-trip delay.',
    see: ['damping-factor', 'reflection-coefficient', 'gibbs-phenomenon'],
    module: 'm2',
  },
  {
    id: 'damping-factor',
    term: 'Damping factor',
    aka: ['zeta'],
    unit: '1',
    definition:
      'Dimensionless measure of how quickly a second-order system settles. Below 1 the response overshoots and rings, at 1 it is critically damped, above 1 it is overdamped and slow.',
    note: 'A value near 0.7 gives the fastest settling to within a small error band, which is why it is the usual design target.',
    see: ['ringing', 'rlc'],
    module: 'm2',
  },
  {
    id: 'rlc',
    term: 'RLC network',
    definition:
      'A lumped model of a package, via or connector as series resistance in ohms and inductance in henries with shunt capacitance in farads. Valid while the structure is short compared with the shortest wavelength of interest.',
    note: 'Once the structure exceeds roughly a tenth of that wavelength it needs a transmission line model instead.',
    see: ['damping-factor', 'transmission-line', 'electrical-length'],
    module: 'm2',
  },
  {
    id: 'bessel-response',
    term: 'Bessel response',
    definition:
      'A filter response with maximally flat group delay, so every frequency is delayed equally and pulse shape is preserved, at the cost of a gentler amplitude roll-off.',
    note: 'Most real-time oscilloscopes above a few gigahertz use a Bessel-Thomson front end precisely because it does not add overshoot to an edge that had none.',
    see: ['group-delay', 'brickwall-filter', 'bandwidth'],
    module: 'm10',
  },
  {
    id: 'brickwall-filter',
    term: 'Brickwall filter',
    definition:
      'An idealised filter passing everything below a cutoff unchanged and removing everything above it. Its impulse response is a sinc of infinite extent, so it is non-causal and cannot be built.',
    note: 'Useful as a teaching limit and as a model of what a truncated Fourier series does. Its step response overshoots by the Gibbs amount.',
    see: ['gibbs-phenomenon', 'bessel-response'],
    module: 'm2',
  },
  {
    id: 'group-delay',
    term: 'Group delay',
    unit: 's',
    definition:
      'The negative derivative of phase with respect to angular frequency, in seconds. Constant group delay means every frequency component arrives together and the waveform shape survives.',
    note: 'Group delay variation across the band is what smears a clean edge even when the amplitude response looks acceptable.',
    see: ['bessel-response', 'dispersion', 'phase-response'],
    module: 'm4',
  },
  {
    id: 'phase-response',
    term: 'Phase response',
    unit: 'rad',
    definition:
      'The phase shift a system applies as a function of frequency, in radians. A phase response linear in frequency is equivalent to a pure time delay.',
    see: ['group-delay', 'hilbert-transform'],
    module: 'm4',
  },

  /* ------------------------------------------- M3: transmission lines, TDR */
  {
    id: 'transmission-line',
    term: 'Transmission line',
    definition:
      'A conductor pair modelled by distributed series resistance and inductance and shunt conductance and capacitance per unit length, supporting a wave that takes finite time to propagate.',
    note: 'The practical trigger for using this model is electrical length: if the round trip takes an appreciable fraction of the edge rise time, reflections are visible in the waveform.',
    see: ['characteristic-impedance', 'electrical-length', 'rlgc'],
    module: 'm3',
  },
  {
    id: 'characteristic-impedance',
    term: 'Characteristic impedance',
    aka: ['Z0'],
    unit: 'ohm',
    definition:
      'The ratio of voltage to current of a single travelling wave on a line, equal to sqrt((R + jwL)/(G + jwC)), and to sqrt(L/C) in the lossless limit. It is a property of the cross-section, not of the length.',
    note: 'A 50 ohm line is 50 ohms whether it is one millimetre or one metre long. Measuring it in the time domain, though, needs the line long enough to separate incident from reflected wave.',
    see: ['reflection-coefficient', 'tdr', 'transmission-line'],
    module: 'm3',
  },
  {
    id: 'reflection-coefficient',
    term: 'Reflection coefficient',
    aka: ['Gamma'],
    unit: '1',
    definition:
      'The dimensionless ratio of reflected to incident wave amplitude at a discontinuity, (ZL - Z0)/(ZL + Z0). It is +1 at an open, -1 at a short and 0 at a matched load.',
    note: 'The sign is the diagnostic. A step that rises at the reflection means higher impedance ahead; one that dips means lower.',
    see: ['characteristic-impedance', 'tdr', 'termination'],
    module: 'm3',
  },
  {
    id: 'electrical-length',
    term: 'Electrical length',
    unit: 's',
    definition:
      'The one-way propagation time along a structure: physical length divided by propagation velocity, where velocity is c divided by the square root of the effective relative permittivity.',
    note: 'Stripline in FR-4 propagates at roughly half the speed of light, about 6 to 7 picoseconds per millimetre. That number is worth memorising.',
    see: ['transmission-line', 'permittivity', 'skew'],
    module: 'm3',
  },
  {
    id: 'tdr',
    term: 'TDR',
    aka: ['Time-domain reflectometry'],
    unit: 'ohm',
    definition:
      'Launching a fast step into a network and reading reflected voltage against time, converting each reflection to an impedance through the reflection coefficient. The horizontal axis is round-trip time, so a feature at time t sits at electrical distance t/2.',
    note: 'TDR spatial resolution is set by the step rise time, not by the sample rate. A 30 ps step cannot resolve two discontinuities 5 ps apart however finely you sample.',
    see: ['reflection-coefficient', 'characteristic-impedance', 's-parameters'],
    module: 'm3',
  },
  {
    id: 'termination',
    term: 'Termination',
    unit: 'ohm',
    definition:
      'A resistance placed to absorb the travelling wave. Series (source) termination sets driver output impedance equal to Z0 and absorbs the returning reflection; parallel (end) termination places Z0 at the far end so nothing reflects.',
    note: 'Series termination halves the launched amplitude and relies on full reflection from the open far end to restore it, so it works only with a single load at the end of the line.',
    see: ['reflection-coefficient', 'characteristic-impedance', 'odt'],
    module: 'm3',
  },
  {
    id: 'odt',
    term: 'ODT',
    aka: ['On-die termination'],
    unit: 'ohm',
    definition:
      'Termination resistance integrated on the silicon die and switchable by register setting, so it can be applied only at the receiving end of a bidirectional bus and only while that end is receiving.',
    note: 'On a memory bus the ODT setting is a trained parameter, and sweeping it against another parameter is a standard shmoo axis.',
    see: ['termination', 'shmoo', 'memory-training'],
    module: 'm8',
  },
  {
    id: 'stub',
    term: 'Stub',
    definition:
      'A branch off the signal path that is not terminated, such as the unused barrel of a plated through-hole below the layer the signal exits on. It reflects energy back and creates a resonant null where it is a quarter wavelength long.',
    note: 'Back-drilling removes the unused barrel to push that resonance above the band of interest.',
    see: ['reflection-coefficient', 'via', 'resonance'],
    module: 'm3',
  },
  {
    id: 'via',
    term: 'Via',
    definition:
      'A vertical interconnect between layers, modelled at high frequency as shunt capacitance from the pad and antipad together with the series inductance of the barrel, plus any stub.',
    see: ['stub', 'rlc', 'insertion-loss'],
    module: 'm4',
  },
  {
    id: 'resonance',
    term: 'Resonance',
    unit: 'Hz',
    definition:
      'A frequency at which a structure’s stored electric and magnetic energy exchange, producing a peak or a null in the response. In a PDN it is a peak in impedance; in a stub it is a null in insertion loss.',
    see: ['stub', 'pdn', 'anti-resonance'],
    module: 'm6',
  },

  /* ------------------------------------------------- M4: loss, S-parameters */
  {
    id: 'skin-effect',
    term: 'Skin effect',
    unit: 'm',
    definition:
      'Confinement of high-frequency current to a thin layer at the conductor surface, of depth sqrt(2/(w*mu*sigma)) metres. Because the effective cross-section shrinks with the square root of frequency, resistance and hence loss rise as sqrt(f).',
    note: 'Skin-effect loss and dielectric loss have different frequency slopes, which is how an insertion-loss curve can be decomposed into the two.',
    see: ['dielectric-loss', 'insertion-loss', 'roughness'],
    module: 'm4',
  },
  {
    id: 'dielectric-loss',
    term: 'Dielectric loss',
    unit: 'dB',
    definition:
      'Energy absorbed by the insulating material, proportional to frequency, to the loss tangent and to the square root of the relative permittivity. Loss in decibels therefore rises linearly with frequency.',
    note: 'Above a few gigahertz on a long FR-4 trace, dielectric loss dominates skin effect. That is the argument for a low-loss laminate rather than thicker copper.',
    see: ['loss-tangent', 'permittivity', 'skin-effect'],
    module: 'm4',
  },
  {
    id: 'loss-tangent',
    term: 'Loss tangent',
    aka: ['tan delta', 'Df'],
    unit: '1',
    definition:
      'The dimensionless ratio of imaginary to real part of a material’s complex permittivity, quoted at a stated frequency. It is the fraction of energy the dielectric absorbs per radian of phase.',
    note: 'Always paired with the frequency it was measured at. Both it and the permittivity drift with frequency, and a Djordjevic-Sarkar model is the usual causal interpolation.',
    see: ['dielectric-loss', 'permittivity'],
    module: 'm4',
  },
  {
    id: 'permittivity',
    term: 'Relative permittivity',
    aka: ['Dk', 'er', 'dielectric constant'],
    unit: '1',
    definition:
      'The dimensionless ratio of a material’s permittivity to that of free space. It sets both the propagation velocity, as c/sqrt(er_eff), and the characteristic impedance for a given geometry.',
    note: 'The effective value for microstrip is lower than the laminate value because part of the field is in air, so microstrip is faster than stripline on the same board.',
    see: ['electrical-length', 'loss-tangent', 'characteristic-impedance'],
    module: 'm4',
  },
  {
    id: 'roughness',
    term: 'Copper roughness',
    unit: 'm',
    definition:
      'RMS surface profile of the copper foil, which lengthens the path skin-limited current must follow and so raises loss above the smooth-conductor value. The Hammerstad correction multiplies conductor loss by a factor that saturates at 2.',
    note: 'Roughness matters exactly when skin depth becomes comparable to the profile height, which for typical foils is in the low gigahertz.',
    see: ['skin-effect', 'insertion-loss'],
    module: 'm4',
  },
  {
    id: 'insertion-loss',
    term: 'Insertion loss',
    aka: ['S21', 'IL'],
    unit: 'dB',
    definition:
      'The magnitude of the transmitted wave relative to the incident one, in decibels, as a function of frequency. Conventionally quoted as a positive number of decibels of loss, equal to -20*log10(|S21|).',
    note: 'The figure of merit for a data channel is loss at the Nyquist frequency, because that is where the fundamental of the fastest pattern sits.',
    see: ['s-parameters', 'return-loss', 'nyquist-frequency'],
    module: 'm4',
  },
  {
    id: 'return-loss',
    term: 'Return loss',
    aka: ['S11', 'RL'],
    unit: 'dB',
    definition:
      'The magnitude of the reflected wave relative to the incident one, in decibels. Large return loss means little reflection, so bigger numbers are better.',
    note: 'Poor return loss with good insertion loss points at an impedance discontinuity rather than at material loss.',
    see: ['s-parameters', 'reflection-coefficient', 'insertion-loss'],
    module: 'm4',
  },
  {
    id: 's-parameters',
    term: 'S-parameters',
    definition:
      'A matrix describing a network by ratios of outgoing to incoming travelling waves at each port, defined against a stated reference impedance. Sij is the wave out of port i for a wave into port j.',
    note: 'Reference impedance is part of the data. Renormalising a 50 ohm file to 100 ohms differential changes every number in it.',
    see: ['touchstone', 'insertion-loss', 'mixed-mode'],
    module: 'm4',
  },
  {
    id: 'touchstone',
    term: 'Touchstone file',
    aka: ['.s2p', '.s4p', 'SnP'],
    definition:
      'A text format for S-parameters: an option line giving frequency unit, parameter type, data format and reference impedance, followed by one block per frequency point. The .sNp extension states the port count.',
    note: 'Check the option line before trusting a file. Magnitude-angle, decibel-angle and real-imaginary are all legal and none of them is identifiable from the numbers alone.',
    see: ['s-parameters', 'mixed-mode'],
    module: 'm4',
  },
  {
    id: 'mixed-mode',
    term: 'Mixed-mode S-parameters',
    aka: ['Sdd21', 'Scd21'],
    definition:
      'A change of basis from single-ended to differential and common modes. Sdd21 is differential insertion loss; Scd21 is mode conversion, differential in and common out.',
    note: 'Nonzero mode conversion means the pair is unbalanced, usually from length mismatch within the pair, and it turns into radiated emission and common-mode noise at the receiver.',
    see: ['s-parameters', 'skew', 'differential-signaling'],
    module: 'm4',
  },
  {
    id: 'dispersion',
    term: 'Dispersion',
    definition:
      'Frequency dependence of propagation velocity, so different spectral components of an edge arrive at different times and the edge spreads.',
    see: ['group-delay', 'dielectric-loss'],
    module: 'm4',
  },
  {
    id: 'rlgc',
    term: 'RLGC',
    definition:
      'The per-unit-length parameters of a transmission line: series resistance in ohms/m, series inductance in H/m, shunt conductance in S/m and shunt capacitance in F/m, each generally frequency dependent.',
    note: 'The chain is RLGC to an ABCD matrix for a length of line, cascaded through discontinuities, then converted to S-parameters.',
    see: ['transmission-line', 's-parameters', 'characteristic-impedance'],
    module: 'm4',
  },

  /* ------------------------------------------------ M5: eye, ISI and jitter */
  {
    id: 'unit-interval',
    term: 'Unit interval',
    aka: ['UI'],
    unit: 's',
    definition:
      'The nominal time allotted to one transmitted symbol, the reciprocal of the symbol rate. Timing quantities are normally expressed as a fraction of it so they compare across data rates.',
    note: 'For PAM4 one unit interval carries two bits, so the UI and the bit period are no longer the same thing.',
    see: ['symbol-rate', 'baud-rate', 'pam4'],
    module: 'm5',
  },
  {
    id: 'symbol-rate',
    term: 'Symbol rate',
    aka: ['Baud rate', 'Bd'],
    unit: 'Bd',
    definition:
      'Symbols transmitted per second, the reciprocal of the unit interval. Bit rate equals symbol rate times bits per symbol: equal for NRZ, twice for PAM4.',
    see: ['unit-interval', 'baud-rate', 'nyquist-frequency'],
    module: 'm5',
  },
  {
    id: 'baud-rate',
    term: 'Baud rate',
    unit: 'Bd',
    definition:
      'Another name for symbol rate: symbols per second, independent of how many bits each symbol carries.',
    see: ['symbol-rate', 'unit-interval'],
    module: 'm5',
  },
  {
    id: 'nyquist-frequency',
    term: 'Nyquist frequency',
    unit: 'Hz',
    definition:
      'Half the symbol rate: the fundamental of the fastest alternating pattern a link can send. Separately, in sampling theory, half the sample rate, the highest frequency a sampled record can represent unambiguously.',
    note: 'Both senses appear in this course and they are different numbers. Channel loss is quoted at the data Nyquist; scope aliasing is about the sampling Nyquist.',
    see: ['symbol-rate', 'aliasing', 'insertion-loss'],
    module: 'm5',
  },
  {
    id: 'isi',
    term: 'ISI',
    aka: ['Intersymbol interference'],
    unit: 'V',
    definition:
      'The contribution of previously and subsequently transmitted symbols to the voltage at the current sampling instant, caused by a channel impulse response longer than one unit interval. Measured in volts of eye closure.',
    note: 'ISI is deterministic and pattern dependent, which is what makes it correctable by equalization and what makes constructing a worst-case pattern worthwhile.',
    see: ['pulse-response', 'cursor-taps', 'ffe', 'dfe'],
    module: 'm5',
  },
  {
    id: 'pulse-response',
    term: 'Single-bit response',
    aka: ['Pulse response', 'SBR'],
    unit: 'V',
    definition:
      'The channel output for a single isolated symbol. Sampled at unit-interval spacing it gives the cursor taps: the main cursor and the pre- and post-cursor ISI.',
    note: 'The single-bit response is the whole ISI story. Everything a linear equalizer can do is a re-weighting of its samples.',
    see: ['isi', 'cursor-taps', 'impulse-response'],
    module: 'm5',
  },
  {
    id: 'impulse-response',
    term: 'Impulse response',
    definition:
      'The output of a linear time-invariant system for a unit impulse input. Convolving it with any input gives the output; its Fourier transform is the transfer function.',
    see: ['pulse-response', 'convolution', 'transfer-function'],
    module: 'm2',
  },
  {
    id: 'convolution',
    term: 'Convolution',
    definition:
      'The operation producing a linear system’s output from its input and impulse response, integrating the product of one with a time-reversed, shifted copy of the other. It becomes multiplication in the frequency domain.',
    see: ['impulse-response', 'transfer-function', 'dft'],
    module: 'm2',
  },
  {
    id: 'transfer-function',
    term: 'Transfer function',
    definition:
      'The complex ratio of output to input as a function of frequency, carrying both magnitude and phase. For a channel it is S21 renormalised to the actual source and load impedances.',
    see: ['impulse-response', 's-parameters', 'group-delay'],
    module: 'm4',
  },
  {
    id: 'cursor-taps',
    term: 'Pre-cursor and post-cursor',
    unit: 'V',
    definition:
      'Samples of the single-bit response one or more unit intervals before and after the main cursor. Pre-cursor ISI comes from a symbol not yet decided; post-cursor ISI from symbols already decided.',
    note: 'That asymmetry is why a DFE can cancel post-cursor ISI exactly but cannot touch pre-cursor ISI, which needs an FFE.',
    see: ['isi', 'ffe', 'dfe', 'pulse-response'],
    module: 'm7',
  },
  {
    id: 'eye-diagram',
    term: 'Eye diagram',
    definition:
      'A record folded into overlapping windows one or two unit intervals wide and accumulated as a density, so every transition is superimposed. The clear region in the centre is the eye opening.',
    note: 'A pattern whose period equals the fold window produces no overlay at all: every trace lands on itself. If an eye looks impossibly clean, check the pattern against the fold width first.',
    see: ['eye-height', 'eye-width', 'persistence', 'isi'],
    module: 'm5',
  },
  {
    id: 'eye-height',
    term: 'Eye height',
    unit: 'V',
    definition:
      'The vertical opening of the eye at the sampling instant: the gap in volts between the lowest high-level trace and the highest low-level trace. Always stated with the BER at which it was measured, since a deeper population closes it further.',
    note: 'Eye height at 1e-12 from a statistical engine and eye height from twenty thousand simulated bits are different measurements, and the difference between them is the point.',
    see: ['eye-diagram', 'eye-width', 'ber', 'bathtub-curve'],
    module: 'm5',
  },
  {
    id: 'eye-width',
    term: 'Eye width',
    unit: 's',
    definition:
      'The horizontal opening of the eye at the decision threshold, measured between the latest early crossing and the earliest late crossing, usually expressed as a fraction of a unit interval.',
    note: 'Eye width at the threshold measures crossing spread, which is jitter. A slow but perfectly repeatable edge closes the eye vertically and leaves the width at a full UI.',
    see: ['eye-diagram', 'eye-height', 'total-jitter'],
    module: 'm5',
  },
  {
    id: 'eye-mask',
    term: 'Eye mask',
    definition:
      'A forbidden polygon placed in the eye; any trace entering it is a violation. The mask encodes the minimum voltage and timing the receiver requires.',
    note: 'Mask limits come from the interface specification. Any mask drawn in this course is illustrative and is labelled as such.',
    see: ['eye-diagram', 'eye-height', 'setup-time'],
    module: 'm5',
  },
  {
    id: 'persistence',
    term: 'Persistence',
    unit: 's',
    definition:
      'How long an acquired trace stays on the display before fading. Infinite persistence accumulates every acquisition, which is how rare outliers become visible; a finite decay shows recent behaviour only.',
    note: 'Infinite persistence plus a long run is the bench equivalent of a deep eye measurement, and it is how you catch an intermittent that a single acquisition misses.',
    see: ['eye-diagram', 'colour-grading'],
    module: 'm10',
  },
  {
    id: 'colour-grading',
    term: 'Colour grading',
    definition:
      'Mapping the hit count of each display bin to a colour, so density rather than mere presence is visible. A logarithmic mapping keeps the rare outer skirts visible next to the dense rails.',
    note: 'The outer skirts are what set the BER, and on a linear colour scale they are invisible against the bright centre.',
    see: ['eye-diagram', 'persistence', 'ber'],
    module: 'm5',
  },
  {
    id: 'jitter',
    term: 'Jitter',
    unit: 's',
    definition:
      'Deviation of a signal transition from its ideal position in time. Decomposed into a random component described by a standard deviation and bounded deterministic components described by a peak-to-peak value.',
    see: ['random-jitter', 'deterministic-jitter', 'total-jitter', 'eye-width'],
    module: 'm5',
  },
  {
    id: 'random-jitter',
    term: 'Random jitter',
    aka: ['RJ'],
    unit: 's',
    definition:
      'The unbounded, Gaussian-distributed component of jitter, arising from thermal and shot noise. Quoted as an RMS value, because its peak-to-peak value depends entirely on how long you look.',
    note: 'Any peak-to-peak number for RJ is meaningless without the BER it was extrapolated to.',
    see: ['deterministic-jitter', 'total-jitter', 'dual-dirac', 'ber'],
    module: 'm5',
  },
  {
    id: 'deterministic-jitter',
    term: 'Deterministic jitter',
    aka: ['DJ'],
    unit: 's',
    definition:
      'The bounded component of jitter, quoted peak to peak. It includes data-dependent jitter from ISI, duty-cycle distortion, periodic jitter from a coupled tone, and bounded uncorrelated jitter from crosstalk.',
    see: ['random-jitter', 'ddj', 'dcd', 'periodic-jitter', 'total-jitter'],
    module: 'm5',
  },
  {
    id: 'ddj',
    term: 'Data-dependent jitter',
    aka: ['DDJ'],
    unit: 's',
    definition:
      'The part of deterministic jitter that correlates with the transmitted pattern, produced by ISI moving the threshold crossing earlier or later depending on preceding symbols.',
    note: 'It is fully repeatable: send the same pattern and you get the same edge positions. That repeatability is how it is separated from random jitter.',
    see: ['isi', 'deterministic-jitter', 'pattern'],
    module: 'm5',
  },
  {
    id: 'dcd',
    term: 'Duty-cycle distortion',
    aka: ['DCD'],
    unit: 's',
    definition:
      'Jitter from rising and falling edges being displaced in opposite directions, so alternate unit intervals are long and short. Caused by threshold offset or by unequal rise and fall times.',
    note: 'On an eye it shows as two distinct crossing points rather than one. On a clock it shows as a duty cycle away from 50%.',
    see: ['deterministic-jitter', 'rise-time', 'threshold'],
    module: 'm5',
  },
  {
    id: 'periodic-jitter',
    term: 'Periodic jitter',
    aka: ['PJ'],
    unit: 's',
    definition:
      'Jitter repeating at a rate uncorrelated with the data, typically coupled from a switching supply or a nearby clock. Quoted as an amplitude and a frequency; its distribution is the arcsine shape of a sinusoid.',
    note: 'The frequency is the clue. Match it against known aggressors: a switching regulator, a reference clock, a spread-spectrum profile.',
    see: ['deterministic-jitter', 'pdn', 'crosstalk'],
    module: 'm6',
  },
  {
    id: 'total-jitter',
    term: 'Total jitter',
    aka: ['TJ'],
    unit: 's',
    definition:
      'The peak-to-peak jitter that will not be exceeded at a specified bit error ratio, conventionally estimated as DJ plus a BER-dependent multiple of the RJ standard deviation.',
    note: 'Total jitter without a stated BER is not a number. TJ at 1e-12 and TJ at 1e-6 differ by several sigma of RJ.',
    see: ['random-jitter', 'deterministic-jitter', 'dual-dirac', 'ber'],
    module: 'm5',
  },
  {
    id: 'dual-dirac',
    term: 'Dual-Dirac model',
    unit: 's',
    definition:
      'A jitter model in which the deterministic part is idealised as two impulses separated by the DJ peak-to-peak value, each convolved with the Gaussian random part. Total jitter at a BER is then DJ plus n(BER) times the RJ sigma.',
    note: 'The model is a fitting convenience, not physics. It is accurate when the deterministic distribution really is bimodal, and optimistic or pessimistic when it is not.',
    see: ['total-jitter', 'random-jitter', 'bathtub-curve'],
    module: 'm5',
  },
  {
    id: 'bathtub-curve',
    term: 'Bathtub curve',
    definition:
      'Bit error ratio plotted against sampling position across the unit interval, on a logarithmic vertical axis. It falls steeply from each crossing, flattens in the eye opening, and its width at a chosen BER is the timing margin.',
    note: 'The straight-line region on a log axis is the Gaussian tail. Extrapolating that line is how a 1e-12 number is obtained from a measurement that never reached 1e-12.',
    see: ['ber', 'total-jitter', 'eye-width', 'q-factor'],
    module: 'm5',
  },
  {
    id: 'ber',
    term: 'Bit error ratio',
    aka: ['BER'],
    unit: '1',
    definition:
      'Errored bits divided by transmitted bits, a dimensionless ratio. A ratio of 1e-12 means one error in a million million bits.',
    note: 'Confirming 1e-12 by counting takes of order a trillion bits. Measurements reach around 1e-9 and the rest is extrapolation through a model, which is why the model matters.',
    see: ['bathtub-curve', 'q-factor', 'total-jitter'],
    module: 'm5',
  },
  {
    id: 'q-factor',
    term: 'Q factor',
    unit: '1',
    definition:
      'The separation between the two signal levels divided by the sum of their noise standard deviations. For Gaussian noise the bit error ratio is 0.5*erfc(Q/sqrt(2)).',
    note: 'Q of 7 corresponds to roughly 1e-12. That single pairing converts a voltage margin into a BER on the spot.',
    see: ['ber', 'bathtub-curve', 'noise'],
    module: 'm5',
  },
  {
    id: 'prbs',
    term: 'PRBS',
    aka: ['Pseudo-random bit sequence'],
    definition:
      'A deterministic maximal-length sequence from a linear feedback shift register of order n, repeating every 2^n - 1 bits and containing every n-bit combination except all zeros exactly once per period.',
    note: 'The order sets the longest run and hence the low-frequency content. A PRBS7 will not exercise a channel’s low-frequency behaviour the way a PRBS31 does.',
    see: ['pattern', 'isi', 'ddj'],
    module: 'm1',
  },
  {
    id: 'pattern',
    term: 'Test pattern',
    definition:
      'The symbol sequence chosen to stress a particular behaviour: PRBS for broadband content, a clock pattern for the Nyquist tone, a lone one for the isolated pulse response, a worst-case sequence to maximise ISI.',
    note: 'A pattern that does not stress the failure mechanism will pass a link that is broken. Pattern selection is a deliberate part of a validation plan.',
    see: ['prbs', 'isi', 'eye-diagram'],
    module: 'm1',
  },

  /* ------------------------------------------- M6: crosstalk, noise, power */
  {
    id: 'crosstalk',
    term: 'Crosstalk',
    unit: 'V',
    definition:
      'Energy coupled from an aggressor net to a victim net through mutual inductance and mutual capacitance. Split into near-end (reverse-travelling) and far-end (forward-travelling) contributions.',
    see: ['next', 'fext', 'coupling-coefficient'],
    module: 'm6',
  },
  {
    id: 'next',
    term: 'NEXT',
    aka: ['Near-end crosstalk'],
    unit: 'V',
    definition:
      'Crosstalk travelling back towards the aggressor’s driver. Its amplitude is the backward coupling coefficient times the aggressor swing, and it saturates once the coupled length exceeds half the spatial extent of the edge.',
    note: 'NEXT looks like a wide flat-topped pulse rather than a spike, because it is the integral of the aggressor edge over the coupled length.',
    see: ['crosstalk', 'fext', 'coupling-coefficient'],
    module: 'm6',
  },
  {
    id: 'fext',
    term: 'FEXT',
    aka: ['Far-end crosstalk'],
    unit: 'V',
    definition:
      'Crosstalk travelling with the aggressor towards the far end. Its shape is the derivative of the aggressor edge and its amplitude grows with coupled length, so it does not saturate.',
    note: 'FEXT worsens with faster edges and longer parallel runs, and it vanishes in a homogeneous medium where inductive and capacitive coupling cancel, which is why stripline FEXT is far smaller than microstrip FEXT.',
    see: ['crosstalk', 'next', 'coupling-coefficient'],
    module: 'm6',
  },
  {
    id: 'coupling-coefficient',
    term: 'Coupling coefficient',
    definition:
      'The pair of constants describing coupling strength: backward coupling Kb, dimensionless, and forward coupling Kf, in seconds per metre. Both derive from the mutual and self inductance and capacitance of the line pair.',
    see: ['next', 'fext', 'crosstalk'],
    module: 'm6',
  },
  {
    id: 'ssn',
    term: 'SSN',
    aka: ['Simultaneous switching noise', 'Ground bounce', 'SSO'],
    unit: 'V',
    definition:
      'Voltage developed across shared return-path inductance when many outputs switch together, equal to L times the sum of their dI/dt. It appears as a shift of the local ground or supply reference.',
    note: 'It is pattern dependent and worst when every bit switches the same way at once, which is why an all-ones-to-all-zeros transition is a standard SSO stress.',
    see: ['pdn', 'crosstalk', 'return-path'],
    module: 'm6',
  },
  {
    id: 'return-path',
    term: 'Return path',
    definition:
      'The conductor carrying current back from the load to the source. At high frequency it follows the path of least inductance, directly under the signal trace, not the path of least resistance.',
    note: 'A split in the reference plane under a trace forces the return current to detour, adding inductance, generating SSN and radiating. Most mystery crosstalk is a return path problem.',
    see: ['ssn', 'crosstalk', 'pdn'],
    module: 'm6',
  },
  {
    id: 'pdn',
    term: 'PDN',
    aka: ['Power delivery network'],
    unit: 'ohm',
    definition:
      'The impedance seen looking into the supply from the die, as a function of frequency. Multiplied by the transient current it gives the supply ripple.',
    note: 'A target impedance is the tolerable ripple divided by the expected transient current. The interesting feature is the anti-resonance between package inductance and on-die capacitance.',
    see: ['anti-resonance', 'ssn', 'supply-droop'],
    module: 'm6',
  },
  {
    id: 'anti-resonance',
    term: 'Anti-resonance',
    unit: 'ohm',
    definition:
      'A peak in PDN impedance where the inductance of one decoupling stage resonates with the capacitance of the next. It is the frequency at which a given transient produces the most ripple.',
    see: ['pdn', 'resonance', 'supply-droop'],
    module: 'm6',
  },
  {
    id: 'supply-droop',
    term: 'Supply droop',
    unit: 'V',
    definition:
      'A drop in supply voltage under load, which reduces driver swing and shifts the receiver threshold. Expressed as a fraction of the nominal supply or of the signal swing.',
    note: 'Droop that tracks the data pattern converts directly into data-dependent jitter, because a smaller swing crosses the threshold later.',
    see: ['pdn', 'ssn', 'ddj'],
    module: 'm6',
  },
  {
    id: 'noise',
    term: 'Noise',
    unit: 'V',
    definition:
      'Random voltage added to the signal, quoted as an RMS value. Thermal noise is white; device flicker noise rises as 1/f below a corner frequency.',
    see: ['noise-to-jitter', 'q-factor', 'random-jitter'],
    module: 'm6',
  },
  {
    id: 'noise-to-jitter',
    term: 'Noise-to-jitter conversion',
    unit: 's',
    definition:
      'Voltage noise at a threshold crossing becomes timing uncertainty equal to the noise divided by the slew rate at that instant.',
    note: 'This is the mechanism that makes a slow edge a timing problem and not only an amplitude problem.',
    see: ['noise', 'slew-rate', 'random-jitter'],
    module: 'm6',
  },

  /* -------------------------------------------------- M7: equalization, CDR */
  {
    id: 'equalization',
    term: 'Equalization',
    definition:
      'Applying the inverse of the channel response, in whole or in part, to reopen the eye. Split into transmitter pre-emphasis, receiver linear filtering and receiver decision feedback.',
    see: ['ffe', 'ctle', 'dfe', 'isi'],
    module: 'm7',
  },
  {
    id: 'ffe',
    term: 'FFE',
    aka: ['Feed-forward equalizer', 'Pre-emphasis', 'De-emphasis'],
    unit: '1',
    definition:
      'A finite impulse response filter applied to the transmitted or received symbol stream, with dimensionless tap weights chosen to cancel pre- and post-cursor ISI.',
    note: 'An FFE at the transmitter cannot add energy, so cancelling ISI means attenuating everything else. That insertion loss is the price, and it is why FFE alone runs out of margin on a very lossy channel.',
    see: ['cursor-taps', 'dfe', 'ctle', 'isi'],
    module: 'm7',
  },
  {
    id: 'ctle',
    term: 'CTLE',
    aka: ['Continuous-time linear equalizer'],
    unit: 'dB',
    definition:
      'An analogue filter with a zero and two poles that boosts high frequency relative to low, compensating channel roll-off. Characterised by DC gain, peak gain and pole frequencies.',
    note: 'A CTLE boosts crosstalk and noise along with the signal, because it cannot distinguish them. That sets the practical limit on how much peaking is useful.',
    see: ['equalization', 'ffe', 'dfe', 'insertion-loss'],
    module: 'm7',
  },
  {
    id: 'dfe',
    term: 'DFE',
    aka: ['Decision feedback equalizer'],
    unit: 'V',
    definition:
      'A feedback filter subtracting the known post-cursor ISI contribution of already-decided symbols from the incoming signal. Tap weights are in volts, or normalised to the main cursor.',
    note: 'A DFE does not amplify noise, which is its advantage over a CTLE. Its weakness is error propagation: one wrong decision feeds wrong corrections into the next several.',
    see: ['cursor-taps', 'ffe', 'ctle', 'slicer'],
    module: 'm7',
  },
  {
    id: 'slicer',
    term: 'Slicer',
    definition:
      'The comparator converting equalized analogue voltage into a symbol decision by comparing it with one or more thresholds at the sampling instant.',
    see: ['threshold', 'hysteresis', 'dfe', 'sampling-point'],
    module: 'm7',
  },
  {
    id: 'threshold',
    term: 'Decision threshold',
    unit: 'V',
    definition:
      'The voltage against which the received signal is compared to decide a symbol. Offsetting it from the centre of the eye trades margin on one rail for margin on the other.',
    note: 'A threshold sweep is the vertical axis of a shmoo and the direct measurement of voltage margin.',
    see: ['slicer', 'hysteresis', 'eye-height', 'shmoo'],
    module: 'm7',
  },
  {
    id: 'hysteresis',
    term: 'Hysteresis',
    unit: 'V',
    definition:
      'A deliberate difference between rising and falling decision thresholds, so the signal must move by that much to change the output state. It suppresses multiple transitions on a noisy slow edge at the cost of added duty-cycle distortion.',
    see: ['threshold', 'slicer', 'dcd'],
    module: 'm7',
  },
  {
    id: 'cdr',
    term: 'CDR',
    aka: ['Clock and data recovery'],
    unit: 'Hz',
    definition:
      'A loop extracting a sampling clock from data transitions. Its loop bandwidth in hertz divides jitter into low-frequency jitter the loop tracks and high-frequency jitter the receiver must tolerate.',
    note: 'Jitter below the loop bandwidth is largely harmless because the sampling clock follows it. This is why a jitter number means nothing without the observation bandwidth it was measured in.',
    see: ['jitter-transfer', 'golden-pll', 'jitter'],
    module: 'm7',
  },
  {
    id: 'jitter-transfer',
    term: 'Jitter transfer',
    unit: 'dB',
    definition:
      'The ratio of output to input jitter of a clock recovery loop as a function of jitter frequency. A first-order loop is low-pass with a single corner; a second-order loop can peak before rolling off.',
    see: ['cdr', 'golden-pll', 'damping-factor'],
    module: 'm7',
  },
  {
    id: 'golden-pll',
    term: 'Golden PLL',
    unit: 'Hz',
    definition:
      'A specified clock recovery response used so jitter measurements are comparable between instruments. It defines which jitter frequencies count against the budget.',
    note: 'Two scopes reporting different jitter on the same signal are usually running different observation bandwidths, not disagreeing about physics.',
    see: ['cdr', 'jitter-transfer'],
    module: 'm7',
  },

  /* --------------------------------------------------------- M8: memory bus */
  {
    id: 'strobe',
    term: 'Strobe',
    aka: ['DQS'],
    definition:
      'A source-synchronous timing reference sent alongside a group of data lines, so the receiver samples against a clock that experienced the same channel as the data.',
    note: 'This is the structural difference from a serial link: the timing reference is a separate physical net rather than recovered from the data transitions.',
    see: ['memory-training', 'skew', 'cdr'],
    module: 'm8',
  },
  {
    id: 'memory-training',
    term: 'Training',
    definition:
      'A start-up procedure in which the controller sweeps a timing or voltage parameter, tests each setting, and programs the centre of the passing range. Write levelling, read training and per-bit deskew are separate phases.',
    note: 'Training is the reason a shmoo has a plateau to centre in. When training picks a bad point, the shmoo usually shows why.',
    see: ['shmoo', 'strobe', 'sampling-point', 'odt'],
    module: 'm8',
  },
  {
    id: 'shmoo',
    term: 'Shmoo plot',
    definition:
      'A two-dimensional pass/fail map over two swept parameters, such as strobe delay against reference voltage. The largest contiguous passing region is the operating window.',
    note: 'Report the window edge to edge and the centre of it, not the count of passing points. A window with a hole in it is not a window.',
    see: ['memory-training', 'threshold', 'sampling-point'],
    module: 'm8',
  },
  {
    id: 'skew',
    term: 'Skew',
    unit: 's',
    definition:
      'Difference in arrival time between signals that should be simultaneous: between the two halves of a differential pair, between data bits in a byte lane, or between data and strobe.',
    note: 'Intra-pair skew converts differential signal into common mode; inter-bit skew eats directly into the common sampling window.',
    see: ['mixed-mode', 'strobe', 'setup-time'],
    module: 'm8',
  },
  {
    id: 'setup-time',
    term: 'Setup and hold time',
    unit: 's',
    definition:
      'The intervals before and after the sampling edge during which data must be stable for the latch to resolve reliably. Their sum is the minimum valid window the signal must present.',
    note: 'The eye must be wider than setup plus hold, not merely open. A scope showing an open eye says nothing on its own about whether the latch can capture it.',
    see: ['sampling-point', 'eye-width', 'shmoo'],
    module: 'm8',
  },
  {
    id: 'sampling-point',
    term: 'Sampling point',
    aka: ['Strobe position'],
    unit: 'UI',
    definition:
      'The position within the unit interval at which the receiver samples, expressed as a fraction of a UI. The optimum is the centre of the widest region meeting both timing and voltage requirements.',
    note: 'On a noiseless eye the best position is a plateau of equally good settings, not a single point. Centring in the plateau is what training does and what leaves margin on both sides.',
    see: ['shmoo', 'setup-time', 'eye-width', 'memory-training'],
    module: 'm8',
  },
  {
    id: 'differential-signaling',
    term: 'Differential signalling',
    definition:
      'Transmitting on two conductors with opposite polarity so the receiver responds to their difference. Common-mode disturbance affects both equally and cancels at the receiver.',
    see: ['mixed-mode', 'skew', 'crosstalk'],
    module: 'm3',
  },

  /* ------------------------------------------------- M9: the wireless view */
  {
    id: 'constellation',
    term: 'Constellation diagram',
    definition:
      'A scatter plot of the complex baseband symbol at the decision instant, in-phase on the real axis and quadrature on the imaginary. Cluster spread corresponds directly to eye closure.',
    see: ['evm', 'iq', 'eye-diagram'],
    module: 'm9',
  },
  {
    id: 'evm',
    term: 'EVM',
    aka: ['Error vector magnitude'],
    unit: '1',
    definition:
      'The RMS distance between measured and ideal symbol positions, normalised to the reference amplitude and usually quoted as a percentage or in decibels. It plays the role eye closure plays in a wireline link.',
    see: ['constellation', 'q-factor', 'eye-height'],
    module: 'm9',
  },
  {
    id: 'iq',
    term: 'IQ representation',
    definition:
      'Describing a bandpass signal by its complex baseband envelope, the in-phase and quadrature components, obtained through the analytic signal from the Hilbert transform.',
    see: ['hilbert-transform', 'constellation'],
    module: 'm9',
  },
  {
    id: 'hilbert-transform',
    term: 'Hilbert transform',
    definition:
      'A 90-degree phase shift applied at every frequency, used to build the analytic signal whose magnitude is the envelope and whose angle is the instantaneous phase.',
    see: ['iq', 'phase-response'],
    module: 'm9',
  },
  {
    id: 'multipath',
    term: 'Multipath',
    definition:
      'Reception of several delayed copies of a signal that arrived by different routes, producing frequency-selective fading. The wireless counterpart of reflections on a transmission line.',
    see: ['reflection-coefficient', 'isi', 'equalization'],
    module: 'm9',
  },

  /* ---------------------------------------------------------- M10: the lab */
  {
    id: 'sample-rate',
    term: 'Sample rate',
    unit: 'Sa/s',
    definition:
      'Samples acquired per second. It must exceed twice the highest frequency present after the analogue front end, or those frequencies alias to lower ones.',
    note: 'The usual guidance of 2.5 to 4 times the scope bandwidth is about reconstruction quality on an edge, not about merely satisfying Nyquist.',
    see: ['aliasing', 'interpolation', 'bandwidth'],
    module: 'm10',
  },
  {
    id: 'aliasing',
    term: 'Aliasing',
    definition:
      'Energy above half the sample rate appearing at a lower frequency after sampling, indistinguishable there from a real signal.',
    note: 'An alias does not look wrong. It looks like a signal you did not expect, which is why changing the sample rate and watching the feature move is the standard test.',
    see: ['sample-rate', 'nyquist-frequency'],
    module: 'm10',
  },
  {
    id: 'interpolation',
    term: 'Interpolation',
    definition:
      'Reconstructing the waveform between samples for display. Sin(x)/x interpolation is correct for a band-limited signal; linear interpolation understates peaks and overstates rise time.',
    note: 'Sin(x)/x applied to a signal that is not band-limited within the sample rate invents overshoot that is not there. Both interpolators can lie, in opposite directions.',
    see: ['sample-rate', 'aliasing'],
    module: 'm10',
  },
  {
    id: 'adc-resolution',
    term: 'ADC resolution',
    unit: 'bit',
    definition:
      'Number of bits the digitiser quantises to, making the least significant bit equal to full-scale range divided by 2^bits. Quantisation adds noise of one LSB divided by sqrt(12) RMS.',
    note: 'Resolution is only useful if the signal fills the range. A 12-bit acquisition at a tenth of full scale has less usable resolution than 8 bits well scaled.',
    see: ['vertical-range', 'noise', 'averaging'],
    module: 'm10',
  },
  {
    id: 'vertical-range',
    term: 'Vertical range',
    unit: 'V',
    definition:
      'Full-scale voltage the acquisition covers, usually stated as volts per division times the number of divisions. With the ADC resolution it sets the quantisation step.',
    note: 'Clipping is the failure mode at one end and wasted resolution at the other. Fill about 80% of the screen.',
    see: ['adc-resolution', 'probe-loading'],
    module: 'm10',
  },
  {
    id: 'averaging',
    term: 'Averaging',
    definition:
      'Accumulating repeated acquisitions of a repetitive signal to reduce uncorrelated noise by the square root of the number of averages.',
    note: 'Averaging removes exactly what you may be looking for. It suppresses random jitter and noise and leaves deterministic effects, so never measure jitter on an averaged trace.',
    see: ['noise', 'random-jitter', 'persistence'],
    module: 'm10',
  },
  {
    id: 'probe-loading',
    term: 'Probe loading',
    definition:
      'The change a probe makes to the circuit it measures, dominated at high frequency by tip capacitance and at low frequency by tip resistance.',
    note: 'A fraction of a picofarad at the tip is enough to slow an edge measurably. If the waveform changes when you move the probe, the probe is part of the circuit.',
    see: ['rlc', 'bandwidth', 'rise-time'],
    module: 'm10',
  },
  {
    id: 'trigger',
    term: 'Trigger',
    definition:
      'The condition determining which part of the incoming signal is captured. Edge, width, runt, setup/hold violation and serial pattern triggers each isolate a different failure.',
    note: 'For an intermittent, the trigger is the measurement. A runt or setup/hold trigger plus infinite persistence catches in minutes what an edge trigger will not find in hours.',
    see: ['persistence', 'eye-diagram'],
    module: 'm10',
  },
  {
    id: 'de-embedding',
    term: 'De-embedding',
    definition:
      'Removing the known response of fixturing, cables or probes from a measurement by applying the inverse of their characterised S-parameters.',
    note: 'De-embedding amplifies noise wherever the fixture had loss, so it cannot recover what the fixture destroyed.',
    see: ['s-parameters', 'touchstone', 'insertion-loss'],
    module: 'm10',
  },

  /* -------------------------------------------------------------- M11: PAM4 */
  {
    id: 'pam4',
    term: 'PAM4',
    definition:
      'Four-level pulse amplitude modulation: two bits per symbol, three thresholds and three stacked eyes. It halves the symbol rate for a given bit rate at the cost of roughly a third of the amplitude margin per eye.',
    note: 'The three eyes are not identical. Level-dependent nonlinearity makes the outer eyes differ from the middle one, and the reported margin should be the worst of the three.',
    see: ['unit-interval', 'eye-diagram', 'threshold', 'symbol-rate'],
    module: 'm11',
  },
];

const BY_ID = new Map(GLOSSARY.map((g) => [g.id, g]));

export function getTerm(id: string): GlossaryEntry | undefined {
  return BY_ID.get(id);
}

export function hasTerm(id: string): boolean {
  return BY_ID.has(id);
}

/** Alphabetical by display term, which is the order the glossary page reads in. */
export function glossaryAlphabetical(): GlossaryEntry[] {
  return [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
}

/** Terms introduced by a module, in declaration order. */
export function termsForModule(moduleId: string): GlossaryEntry[] {
  return GLOSSARY.filter((g) => g.module === moduleId);
}

/**
 * Substring search over term, abbreviations and definition, in that priority.
 * Deliberately simple: this is a hundred entries, not a corpus.
 */
export function searchGlossary(query: string): GlossaryEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const score = (g: GlossaryEntry): number => {
    const term = g.term.toLowerCase();
    const aka = (g.aka ?? []).map((a) => a.toLowerCase());
    if (term === q || aka.includes(q)) return 0;
    if (term.startsWith(q)) return 1;
    if (aka.some((a) => a.startsWith(q))) return 2;
    if (term.includes(q)) return 3;
    if (aka.some((a) => a.includes(q))) return 4;
    if (g.definition.toLowerCase().includes(q)) return 5;
    return Infinity;
  };
  return GLOSSARY.map((g) => ({ g, s: score(g) }))
    .filter((e) => e.s < Infinity)
    .sort((a, b) => a.s - b.s || a.g.term.localeCompare(b.g.term))
    .map((e) => e.g);
}
