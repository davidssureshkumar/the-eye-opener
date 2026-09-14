/**
 * M4, second half: measured channels.
 *
 * Everything here is drawn from one `runJob('measured', ...)`. Its input is a
 * `Network`: the Touchstone file the reader loaded, or one of two synthetic
 * four-ports built from the lossy line in the channel panel, a pair over a glass
 * weave and a coupled pair, so the page has something known to run on before a
 * file is loaded. The same path handles all three, which is the point: a file is
 * driven through exactly what the synthetic examples are, and the examples can be
 * saved as .s4p files and loaded back.
 *
 * Which source, the weave and coupling settings, the corruption and the figure
 * views are page state and are not carried by the permalink. Which ports are driven
 * and whether the pair is read differentially are Scenario fields, so they are.
 *
 * The weave figure and the skew and null readouts in the prose are computed from
 * `weaveLegs` on the main thread, so they follow the sliders without waiting for
 * the job; the job computes the same legs, and the tests hold the two together.
 */

import { useEffect, useMemo, useState } from 'react';
import { Callout, Math as TeX, MathBlock, Plot, SelfCheck, TryThis } from '../../ui';
import { ChannelKindNotice } from '../ChannelKindNotice';
import { ParamRow, ParamSelect, ParamSlider, ParamToggle } from '../params';
import { measuredJob, type Corruption, type MeasuredSource } from '../../dsp/jobs/measured-job';
import { downloadBlob } from '../../plots/export';
import { formatEng } from '../../plots/scale';
import { METRES_PER_INCH, type LossyLineSpec } from '../../sim/channel/lossy';
import {
  COUPLING_DEFAULTS,
  coupledPairNetwork,
  linearSweep,
  WEAVE_DEFAULTS,
  weaveLegs,
  weavePairNetwork,
} from '../../sim/touchstone/examples';
import { writeTouchstone } from '../../sim/touchstone/parser';
import { clearNetwork, loadNetworkFile, useNetworkFile } from '../../state/network-store';
import { setScenario, useScenario } from '../../state/store';
import { withPatch } from '../../state/url-codec';
import { useJob } from '../../workers/use-job';
import { routeBudgets } from './budgets';
import {
  causalityRender,
  crosstalkRender,
  ildRender,
  mixedModeRender,
  passivityRender,
  skewRender,
  weaveRender,
} from './measured-plots';
import { streamRender } from './plots';

type IldView = 'fit' | 'deviation';

/** UIs of the causality figure after the later arrival. */
const CAUSALITY_UIS = 8;

/** File extensions a Touchstone reader is offered. Version 2 files may use .ts. */
const TOUCHSTONE_ACCEPT = [...Array.from({ length: 12 }, (_, i) => `.s${i + 1}p`), '.ts'].join(',');

const BUTTON = 'rounded-sm border px-2 py-0.5 text-micro text-hi';

/** A 1-based "in -> out" list of the through paths the job found. */
function wiringOf(lines: readonly { input: number; output: number }[]): string {
  return lines.map((l) => `${l.input + 1} → ${l.output + 1}`).join(', ');
}

export function MeasuredChannel({
  moduleId,
  permalink,
}: {
  moduleId: string;
  permalink: string | undefined;
}): JSX.Element {
  const [scenario] = useScenario();
  const src = scenario.source;
  const line = scenario.channel.lossy;
  const ts = scenario.channel.touchstone;
  const nyquist = src.symbolRate / 2;
  const ui = 1 / src.symbolRate;

  const { file, error, loading } = useNetworkFile();

  const [source, setSource] = useState<MeasuredSource>(file ? 'file' : 'weave');
  const [offset, setOffset] = useState(WEAVE_DEFAULTS.offset);
  const [angle, setAngle] = useState(WEAVE_DEFAULTS.angleDeg);
  const [k, setK] = useState(COUPLING_DEFAULTS.k);
  const [corruption, setCorruption] = useState<Corruption>('none');
  const [minimumPhase, setMinimumPhase] = useState(false);
  const [ildView, setIldView] = useState<IldView>('fit');

  // A file that has just loaded is what the reader wants to see; a file that has
  // gone leaves nothing for the 'file' source to run on.
  useEffect(() => {
    if (file) setSource('file');
    else setSource((s) => (s === 'file' ? 'weave' : s));
  }, [file]);

  const weave = useMemo(() => ({ ...WEAVE_DEFAULTS, offset, angleDeg: angle }), [offset, angle]);
  const coupling = useMemo(() => ({ ...COUPLING_DEFAULTS, k }), [k]);
  const legs = useMemo(() => weaveLegs(weave, line), [weave, line]);

  const params = useMemo(
    () => ({
      source,
      network: file?.network ?? null,
      weave,
      coupling,
      corruption,
      minimumPhase,
    }),
    [source, file, weave, coupling, corruption, minimumPhase],
  );
  const { data, running, progress } = useJob('measured', scenario, params);
  const busy = running;
  const progressPct = progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0;

  const pair = data?.mode === 'differential';
  const setMixedMode = (on: boolean) =>
    setScenario(withPatch(scenario, { 'channel.touchstone.mixedMode': on }), false);

  const downloadExample = (kind: 'weave' | 'coupled') => {
    const { sweepStep, sweepMultiple } = measuredJob.defaults;
    const count = Math.max(16, Math.min(4000, Math.ceil((sweepMultiple * nyquist) / sweepStep)));
    const freq = linearSweep(sweepStep, count);
    const net =
      kind === 'coupled'
        ? coupledPairNetwork(line, coupling, freq)
        : weavePairNetwork(line, weave, freq).network;
    const header = [
      `Anatomy of an Edge: synthetic ${kind === 'coupled' ? 'coupled pair' : 'pair over a glass weave'}.`,
      'Computed from a model with illustrative values. Not a measurement of any product.',
      kind === 'coupled' ? 'Ports: 1 -> 2 victim, 3 -> 4 aggressor.' : 'Ports: 1 -> 2 P leg, 3 -> 4 N leg.',
    ];
    const text = writeTouchstone(net, 'RI', header);
    downloadBlob(
      new Blob([text], { type: 'text/plain' }),
      kind === 'coupled' ? 'coupled-pair.s4p' : 'woven-pair.s4p',
    );
  };

  const sourceOptions: { value: MeasuredSource; label: string }[] = [
    { value: 'weave', label: 'Synthetic: pair over a glass weave' },
    { value: 'coupled', label: 'Synthetic: coupled pair' },
    ...(file ? [{ value: 'file' as const, label: `Loaded file: ${file.name}` }] : []),
  ];

  const skewPerInch = (legs.skew * METRES_PER_INCH) / line.length;

  return (
    <>
      <h2>Measured channels: S-parameters</h2>

      <p>
        Everything above came from a model of a line whose every dimension was known. A real channel is a
        route, two or more vias, a connector, a package and a socket, and nobody models that from first
        principles to the accuracy an eye needs. It is measured instead, with a vector network analyser, and
        the measurement is a matrix: for <TeX tex="N" /> ports, the wave <TeX tex="b_i" /> leaving port{' '}
        <TeX tex="i" /> for a wave <TeX tex="a_j" /> arriving at port <TeX tex="j" />, at every frequency of
        the sweep, <TeX tex="b = S\,a" />. <TeX tex="S_{11}" /> is what port 1 reflects, the return loss of
        M3&rsquo;s mismatches; <TeX tex="S_{21}" /> is what reaches port 2 from port 1, the insertion loss
        above. A Touchstone file (.s2p, .s4p and so on) is that matrix written out as text, with the reference
        impedance the waves were defined against.
      </p>

      <p>
        Waves are defined against a reference, and a file measured against one can be read against another.
        With the reference of each port changing from <TeX tex="Z" /> to <TeX tex="Z'" />, the same network is
      </p>

      <MathBlock
        tex="S' = (Q + P\,S)\,(P + Q\,S)^{-1}, \qquad P = \frac{Z + Z'}{2\sqrt{Z Z'}}, \quad Q = \frac{Z - Z'}{2\sqrt{Z Z'}}"
        label="S prime equals Q plus P S, times the inverse of P plus Q S; P equals Z plus Z prime over two root Z Z prime; Q equals Z minus Z prime over two root Z Z prime; both diagonal"
        tag="4.13"
        source="PHYSICS.md §14.1. Implemented in src/sim/touchstone/network.ts, renormalize()."
      />

      <p>
        with <TeX tex="P" /> and <TeX tex="Q" /> diagonal. The page renormalises every network to the channel
        panel&rsquo;s Renormalise to setting before it reads anything from it.
      </p>

      <ParamRow>
        <ParamSelect<MeasuredSource>
          label="Network"
          value={source}
          options={sourceOptions}
          hint="A loaded file, or a four-port built from the lossy line in the channel panel."
          onChange={setSource}
        />
        {source === 'coupled' ? (
          <ParamSlider
            label="Coupling coefficient K"
            value={k}
            min={0}
            max={0.2}
            step={0.005}
            format={(v) => v.toFixed(3)}
            hint="Backward coupling of the synthetic pair. Illustrative."
            onChange={setK}
          />
        ) : null}
      </ParamRow>

      <div className="my-4 flex flex-wrap items-center gap-3 text-micro">
        <label className="text-lo">
          <span className="mr-2">Load a Touchstone file</span>
          <input
            type="file"
            accept={TOUCHSTONE_ACCEPT}
            className="text-micro text-hi"
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) void loadNetworkFile(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        {file ? (
          <button
            type="button"
            className={BUTTON}
            style={{ borderColor: 'var(--rule)' }}
            onClick={clearNetwork}
          >
            Forget {file.name}
          </button>
        ) : null}
        <button
          type="button"
          className={BUTTON}
          style={{ borderColor: 'var(--ch2)' }}
          onClick={() => downloadExample('weave')}
        >
          Save the woven pair as .s4p
        </button>
        <button
          type="button"
          className={BUTTON}
          style={{ borderColor: 'var(--ch2)' }}
          onClick={() => downloadExample('coupled')}
        >
          Save the coupled pair as .s4p
        </button>
      </div>

      <p className="text-micro text-lo">
        The file is read in this tab and held in memory only. Nothing is uploaded, nothing is stored, and a
        permalink carries the file&rsquo;s name and the port settings but not its data.
      </p>

      {loading ? <p className="text-lo">Reading the file&hellip;</p> : null}
      {error ? (
        <p role="alert" style={{ color: 'var(--fail)' }}>
          {error}
        </p>
      ) : null}

      {!file && ts.name && scenario.channel.kind === 'touchstone' ? (
        <Callout variant="notice" title="This link names a file that is not loaded">
          <p>
            The Scenario refers to {ts.name} ({ts.ports} ports, transmit port {ts.txPort}, receive port{' '}
            {ts.rxPort}). A link cannot carry the data itself; load the file to see it, or use a synthetic
            network below.
          </p>
        </Callout>
      ) : null}

      {file ? (
        <p className="text-micro text-lo">
          {file.name}: {file.network.ports} ports, {file.network.freq.length} frequencies from{' '}
          {formatEng(file.network.freq[0], 'Hz', 3)} to{' '}
          {formatEng(file.network.freq[file.network.freq.length - 1], 'Hz', 3)}, Touchstone version{' '}
          {file.meta.version}, {file.meta.format} format, {formatEng(file.bytes, 'B', 3)}.
          {file.meta.warnings.length > 0 ? ` Read with ${file.meta.warnings.length} warnings:` : ''}
        </p>
      ) : null}
      {file && file.meta.warnings.length > 0 ? (
        <ul className="text-micro text-lo">
          {file.meta.warnings.slice(0, 8).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {file ? (
        <ChannelKindNotice
          kind="touchstone"
          controls={['Transmit port', 'Receive port', 'Renormalise to', 'Mixed mode']}
        />
      ) : null}

      {data ? (
        <p className="text-micro text-lo">
          {`Through paths found from the low-frequency transmissions: ${wiringOf(data.lines)}`}
          {data.pairCount > 0
            ? `, forming ${data.pairCount} differential pair${data.pairCount > 1 ? 's' : ''}`
            : ''}
          .{data.notes.length > 0 ? ` ${data.notes.join(' ')}` : ''}
        </p>
      ) : null}

      <h2>Differential pairs and mixed mode</h2>

      <p>
        The clocks and data strobes of DDR5 and LPDDR5 travel on differential pairs, and their receivers
        respond to the difference of the two legs. A four-port file describes the legs separately; what the
        receiver sees has to be computed from it. Writing the differential and common waves at each end as{' '}
        <TeX tex="(a_P - a_N)/\sqrt{2}" /> and <TeX tex="(a_P + a_N)/\sqrt{2}" /> gives
      </p>

      <MathBlock
        tex="S_{dd21} = \tfrac12\left(S_{P'P} - S_{P'N} - S_{N'P} + S_{N'N}\right), \qquad S_{cd21} = \tfrac12\left(S_{P'P} - S_{P'N} + S_{N'P} - S_{N'N}\right)"
        label="S d d 2 1 equals one half of S P prime P minus S P prime N minus S N prime P plus S N prime N; S c d 2 1 equals one half of S P prime P minus S P prime N plus S N prime P minus S N prime N"
        tag="4.14"
        source="PHYSICS.md §14.3. Implemented in src/sim/touchstone/mixed-mode.ts, modalTransfer() and channelView()."
      />

      <p>
        where a primed port is at the far end. <TeX tex="S_{dd21}" /> is the differential insertion loss.{' '}
        <TeX tex="S_{cd21}" /> is mode conversion: differential signal that arrives as common mode, which the
        receiver rejects, so it is lost from the signal, and which radiates and couples to neighbours far more
        readily than the differential mode does. On a perfectly symmetric pair it is zero. A file does not say
        how its ports are wired, so the page reads the wiring from the data: at low frequency a through path
        passes nearly everything and a coupled one nearly nothing.
      </p>

      {data && data.mode === 'single' && data.pairCount > 0 ? (
        <p>
          <button
            type="button"
            className={BUTTON}
            style={{ borderColor: 'var(--ch2)' }}
            onClick={() => setMixedMode(true)}
          >
            Read the pair differentially
          </button>
          <span className="ml-2 text-micro text-lo">
            Mixed mode is off in the channel panel, so the figures show one leg. This changes the Scenario.
          </span>
        </p>
      ) : null}

      {data ? (
        <Plot
          title="Through, reflection and mode conversion"
          height={300}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={mixedModeRender(data)}
          data={() => ({
            x: data.freq,
            series: [
              { key: 'thru', values: data.thruDb },
              { key: 'reflection', values: data.reflectionDb },
              ...(pair
                ? [
                    { key: 'legP', values: data.legPDb },
                    { key: 'legN', values: data.legNDb },
                    { key: 'conversion', values: data.conversionDb },
                  ]
                : []),
            ],
          })}
        />
      ) : (
        <p className="text-lo">Computing the network&hellip;</p>
      )}

      <h2>Fiber weave: why P and N arrive at different times</h2>

      <p>
        A board laminate is not a uniform dielectric. It is woven glass fibre, bundles of it, set in resin,
        and glass has roughly twice the permittivity of the resin. A trace that happens to run along a glass
        bundle sees a higher effective Dk than one running along the resin gap beside it. The two legs of a
        pair are a fraction of a millimetre apart, the same order as the weave pitch, so they can sit on
        different parts of the weave for their whole length. The figure below is a top view: light bands are
        glass-rich, dark bands resin-rich.
      </p>

      <ParamRow>
        <ParamSlider
          label="Pair position in the weave"
          value={offset}
          min={0}
          max={WEAVE_DEFAULTS.pitch}
          step={5e-6}
          format={(v) => formatEng(v, 'm', 3)}
          hint="Where the P trace's centre falls, across one weave pitch."
          onChange={setOffset}
        />
        <ParamSlider
          label="Route angle to the weave"
          value={angle}
          min={0}
          max={15}
          step={0.5}
          format={(v) => `${v.toFixed(1)}°`}
          hint="Rotating the route makes each trace cross the bundles."
          onChange={setAngle}
        />
      </ParamRow>

      <Plot
        title="The pair over the glass weave"
        height={260}
        permalink={permalink}
        render={weaveRender({ weave, legs, length: line.length, traceWidth: line.traceWidth })}
      />

      <p>
        Model the glass fraction under a point as a sinusoid of the weave pitch <TeX tex="p" /> across the
        board. A trace of width <TeX tex="w" /> whose centre starts at <TeX tex="x" /> and drifts sideways by{' '}
        <TeX tex="D = l\sin\theta" /> over a route of length <TeX tex="l" /> sees the average of it over its
        width and its length, and a Dk mixed from glass and resin in that proportion:
      </p>

      <MathBlock
        tex="\bar\phi = \phi_0 + \Delta\phi\,\operatorname{sinc}\!\left(\frac{w}{p}\right)\operatorname{sinc}\!\left(\frac{D}{p}\right)\cos\!\left(\frac{2\pi (x + D/2)}{p}\right), \qquad D_k = D_{k,\mathrm{resin}} + \left(D_{k,\mathrm{glass}} - D_{k,\mathrm{resin}}\right)\bar\phi"
        label="Mean glass fraction equals phi zero plus delta phi times sinc of w over p times sinc of D over p times cosine of two pi times x plus D over two, over p; Dk equals resin Dk plus glass Dk minus resin Dk times the mean glass fraction"
        tag="4.15"
        source="PHYSICS.md §14.4. Implemented in src/sim/touchstone/examples.ts, meanGlassFraction(), mixedDk() and weaveLegs()."
      />

      <p>
        with <TeX tex="\operatorname{sinc} u = \sin(\pi u)/(\pi u)" />. The N leg is the same with{' '}
        <TeX tex="x" /> moved by the pair pitch. Each leg is then a line of its own Dk, and the difference in
        their delays is the skew, which puts a null in the differential transfer where the legs are half a
        cycle apart:
      </p>

      <MathBlock
        tex="\tau = \frac{l\left(\sqrt{D_{k,P}} - \sqrt{D_{k,N}}\right)}{c}, \qquad |S_{dd21}| = |S_{21}|\,|\cos \pi f \tau|, \quad |S_{cd21}| = |S_{21}|\,|\sin \pi f \tau|, \qquad f_{\mathrm{null}} = \frac{1}{2|\tau|}"
        label="Skew tau equals l times root Dk P minus root Dk N, over c; magnitude of S d d 2 1 equals magnitude of S 2 1 times magnitude of cosine pi f tau; magnitude of S c d 2 1 equals magnitude of S 2 1 times magnitude of sine pi f tau; null frequency equals one over two tau"
        tag="4.16"
        source="PHYSICS.md §14.4. Implemented in src/sim/touchstone/examples.ts, weaveLegs(); the magnitudes hold for legs of equal loss and are checked against mixedModeRender in its tests."
      />

      <p>
        For the {formatEng(line.length, 'm', 3)} route in the channel panel at this position and angle, the
        legs see Dk <span className="readout text-hi">{legs.dkP.toFixed(3)}</span> and{' '}
        <span className="readout text-hi">{legs.dkN.toFixed(3)}</span>, a skew of{' '}
        <span className="readout text-hi">{formatEng(Math.abs(legs.skew), 's', 3)}</span> (
        {formatEng(Math.abs(skewPerInch), 's', 3)} per inch, {(Math.abs(legs.skew) / ui).toFixed(2)} UI at{' '}
        {formatEng(src.symbolRate, 'b/s', 3)}), and{' '}
        {Number.isFinite(legs.nullFrequency) ? (
          <>
            a first differential null at{' '}
            <span className="readout text-hi">{formatEng(legs.nullFrequency, 'Hz', 3)}</span>.
          </>
        ) : (
          <>no null at all.</>
        )}{' '}
        Skew is linear in length, so it is quoted per inch, and it cannot be equalised away: the common-mode
        part of the signal never reaches the differential receiver.
      </p>

      {data ? (
        <Plot
          title="Step through each leg and through the pair"
          height={300}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={skewRender(data, {
            closedFormSkew: source === 'weave' && pair ? legs.skew : undefined,
          })}
        />
      ) : null}

      <TryThis
        title="Route at an angle"
        steps={[
          'Set this up: a 30 cm route at 6.4 Gb/s, read differentially.',
          'Choose the synthetic pair over a glass weave. Move Pair position in the weave and watch the skew.',
          'Set the position back to 0 and turn Route angle to the weave up to 10°.',
        ]}
        setup={{
          'channel.lossy.length': 0.3,
          'channel.touchstone.mixedMode': true,
          'source.symbolRate': 6.4e9,
        }}
        expect="At zero angle the skew depends entirely on where the pair happens to land, from zero when both legs sit on the same mix to about half a UI when one is on glass and the other on resin; a fabricator cannot control that position. At 10° each trace crosses about a hundred bundles over the route, both average to the same Dk, the skew collapses to a fraction of a picosecond and the null leaves the band. Routing at an angle, or rotating the artwork on the panel, trades a little routing density for skew that no longer depends on luck. A glass style with a flatter weave shrinks the swing instead."
      />

      <h2>Insertion loss deviation</h2>

      <p>
        A uniform line&rsquo;s loss is smooth in frequency: a constant from mismatch, a term in{' '}
        <TeX tex="\sqrt f" /> from the copper, a term in <TeX tex="f" /> from the laminate. An equaliser can
        undo a smooth loss. It cannot undo ripple, from reflections between vias and connectors or from a skew
        null, because ripple is not a function a few taps can match. So the loss is fitted by least squares
        over a band, and what is left is reported on its own:
      </p>

      <MathBlock
        tex="\mathrm{IL}_{\mathrm{fit}}(f) = a_0 + a_1\sqrt{f} + a_2 f + a_3 f^2, \qquad \mathrm{ILD}(f) = \mathrm{IL}(f) - \mathrm{IL}_{\mathrm{fit}}(f)"
        label="Fitted insertion loss equals a zero plus a one root f plus a two f plus a three f squared; insertion loss deviation equals insertion loss minus the fit"
        tag="4.17"
        source="PHYSICS.md §14.6. Implemented in src/sim/touchstone/metrics.ts, insertionLossDeviation(); f in GHz, band up to twice Nyquist."
      />

      <ParamRow>
        <ParamSelect<IldView>
          label="ILD figure"
          value={ildView}
          options={[
            { value: 'fit', label: 'Loss and its fit' },
            { value: 'deviation', label: 'Deviation from the fit' },
          ]}
          onChange={setIldView}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="Insertion loss deviation"
          height={280}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={ildRender(data, { view: ildView })}
          data={() => ({
            x: data.freq,
            series: [
              { key: 'fit', values: data.ilFit },
              { key: 'ild', values: data.ild },
            ],
          })}
        />
      ) : null}

      <p>
        On the woven pair at zero angle the deviation is dominated by the skew null, which the four-term fit
        cannot follow; at 10° the null leaves the band and little deviation is left. That is the practical use
        of ILD on the bench: a route whose loss looks acceptable at Nyquist but whose deviation is large has a
        structure in it that equalisation will not fix.
      </p>

      <h2>Crosstalk, as noise</h2>

      <p>
        A neighbouring line couples into the victim at the near end, travelling back towards the
        victim&rsquo;s transmitter, and at the far end, travelling with the victim&rsquo;s own signal. In a
        four-port or larger file every other through path is an aggressor, and each coupling path is an
        S-parameter. An aggressor carrying random data is noise at the victim&rsquo;s receiver, and its RMS
        follows from the aggressor&rsquo;s power spectrum, a random NRZ signal of levels <TeX tex="\pm L" />{' '}
        and symbol time <TeX tex="T" />, shaped by the transmitter&rsquo;s edge, the coupling and the
        receiver&rsquo;s bandwidth:
      </p>

      <MathBlock
        tex="\sigma_{\mathrm{ICN}}^2 = \int_0^{F} 2L^2 T\,\operatorname{sinc}^2(fT)\,|H_{tx}(f)|^2\,|XT(f)|^2\,\frac{1}{1 + (f/f_r)^8}\,df, \qquad \sigma_{\mathrm{total}}^2 = \sum_i \sigma_i^2"
        label="Integrated crosstalk noise squared equals the integral from zero to F of two L squared T sinc squared f T, times transmit edge magnitude squared, times crosstalk magnitude squared, over one plus f over f r to the eighth, d f; total noise squared is the sum over aggressors"
        tag="4.18"
        source="PHYSICS.md §14.6. Implemented in src/sim/touchstone/metrics.ts, crosstalkDensity(), integratedCrosstalkNoise() and powerSum(). Method as in IEEE 802.3 Annex 69B, cited by number only."
      />

      <p>
        Independent aggressors add in power, not in amplitude. The page assumes every aggressor swings the
        same as the victim and takes <TeX tex="f_r" /> as three quarters of the symbol rate.
      </p>

      {data && data.aggressors.length === 0 && source === 'coupled' && pair ? (
        <p>
          <button
            type="button"
            className={BUTTON}
            style={{ borderColor: 'var(--ch2)' }}
            onClick={() => setMixedMode(false)}
          >
            Read the coupled lines single-ended
          </button>
          <span className="ml-2 text-micro text-lo">
            Read as one differential pair, the two lines have no neighbour to couple from. This changes the
            Scenario.
          </span>
        </p>
      ) : null}

      {data ? (
        <Plot
          title="Coupling into the victim"
          height={300}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={crosstalkRender(data)}
          data={() => ({
            x: data.freq,
            series: [
              { key: 'thru', values: data.thruDb },
              ...data.aggressors.map((a, i) => ({ key: `xt${i}`, values: a.xtDb })),
            ],
          })}
        />
      ) : null}

      <h2>Before trusting a file: passivity and causality</h2>

      <p>
        A measured file is a calibrated measurement with noise, a fixture removed by de-embedding, and a sweep
        that stops somewhere. Each of those can leave it describing something no physical network can do, and
        a simulator will draw an eye from it anyway. Two checks catch most of that. A passive network cannot
        return more power than it receives, so no combination of incident waves may come out larger; and a
        network built from copper and laminate is reciprocal:
      </p>

      <MathBlock
        tex="\sigma_{\max}\!\big(S(f)\big) \le 1 \ \text{at every } f, \qquad \max_{i<j} |S_{ij} - S_{ji}| \approx 0"
        label="The largest singular value of S at every frequency is at most one; the largest difference between S i j and S j i is near zero"
        tag="4.19"
        source="PHYSICS.md §14.1. Implemented in src/sim/touchstone/network.ts, maxSingularValue() and reciprocityError()."
      />

      <p>
        A causal network cannot respond before it is driven. That is a condition on the phase, and a file
        whose phase has the opposite sign convention, or has been discarded, fails it while its magnitude is
        perfect. The screen computes the impulse response from the data on its own grid and compares the
        energy before and after a guard band <TeX tex="t_g" /> of a few widths of the band-limiting kernel:
      </p>

      <MathBlock
        tex="E_{\mathrm{pre}} = \int_{-\infty}^{-t_g} h^2\,dt, \quad E_{\mathrm{post}} = \int_{t_g}^{\infty} h^2\,dt, \qquad \text{flagged when } E_{\mathrm{pre}} > 10^{-6}\!\int h^2\,dt \ \text{and}\ E_{\mathrm{pre}} > 0.05\,E_{\mathrm{post}}"
        label="Energy before minus t g and energy after t g of the impulse response; the transfer is flagged when the energy before exceeds one part in a million of the whole and five percent of the energy after"
        tag="4.20"
        source="PHYSICS.md §14.5. Implemented in src/sim/touchstone/to-impulse.ts, impulseOf(), with CAUSALITY_FLOOR and CAUSALITY_SYMMETRY."
      />

      <p>
        It is a screen, not a proof: a response shorter than the band&rsquo;s own resolution cannot be judged,
        and the page says so. Spoil the network on purpose to see each check fire.
      </p>

      <ParamRow>
        <ParamSelect<Corruption>
          label="Spoil the network"
          value={corruption}
          options={[
            { value: 'none', label: 'As it is' },
            { value: 'gain', label: `Gain of ${measuredJob.defaults.corruptionGain}` },
            { value: 'conjugate', label: 'Phase conjugated' },
            { value: 'magnitude', label: 'Phase discarded' },
          ]}
          hint="Applied to every S-parameter before any check."
          onChange={setCorruption}
        />
        <ParamToggle
          label="Minimum-phase comparison"
          value={minimumPhase}
          hint="Adds the response of a transfer with the same magnitude and the least possible delay."
          onChange={setMinimumPhase}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="Passivity across the sweep"
          height={240}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={passivityRender(data)}
          data={() => ({ x: data.sigmaFreq, series: [{ key: 'sigma', values: data.sigmaMax }] })}
        />
      ) : null}

      {data ? (
        <Plot
          title="The causality screen in time"
          height={300}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={causalityRender(data, { uisAfter: CAUSALITY_UIS })}
        />
      ) : null}

      <p>
        A gain above one fails passivity and leaves causality alone. A conjugated phase is a perfectly passive
        file whose impulse response is the causal one reversed in time: the pulse arrives before the launch.
        Discarding the phase gives a response symmetric about zero, with the delay gone. The minimum-phase
        transfer is the one causal response a magnitude alone determines; it arrives almost at once, because
        the delay of a line is phase that the magnitude does not record. A file that has lost its phase cannot
        be repaired from its magnitude.
      </p>

      <h2>The measured channel, driven</h2>

      <p>
        And this is the reason for all of it: whatever the network, once it passes its checks it replaces the
        model in the chain. The same pattern, edge and launch level as above, through the network&rsquo;s
        through transfer, differential if the pair is read that way:
      </p>

      {data ? (
        <Plot
          title="The bit stream through the network"
          height={300}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={streamRender(data, { amplitude: src.amplitude })}
          data={() => ({
            x: Array.from({ length: data.streamIn.length }, (_, i) => i / data.samplesPerUi),
            series: [
              { key: 'launched', values: data.streamIn },
              { key: 'received', values: data.streamOut },
            ],
          })}
        />
      ) : null}

      <SelfCheck
        moduleId={moduleId}
        id="skew-null"
        question="A differential pair has 20 ps of intra-pair skew and legs of otherwise equal loss. Where is the first null in its differential insertion loss?"
        options={[
          {
            id: 'half',
            text: `At ${formatEng(1 / (2 * 20e-12), 'Hz', 3)}.`,
            correct: true,
            why: 'The legs cancel where they are half a cycle apart: f tau = 1/2, so f = 1 / (2 tau), equation 4.16. The common-mode output peaks there too.',
          },
          {
            id: 'full',
            text: `At ${formatEng(1 / 20e-12, 'Hz', 3)}.`,
            why: 'At f = 1 / tau the legs are a whole cycle apart, which adds, not cancels. That is the first frequency where the pair recovers.',
          },
          {
            id: 'quarter',
            text: `At ${formatEng(1 / (4 * 20e-12), 'Hz', 3)}.`,
            why: 'A quarter cycle apart the differential transfer is down by a factor cos(pi/4), 3 dB, and half the power is in the common mode. It is not yet a null.',
          },
          {
            id: 'none',
            text: 'Nowhere: skew delays the differential signal but does not change its magnitude.',
            why: 'That holds only for a common delay of both legs. A difference in delay makes the legs interfere, as equation 4.16 shows.',
          },
        ]}
      />

      <SelfCheck
        moduleId={moduleId}
        id="conjugate-file"
        question="A vendor's .s4p passes the passivity check, its insertion loss matches your own measurement, and the eye it produces looks fine, but the causality screen flags it and its pulse arrives before the launch. What is the most likely explanation?"
        options={[
          {
            id: 'sign',
            text: 'Its phase uses the opposite sign convention, so it is the conjugate of the network.',
            correct: true,
            why: 'Conjugating every S-parameter leaves the magnitudes, and so insertion loss and passivity, untouched, and reverses the impulse response in time. The eye of a single transfer can look similar; the delay and every pre- and post-cursor are swapped.',
          },
          {
            id: 'active',
            text: 'The fixture adds gain, so the file is not passive.',
            why: 'Gain would fail the passivity check, which this file passes.',
          },
          {
            id: 'coarse',
            text: 'The sweep step is too coarse for the delay.',
            why: 'A coarse sweep is flagged separately, by the phase step between samples, and aliases the delay rather than reversing it.',
          },
          {
            id: 'reference',
            text: 'It was measured in a 42.5 ohm reference, not 50 ohms.',
            why: 'A wrong reference changes the reflections and the ripple. It cannot move the response to before the launch.',
          },
        ]}
      />
    </>
  );
}

/** The silicon callout's comparison of three route classes. Illustrative values throughout. */
export function RouteBudgetTable({
  line,
  frequency,
}: {
  line: LossyLineSpec;
  frequency: number;
}): JSX.Element {
  const rows = useMemo(() => routeBudgets(line, frequency), [line, frequency]);
  return (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-micro">
        <caption className="mb-2 text-left text-micro text-lo">
          Three illustrative route classes through the lossy-line model at {formatEng(frequency, 'Hz', 3)},
          the Nyquist frequency of the source in the transmitter panel, between 50 ohm ports. Only the line is
          modelled; what each leaves out is listed. No value is from a JEDEC document or a datasheet.
        </caption>
        <thead>
          <tr className="border-b border-rule text-lo">
            <th scope="col" className="py-1 text-left font-normal">
              Route class
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Length
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Width × thickness
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Skin depth / thickness
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              DC resistance
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              IL at DC, dB
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              IL at Nyquist, dB
            </th>
            <th scope="col" className="py-1 text-left font-normal">
              Leaves out
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-rule/40">
              <td className="py-1 text-hi">{r.name}</td>
              <td className="readout py-1 text-right text-hi">{formatEng(r.length, 'm', 3)}</td>
              <td className="readout py-1 text-right text-hi">
                {formatEng(r.traceWidth, 'm', 2)} × {formatEng(r.thickness, 'm', 2)}
              </td>
              <td className="readout py-1 text-right text-hi">{r.skinOverThickness.toFixed(3)}</td>
              <td className="readout py-1 text-right text-hi">{formatEng(r.seriesResistance, 'Ω', 3)}</td>
              <td className="readout py-1 text-right text-hi">{r.ilDc.toFixed(3)}</td>
              <td className="readout py-1 text-right" style={{ color: 'var(--ch2)' }}>
                {r.ilAt.toFixed(2)}
              </td>
              <td className="py-1 pl-2 text-lo">{r.omits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
