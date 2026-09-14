/**
 * M3: where the second edge came from.
 *
 * M2 treated the interconnect as one lumped filter. That is valid while the signal
 * crosses the structure in a time short compared with its edge, and this module is
 * about what happens after that stops being true. The line acquires a delay and an
 * impedance, the driver launches a wave into that impedance without knowing what
 * is at the far end, and every mismatch sends part of the wave back.
 *
 * Three figures from one `runJob('tline', ...)`: the reflection lattice drawn from
 * the closed form, the waveform at both ends drawn from the simulator with the
 * lattice's staircase over it, and the display of a 50 ohm TDR looking into the
 * same line. The tables are evaluated, not quoted: the critical-length table calls
 * `criticalLength`, the termination table calls `bounceDiagram` for each scheme,
 * and the self-check answers are computed from `tdrDistance` and
 * `apparentSecondReflection`.
 */

import { useMemo, useState } from 'react';
import { Callout, IllustrativeNotice, Math as TeX, MathBlock, Plot, SelfCheck, TryThis } from '../../ui';
import { ChannelKindNotice } from '../ChannelKindNotice';
import { ParamRow, ParamSelect, ParamSlider, ParamToggle } from '../params';
import { riseTimeBandwidthProduct } from '../../dsp/filters';
import { edgeResponseOf, TDR_REFERENCE_OHMS } from '../../dsp/jobs';
import { formatEng } from '../../plots/scale';
import {
  apparentSecondReflection,
  bounceDiagram,
  criticalLength,
  delayPerMetre,
  effectivePermittivity,
  impedanceFromReflection,
  propagationDelay,
  reflectionCoefficient,
  tdrDistance,
} from '../../sim/channel/tline';
import { useScenario } from '../../state/store';
import { permalinkFor } from '../../state/url-codec';
import { useJob } from '../../workers/use-job';
import { latticeRender, tdrRender, waveformRender } from './plots';

/** Fractions of the rise time the critical-length rules of thumb use. */
const CRITICAL_FRACTIONS: readonly { fraction: number; label: string }[] = [
  { fraction: 1 / 2, label: '1/2' },
  { fraction: 1 / 4, label: '1/4' },
  { fraction: 1 / 6, label: '1/6' },
  { fraction: 1 / 10, label: '1/10' },
];

/** A far end this many ohms is treated as open, here and in the Scenario default. */
const OPEN = 1e6;

type TdrAxis = 'time' | 'distance';

export function M3({ moduleId }: { moduleId: string }): JSX.Element {
  const [scenario] = useScenario();
  const src = scenario.source;
  const line = scenario.channel.tline;

  // Job parameters, not Scenario fields: how much of the line's history to compute
  // and how to draw it are properties of this experiment, not of the link.
  const [delays, setDelays] = useState(10);
  const [rows, setRows] = useState(8);
  const [showSource, setShowSource] = useState(false);
  const [showLattice, setShowLattice] = useState(true);
  const [axis, setAxis] = useState<TdrAxis>('time');

  const { data, running, progress } = useJob('tline', scenario, {
    samples: 8192,
    delays,
    minRiseTimes: 40,
    includeTdr: true,
  });

  const td = propagationDelay(line);
  const swing = src.amplitude;

  // The rules of thumb are stated against a 10-90% rise time. The Scenario states
  // the driver at 20-80%, so convert through the product for the modelled shape
  // rather than with a fixed factor that is only right for one of them.
  const rise1090 = useMemo(() => {
    const shape = edgeResponseOf(src);
    return (
      (src.riseTime * riseTimeBandwidthProduct(shape, 0.1, 0.9)) / riseTimeBandwidthProduct(shape, 0.2, 0.8)
    );
  }, [src]);

  const critical = useMemo(
    () =>
      CRITICAL_FRACTIONS.map((c) => ({
        ...c,
        length: criticalLength(rise1090, line.velocityFactor, c.fraction),
      })),
    [rise1090, line.velocityFactor],
  );

  const terminations = useMemo(() => {
    const schemes = [
      { key: 'none', name: 'Unterminated', sourceZ: src.sourceZ, loadZ: OPEN },
      { key: 'series', name: 'Series, at the driver', sourceZ: line.z0, loadZ: OPEN },
      { key: 'parallel', name: 'Parallel, at the receiver', sourceZ: src.sourceZ, loadZ: line.z0 },
      { key: 'both', name: 'Both ends', sourceZ: line.z0, loadZ: line.z0 },
    ];
    return schemes.map((sc) => {
      const b = bounceDiagram({ ...line, sourceZ: sc.sourceZ, loadZ: sc.loadZ, amplitude: swing }, 64);
      const far = b.events.filter((e) => e.end === 'far');
      const final = b.steadyState;
      let peak = -Infinity;
      for (const e of far) peak = Math.max(peak, e.level);
      return {
        ...sc,
        gammaSource: b.gammaSource,
        gammaLoad: b.gammaLoad,
        shelf: b.launch / final,
        firstArrival: far.length > 0 ? far[0].level / final : 0,
        overshoot: Math.max(0, (peak - final) / final),
        current: (src.dcOffset + swing / 2) / (sc.sourceZ + sc.loadZ),
      };
    });
  }, [line, src.sourceZ, src.dcOffset, swing]);

  const rPar = (line.loadZ * line.z0) / (line.loadZ + line.z0);
  const tau = line.loadC * rPar;

  // Self-check arithmetic, evaluated so the answers cannot disagree with the module.
  const dipTime = 1.34e-9;
  const dipAt = tdrDistance(dipTime, 0.5);
  const g1 = reflectionCoefficient(42, TDR_REFERENCE_OHMS);
  const rhoRead = reflectionCoefficient(73, TDR_REFERENCE_OHMS);
  const g2 = (rhoRead - g1) / (1 - g1 * g1);
  const trueLoad = impedanceFromReflection(g2, 42);
  const checkRho = apparentSecondReflection(g1, g2);

  const permalink =
    typeof window === 'undefined'
      ? undefined
      : permalinkFor(moduleId, '', scenario, window.location.origin, window.location.pathname);

  const progressPct = progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0;
  const drawn = Math.min(rows, 2 * line.bounces);

  return (
    <>
      <p className="text-lead text-hi">
        M2 ended on a lumped network: one inductance, one capacitance, one resistance, all at a single point.
        That picture assumes the signal reaches every part of the structure at the same instant. On a board
        route it does not. The edge takes time to travel, and once that time is comparable with the edge
        itself, the driver launches a wave without knowing what is at the far end - and whatever is there
        sends part of the wave back.
      </p>

      <ChannelKindNotice
        kind="tline"
        controls={['Line impedance', 'Length', 'Velocity factor', 'Far-end load', 'Far-end C']}
      />

      <h2>Lumped or distributed</h2>

      <p>
        A signal on a line travels at a fraction of the speed of light set by the dielectric the field lives
        in. The one-way delay is the length divided by that velocity:
      </p>

      <MathBlock
        tex="t_d = \frac{\ell}{v}, \qquad v = v_f\,c = \frac{c}{\sqrt{\varepsilon_{r,\mathrm{eff}}}}"
        label="Delay equals length over velocity; velocity equals velocity factor times c, which equals c over the square root of the effective relative permittivity"
        tag="3.1"
        source="PHYSICS.md §12.1. Implemented in src/sim/channel/tline.ts, propagationDelay() and effectivePermittivity()."
      />

      <p>
        At the velocity factor in the channel panel, {line.velocityFactor.toFixed(3)} (an effective
        permittivity of {effectivePermittivity(line.velocityFactor).toFixed(2)}), that is{' '}
        {formatEng(delayPerMetre(line.velocityFactor) * 1e-3, 's', 4)} per millimetre, and the{' '}
        {formatEng(line.length, 'm', 3)} line has a one-way delay of{' '}
        <span className="readout text-hi">{formatEng(td, 's', 4)}</span>.
      </p>

      <p>
        Whether that delay matters depends on the edge. The usual test is to compare the delay with the rise
        time, and call the structure electrically long when the delay exceeds some fraction of it. Which
        fraction depends on which book you read, because it is a judgement about how large a reflection you
        are willing to ignore, not a physical threshold. Here are the common ones for the driver in the source
        panel, whose {formatEng(src.riseTime, 's', 3)} 20-80% rise time is {formatEng(rise1090, 's', 3)} at
        10-90% for its edge shape:
      </p>

      <MathBlock
        tex="\ell_{\mathrm{crit}} = k\, v\, t_r"
        label="Critical length equals k times velocity times rise time"
        tag="3.2"
        source="PHYSICS.md §12.1. Implemented in src/sim/channel/tline.ts, criticalLength()."
      />

      <div className="my-5 overflow-x-auto">
        <table className="w-full border-collapse text-micro">
          <caption className="mb-2 text-left text-micro text-lo">
            Length beyond which the line is treated as distributed, for the 10-90% rise time above, from{' '}
            <span className="readout">criticalLength</span>. The line in the channel panel is{' '}
            {formatEng(line.length, 'm', 3)}.
          </caption>
          <thead>
            <tr className="border-b border-rule text-lo">
              <th scope="col" className="py-1 text-left font-normal">
                Rule, <TeX tex="k" />
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Critical length
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                This line
              </th>
            </tr>
          </thead>
          <tbody>
            {critical.map((row) => (
              <tr key={row.label} className="border-b border-rule/40">
                <td className="py-1 text-hi">{row.label}</td>
                <td className="readout py-1 text-right text-hi">{formatEng(row.length, 'm', 3)}</td>
                <td className="readout py-1 text-right" style={{ color: 'var(--ch2)' }}>
                  {line.length > row.length ? 'distributed' : 'lumped'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        The spread is a factor of five. What does not depend on the rule is the direction: a faster edge
        shrinks every row in proportion, so a route that was comfortably lumped at one generation of interface
        is a transmission line at the next without a single trace having moved.
      </p>

      <h2>Characteristic impedance, and what the driver sees</h2>

      <p>
        A line has inductance and capacitance per metre, <TeX tex="L'" /> and <TeX tex="C'" />. A wave moving
        along it charges each new section&rsquo;s capacitance through the inductance behind it, and the ratio
        of voltage to current in that wave is fixed by the two:
      </p>

      <MathBlock
        tex="Z_0 = \sqrt{\frac{L'}{C'}}, \qquad v = \frac{1}{\sqrt{L'C'}}"
        label="Z zero equals the square root of L prime over C prime; velocity equals one over the square root of L prime C prime"
        tag="3.3"
        source="PHYSICS.md §12.2. Implemented in src/sim/channel/tline.ts, characteristicImpedance() and velocityFromPerUnitLength()."
      />

      <p>
        <TeX tex="Z_0" /> is in ohms and dissipates nothing - there is no resistance in it. It does not depend
        on length, because both quantities are per metre. And for the first <TeX tex="2t_d" /> after an edge,
        it is the only load the driver can see: nothing that happens at the far end can reach the driver
        sooner. So the first wave down the line is set by a divider between the driver&rsquo;s own impedance
        and <TeX tex="Z_0" />, regardless of what is connected at the other end:
      </p>

      <MathBlock
        tex="V_{\mathrm{launch}} = V_s\,\frac{Z_0}{R_S + Z_0}"
        label="Launched voltage equals source voltage times Z zero over R S plus Z zero"
        tag="3.4"
        source="PHYSICS.md §12.3. Implemented in src/sim/channel/tline.ts, launchVoltage()."
      />

      <p>
        <TeX tex="V_s" /> here is the open-circuit swing of the driver, which is how this site reads the
        amplitude in the source panel. A datasheet swing measured into a stated load is a different number.
      </p>

      <h2>The reflection coefficient</h2>

      <p>
        When the wave reaches an impedance <TeX tex="Z" /> that is not <TeX tex="Z_0" />, voltage and current
        cannot both satisfy the line and the termination with only the incident wave present. A reflected wave
        makes up the difference, and its size relative to the incident one is
      </p>

      <MathBlock
        tex="\Gamma = \frac{Z - Z_0}{Z + Z_0}, \qquad V_{\mathrm{node}} = (1 + \Gamma)\,V_{\mathrm{inc}}"
        label="Gamma equals Z minus Z zero over Z plus Z zero; the node voltage equals one plus gamma times the incident voltage"
        tag="3.5"
        source="PHYSICS.md §12.3. Implemented in src/sim/channel/tline.ts, reflectionCoefficient() and bounceDiagram()."
      />

      <p>
        An open end has <TeX tex="\Gamma = +1" />: the voltage at it is twice the incident wave, which is
        where an unterminated far end&rsquo;s overshoot comes from. A short has <TeX tex="\Gamma = -1" /> and
        holds zero. A match has <TeX tex="\Gamma = 0" /> and absorbs the wave. The reflected wave travels back
        to the driver, where the same rule applies with <TeX tex="R_S" /> in place of <TeX tex="Z" />, and the
        process repeats. With the source panel at {formatEng(src.sourceZ, 'Ω', 3)} and the channel at{' '}
        {formatEng(line.z0, 'Ω', 3)} into {formatEng(line.loadZ, 'Ω', 3)}, the two coefficients are{' '}
        <span className="readout text-hi">{reflectionCoefficient(src.sourceZ, line.z0).toFixed(4)}</span> and{' '}
        <span className="readout text-hi">{reflectionCoefficient(line.loadZ, line.z0).toFixed(4)}</span>.
      </p>

      <h2>The lattice</h2>

      <p>
        Draw the line across the page and time down it, and every wave is a diagonal. Each arrival multiplies
        the wave by the coefficient at that end and sends the product back. Adding up what has arrived at an
        end gives its voltage, a staircase in steps of <TeX tex="2t_d" />. The sum is a geometric series in{' '}
        <TeX tex="\Gamma_S\Gamma_L" />, and it converges to a value in which <TeX tex="Z_0" /> does not
        appear:
      </p>

      <MathBlock
        tex="V_\infty = V_{\mathrm{launch}}\,\frac{1 + \Gamma_L}{1 - \Gamma_S\Gamma_L} = V_s\,\frac{R_L}{R_S + R_L}"
        label="The final voltage equals the launched voltage times one plus gamma L over one minus gamma S gamma L, which equals V s times R L over R S plus R L"
        tag="3.6"
        source="PHYSICS.md §12.4. Implemented in src/sim/channel/tline.ts, bounceDiagram() and steadyStateVoltage()."
      />

      <p>
        That is the resistive divider you would have written down without ever hearing of a transmission line.
        The line changes how the voltage gets there, never where it ends up.
      </p>

      <ParamRow>
        <ParamSlider
          label="Lattice rows"
          value={rows}
          min={2}
          max={24}
          step={1}
          format={(v) => `${Math.min(v, 2 * line.bounces)} one-way trips`}
          hint="Capped at twice the Round trips control in the channel panel."
          onChange={setRows}
        />
        <ParamSlider
          label="Record length"
          value={delays}
          min={2}
          max={40}
          step={1}
          format={(v) => `${v} delays`}
          hint="How long after the step to simulate, in one-way delays."
          onChange={setDelays}
        />
        <ParamToggle
          label="Show the lattice staircase"
          value={showLattice}
          hint="Overlays the closed form on the simulated waveforms."
          onChange={setShowLattice}
        />
        <ParamToggle
          label="Show the source"
          value={showSource}
          hint="The open-circuit voltage behind the driver impedance."
          onChange={setShowSource}
        />
        <ParamSelect<TdrAxis>
          label="TDR horizontal axis"
          value={axis}
          options={[
            { value: 'time', label: 'Round-trip time' },
            { value: 'distance', label: 'Distance' },
          ]}
          onChange={setAxis}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="Reflection lattice"
          height={360}
          busy={running}
          progress={progressPct}
          permalink={permalink}
          render={latticeRender(data, { length: line.length, rows: drawn, loadC: line.loadC })}
        />
      ) : (
        <p className="text-lo">Computing the line&hellip;</p>
      )}

      <p>
        Here is the same thing as two probes would see it, one on the driver pin and one on the receiver pad.
        The solid traces are the simulation, which carries the driver&rsquo;s real rise time; the dotted ones
        are the staircase from the lattice above. They agree on every plateau and disagree only on the edges,
        which the lattice draws as vertical.
      </p>

      {data ? (
        <Plot
          title="The same edge at both ends of the line"
          height={340}
          busy={running}
          progress={progressPct}
          permalink={permalink}
          render={waveformRender(data, { showSource, showLattice, loadC: line.loadC })}
          data={() => ({
            x: data.t,
            series: [
              { key: 'source', values: data.source },
              { key: 'near', values: data.near },
              { key: 'far', values: data.far },
            ],
          })}
        />
      ) : null}

      <p>
        Read the driver pin first. It rises to the launched level, sits there for <TeX tex="2t_d" /> while the
        wave is away, and moves again only when the reflection comes home. A probe there is measuring the
        line&rsquo;s history, not the signal the receiver gets. The receiver pad shows nothing for{' '}
        <TeX tex="t_d" />, then the incident wave and its reflection arrive together - which, into a near-open
        end, is nearly double the launch.
      </p>

      <TryThis
        title="Make the far end ring, then stop it"
        steps={[
          'Set this up: a 20 ohm driver into an open 50 ohm line.',
          'Read the far-end overshoot and ringback metrics under the second figure.',
          'Raise Source impedance in the transmitter panel towards 50 ohms and watch both fall.',
          'Carry on past 50 ohms, to 100.',
        ]}
        setup={{
          'channel.kind': 'tline',
          'source.sourceZ': 20,
          'channel.tline.loadZ': OPEN,
          'channel.tline.z0': 50,
        }}
        expect="Below 50 ohms the driver's coefficient is negative, so each return trip flips the sign and the far end oscillates around its final value. At 50 ohms the first reflection is absorbed and the far end steps cleanly to its final level in one delay. Above 50 ohms both coefficients are positive, the far end climbs a staircase without overshooting, and it takes many round trips to get there."
      />

      <h2>Termination schemes</h2>

      <p>
        Termination is choosing where to put <TeX tex="\Gamma = 0" />. Matching either end breaks the series
        after one term; matching both breaks it before it starts. The table evaluates each choice for the line
        and driver currently configured.
      </p>

      <div className="my-5 overflow-x-auto">
        <table className="w-full border-collapse text-micro">
          <caption className="mb-2 text-left text-micro text-lo">
            Each scheme through <span className="readout">bounceDiagram</span>, 64 round trips. Shelf and
            first arrival are fractions of the final level; current is DC, at the high level of the source.
          </caption>
          <thead>
            <tr className="border-b border-rule text-lo">
              <th scope="col" className="py-1 text-left font-normal">
                Scheme
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                <TeX tex="\Gamma_S" />
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                <TeX tex="\Gamma_L" />
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Driver shelf
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                First arrival
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Overshoot
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                DC current
              </th>
            </tr>
          </thead>
          <tbody>
            {terminations.map((row) => (
              <tr key={row.key} className="border-b border-rule/40">
                <td className="py-1 text-hi">{row.name}</td>
                <td className="readout py-1 text-right text-hi">{row.gammaSource.toFixed(3)}</td>
                <td className="readout py-1 text-right text-hi">{row.gammaLoad.toFixed(3)}</td>
                <td className="readout py-1 text-right text-hi">{(row.shelf * 100).toFixed(1)}%</td>
                <td className="readout py-1 text-right text-hi">{(row.firstArrival * 100).toFixed(1)}%</td>
                <td className="readout py-1 text-right" style={{ color: 'var(--ch2)' }}>
                  {(row.overshoot * 100).toFixed(2)}%
                </td>
                <td className="readout py-1 text-right text-hi">{formatEng(row.current, 'A', 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Series termination costs no DC current and gives a clean edge at the far end, and pays for it on the
        way: every point along the line sits at half the final level for a while. That is harmless to a single
        receiver at the end and fatal to a receiver in the middle, which would see a shelf sitting across its
        threshold. It is a point-to-point scheme. Parallel termination gives a clean edge everywhere, at the
        price of a DC path through the terminator and a final swing reduced by the divider with the driver.
      </p>

      <p>
        Where the terminator returns to does not change any of this. To the wave, a resistor to ground and a
        resistor to a supply rail are the same impedance, because a decoupled rail is an AC ground; the rail
        changes only the DC levels the edge moves between, and which logic state draws current.
      </p>

      <Callout variant="silicon" title="Termination in a memory interface">
        <p>
          A DDR-class interface does not use a discrete resistor for either end. The driver&rsquo;s output
          impedance is a programmable array of transistor legs, calibrated against an external precision
          reference, and the receiver has on-die termination whose value is selected by mode register and can
          differ between reading and writing. DDR4 and DDR5 data lines use pseudo-open-drain signalling, with
          the termination tied to the I/O supply, so the termination draws current only when the line is
          driven low. LPDDR4 and LPDDR5 use low-voltage swing-terminated logic instead, terminated to ground,
          which draws current only when driven high. The values and the register encodings are in JESD79-5
          (DDR5) and JESD209-5 (LPDDR5); this site does not reproduce them.
        </p>
        <p>
          Two consequences worth carrying into the lab. Because the termination is on the die, the only point
          where the line is actually matched is inside the package, past a bond wire or bump and a package
          trace - so the best termination setting is the one that makes the waveform right <em>at the die</em>
          , which is not where a probe can go. And because it is programmable, &ldquo;the impedance of the
          driver&rdquo; is a setting under test, not a fixed property of the part.
        </p>
      </Callout>

      <Callout variant="silicon" title="First-incident switching">
        <p>
          A receiver switches on the <em>first</em> wave to arrive only if that wave crosses its threshold.
          When the launched level falls short - a weak driver, a heavy load, or a receiver partway along a
          series-terminated route - the receiver waits for a reflection to lift the line the rest of the way.
          Its timing then includes a round trip of the line beyond it, and it moves when that length changes.
          On the bench this looks like a timing margin that jumps rather than degrades as a route is
          lengthened or a termination setting is stepped: two separate mechanisms, not one getting worse.
        </p>
      </Callout>

      <h2>A capacitive load</h2>

      <p>
        A receiver is not a resistor. Its pad, its ESD structure and its input stage add capacitance across
        the termination, and a capacitor has no single reflection coefficient: at the instant the edge arrives
        it is uncharged and looks like a short, and once charged it looks like nothing. For an ideal step of
        amplitude <TeX tex="A" /> arriving at <TeX tex="R_L" /> in parallel with <TeX tex="C" />,
      </p>

      <MathBlock
        tex="V_{\mathrm{ref}}(t) = A\left[\Gamma_R - (1 + \Gamma_R)\,e^{-t/\tau}\right], \qquad \tau = C\,(R_L \parallel Z_0)"
        label="The reflected voltage equals A times gamma R minus one plus gamma R times e to the minus t over tau, with tau equal to C times R L in parallel with Z zero"
        tag="3.7"
        source="PHYSICS.md §12.5. Implemented in src/sim/channel/tline.ts, rcLoadReflection(); simulated by simulateLine()."
      />

      <p>
        The reflection starts at <TeX tex="-A" /> whatever the resistor is, and relaxes to the resistive
        value. The capacitor charges through <TeX tex="Z_0" /> in parallel with <TeX tex="R_L" />, so the
        far-end edge becomes a single-pole edge with a 10-90% rise time of <TeX tex="\tau\ln 9" /> (equation
        2.2 of M2) for an ideal incident step.{' '}
        {line.loadC > 0 ? (
          <>
            The {formatEng(line.loadC, 'F', 3)} in the channel panel, across {formatEng(rPar, 'Ω', 3)}, gives{' '}
            <TeX tex="\tau" /> = <span className="readout text-hi">{formatEng(tau, 's', 3)}</span> and adds a
            rise time of <span className="readout text-hi">{formatEng(tau * Math.log(9), 's', 3)}</span>.
          </>
        ) : (
          <>Far-end C in the channel panel is currently zero; set it to a picofarad to see this.</>
        )}
      </p>

      <TryThis
        title="A perfect termination that is not"
        steps={[
          'Set this up: a matched 50 ohm driver, line and load.',
          'Confirm the far end steps once and the TDR is flat.',
          'Raise Far-end C in the channel panel to 1 pF, then 3 pF.',
        ]}
        setup={{
          'channel.kind': 'tline',
          'source.sourceZ': 50,
          'channel.tline.z0': 50,
          'channel.tline.loadZ': 50,
          'channel.tline.loadC': 0,
        }}
        expect="The resistor is still a perfect match, and the far-end edge still slows and the driver pin still shows a negative notch one round trip after the launch. The TDR dips below 50 ohms at the load and recovers to it. A resistive match only matches at frequencies where the capacitance is negligible, and a fast edge is made of exactly the frequencies where it is not."
      />

      <h2>Time-domain reflectometry</h2>

      <p>
        A TDR is the lattice run backwards. The instrument launches a fast step from a matched source,
        typically 50 ohms, and records the voltage at its own port. Because the source is matched to the
        reference, the incident wave is half the step. Whatever the port shows beyond that is reflection, and
        each sample is converted as though it had come from a single interface against the reference:
      </p>

      <MathBlock
        tex="\rho(t) = \frac{V_{\mathrm{port}}(t) - V_{\mathrm{inc}}(t)}{V_{\mathrm{inc}}}, \qquad Z(t) = Z_{\mathrm{ref}}\,\frac{1 + \rho(t)}{1 - \rho(t)}"
        label="Rho of t equals port voltage minus incident voltage over incident voltage; apparent impedance equals Z ref times one plus rho over one minus rho"
        tag="3.8"
        source="PHYSICS.md §12.6. Implemented in src/sim/channel/tline.ts, tdrReflection() and tdrImpedance()."
      />

      <p>
        The horizontal axis is round-trip time. The distance to a feature is half of what that time implies:
      </p>

      <MathBlock
        tex="d = \frac{v\,t}{2}"
        label="Distance equals velocity times time over two"
        tag="3.9"
        source="PHYSICS.md §12.6. Implemented in src/sim/channel/tline.ts, tdrDistance()."
      />

      {data ? (
        <Plot
          title="What a TDR shows, looking into this line"
          height={320}
          busy={running}
          progress={progressPct}
          permalink={permalink}
          render={tdrRender(data, {
            velocityFactor: line.velocityFactor,
            z0: line.z0,
            loadZ: line.loadZ,
            loadC: line.loadC,
            axis,
            reference: TDR_REFERENCE_OHMS,
          })}
          data={() => ({ x: data.t, series: [{ key: 'tdr', values: data.tdrZ }] })}
        />
      ) : null}

      <p>
        The first discontinuity reads exactly. Everything after it does not, because a later reflection
        reaches the instrument only after crossing the first interface twice, once in each direction. For a
        section of coefficient <TeX tex="\Gamma_1" /> against the reference, followed by an interface of
        coefficient <TeX tex="\Gamma_2" />, the instrument reads
      </p>

      <MathBlock
        tex="\rho_2 = \Gamma_1 + (1 + \Gamma_1)(1 - \Gamma_1)\,\Gamma_2 = \Gamma_1 + (1 - \Gamma_1^2)\,\Gamma_2"
        label="Rho two equals gamma one plus one plus gamma one times one minus gamma one times gamma two, which equals gamma one plus one minus gamma one squared times gamma two"
        tag="3.10"
        source="PHYSICS.md §12.6. Implemented in src/sim/channel/tline.ts, apparentSecondReflection()."
      />

      <p>
        and converts it against 50 ohms rather than against <TeX tex="Z_1" />. A 40 ohm section in front of a
        75 ohm load reads the load as 73.38 ohms: 2% low, small enough to believe and large enough to fail a
        tight impedance coupon. Set the line impedance and load in the channel panel and read the two TDR
        metrics against their targets.
      </p>

      <p>
        Resolution is set by the edge. Two features whose round trips differ by less than about one rise time
        of the step merge into one, which at the velocity factor above and a step as fast as this
        driver&rsquo;s 10-90% edge is about{' '}
        <span className="readout text-hi">
          {formatEng(tdrDistance(rise1090, line.velocityFactor), 'm', 2)}
        </span>{' '}
        of line - a rule of thumb, since what counts as resolved depends on the edge shape and on how small a
        feature you need to see.
      </p>

      <Callout
        variant="bench"
        title="Reading reflections on real instruments"
        controls={[
          'TDR/TDT option',
          'Step rise-time filter',
          'Reference plane',
          'Vertical units: rho or ohms',
          'Averaging',
        ]}
      >
        <p>
          Sampling scopes with a TDR module, and some real-time scopes with a TDR option, launch the step and
          do the conversion above for you. Three settings decide whether the display is a measurement. The
          reference plane: without calibrating it to the end of the fixture, the cable and connector are
          displayed as part of the line, and every time and distance is offset by them. The rise-time filter:
          most instruments let you slow the displayed step in software to match the edge the link will
          actually see, which trades resolution for relevance and is usually the right trade. And the vertical
          units: in rho, a later feature at least reads as the apparent coefficient it is; in ohms it looks
          like an impedance and invites the reading this section just warned against.
        </p>
        <p>
          On a real-time scope without TDR, the near-end shelf is still there to be read. Probe the driver pin
          of a series-terminated route and the shelf length is <TeX tex="2t_d" /> of the route; average over a
          repetitive pattern to pull a small reflection out of the noise. Two cautions. A probe&rsquo;s tip
          capacitance is itself a capacitive load, so it adds a notch of its own (M10, on measuring in the
          lab, returns to it). And a long ground lead on the probe rings with that capacitance, producing
          oscillation that looks exactly like a reflection and is not one - if ringing changes when you change
          the ground connection, it is the probe.
        </p>
      </Callout>

      <SelfCheck
        moduleId={moduleId}
        id="shelf"
        question="You probe the driver pin of a point-to-point, series-terminated data line. The edge rises to about half its final value, stays there for 1.2 ns, and then completes. What does this tell you?"
        options={[
          {
            id: 'expected',
            text: 'The line is behaving as designed, and has a one-way delay of about 600 ps.',
            correct: true,
            why: 'A matched series terminator launches half the swing, and the driver pin completes the edge when the open far end sends the other half back, one round trip later. The receiver at the far end sees a single clean edge. The shelf is diagnostic, not a defect: its length is twice the line delay.',
          },
          {
            id: 'weak',
            text: 'The driver is too weak to complete the transition.',
            why: 'A weak driver would slow the whole edge, not stop at a level set by an impedance ratio and then resume after a fixed time. The resumption is the reflection arriving.',
          },
          {
            id: 'isi',
            text: 'Inter-symbol interference from the previous bit.',
            why: 'ISI depends on the bit history and changes from edge to edge. This shelf is the same on every edge, with a duration fixed by the route length.',
          },
          {
            id: 'receiver-bad',
            text: 'The receiver will see the same shelf and may switch late.',
            why: 'The receiver is at the far end, where the incident wave and its reflection arrive together. Only points along the line, including the driver pin, see the shelf.',
          },
        ]}
      />

      <SelfCheck
        moduleId={moduleId}
        id="tdr-distance"
        question={`A TDR shows a capacitive dip ${formatEng(dipTime, 's', 3)} after the launch, on a route with a velocity factor of 0.5. Where on the route is it?`}
        options={[
          {
            id: 'half',
            text: `About ${formatEng(dipAt, 'm', 3)} from the reference plane.`,
            correct: true,
            why: `The display is round-trip time. At half the speed of light, ${formatEng(dipTime, 's', 3)} of round trip is ${formatEng(2 * dipAt, 'm', 3)} of travel, so the feature is at half of that.`,
          },
          {
            id: 'double',
            text: `About ${formatEng(2 * dipAt, 'm', 3)} from the reference plane.`,
            why: 'That is the distance the wave travelled, out and back. The classic TDR mistake: it doubles every reported distance.',
          },
          {
            id: 'z0',
            text: 'It cannot be located without knowing the line impedance.',
            why: 'Impedance sets how large the reflection is, not when it arrives. Timing depends only on the velocity, which is what the velocity factor gives you.',
          },
          {
            id: 'rise',
            text: 'It cannot be located to better than the step rise time, so the question has no answer.',
            why: 'Rise time limits how close two features can be and still be told apart, not where a single isolated feature is.',
          },
        ]}
      />

      <SelfCheck
        moduleId={moduleId}
        id="second-feature"
        question="A 50 ohm TDR reads a trace at a steady 42 ohms, and then the termination at the end of it at 73 ohms. What is the termination?"
        options={[
          {
            id: 'corrected',
            text: `About ${formatEng(trueLoad, 'Ω', 3)}: the reading is seen through the 42 ohm section and needs correcting.`,
            correct: true,
            why: `Invert equation 3.10: gamma 2 = (rho - gamma 1)/(1 - gamma 1 squared) = ${g2.toFixed(4)}, against 42 ohms rather than 50, which is ${formatEng(trueLoad, 'Ω', 4)}. Putting that back through 3.10 gives rho = ${checkRho.toFixed(4)}, the 73 ohm reading.`,
          },
          {
            id: 'as-read',
            text: '73 ohms, as displayed.',
            why: 'Only the first discontinuity reads exactly. The termination is seen through the 42 ohm section, crossed twice, and the display converts against 50 ohms.',
          },
          {
            id: 'difference',
            text: '81 ohms: add the 8 ohms the trace is low by.',
            why: 'Reflection coefficients do not combine by adding impedance offsets. The correction here is about one ohm, not eight.',
          },
          {
            id: 'unknowable',
            text: 'It cannot be determined from a TDR.',
            why: 'For a clean two-interface structure it can, exactly, with equation 3.10. What cannot be undone this simply is a structure with many interfaces close together, which is what layer-peeling algorithms exist for.',
          },
        ]}
      />

      <IllustrativeNotice what="The default driver impedance, line impedance, length, velocity factor and load capacitance are illustrative." />

      <p className="text-micro text-lo">
        Next: every line on this page was lossless, so every reflection kept bouncing until a termination
        absorbed it. Real routes lose energy as they go, and lose more of it at higher frequencies. M4 adds
        that loss and shows what it does to an edge that has nothing to reflect from at all.
      </p>
    </>
  );
}
