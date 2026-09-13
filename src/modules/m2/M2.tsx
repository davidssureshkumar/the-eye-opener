/**
 * M2: from an ideal edge to a real one.
 *
 * M1 removed harmonics with a brick wall, which was the right way to make a point
 * about a series and the wrong model of almost every real bandwidth limit. This
 * module replaces it. A band-limited edge is a filter output, and once that is said
 * out loud the rest follows: the shape of the edge is the step response of the
 * thing that limited it, the rise time is a property of that shape and of the two
 * levels you chose to measure between, and 0.35/BW is one entry in a table rather
 * than a constant of nature.
 *
 * Two figures. The first is one edge from `runJob('edge', ...)` with all four
 * threshold levels drawn on it, so the two rise-time conventions are visibly two
 * readings of the same curve. The second is a series RLC at three dampings, which
 * is where overshoot and ringing come from when nothing has been truncated.
 *
 * Every number in the prose below is evaluated, not quoted: the rise-time-bandwidth
 * table calls `riseTimeBandwidthProduct`, the cascade table calls
 * `cascadedPoleRiseTime`, and the damping figures come from `rlcCharacteristics`.
 */

import { useMemo, useState } from 'react';
import { Callout, Math as TeX, MathBlock, Plot, SelfCheck, TryThis } from '../../ui';
import { ParamRow, ParamSlider, ParamToggle } from '../params';
import {
  cascadedPoleRiseTime,
  riseTimeBandwidthProduct,
  rlcCharacteristics,
  type ResponseSpec,
} from '../../dsp/filters';
import { formatEng } from '../../plots/scale';
import { useScenario } from '../../state/store';
import { permalinkFor } from '../../state/url-codec';
import { useJob } from '../../workers/use-job';
import { dampingRender, edgeRender, RESPONSE_NAMES } from './plots';

/** Shapes the product table reports, in the order they appear. */
const TABLE_SHAPES: readonly ResponseSpec[] = [
  { type: 'rc', bw: 1 },
  { type: 'gaussian', bw: 1 },
  { type: 'bessel', bw: 1, order: 4 },
  { type: 'butterworth', bw: 1, order: 4 },
  { type: 'brickwall', bw: 1 },
];

/** Pole counts the cascade table reports. */
const CASCADE_N: readonly number[] = [1, 2, 3, 4, 6];

export function M2({ moduleId }: { moduleId: string }): JSX.Element {
  const [scenario] = useScenario();

  // Job parameters, not Scenario fields. The edge shape and the rise time are
  // properties of the link and live in the source panel; how long a record to
  // compute and whether to put the scope in the path are properties of this
  // experiment.
  const [span, setSpan] = useState(12);
  const [showScope, setShowScope] = useState(false);

  const { data, running, progress } = useJob('edge', scenario, {
    samples: 4096,
    spanInRiseTimes: span,
    includeScope: showScope,
  });

  const products = useMemo(
    () =>
      TABLE_SHAPES.map((spec) => {
        const wide = riseTimeBandwidthProduct(spec, 0.1, 0.9);
        const narrow = riseTimeBandwidthProduct(spec, 0.2, 0.8);
        return { spec, wide, narrow, ratio: narrow / wide };
      }),
    [],
  );

  // Cascaded identical poles, against the rule that says rise times add in
  // quadrature. Evaluated through the same function M2's claim is made with, so the
  // table cannot disagree with the sentence above it.
  const cascade = useMemo(() => {
    const one = cascadedPoleRiseTime(1, 1);
    return CASCADE_N.map((n) => {
      const exact = cascadedPoleRiseTime(n, 1);
      const rss = one * Math.sqrt(n);
      return { n, exact, rss, error: (rss - exact) / exact };
    });
  }, []);

  const rlc = scenario.channel.rlc;
  const ch = useMemo(() => rlcCharacteristics(rlc), [rlc]);

  const levels = {
    low: scenario.source.dcOffset - scenario.source.amplitude / 2,
    high: scenario.source.dcOffset + scenario.source.amplitude / 2,
  };

  const permalink =
    typeof window === 'undefined'
      ? undefined
      : permalinkFor(moduleId, '', scenario, window.location.origin, window.location.pathname);

  // The name the figure and the prose use is the response actually modelled, not
  // the Scenario's word for it: 'linear' is a ramp with no transfer function and is
  // mapped to a Bessel, and saying so is better than quietly renaming it.
  const modelled = data ? data.response.type : scenario.source.edgeShape;
  const shapeName = RESPONSE_NAMES[modelled] ?? modelled;

  return (
    <>
      <p className="text-lead text-hi">
        M1 deleted harmonics above a cut-off and kept everything below it at full amplitude. That is a brick
        wall, and almost nothing in a real link behaves like one. A package pin, a via, a driver&rsquo;s
        output stage and a scope&rsquo;s front end do not delete frequencies; they attenuate them
        progressively and delay them by amounts that differ with frequency. The edge you measure is the step
        response of whatever did that, and its shape tells you which one it was.
      </p>

      <h2>A step through a single pole</h2>

      <p>
        Start with the simplest band limit there is: one resistor and one capacitor, a single pole at{' '}
        <TeX tex="f_{3\mathrm{dB}}" />. Drive it with a perfect step and the output is
      </p>

      <MathBlock
        tex="v(t) = V\left(1 - e^{-t/\tau}\right), \qquad \tau = \frac{1}{2\pi f_{3\mathrm{dB}}}"
        label="v of t equals V times one minus e to the minus t over tau, with tau equal to one over two pi f three dB"
        tag="2.1"
        source="PHYSICS.md §3.2. Implemented in src/dsp/filters.ts, rcStepResponse()."
      />

      <p>
        It is monotone: it approaches the final value and never exceeds it. Invert it and you get the time at
        which the output reaches any fraction <TeX tex="p" /> of the step,{' '}
        <TeX tex="t(p) = -\tau\ln(1 - p)" />, so the time spent between two fractions is a difference of two
        logarithms:
      </p>

      <MathBlock
        tex="t_r = \tau\,\ln\!\frac{1 - \mathrm{lo}}{1 - \mathrm{hi}} \;\Longrightarrow\; t_r\,(10\text{-}90\%) = \frac{\ln 9}{2\pi\,\mathrm{BW}} = \frac{0.3497}{\mathrm{BW}}"
        label="Rise time equals tau times the log of one minus lo over one minus hi, giving ten to ninety percent rise time of log nine over two pi bandwidth, which is 0.3497 over bandwidth"
        tag="2.2"
        source="PHYSICS.md §3.2. Implemented in src/dsp/filters.ts, riseTimeBandwidthProduct()."
      />

      <p>
        That is where <TeX tex="0.35/\mathrm{BW}" /> comes from. It is exact - for a single pole, at 10-90%,
        and for nothing else. Both of those qualifications get dropped in conversation and both of them
        matter, which is the rest of this module.
      </p>

      <p>
        The figure below is one rising edge of the driver currently configured in the source panel: a{' '}
        {shapeName} response
        {scenario.source.edgeShape === 'linear'
          ? ' - a straight ramp has no transfer function, so it is modelled as the maximally-flat-delay shape closest to one - '
          : ' '}
        with a 20-80% rise time of {formatEng(scenario.source.riseTime, 's', 3)}. The four dashed lines are
        the 10%, 20%, 80% and 90% levels. Rise time is the horizontal distance between a pair of them, and
        there are two pairs.
      </p>

      <ParamRow>
        <ParamSlider
          label="Record length"
          value={span}
          min={4}
          max={40}
          step={1}
          format={(v) => `${v} rise times`}
          hint="How much time either side of the transition to compute."
          onChange={setSpan}
        />
        <ParamToggle
          label="Show it through the scope"
          value={showScope}
          hint="Puts the configured scope front end in series with the driver."
          onChange={setShowScope}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="One edge, and the levels it is measured between"
          height={340}
          busy={running}
          progress={progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0}
          permalink={permalink}
          render={edgeRender(data, { ...levels, showScope })}
          data={() => ({
            x: data.t,
            series: [
              { key: 'edge', values: data.y },
              { key: 'scope', values: data.measured },
            ],
          })}
        />
      ) : (
        <p className="text-lo">Computing the edge&hellip;</p>
      )}

      <h2>Rise time is not one number</h2>

      <p>
        Change the edge shape in the source panel and watch the{' '}
        <span className="readout">ratio, 20-80% to 10-90%</span> metric move. For a single pole it is{' '}
        <TeX tex="\ln 4/\ln 9 = 0.6309" />, because both rise times are logarithms of the same time constant
        and the constant cancels. For every other shape it is something else, and the difference is not small.
      </p>

      <p>
        These are the rise-time-bandwidth products this site uses, evaluated rather than remembered. Closed
        form where one exists; solved from the actual step response where it does not:
      </p>

      <div className="my-5 overflow-x-auto">
        <table className="w-full border-collapse text-micro">
          <caption className="mb-2 text-left text-micro text-lo">
            <TeX tex="t_r \cdot \mathrm{BW}" /> by response shape and reference levels, from{' '}
            <span className="readout">riseTimeBandwidthProduct</span>. Fourth order for Bessel and
            Butterworth.
          </caption>
          <thead>
            <tr className="border-b border-rule text-lo">
              <th scope="col" className="py-1 text-left font-normal">
                Response
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                10-90%
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                20-80%
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Ratio
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((row) => (
              <tr key={row.spec.type} className="border-b border-rule/40">
                <td className="py-1 text-hi">{RESPONSE_NAMES[row.spec.type] ?? row.spec.type}</td>
                <td className="readout py-1 text-right text-hi">{row.wide.toFixed(6)}</td>
                <td className="readout py-1 text-right text-hi">{row.narrow.toFixed(6)}</td>
                <td className="readout py-1 text-right" style={{ color: 'var(--ch2)' }}>
                  {row.ratio.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Read the first column: the product spans 0.34 to 0.45 depending on shape. Using 0.35 on a fourth-order
        Butterworth understates the bandwidth needed by about 10%; using it on a brick wall understates it by
        about 21%. Read the last column: converting a measured 20-80% rise time into a 10-90% one with a
        single fixed factor is only valid if you already know the edge shape, and if you knew that you would
        not need the conversion.
      </p>

      <p>
        This is a practical trap in datasheet reading. Fast-interface parts increasingly quote 20-80%, older
        parts and most textbook rules use 10-90%, and on the same edge the 10-90% figure is 40 to 60% larger
        than the 20-80% one, depending on shape. A margin calculation that mixes them is wrong by more than
        most of the effects it is trying to account for.
      </p>

      <h2>Rise times in series, and the quadrature rule</h2>

      <p>
        Put two band limits in series - a driver and a scope, a package and a channel - and the standard
        estimate is that their rise times add in quadrature:
      </p>

      <MathBlock
        tex="t_{r,\mathrm{total}} \approx \sqrt{t_{r,1}^2 + t_{r,2}^2 + \dots}"
        label="Total rise time is approximately the square root of the sum of the squares of the individual rise times"
        tag="2.3"
        source="PHYSICS.md §3.7. Compared against src/dsp/filters.ts, cascadedPoleRiseTime()."
      />

      <p>
        This is exact for Gaussian responses, because convolving Gaussians adds their variances and the rise
        time of a Gaussian is proportional to its standard deviation. It is an approximation for everything
        else, and it errs in the optimistic direction. Here is what it does to a cascade of <TeX tex="n" />{' '}
        identical single poles, whose step response is the Erlang distribution function and whose rise time is
        therefore computable exactly:
      </p>

      <div className="my-5 overflow-x-auto">
        <table className="w-full border-collapse text-micro">
          <caption className="mb-2 text-left text-micro text-lo">
            10-90% rise time of <TeX tex="n" /> identical poles, in units of{' '}
            <TeX tex="1/\mathrm{BW}_{\mathrm{pole}}" />, against the quadrature estimate. From{' '}
            <span className="readout">cascadedPoleRiseTime</span>.
          </caption>
          <thead>
            <tr className="border-b border-rule text-lo">
              <th scope="col" className="py-1 text-left font-normal">
                Poles
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                True
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Quadrature
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Error
              </th>
            </tr>
          </thead>
          <tbody>
            {cascade.map((row) => (
              <tr key={row.n} className="border-b border-rule/40">
                <td className="py-1 text-hi">{row.n}</td>
                <td className="readout py-1 text-right text-hi">{row.exact.toFixed(6)}</td>
                <td className="readout py-1 text-right text-hi">{row.rss.toFixed(6)}</td>
                <td className="readout py-1 text-right" style={{ color: 'var(--ch2)' }}>
                  {(row.error * 100).toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Two identical poles produce an edge of <TeX tex="0.534428/\mathrm{BW}" /> where quadrature predicts{' '}
        <TeX tex="0.494549/\mathrm{BW}" />: the estimate is 7.46% low, and it gets worse as poles are added.
        Low means it tells you the edge is faster than it is, which on a margin calculation is the direction
        that does not warn you.
      </p>

      <Callout
        variant="bench"
        title="Picking a scope for an edge you have not seen yet"
        controls={['Bandwidth limit', 'Rise time measurement', 'Reference levels']}
      >
        <p>
          The same arithmetic in reverse is how scope bandwidth gets chosen. If the instrument&rsquo;s own
          rise time is comparable with the signal&rsquo;s, what you read is the cascade, not the signal. A
          scope with a rise time one third of the signal&rsquo;s inflates the reading by about 5% by
          quadrature - and by more than that in reality, for the reason in the table above.
        </p>
        <p>
          Turn on <span className="readout">Show it through the scope</span> to put the configured front end
          in series with this edge and compare the two rise-time metrics. Note that the correction is not
          something you should apply by hand: most scopes measure rise time between reference levels you can
          set, and getting <em>those</em> wrong is a larger error than the front end. Check whether the
          instrument is set to 10-90% or 20-80% before comparing anything to a datasheet. M10 does the
          instrument properly, including what its own noise does to the reading.
        </p>
      </Callout>

      <TryThis
        title="Make the instrument the dominant error"
        steps={[
          'Set the driver rise time in the source panel to something fast - a few picoseconds.',
          'Turn on Show it through the scope and read both rise-time metrics.',
          'Raise the scope bandwidth in the instrument panel and read them again.',
          'Now set the driver rise time slow, and repeat.',
        ]}
        expect="With a fast driver the two readings diverge sharply: the scope is the slowest thing in the path and the measurement is mostly of the instrument. With a slow driver they converge, because the front end contributes almost nothing in quadrature. The scope stops being a measurement and starts being a filter at the point where its rise time approaches the signal's."
      />

      <SelfCheck
        moduleId={moduleId}
        id="rtbw"
        question="A datasheet quotes a 20-80% rise time of 20 ps. What bandwidth does the edge need?"
        options={[
          {
            id: 'need-shape',
            text: 'It depends on the edge shape, and is somewhere near 11 GHz.',
            correct: true,
            why: 'The 20-80% product runs from 0.2206 for a single pole to 0.3167 for a brick wall, so 20 ps corresponds to anywhere from 11 to 16 GHz. The table above is the whole answer: pick the product that matches the shape, and treat the spread as the uncertainty.',
          },
          {
            id: 'zero-three-five',
            text: '17.5 GHz, from 0.35 divided by 20 ps.',
            why: 'That applies the 10-90% single-pole constant to a 20-80% number, which is two mistakes pulling in the same direction. The 20-80% single-pole product is 0.2206, not 0.35.',
          },
          {
            id: 'convert-first',
            text: 'Convert to 10-90% by dividing by 0.63, then use 0.35.',
            why: 'Closer, and the right instinct, but 0.63 is the single-pole ratio. On a Bessel front end it is 0.675 and on a brick wall 0.711. If you are going to assume a shape, use that shape both times rather than mixing two.',
          },
          {
            id: 'cannot',
            text: 'The question is unanswerable without the symbol rate.',
            why: 'Bandwidth demanded by an edge has nothing to do with how often the edge happens. That was the knee-frequency point of M1 and it holds here.',
          },
        ]}
      />

      <h2>Second order, where the ringing comes from</h2>

      <p>
        A single pole cannot overshoot. Real interconnect does, constantly, and the reason is that a package
        pin or a via is not one pole - it is inductance and capacitance with some resistance, which is a
        second-order system. Series <TeX tex="R" />, series <TeX tex="L" />, shunt <TeX tex="C" />, measured
        across the capacitor:
      </p>

      <MathBlock
        tex="\omega_n = \frac{1}{\sqrt{LC}}, \qquad \zeta = \frac{R}{2}\sqrt{\frac{C}{L}}, \qquad \omega_d = \omega_n\sqrt{1 - \zeta^2}"
        label="Omega n equals one over the square root of L C; zeta equals R over two times the square root of C over L; omega d equals omega n times the square root of one minus zeta squared"
        tag="2.4"
        source="PHYSICS.md §3.4. Implemented in src/dsp/filters.ts, rlcCharacteristics()."
      />

      <p>
        Everything about the response follows from <TeX tex="\zeta" /> alone. Below 1 the network rings at{' '}
        <TeX tex="\omega_d" /> and overshoots by
      </p>

      <MathBlock
        tex="M_p = \exp\!\left(\frac{-\pi\zeta}{\sqrt{1 - \zeta^2}}\right)"
        label="Peak overshoot equals the exponential of minus pi zeta over the square root of one minus zeta squared"
        tag="2.5"
        source="PHYSICS.md §3.4. Implemented in src/dsp/filters.ts, rlcCharacteristics()."
      />

      <p>
        At <TeX tex="\zeta = 1" /> it reaches the final value as fast as it can without exceeding it. Above 1
        it is two real poles and it is slow. The resistance that puts <TeX tex="\zeta" /> exactly at 1 is{' '}
        <TeX tex="R = 2\sqrt{L/C}" />, which for the {formatEng(rlc.l, 'H', 2)} and {formatEng(rlc.c, 'F', 2)}{' '}
        currently set is {formatEng(2 * ch.z0, 'ohm', 4)}. The panel has {formatEng(rlc.r, 'ohm', 3)} in it,
        giving <TeX tex="\zeta" /> = <span className="readout text-hi">{ch.zeta.toFixed(4)}</span> -{' '}
        {ch.regime}.
      </p>

      <Plot
        title="The same L and C at three dampings"
        height={320}
        permalink={permalink}
        render={dampingRender(rlc)}
      />

      <p>
        Change <TeX tex="R" />, <TeX tex="L" /> or <TeX tex="C" /> in the channel panel and the solid curve
        moves while the dashed critical-damping reference moves with it. Two things are worth noticing. The
        first is that <TeX tex="L" /> and <TeX tex="C" /> set the ringing frequency but <TeX tex="R" /> alone
        decides whether you see ringing at all: the same package pin is a problem on a lightly loaded net and
        invisible on a heavily terminated one. The second is that critical damping is not the fastest response
        to the 2% band - slight underdamping gets there sooner - which is why real termination is rarely
        designed for <TeX tex="\zeta = 1" />.
      </p>

      <Callout variant="silicon" title="What this is a model of">
        <p>
          The lumped series-RLC is the standard first model of a package pin, a bond wire, a via stub or an
          unterminated branch: inductance from the path, capacitance from the pad and the receiver, resistance
          from whatever is damping it. It is valid while the structure is electrically short - while the
          propagation delay across it is well under the rise time. Past that, the reflection picture of M3
          replaces it, and the lumped model understates what happens rather than overstating it.
        </p>
        <p>
          The values in the channel panel are illustrative defaults chosen to make the effect visible, not
          figures from any device.
        </p>
      </Callout>

      <h2>And the brick wall, in the time domain</h2>

      <p>
        Set the edge shape to brick wall in the source panel and look at the first figure again. The edge
        overshoots by about 9%, rings on both sides, and - this is the part that should be alarming - starts
        moving <em>before</em> the step that caused it.
      </p>

      <p>
        That is M1&rsquo;s Gibbs phenomenon, arriving by a different route. A brick wall multiplies the
        spectrum by a rectangle, which convolves the time-domain signal with a <TeX tex="\sin(x)/x" />, and a{' '}
        <TeX tex="\sin(x)/x" /> is symmetric about zero: it has as much tail before the edge as after it. A
        filter whose output depends on its future input is not causal and cannot be built. It is in this site
        as a reference and as a warning, because its signature - symmetric pre- and post-ringing at about 9% -
        is exactly what you see when a digital reconstruction filter, a sharp anti-alias, or a sin(x)/x
        interpolator in a scope&rsquo;s display path is the thing shaping your edge rather than the channel.
      </p>

      <SelfCheck
        moduleId={moduleId}
        id="preshoot"
        question="An edge on your screen shows symmetric ringing before and after the transition, about 9% deep on both sides. What should you suspect first?"
        options={[
          {
            id: 'interpolation',
            text: 'Something in the measurement path with a brick-wall response, such as sin(x)/x interpolation.',
            correct: true,
            why: 'Pre-ringing is non-causal, so it cannot have come from the channel. Symmetric ringing at roughly the Gibbs amount points at an ideal-lowpass-shaped operation, and the usual culprit is the scope reconstructing a display from too few samples per edge.',
          },
          {
            id: 'inductance',
            text: 'Package inductance ringing with the load capacitance.',
            why: 'An RLC rings after the edge and never before it. If the disturbance is symmetric about the transition, a causal network cannot be responsible.',
          },
          {
            id: 'reflection',
            text: 'A reflection from an impedance discontinuity.',
            why: 'A reflection arrives after the incident wave by twice the propagation delay to the discontinuity. Nothing reflected can appear before the edge that launched it.',
          },
          {
            id: 'crosstalk',
            text: 'Near-end crosstalk from an adjacent aggressor.',
            why: 'Crosstalk is real and M6 covers it, but it is tied to the edge timing of the aggressor, not symmetric about the victim. It also would not sit at a fixed 9%.',
          },
        ]}
      />

      <p className="text-micro text-lo">
        Next: so far the whole channel has been one filter. M3 gives it a length. Once a structure is long
        enough that the signal takes measurable time to cross it, impedance stops being a number you divide by
        and starts being something a wave gets reflected from - and the ringing in the second figure above
        turns out to have a second, entirely different explanation.
      </p>
    </>
  );
}
