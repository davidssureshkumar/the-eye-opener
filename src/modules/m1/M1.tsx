/**
 * M1: building a square wave from nothing.
 *
 * The argument, in order: a transmitter cannot send a square wave, because a square
 * wave is an infinite sum; what it can send is the first few terms of that sum, and
 * every effect in the rest of the course is a statement about which terms survive.
 *
 * Two figures carry it. The synthesis plot shows the partial sum converging - in
 * the mean, and never at the edge. The spectrum plot shows where the terms actually
 * live in frequency, which is what makes "loss at Nyquist" a sentence about this
 * page rather than a number from a datasheet.
 *
 * Nothing here computes physics. The waveform, the harmonics, the overshoot and the
 * RMS error all come from `runJob('fourier', ...)` through `useJob`; the two figures
 * are built in `./plots`, which is tested; the duty-cycle table is evaluated through
 * `secondHarmonicRatio`, the same function the spectrum figure's metric uses. Every
 * formula displayed below is implemented somewhere this file imports from, which is
 * the rule the whole project is written against.
 */

import { useMemo, useState } from 'react';
import { Callout, Math as TeX, MathBlock, Plot, SelfCheck, TryThis } from '../../ui';
import { ParamRow, ParamSelect, ParamSlider, ParamToggle } from '../params';
import { secondHarmonicRatio, type WaveShape } from '../../dsp/fourier';
import { formatEng } from '../../plots/scale';
import { useScenario } from '../../state/store';
import { permalinkFor } from '../../state/url-codec';
import { useJob } from '../../workers/use-job';
import { SHAPE_NAMES, spectrumRender, synthesisRender } from './plots';

const SHAPE_OPTIONS: readonly { value: WaveShape; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
  { value: 'pulse', label: 'Pulse, adjustable duty' },
];

/** Duty errors the table below reports, as a fraction of the period. */
const DUTY_ERRORS: readonly number[] = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05];

export function M1({ moduleId }: { moduleId: string }): JSX.Element {
  const [scenario] = useScenario();

  // Job parameters, not Scenario fields: they describe the experiment this module
  // is running, not the link. See the header of `src/modules/params.tsx`.
  const [shape, setShape] = useState<WaveShape>('square');
  const [maxN, setMaxN] = useState(9);
  const [duty, setDuty] = useState(0.5);
  const [showEach, setShowEach] = useState(true);

  const { data, running, progress } = useJob('fourier', scenario, {
    shape,
    maxN,
    duty,
    perHarmonic: showEach,
    samples: 2048,
  });

  // The second harmonic a duty error puts on a clock, evaluated rather than
  // remembered. |a2/a1| = |cos(pi d)| exactly; the familiar pi*|d - 1/2| is its
  // linearisation and is already wrong in the sixth decimal at 1%.
  const dutyTable = useMemo(
    () =>
      DUTY_ERRORS.map((e) => {
        const ratio = secondHarmonicRatio(0.5 + e);
        return { error: e, ratio, db: 20 * Math.log10(ratio) };
      }),
    [],
  );

  const permalink =
    typeof window === 'undefined'
      ? undefined
      : permalinkFor(moduleId, '', scenario, window.location.origin, window.location.pathname);

  return (
    <>
      <p className="text-lead text-hi">
        A transmitter sent a square wave. It did not, and it could not: a square wave is an infinite sum, and
        no driver has infinite bandwidth. What left the pin was the first few terms of that sum. Every
        impairment in the rest of this course - loss, reflection, crosstalk, equalization - is a statement
        about which terms survived the trip and in what shape.
      </p>

      <h2>What the series says</h2>

      <p>
        Any periodic waveform can be written as a sum of sinusoids at integer multiples of its own repetition
        rate. For a bipolar square wave of amplitude <TeX tex="A" /> and fundamental <TeX tex="f_0" />:
      </p>

      <MathBlock
        tex="x(t) = \frac{4A}{\pi}\sum_{n=1,3,5,\dots}^{\infty}\frac{1}{n}\,\sin\!\left(2\pi n f_0 t\right)"
        label="x of t equals four A over pi, times the sum over odd n of one over n, times sine of two pi n f-nought t"
        tag="1.1"
        source="PHYSICS.md §2.1. Implemented in src/dsp/fourier.ts, harmonics()."
      />

      <p>
        Two things in that expression do the work. The coefficients fall as <TeX tex="1/n" />, which is{' '}
        <TeX tex="-20" /> dB per decade: the hundredth harmonic is 40 dB below the first. And only odd{' '}
        <TeX tex="n" /> appear at all, because a 50% square wave satisfies <TeX tex="x(t + T/2) = -x(t)" />.
        Half-wave symmetry forces every even coefficient to zero - a fact worth holding onto, because it is
        the first thing a duty-cycle error destroys.
      </p>

      <p>
        Move the harmonic count below and watch an edge assemble itself out of sine waves. The faint traces
        are the individual harmonics; the dashed line is what the series is converging to.
      </p>

      <ParamRow>
        <ParamSelect
          label="Waveform"
          value={shape}
          options={SHAPE_OPTIONS}
          hint="What the series is a series for."
          onChange={(v) => setShape(v)}
        />
        <ParamSlider
          label="Harmonics included"
          value={maxN}
          min={1}
          max={99}
          step={1}
          format={(v) => `n ≤ ${v}`}
          hint="Highest harmonic number in the partial sum."
          onChange={setMaxN}
        />
        {shape === 'pulse' ? (
          <ParamSlider
            label="Duty cycle"
            value={duty}
            min={0.02}
            max={0.98}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            hint="Fraction of the period spent high."
            onChange={setDuty}
          />
        ) : null}
        <ParamToggle
          label="Show each harmonic"
          value={showEach}
          hint="Draws the terms as well as the sum."
          onChange={setShowEach}
        />
      </ParamRow>

      {data ? (
        <Plot
          title={`Fourier synthesis of a ${SHAPE_NAMES[shape]}`}
          height={320}
          busy={running}
          progress={progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0}
          permalink={permalink}
          render={synthesisRender(data, { shape, showEach })}
          data={() => ({
            x: data.t,
            series: [
              { key: 'sum', values: data.y },
              { key: 'ideal', values: data.ideal },
            ],
          })}
        />
      ) : (
        <p className="text-lo">Computing the first partial sum&hellip;</p>
      )}

      <h2>The overshoot that will not go away</h2>

      <p>
        Push the harmonic count up and the flat parts of the waveform flatten, the edge steepens, and the RMS
        error falls. The overshoot at the edge does not. It narrows - it gets squeezed toward the
        discontinuity - but its height converges to a fixed value that no amount of bandwidth removes.
      </p>

      <MathBlock
        tex="\lim_{N\to\infty}\;\max_t\,s_N(t) \;=\; \frac{2}{\pi}\int_0^{\pi}\frac{\sin u}{u}\,du \;=\; \frac{2}{\pi}\,\mathrm{Si}(\pi) \;=\; 1.178980\dots"
        label="The limit of the peak of the partial sum is two over pi times the sine integral of pi, which is 1.17898"
        tag="1.2"
        source="PHYSICS.md §2.2. Si(x) implemented in src/dsp/fourier.ts, sineIntegral()."
      />

      <p>
        That is 17.8980% above the amplitude of a unit-amplitude wave. The convention this site reports is a
        fraction of the <em>jump</em>, which for a wave running between <TeX tex="+1" /> and <TeX tex="-1" />{' '}
        is 2 units tall, so the number in the metric list is half of it:{' '}
        <span className="readout text-hi">8.9490%</span>. It is the same constant either way; the two
        conventions differ by a factor of two and both are in use, which is exactly the kind of ambiguity
        worth naming rather than inheriting.
      </p>

      <p>
        Read the two metrics under the plot together. <span className="readout">RMS error</span> falls toward
        zero as harmonics are added - the series does converge, in the mean-square sense.
        <span className="readout">Peak overshoot</span> does not move. Convergence in energy and convergence
        at every point are different claims, and a Fourier series at a discontinuity only makes the first one.
        The third metric, <span className="readout">overshoot peak, from the edge</span>, is where the lobe
        has got to: it falls roughly as <TeX tex="1/N" />, which is why the ripple looks like it is
        disappearing when it is only getting thinner.
      </p>

      <Callout variant="notice" title="Gibbs is what truncation does, not what bandwidth does">
        <p>
          A 9% overshoot on a real edge is not automatic evidence of Gibbs. The series above is truncated -
          every harmonic up to <TeX tex="N" /> passes at full amplitude and everything above it is deleted.
          That is a brick-wall filter, and a brick wall is the one response that produces this overshoot.
        </p>
        <p>
          A first-order roll-off, which is what most real bandwidth limits look like, produces no overshoot at
          all: it never exceeds its final value. M2 builds both and puts them side by side. If you see 9% and
          ringing on both sides of an edge, suspect something that behaves like a brick wall - an
          interpolating filter, a sharp anti-alias, an equalizer with too much peaking - before blaming the
          channel.
        </p>
      </Callout>

      <TryThis
        title="Watch the two convergence claims separate"
        steps={[
          'Set the waveform to Square and the harmonic count to 3.',
          'Note the RMS error and the peak overshoot.',
          'Raise the harmonic count to 9, then 33, then 99, reading both numbers each time.',
        ]}
        expect="RMS error falls steadily toward zero. Peak overshoot climbs slightly and then sticks at 8.95% of the jump - the target beside it. The overshoot peak moves toward the edge as roughly 1/N, so the lobe narrows without shrinking."
      />

      <SelfCheck
        moduleId={moduleId}
        id="gibbs"
        question="You double the bandwidth of an ideal brick-wall filter carrying a square wave. What happens to the overshoot at the edge?"
        options={[
          {
            id: 'same-height',
            text: 'Its height stays the same; it just moves closer to the edge.',
            correct: true,
            why: 'The Wilbraham-Gibbs limit is a property of truncation, not of where the truncation happens. Doubling N halves the width of the lobe and leaves its height at 8.949% of the jump.',
          },
          {
            id: 'halves',
            text: 'It halves, because there is twice as much bandwidth.',
            why: 'A reasonable guess, and it is what the RMS error does. The peak does not follow it: the lobe carries half the energy because it is half as wide, not because it is half as tall.',
          },
          {
            id: 'vanishes',
            text: 'It disappears once enough harmonics are included.',
            why: 'It never does. That is the whole point of the phenomenon - the series converges in the mean but not uniformly, so no finite or infinite N removes the peak.',
          },
          {
            id: 'doubles',
            text: 'It doubles, because the edge is now faster.',
            why: 'Faster edges do not carry larger Gibbs lobes. The constant is 8.949% of the jump regardless of how many terms are summed.',
          },
        ]}
      />

      <h2>Where the harmonics actually land</h2>

      <p>
        The plot above is drawn against a normalised period. The frequencies are the part that matters on a
        real link, and they follow from the pattern. A repeating 1010 stream at symbol rate <TeX tex="f_s" />{' '}
        completes one full cycle every two unit intervals, so its fundamental is at <TeX tex="f_s/2" /> - the
        Nyquist frequency - and its <TeX tex="n" />
        th harmonic sits at <TeX tex="n f_s/2" />.
      </p>

      <p>
        At the {formatEng(scenario.source.symbolRate, 'Bd', 3)} currently set in the panel, that puts the
        fundamental at {formatEng(scenario.source.symbolRate / 2, 'Hz', 3)}. This is why channel loss is
        quoted &ldquo;at Nyquist&rdquo;: it is the loss at the frequency where a clock pattern keeps all of
        its energy, and the single number a link budget starts from.
      </p>

      {data ? (
        <Plot
          title={`Harmonic content of a ${SHAPE_NAMES[shape]}`}
          height={300}
          busy={running}
          permalink={permalink}
          render={spectrumRender(data, { shape, duty })}
        />
      ) : null}

      <h2>Duty cycle, and the sinc envelope</h2>

      <p>
        A pulse train of duty <TeX tex="d" /> is the general case; the square wave is <TeX tex="d = 1/2" />.
        Its coefficients are
      </p>

      <MathBlock
        tex="a_n = \frac{4}{n\pi}\,\sin(n\pi d) \;=\; 4d\,\operatorname{sinc}(nd), \qquad \operatorname{sinc}(x) \equiv \frac{\sin \pi x}{\pi x}"
        label="a sub n equals four over n pi times sine of n pi d, which equals four d times sinc of n d"
        tag="1.3"
        source="PHYSICS.md §2.5. Implemented in src/dsp/fourier.ts, harmonics() and harmonicEnvelope()."
      />

      <p>
        Plus a DC term of <TeX tex="2d - 1" />, which is just the mean of a waveform that spends a fraction{' '}
        <TeX tex="d" /> of its time high. The dashed curve on the spectrum plot is the magnitude of that
        expression read as a continuous function of frequency, and it has nulls wherever <TeX tex="nd" /> is
        an integer. Set the waveform to Pulse and sweep the duty: at 25% every fourth harmonic vanishes, at
        20% every fifth, and at 50% every second - which is the square wave&rsquo;s missing even harmonics.
        Half-wave symmetry and the sinc nulls are not two facts. They are one fact seen twice.
      </p>

      <h3>Reading duty cycle off the second harmonic</h3>

      <p>Take the ratio of the second harmonic to the first. The sines collapse:</p>

      <MathBlock
        tex="\left|\frac{a_2}{a_1}\right| = \frac{\left|\tfrac{4}{2\pi}\sin(2\pi d)\right|}{\left|\tfrac{4}{\pi}\sin(\pi d)\right|} = \frac{|2\sin \pi d\,\cos \pi d|}{|2\sin \pi d|} = \left|\cos \pi d\right|"
        label="The magnitude of a-two over a-one equals the magnitude of cosine pi d"
        tag="1.4"
        source="PHYSICS.md §2.5. Implemented in src/dsp/fourier.ts, secondHarmonicRatio()."
      />

      <p>
        Which inverts, on the branch <TeX tex="d \le 1/2" />, to
      </p>

      <MathBlock
        tex="d = \frac{1}{\pi}\arccos\left|\frac{a_2}{a_1}\right|"
        label="d equals one over pi times the arc cosine of the magnitude of a-two over a-one"
        tag="1.5"
        source="PHYSICS.md §2.5. Implemented in src/dsp/fourier.ts, dutyFromSecondHarmonic()."
      />

      <p>
        That is a duty-cycle measurement made entirely in the frequency domain, and it is independent of
        amplitude, of probe attenuation and of vertical calibration, because it is a ratio of two lines in the
        same spectrum. It is also exact rather than a rule of thumb - the{' '}
        <span className="readout">duty recovered from the second harmonic</span> metric under the spectrum
        plot returns the duty the slider set, to the last digit shown.
      </p>

      <p>
        The price is a two-to-one ambiguity: <TeX tex="d" /> and <TeX tex="1 - d" /> give the same second
        harmonic, because a 40% pulse and a 60% pulse are the same waveform inverted. The DC level settles it,
        and so does looking at the waveform.
      </p>

      <p>
        Near 50% the relation is steep, which is what makes it useful. These are the numbers, evaluated
        through <span className="readout">secondHarmonicRatio</span> rather than quoted:
      </p>

      <div className="my-5 overflow-x-auto">
        <table className="w-full border-collapse text-micro">
          <caption className="mb-2 text-left text-micro text-lo">
            Second-harmonic level produced by a duty-cycle error on a clock, from{' '}
            <TeX tex="|a_2/a_1| = |\cos \pi d|" />.
          </caption>
          <thead>
            <tr className="border-b border-rule text-lo">
              <th scope="col" className="py-1 text-left font-normal">
                Duty error
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Duty cycle
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                <TeX tex="|a_2/a_1|" />
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Second harmonic
              </th>
            </tr>
          </thead>
          <tbody>
            {dutyTable.map((row) => (
              <tr key={row.error} className="border-b border-rule/40">
                <td className="py-1 text-hi">&plusmn;{(row.error * 100).toFixed(1)}%</td>
                <td className="readout py-1 text-right text-hi">{((0.5 + row.error) * 100).toFixed(1)}%</td>
                <td className="readout py-1 text-right text-hi">{row.ratio.toFixed(5)}</td>
                <td className="readout py-1 text-right" style={{ color: 'var(--ch2)' }}>
                  {row.db.toFixed(2)} dBc
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        A 1% duty error - 5 ps on a 500 ps clock period - puts a second harmonic 30 dB below the fundamental.
        That is a large, easily visible line on a spectrum analyser or a scope FFT, and it is a far more
        sensitive duty-cycle measurement than reading the pulse width off a scope screen, where 5 ps on 500 ps
        is a change you would struggle to see at all.
      </p>

      <Callout variant="silicon" title="Why anyone cares about the second harmonic of a clock">
        <p>
          A memory interface with a source-synchronous strobe launches data on both edges. Duty-cycle error on
          the internal clock moves one edge relative to the other, so half the bits get a wider window and
          half get a narrower one, and the narrow half sets the margin. Duty-cycle correction circuits exist
          in DDR-class receivers for exactly this reason, and the on-die adjustment they apply is one of the
          things a shmoo in M8 will be sweeping.
        </p>
      </Callout>

      <TryThis
        title="Measure a duty cycle without measuring a pulse width"
        steps={[
          'Set the waveform to Pulse and the harmonic count to 9 or more.',
          'Set the duty cycle to 50% and look at the spectrum: there is no second harmonic, and no duty reading.',
          'Move the duty to 48%, then 45%, then 40%, watching the second harmonic rise out of the floor.',
          'Compare the recovered duty against the value you set.',
        ]}
        expect="The second harmonic appears the moment the duty leaves 50% and climbs quickly. The recovered duty tracks the slider exactly, because the relation is exact and not a linearisation."
      />

      <h2>How much bandwidth does an edge need?</h2>

      <p>
        The series has infinitely many terms, but their contribution to the shape of the edge falls away. The
        standard sizing rule puts the useful upper limit at the knee frequency:
      </p>

      <MathBlock
        tex="f_{\mathrm{knee}} \approx \frac{0.5}{t_r\,(10\text{-}90\%)}"
        label="Knee frequency is approximately 0.5 divided by the ten to ninety percent rise time"
        tag="1.6"
        source="Johnson and Graham, High-Speed Digital Design. PHYSICS.md §2.4. Implemented in src/dsp/fourier.ts, kneeFrequency()."
      />

      <p>
        A channel that is flat to the knee reproduces the edge; one that rolls off well below it does not.
        Treat the constant as a sizing tool with a factor-of-two spread: it depends on whose rise-time
        threshold and whose &ldquo;flat enough&rdquo; you use, and it is not a criterion anything gets signed
        off against.
      </p>

      <p>
        Notice what it does <em>not</em> depend on: the symbol rate. An edge that takes 25 ps to move needs
        content out to about 20 GHz whether it happens once a microsecond or once every unit interval. That is
        the hinge the next module turns on - bandwidth is a statement about edges, not about data rate - and
        it is why a slow interface with fast edges can radiate, couple and reflect exactly like a fast one.
      </p>

      <SelfCheck
        moduleId={moduleId}
        id="duty-nulls"
        question="A pulse train has no fourth harmonic, no eighth and no twelfth, but all of its odd harmonics are present. What is its duty cycle?"
        options={[
          {
            id: 'quarter',
            text: '25%, or equivalently 75%.',
            correct: true,
            why: 'The sinc nulls fall where nd is an integer. With d = 1/4 that is n = 4, 8, 12 and so on. The 75% case is the same waveform inverted and has the same magnitude spectrum.',
          },
          {
            id: 'half',
            text: '50%.',
            why: 'At 50% every even harmonic is a null, so the second and sixth would be missing too. Only multiples of four are gone here.',
          },
          {
            id: 'twelfth',
            text: 'One twelfth, since the twelfth harmonic is missing.',
            why: 'A duty of 1/12 would null n = 12, 24, 36 - but it would leave the fourth and eighth in place. The lowest missing harmonic sets the duty, not the highest one you noticed.',
          },
          {
            id: 'cannot-tell',
            text: 'It cannot be determined from the nulls alone.',
            why: 'The null spacing determines d up to the d against 1 - d ambiguity, which is what the two answers in the correct option are. That is a genuine ambiguity, not an absence of information.',
          },
        ]}
      />

      <p className="text-micro text-lo">
        Next: the same edge stops being a mathematical limit and starts being a filter output. M2 builds the
        first-order and second-order responses this module has been deleting harmonics as a stand-in for, and
        shows what each one does to an edge - and where <TeX tex="0.35/\mathrm{BW}" /> comes from, along with
        the conditions under which it is true.
      </p>
    </>
  );
}
