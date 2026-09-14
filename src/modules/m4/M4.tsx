/**
 * M4: where the harmonics actually go.
 *
 * M3's line had delay and impedance and nothing else, so every edge arrived at the
 * far end exactly as it left. This module takes the energy away: resistance that
 * rises with the square root of frequency once current crowds to the copper surface,
 * a surface that is not flat, and a dielectric that absorbs a fixed fraction of
 * every cycle. Each is a transfer function, and the edge that reaches the receiver
 * is the launched one filtered by their product.
 *
 * Every figure is drawn from one `runJob('lossy', ...)`, plus a second run with the
 * real roughness factor when the causality comparison is switched on. The materials
 * table calls the closed-form attenuation functions for each illustrative class, and
 * the self-check answers are computed from `skinDepth`, `conductorAttenuation` and
 * `dielectricAttenuation`, so none of them can disagree with the plots.
 */

import { useMemo, useState } from 'react';
import { Callout, IllustrativeNotice, Math as TeX, MathBlock, Plot, SelfCheck, TryThis } from '../../ui';
import { ChannelKindNotice } from '../ChannelKindNotice';
import { ParamRow, ParamSelect, ParamSlider, ParamToggle } from '../params';
import { formatEng } from '../../plots/scale';
import {
  conductorAttenuation,
  dcResistancePerMetre,
  dielectricAttenuation,
  METRES_PER_INCH,
  NEPER_TO_DB,
  prepareLine,
  skinDepth,
  skinOnsetFrequency,
  type LossyLineSpec,
} from '../../sim/channel/lossy';
import { defaultScenario } from '../../state/scenario';
import { useScenario } from '../../state/store';
import { permalinkFor } from '../../state/url-codec';
import { useJob } from '../../workers/use-job';
import {
  dielectricRender,
  groupDelayRender,
  lossRender,
  precursorRender,
  pulseRender,
  roughnessCorner,
  roughnessRender,
  sParamRender,
  streamRender,
} from './plots';

/**
 * Laminate classes for the comparison table. The values are illustrative, chosen to
 * span the range a reader will meet; none is taken from a datasheet, and a real
 * material's Dk and Df vary with frequency, resin content and glass style.
 */
const MATERIAL_CLASSES: readonly { key: string; name: string; er: number; df: number; rms: number }[] = [
  { key: 'standard', name: 'Standard FR-4 class', er: 4.3, df: 0.02, rms: 2e-6 },
  { key: 'low', name: 'Low-loss class', er: 3.7, df: 0.008, rms: 1e-6 },
  { key: 'ultra', name: 'Ultra-low-loss class', er: 3.1, df: 0.002, rms: 0.4e-6 },
  { key: 'substrate', name: 'Package substrate class', er: 3.4, df: 0.005, rms: 0.3e-6 },
];

/** dB per inch from nepers per metre. */
const dbPerInch = (npPerMetre: number): number => npPerMetre * NEPER_TO_DB * METRES_PER_INCH;

type Normalise = 'total' | 'perInch';
type RoughView = 'loss' | 'factor';
type DielQuantity = 'permittivity' | 'lossTangent';
type PulseView = 'pulse' | 'step';

export function M4({ moduleId }: { moduleId: string }): JSX.Element {
  const [scenario] = useScenario();
  const src = scenario.source;
  const line = scenario.channel.lossy;

  // Job parameters, not Scenario fields: how the result is drawn, and whether to run
  // the non-causal comparison, are properties of this page, not of the link.
  const [normalise, setNormalise] = useState<Normalise>('total');
  const [showApprox, setShowApprox] = useState(false);
  const [roughView, setRoughView] = useState<RoughView>('loss');
  const [dielQuantity, setDielQuantity] = useState<DielQuantity>('permittivity');
  const [pulseView, setPulseView] = useState<PulseView>('pulse');
  const [uisAfter, setUisAfter] = useState(8);
  const [compareReal, setCompareReal] = useState(false);

  const { data, running, progress } = useJob('lossy', scenario, {});
  const real = useJob('lossy', scenario, { causalRoughness: false }, { enabled: compareReal });

  const nyquist = src.symbolRate / 2;
  const delta = skinDepth(nyquist, line.conductivity);
  const fSkin = skinOnsetFrequency(line);
  const rdc = dcResistancePerMetre(line);
  const cornerRms = roughnessCorner(line.roughnessRms, line.conductivity);
  const cornerHuray = roughnessCorner(line.hurayRadius, line.conductivity);

  const materials = useMemo(
    () =>
      MATERIAL_CLASSES.map((m) => {
        const spec: LossyLineSpec = {
          ...line,
          er: m.er,
          lossTangent: m.df,
          roughnessRms: m.rms,
          roughnessEnabled: true,
          roughnessModel: 'hammerstad',
          conductorLossEnabled: true,
          dielectricLossEnabled: true,
        };
        const model = prepareLine(spec);
        const cond = dbPerInch(conductorAttenuation(model, nyquist));
        const diel = dbPerInch(dielectricAttenuation(model, nyquist));
        return {
          ...m,
          cond,
          diel,
          total: cond + diel,
          route: ((cond + diel) * line.length) / METRES_PER_INCH,
        };
      }),
    [line, nyquist],
  );

  // Self-check arithmetic, on the default route with smooth copper and no vias, so the
  // question reads the same whatever the panels are set to.
  const check = useMemo(() => {
    const base = defaultScenario().channel.lossy;
    const spec: LossyLineSpec = { ...base, roughnessEnabled: false, viaCount: 0 };
    const model = prepareLine(spec);
    const inches = spec.length / METRES_PER_INCH;
    const at = (f: number) => ({
      c: dbPerInch(conductorAttenuation(model, f)) * inches,
      d: dbPerInch(dielectricAttenuation(model, f)) * inches,
    });
    const lo = at(2e9);
    const hi = at(4e9);
    return {
      length: spec.length,
      lo,
      hi,
      skin8: skinDepth(8e9, spec.conductivity),
      skin1: skinDepth(1e9, spec.conductivity),
      thickness: spec.thickness,
    };
  }, []);

  const permalink =
    typeof window === 'undefined'
      ? undefined
      : permalinkFor(moduleId, '', scenario, window.location.origin, window.location.pathname);

  const progressPct = progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0;
  const busy = running || (compareReal && real.running);

  return (
    <>
      <p className="text-lead text-hi">
        Every line in M3 was lossless. The edge that reached the far end was the edge that left, delayed and
        perhaps reflected, but whole. Measure a real route and the far end is smaller as well as later, and
        its edge is slower than the driver&rsquo;s. Nothing reflected. The energy went into the copper and the
        laminate, and it went unevenly: more of every high harmonic than of the low ones. This module follows
        each harmonic down the line and adds up what is left.
      </p>

      <ChannelKindNotice
        kind="lossy"
        controls={[
          'Line impedance',
          'Length',
          'Permittivity (Dk)',
          'Loss tangent (Df)',
          'Conductor loss',
          'Dielectric loss',
          'Roughness model',
          'Via count',
        ]}
      />

      <h2>Skin effect: the copper gets thinner as the frequency rises</h2>

      <p>
        At DC the current uses the whole cross-section of the trace. At high frequency it cannot: a changing
        current induces fields inside the conductor that oppose it, most strongly at the centre, and the
        current is pushed towards the surface. It decays with depth on a scale called the skin depth, and the
        resistance is what that thin layer would have:
      </p>

      <MathBlock
        tex="\delta = \frac{1}{\sqrt{\pi f \mu_0 \sigma}}, \qquad R_s = \sqrt{\frac{\pi f \mu_0}{\sigma}} = \frac{1}{\sigma\delta}"
        label="Skin depth equals one over the square root of pi f mu zero sigma; surface resistance equals the square root of pi f mu zero over sigma, which equals one over sigma delta"
        tag="4.1"
        source="PHYSICS.md §13.1. Implemented in src/sim/channel/lossy.ts, skinDepth() and surfaceResistance()."
      />

      <p>
        For the copper in the channel panel, at the {formatEng(nyquist, 'Hz', 3)} Nyquist frequency of the{' '}
        {formatEng(src.symbolRate, 'b/s', 3)} source, the skin depth is{' '}
        <span className="readout text-hi">{formatEng(delta, 'm', 3)}</span>, against a trace{' '}
        {formatEng(line.thickness, 'm', 3)} thick. The resistance no longer depends on the thickness at all,
        and it grows as <TeX tex="\sqrt{f}" />.
      </p>

      <p>
        A skin depth that is infinite at DC and a resistance that is zero there cannot both be right, and the
        transition between them is not a switch. The model here joins them with one expression that has the
        right limit at each end and, as importantly, is causal and passive everywhere between:
      </p>

      <MathBlock
        tex="Z_{\mathrm{int}}(f) = R_{\mathrm{dc}}\sqrt{1 + j\,\frac{f}{f_{\mathrm{skin}}}}, \qquad R_{\mathrm{dc}} = \frac{1}{\sigma w t}, \qquad f_{\mathrm{skin}} = \frac{1}{2\pi\mu_0\sigma t^2}"
        label="Internal impedance equals R dc times the square root of one plus j f over f skin; R dc equals one over sigma w t; f skin equals one over two pi mu zero sigma t squared"
        tag="4.2"
        source="PHYSICS.md §13.1. Implemented in src/sim/channel/lossy.ts, internalImpedance(), dcResistancePerMetre() and skinOnsetFrequency()."
      />

      <p>
        Well below <TeX tex="f_{\mathrm{skin}}" /> it is <TeX tex="R_{\mathrm{dc}}" />, here{' '}
        {formatEng(rdc, 'Ω/m', 3)}. Well above it it is <TeX tex="(1+j)R_s/w" />: resistance and internal
        reactance equal, both rising as <TeX tex="\sqrt{f}" />. For this trace <TeX tex="f_{\mathrm{skin}}" />{' '}
        is <span className="readout text-hi">{formatEng(fSkin, 'Hz', 3)}</span>, so everything a memory
        interface cares about is deep in the skin-effect regime. The <TeX tex="j" /> matters as much as the
        magnitude. Loss that rises with frequency must come with an inductance that falls with it, or the line
        would respond before it was driven; that is the Kramers-Kronig relation, and it is why the model is
        written this way rather than as a real <TeX tex="\sqrt{f}" />.
      </p>

      <h2>Rough copper</h2>

      <p>
        Copper foil is roughened on purpose, so the laminate grips it. Once the skin depth shrinks to the size
        of that roughness, the current follows the bumps, the path is longer, and the resistance rises beyond
        the smooth-copper value by a factor <TeX tex="K" />. Two models are in common use. Hammerstad&rsquo;s
        is an empirical fit to a profile with an RMS height <TeX tex="\Delta" />, and saturates at twice the
        smooth loss:
      </p>

      <MathBlock
        tex="K_{\mathrm{H}} = 1 + \frac{2}{\pi}\arctan\!\left[1.4\left(\frac{\Delta}{\delta}\right)^{2}\right]"
        label="Hammerstad factor equals one plus two over pi times the arctangent of 1.4 times delta rms over skin depth squared"
        tag="4.3"
        source="PHYSICS.md §13.2. Implemented in src/sim/channel/lossy.ts, hammerstadFactor()."
      />

      <p>
        Huray&rsquo;s treats the surface as spheres of radius <TeX tex="a" /> on a flat base, each absorbing
        like a small conductor in the field, with <TeX tex="S" /> their total surface area per unit flat area.
        It does not saturate at 2, which matches measurements on very rough foil better:
      </p>

      <MathBlock
        tex="K_{\mathrm{Hu}} = 1 + \frac{S}{1 + \dfrac{\delta}{a} + \dfrac{\delta^2}{2a^2}}"
        label="Huray factor equals one plus S over one plus delta over a plus delta squared over two a squared"
        tag="4.4"
        source="PHYSICS.md §13.2. Implemented in src/sim/channel/lossy.ts, hurayFactor()."
      />

      <p>
        Both are functions of the skin depth against a surface length only, so each has a corner where the two
        are equal. For the RMS height in the channel panel that corner is at{' '}
        <span className="readout text-hi">{formatEng(cornerRms, 'Hz', 3)}</span>; for the Huray radius, at{' '}
        <span className="readout text-hi">{formatEng(cornerHuray, 'Hz', 3)}</span>. Below its corner a model
        adds little; above it the extra loss arrives within about a decade.
      </p>

      <p>
        Both factors, as usually published, are real: they scale the resistance and nothing else. That is the
        same mistake the previous section avoided, and it has the same consequence. This site applies each in
        a causal complex form, added to the surface impedance, which keeps the resistance exactly as the real
        factor says and supplies the reactance that resistance has to come with:
      </p>

      <MathBlock
        tex="Z_c = Z_{\mathrm{int}} + (K_c - 1)(1+j)\frac{R_s}{w}, \qquad \operatorname{Re}K_c - \operatorname{Im}K_c = K, \qquad K_{c,\mathrm{Hu}} = 1 + \frac{S\,q}{1+q},\ \ q = (1+j)\frac{a}{\delta}"
        label="Conductor impedance equals internal impedance plus K c minus one times one plus j times R s over w; the real part of K c minus its imaginary part equals K; Bracken's causal Huray factor is one plus S q over one plus q, with q equal to one plus j times a over delta"
        tag="4.5"
        source="PHYSICS.md §13.2. Implemented in src/sim/channel/lossy.ts, conductorImpedance(), hurayCausalFactor() and causalCompletion()."
      />

      <p>
        For Huray the causal form is Bracken&rsquo;s closed form. Hammerstad has none, so its imaginary part
        is computed once from the real factor by the Kramers-Kronig integral, which PHYSICS.md derives. The
        figure shows both: switch to the factor view to see the real factor and the imaginary part the causal
        form adds.
      </p>

      <ParamRow>
        <ParamSelect<RoughView>
          label="Roughness figure"
          value={roughView}
          options={[
            { value: 'loss', label: 'Conductor loss, three surfaces' },
            { value: 'factor', label: 'Roughness factors' },
          ]}
          onChange={setRoughView}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="Conductor loss, smooth and rough"
          height={320}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={roughnessRender(data, {
            view: roughView,
            conductivity: line.conductivity,
            roughnessRms: line.roughnessRms,
            hurayRadius: line.hurayRadius,
            hurayRatio: line.hurayRatio,
          })}
          data={() => ({
            x: data.freq,
            series: [
              { key: 'smooth', values: data.ilSmooth },
              { key: 'hammerstad', values: data.ilHammerstad },
              { key: 'huray', values: data.ilHuray },
              { key: 'kHammerstad', values: data.kHammerstad },
              { key: 'kHuray', values: data.kHuray },
            ],
          })}
        />
      ) : (
        <p className="text-lo">Computing the line&hellip;</p>
      )}

      <TryThis
        title="Roughness only matters above its corner"
        steps={[
          'Set this up: conductor loss only, Huray roughness, a slow link.',
          'Read the Huray extra-loss metric at Nyquist.',
          'Raise Symbol rate in the transmitter panel to 16 Gb/s and read it again.',
          'Switch Roughness model to Hammerstad and compare the two curves above the corner.',
        ]}
        setup={{
          'channel.kind': 'lossy',
          'channel.lossy.dielectricLossEnabled': false,
          'channel.lossy.roughnessEnabled': true,
          'channel.lossy.roughnessModel': 'huray',
          'channel.lossy.viaCount': 0,
          'source.symbolRate': 1.6e9,
        }}
        expect="At a low rate the three surfaces are within about a tenth of each other at Nyquist, because the skin depth there is still larger than the roughness. At 16 Gb/s both rough curves have pulled well away from smooth copper. In the factor view, Hammerstad levels off at 2 while Huray keeps climbing towards 1 + S."
      />

      <h2>Dielectric loss</h2>

      <p>
        The laminate is not a perfect insulator either. Its molecules polarise with the field and lag behind
        it, and the lag dissipates a fixed fraction of the stored energy every cycle. That fraction is the
        loss tangent, <TeX tex="\tan\delta" />, and because it is per cycle the loss per metre rises in
        proportion to frequency, not to its square root. A constant Dk and Df over frequency is not causal,
        for the same reason as before. The wideband Debye model (Djordjevic-Sarkar) is the standard causal
        replacement, fitted so it reproduces the stated Dk and Df exactly at the reference frequency:
      </p>

      <MathBlock
        tex="\varepsilon_r(f) = \varepsilon_\infty + \frac{\Delta\varepsilon}{m_2 - m_1}\log_{10}\!\left(\frac{10^{m_2} + jf}{10^{m_1} + jf}\right)"
        label="Relative permittivity of f equals epsilon infinity plus delta epsilon over m 2 minus m 1 times log base ten of ten to the m 2 plus j f over ten to the m 1 plus j f"
        tag="4.6"
        source="PHYSICS.md §13.3. Implemented in src/sim/channel/lossy.ts, fitWidebandDebye() and permittivityAt()."
      />

      <p>
        The corners <TeX tex="10^{m_1}" /> and <TeX tex="10^{m_2}" /> are placed at 10 kHz and 1 THz, far
        outside the band of interest, so between them the loss tangent is nearly flat and the permittivity
        falls slowly - a few percent per decade. That slow fall is not a detail. It means the laminate is
        slightly faster for high harmonics than for low ones, and it is the second thing, after internal
        inductance, that makes an edge spread out as it travels.
      </p>

      <ParamRow>
        <ParamSelect<DielQuantity>
          label="Dielectric figure"
          value={dielQuantity}
          options={[
            { value: 'permittivity', label: 'Real permittivity' },
            { value: 'lossTangent', label: 'Loss tangent' },
          ]}
          onChange={setDielQuantity}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="The laminate, from the wideband Debye fit"
          height={280}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={dielectricRender(data, {
            quantity: dielQuantity,
            enabled: line.dielectricLossEnabled,
            er: line.er,
            lossTangent: line.lossTangent,
            referenceFreq: line.referenceFreq,
          })}
          data={() => ({
            x: data.freq,
            series: [
              { key: 'epsReal', values: data.epsReal },
              { key: 'lossTangent', values: data.lossTangent },
            ],
          })}
        />
      ) : null}

      <h2>From RLGC to insertion loss</h2>

      <p>
        Put the pieces into the line. Per metre, the series impedance is the external inductance plus the
        conductor impedance, and the shunt admittance is the capacitance with the complex permittivity in it.
        They set the propagation constant and the characteristic impedance, now both complex and both
        frequency dependent:
      </p>

      <MathBlock
        tex="Z' = j\omega L_{\mathrm{ext}} + Z_c, \qquad Y' = j\omega C_{\mathrm{vac}}\,\varepsilon_r(f), \qquad \gamma = \alpha + j\beta = \sqrt{Z'Y'}, \qquad Z_0 = \sqrt{Z'/Y'}"
        label="Z prime equals j omega L external plus conductor impedance; Y prime equals j omega C vacuum times relative permittivity; gamma equals alpha plus j beta equals the square root of Z prime Y prime; Z zero equals the square root of Z prime over Y prime"
        tag="4.7"
        source="PHYSICS.md §13.4. Implemented in src/sim/channel/lossy.ts, seriesImpedance(), shuntAdmittance(), propagationConstant() and characteristicImpedanceAt()."
      />

      <p>
        A section of length <TeX tex="\ell" /> is a two-port with an ABCD matrix, sections and vias cascade by
        multiplying matrices, and the result is read as S-parameters between 50 ohm ports - the reference an
        instrument measures against:
      </p>

      <MathBlock
        tex="\begin{bmatrix}A & B\\ C & D\end{bmatrix} = \begin{bmatrix}\cosh\gamma\ell & Z'\ell\,\dfrac{\sinh\gamma\ell}{\gamma\ell}\\[4pt] Y'\ell\,\dfrac{\sinh\gamma\ell}{\gamma\ell} & \cosh\gamma\ell\end{bmatrix}, \qquad S_{21} = \frac{2}{A + B/R_0 + C R_0 + D}, \qquad \mathrm{IL} = -20\log_{10}\lvert S_{21}\rvert"
        label="The ABCD matrix of a section is cosh gamma l, Z prime l sinh gamma l over gamma l, Y prime l sinh gamma l over gamma l, cosh gamma l; S 21 equals two over A plus B over R zero plus C R zero plus D; insertion loss equals minus twenty log ten of the magnitude of S 21"
        tag="4.8"
        source="PHYSICS.md §13.4. Implemented in src/sim/channel/lossy.ts, sParametersAt() and insertionLossDb()."
      />

      <p>
        Here is the result for the route in the channel panel, taken apart. The conductor and dielectric
        curves are the same line with only one mechanism on; the total is both, with the vias. Loss in dB very
        nearly adds between mechanisms, so the gap between the two curves at any frequency says which one a
        better board would have to fix.
      </p>

      <ParamRow>
        <ParamSelect<Normalise>
          label="Loss figure"
          value={normalise}
          options={[
            { value: 'total', label: 'Whole route, dB' },
            { value: 'perInch', label: 'Per inch, dB/in' },
          ]}
          onChange={setNormalise}
        />
        <ParamToggle
          label="Show the low-loss formula"
          value={showApprox}
          hint="Overlays equation 4.9 on the exact curve."
          onChange={setShowApprox}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="Insertion loss, conductor and dielectric"
          height={340}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={lossRender(data, {
            normalise,
            showApprox,
            conductorEnabled: line.conductorLossEnabled,
            dielectricEnabled: line.dielectricLossEnabled,
          })}
          data={() => ({
            x: data.freq,
            series: [
              { key: 'total', values: data.ilTotal },
              { key: 'conductor', values: data.ilConductor },
              { key: 'dielectric', values: data.ilDielectric },
              { key: 'approx', values: data.ilApprox },
            ],
          })}
        />
      ) : null}

      <p>
        The shapes are the physics. Conductor loss is concave on a linear frequency axis, rising as{' '}
        <TeX tex="\sqrt{f}" /> with a bump where roughness switches on; dielectric loss is a straight line
        through the origin. Wherever they cross, the dielectric wins from there up. Where that is depends on
        the copper as much as on the laminate: conductor loss per metre is inversely proportional to the trace
        width, so a narrow trace pushes the crossover up in frequency and a wide one pulls it down. For a
        well-matched, low-loss line both reduce to closed forms:
      </p>

      <MathBlock
        tex="\alpha_c \approx \frac{R'}{2Z_0}, \qquad \alpha_d \approx \frac{\pi f\sqrt{\varepsilon'}\,\tan\delta}{c}, \qquad \mathrm{IL} \approx 8.686\,(\alpha_c + \alpha_d)\,\ell\ \ \mathrm{dB}"
        label="Conductor attenuation is approximately R prime over two Z zero; dielectric attenuation is approximately pi f times the square root of epsilon prime times tan delta over c; insertion loss is approximately 8.686 times the sum times the length, in dB"
        tag="4.9"
        source="PHYSICS.md §13.5. Implemented in src/sim/channel/lossy.ts, conductorAttenuation() and dielectricAttenuation()."
      />

      {data ? (
        <p>
          At Nyquist the route loses <span className="readout text-hi">{data.ilNyquist.toFixed(2)} dB</span>{' '}
          over {data.lengthInches.toFixed(2)} in, or{' '}
          <span className="readout text-hi">{data.ilNyquistPerInch.toFixed(3)} dB/in</span>. The low-loss
          formula gives {data.approxNyquist.toFixed(2)} dB. It omits the vias and the internal inductance, and
          it reads Z<sub>0</sub> as the lossless value, so it drifts from the exact curve at low frequency,
          where <TeX tex="R'" /> is no longer small against <TeX tex="\omega L'" />, and on routes whose vias
          reflect. The number boards are specified and bought by is dB per inch at a stated frequency, and
          this is where it comes from.
        </p>
      ) : null}

      <div className="my-5 overflow-x-auto">
        <table className="w-full border-collapse text-micro">
          <caption className="mb-2 text-left text-micro text-lo">
            Illustrative laminate classes on the geometry in the channel panel ({formatEng(line.z0, 'Ω', 3)},{' '}
            {formatEng(line.traceWidth, 'm', 3)} wide), at the {formatEng(nyquist, 'Hz', 3)} Nyquist
            frequency, from <span className="readout">conductorAttenuation</span> with Hammerstad roughness
            and <span className="readout">dielectricAttenuation</span>. The values are not from any datasheet.
          </caption>
          <thead>
            <tr className="border-b border-rule text-lo">
              <th scope="col" className="py-1 text-left font-normal">
                Class
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Dk
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Df
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Copper RMS
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Conductor
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Dielectric
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                Total, dB/in
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                This route, dB
              </th>
            </tr>
          </thead>
          <tbody>
            {materials.map((row) => (
              <tr key={row.key} className="border-b border-rule/40">
                <td className="py-1 text-hi">{row.name}</td>
                <td className="readout py-1 text-right text-hi">{row.er.toFixed(1)}</td>
                <td className="readout py-1 text-right text-hi">{row.df.toFixed(3)}</td>
                <td className="readout py-1 text-right text-hi">{formatEng(row.rms, 'm', 2)}</td>
                <td className="readout py-1 text-right text-hi">{row.cond.toFixed(3)}</td>
                <td className="readout py-1 text-right text-hi">{row.diel.toFixed(3)}</td>
                <td className="readout py-1 text-right" style={{ color: 'var(--ch2)' }}>
                  {row.total.toFixed(3)}
                </td>
                <td className="readout py-1 text-right text-hi">{row.route.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>
        Two things to read from it. A better laminate removes dielectric loss almost in proportion to Df, and
        leaves the conductor column nearly untouched, so past a point the copper - its width and its surface -
        is the limit. And the package substrate row is per inch like the others, but a package route is
        millimetres long: its loss in dB is small, and what a package does to the edge is mostly reflection
        and crosstalk rather than attenuation. Product families are sold into these classes; compare them on a
        datasheet at the frequency you care about, and expect the Dk and Df there to differ from the headline
        values.
      </p>

      <TryThis
        title="Which mechanism is costing you"
        steps={[
          'Set this up: the standard class on a 100 um trace, at 6.4 Gb/s.',
          'Read the conductor and dielectric metrics at Nyquist, and the crossover frequency.',
          'Set Trace width to 200 um and read them again.',
          'Now set Loss tangent (Df) to 0.002.',
        ]}
        setup={{
          'channel.kind': 'lossy',
          'channel.lossy.er': 4.3,
          'channel.lossy.lossTangent': 0.02,
          'channel.lossy.roughnessRms': 2e-6,
          'channel.lossy.roughnessModel': 'hammerstad',
          'channel.lossy.traceWidth': 100e-6,
          'channel.lossy.conductorLossEnabled': true,
          'channel.lossy.dielectricLossEnabled': true,
          'source.symbolRate': 6.4e9,
        }}
        expect="Even on the lossiest laminate class, a narrow trace with rough foil loses more to its copper than to its dielectric at Nyquist, and the crossover sits well above Nyquist. Doubling the width halves the conductor term, leaves the dielectric term exactly where it was, and brings the crossover down to about Nyquist. Cutting Df by ten then removes nine tenths of the dielectric term, and the copper is nearly all of the loss that remains."
      />

      <h2>Return loss, vias, and group delay</h2>

      <p>
        A lossy line is not a perfect match to 50 ohms even when its nominal impedance is 50, because its
        impedance is complex and rises at low frequency, and each via adds a small shunt capacitance. Their
        reflections show as return loss, with ripple spaced by the inverse of the round-trip delay between
        them.
      </p>

      {data ? (
        <Plot
          title="S-parameters between 50 ohm ports"
          height={300}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={sParamRender(data)}
          data={() => ({
            x: data.freq,
            series: [
              { key: 's21', values: data.ilTotal },
              { key: 's11', values: data.returnLoss },
            ],
          })}
        />
      ) : null}

      <p>
        Loss changes the delay too. Group delay is the delay of the envelope of a narrow band of harmonics
        around each frequency:
      </p>

      <MathBlock
        tex="\tau_g(f) = -\frac{1}{2\pi}\,\frac{d\,\arg S_{21}}{df}"
        label="Group delay equals minus one over two pi times the derivative of the argument of S 21 with respect to frequency"
        tag="4.10"
        source="PHYSICS.md §13.4. Implemented in src/sim/channel/lossy.ts, groupDelayAt()."
      />

      {data ? (
        <Plot
          title="Group delay"
          height={280}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={groupDelayRender(data)}
          data={() => ({ x: data.freq, series: [{ key: 'groupDelay', values: data.groupDelay }] })}
        />
      ) : null}

      {data ? (
        <p>
          Low harmonics are slower than high ones: internal inductance and the Debye permittivity both fall
          with frequency. The spread is small - the delay at Nyquist is{' '}
          <span className="readout text-hi">{formatEng(data.groupDelayNyquist, 's', 4)}</span> against{' '}
          {formatEng(data.losslessDelay, 's', 4)} for a lossless line with the stated Dk - but it is
          dispersion, and it smears the edge in time on top of the attenuation. Nothing, at any frequency, can
          arrive sooner than{' '}
          <span className="readout text-hi">{formatEng(data.earliestArrival, 's', 4)}</span>, the delay with
          the high-frequency limit of the permittivity. That bound is what the next section tests.
        </p>
      ) : null}

      <h2>The edge at the far end</h2>

      <p>
        Everything so far is a transfer function. To see what it does to bits, launch one isolated bit - a
        pulse one UI wide with the driver&rsquo;s edge - and pass its spectrum through <TeX tex="S_{21}" />:
      </p>

      <MathBlock
        tex="P_{\mathrm{out}}(f) = T\,\mathrm{sinc}(fT)\,e^{-j\pi fT}\,H_{\mathrm{edge}}(f)\,S_{21}(f), \qquad p_{\mathrm{out}}(t) = \mathcal{F}^{-1}\{P_{\mathrm{out}}\}"
        label="The output pulse spectrum equals T sinc f T times e to the minus j pi f T times the edge response times S 21; the output pulse is its inverse Fourier transform"
        tag="4.11"
        source="PHYSICS.md §13.6. Implemented in src/dsp/jobs/lossy-job.ts, pulseFromSpectrum()."
      />

      <p>
        Because the line is linear and time-invariant, any bit stream is a sum of those pulses, one per bit,
        each scaled by the bit&rsquo;s level and shifted by its position. The received waveform at the centre
        of a bit is its own pulse&rsquo;s peak - the main cursor - plus a sample of every other bit&rsquo;s
        pulse, taken whole UIs away:
      </p>

      <MathBlock
        tex="v(t) = \frac{A}{4}\sum_k a_k\,p_{\mathrm{out}}(t - kT), \qquad a_k \in \{-1, +1\}"
        label="The received voltage equals A over four times the sum over k of a k times the output pulse delayed by k T, with a k equal to minus one or plus one"
        tag="4.12"
        source="PHYSICS.md §13.6. Implemented in src/dsp/jobs/lossy-job.ts, lossyJob.run()."
      />

      <ParamRow>
        <ParamSelect<PulseView>
          label="Response"
          value={pulseView}
          options={[
            { value: 'pulse', label: 'Single-bit pulse' },
            { value: 'step', label: 'Step' },
          ]}
          onChange={setPulseView}
        />
        <ParamSlider
          label="Window"
          value={uisAfter}
          min={2}
          max={24}
          step={1}
          format={(v) => `${v} UI after the main cursor`}
          hint="How much of the tail to show."
          onChange={setUisAfter}
        />
      </ParamRow>

      {data ? (
        <Plot
          title="One bit through the route"
          height={320}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={pulseRender(data, { view: pulseView, uisAfter })}
          data={() => ({
            x: Array.from({ length: data.pulseIn.length }, (_, i) => (i - data.startIndex) * data.dt),
            series: [
              { key: 'pulseIn', values: data.pulseIn },
              { key: 'pulseOut', values: data.pulseOut },
              { key: 'stepIn', values: data.stepIn },
              { key: 'stepOut', values: data.stepOut },
            ],
          })}
        />
      ) : null}

      {data ? (
        <p>
          The received pulse peaks at{' '}
          <span className="readout text-hi">{(data.mainCursor * 100).toFixed(1)}%</span> of the launched
          height, and the energy that is missing from the peak is not all gone: some of it has been spread
          into a tail. The dots are the cursors, one per UI. Every post-cursor is a piece of this bit that
          will still be there when the next bits are sampled; their magnitudes add to{' '}
          <span className="readout text-hi">{(data.isiSum * 100).toFixed(1)}%</span> of the main cursor. That
          is intersymbol interference, and M5 builds the eye from it. The step view shows the same thing as a
          slow final approach: a lossy line&rsquo;s step reaches most of its height quickly and the last few
          percent very slowly, because the <TeX tex="\sqrt{f}" /> conductor loss has a long memory.
        </p>
      ) : null}

      <p>
        One more thing is visible here if the model is wrong. The dashed vertical line is the earliest causal
        arrival. With the real roughness factor put back, the received pulse starts to rise before it: a
        response to a bit that has not yet arrived. It is small, but it is a model error, and it is exactly
        the kind that makes a simulated eye look slightly different from a measured one for no physical
        reason.
      </p>

      <ParamRow>
        <ParamToggle
          label="Compare with the real roughness factor"
          value={compareReal}
          hint="Runs the route a second time with roughness applied as a real, non-causal factor."
          onChange={setCompareReal}
        />
      </ParamRow>

      {compareReal && data && real.data ? (
        <Plot
          title="Before the earliest arrival: causal and real roughness"
          height={280}
          busy={busy}
          progress={progressPct}
          permalink={permalink}
          render={precursorRender(data, real.data)}
        />
      ) : compareReal ? (
        <p className="text-lo">Computing the comparison&hellip;</p>
      ) : null}

      <h2>Before and after</h2>

      <p>
        Finally, the question this site started with. Here is a stretch of the pattern in the transmitter
        panel as it was launched, and as it arrived, shifted back by the delay so the bits line up. The swing
        in the transmitter panel is the driver&rsquo;s open-circuit swing <TeX tex="A" />, as in M3; behind a
        50 ohm port it launches half of that, which is why equation 4.12 has <TeX tex="A/4" /> for the level
        of each bit. The worst centre-of-bit level is the pattern&rsquo;s own peak distortion: the bit that
        has the most unlucky history.
      </p>

      {data ? (
        <Plot
          title="The bit stream at both ends"
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

      <TryThis
        title="Length is not linear in damage"
        steps={[
          'Set this up: the standard class, at 6.4 Gb/s, 5 cm long.',
          'Read the insertion loss at Nyquist and the worst centre level under the bit-stream figure.',
          'Set Length to 10 cm, then 20 cm, then 30 cm.',
        ]}
        setup={{
          'channel.kind': 'lossy',
          'channel.lossy.length': 0.05,
          'channel.lossy.traceWidth': 100e-6,
          'channel.lossy.roughnessModel': 'hammerstad',
          'channel.lossy.conductorLossEnabled': true,
          'channel.lossy.dielectricLossEnabled': true,
          'channel.lossy.er': 4.3,
          'channel.lossy.lossTangent': 0.02,
          'channel.lossy.roughnessRms': 2e-6,
          'source.symbolRate': 6.4e9,
        }}
        expect="The loss at Nyquist grows in proportion to length, about 2 dB per 5 cm here. The worst centre level does not: it falls gently at first and then collapses, and by 30 cm the bit with the unluckiest history lands on the wrong side of zero with no noise and no jitter at all. Long runs of one level still reach full height; it is the isolated bits whose pulses have been spread into their neighbours. Undoing that data-dependent error is what equalization (M7) is for."
      />

      <Callout
        variant="bench"
        title="Measuring loss, and removing it from a measurement"
        controls={[
          'S-parameter (Touchstone) file import',
          'De-embed filter',
          'Filter bandwidth limit',
          'TDR/TDT step response',
          'Averaging',
        ]}
      >
        <p>
          Loss is a frequency-domain measurement. A vector network analyser measures <TeX tex="S_{21}" />{' '}
          directly, and a sampling scope with TDR and TDT gets the same thing from the step response through a
          Fourier transform, with a dynamic range set by the step and the averaging. Board fabricators measure
          dB per inch on test coupons; the methods differ in how they remove the probes and launch, so compare
          numbers only when they state the method and frequency.
        </p>
        <p>
          On a real-time scope the useful feature is the de-embedding filter: load the Touchstone file of the
          fixture, cable or channel between the probe point and the point you care about, and the scope
          inverts it. Inverting loss is gain at high frequency, so it amplifies the scope&rsquo;s own noise
          there; that is what the filter bandwidth limit is for, and a de-embedded eye that looks noisier than
          the raw one is usually telling the truth. The same menu can usually <em>embed</em> a channel
          instead, adding its loss to a clean signal, which is a quick way to ask how a longer route would
          look without building it.
        </p>
      </Callout>

      <Callout variant="silicon" title="Where the loss is on a memory route">
        <p>
          A DDR5 route on a DIMM or motherboard is short by serial-link standards, so its loss at Nyquist is
          modest; what closes the eye is its combination with reflections from the connector, the vias and the
          package, and with crosstalk. DDR5 added decision-feedback equalization at the DRAM receiver for
          exactly that residual ISI. LPDDR5 routes are shorter still, often inside a package-on-package or a
          few millimetres of substrate. The receiver requirements are in JESD79-5 (DDR5) and JESD209-5
          (LPDDR5); this site does not reproduce their values.
        </p>
        <p>
          HBM is different in kind. The route between the memory stack and the processor runs on a silicon
          interposer or a similar fine-line redistribution layer, with conductors only micrometres thick and
          wide. There the skin depth at the interface&rsquo;s Nyquist frequency is comparable with the
          conductor itself, so equation 4.2 sits in its transition rather than deep in the skin regime. The
          resistance per metre is then large enough to compete with <TeX tex="\omega L'" /> across the band,
          the line behaves more like a distributed RC than a low-loss transmission line, and a smoother
          surface buys little. The controls on this page stop at board dimensions, so that regime is described
          here, not simulated.
        </p>
      </Callout>

      <SelfCheck
        moduleId={moduleId}
        id="skin-depth"
        question={`A copper trace is ${formatEng(check.thickness, 'm', 3)} thick. At 8 GHz, how deep does the current reach?`}
        options={[
          {
            id: 'delta',
            text: `About ${formatEng(check.skin8, 'm', 3)}: a few percent of the thickness.`,
            correct: true,
            why: `Equation 4.1 with sigma = 5.8e7 S/m gives ${formatEng(check.skin8, 'm', 3)} at 8 GHz. The rest of the copper carries almost nothing, which is why a thicker trace does not lower high-frequency loss.`,
          },
          {
            id: 'linear',
            text: `About ${formatEng(check.skin1 / 8, 'm', 3)}: an eighth of its 1 GHz value.`,
            why: `Skin depth scales as one over the square root of frequency, not one over frequency. Eight times the frequency is a factor of about 2.8, from ${formatEng(check.skin1, 'm', 3)} to ${formatEng(check.skin8, 'm', 3)}.`,
          },
          {
            id: 'whole',
            text: 'Through the whole thickness, as at DC.',
            why: `That holds only well below f_skin in equation 4.2, which for this trace is ${formatEng(skinOnsetFrequency({ conductivity: 5.8e7, thickness: check.thickness, traceWidth: 1e-4 }), 'Hz', 3)}.`,
          },
          {
            id: 'half',
            text: 'Half of the thickness, from each face.',
            why: 'The current decays exponentially from the surface on the scale of the skin depth, which at 8 GHz is far smaller than half the thickness.',
          },
        ]}
      />

      <SelfCheck
        moduleId={moduleId}
        id="loss-scaling"
        question={`A ${formatEng(check.length, 'm', 3)} smooth-copper route loses ${check.lo.c.toFixed(2)} dB to the conductor and ${check.lo.d.toFixed(2)} dB to the dielectric at 2 GHz. About how much does it lose at 4 GHz?`}
        options={[
          {
            id: 'split',
            text: `About ${(check.hi.c + check.hi.d).toFixed(2)} dB.`,
            correct: true,
            why: `The conductor term scales as the square root of frequency, ${check.lo.c.toFixed(2)} to ${check.hi.c.toFixed(2)} dB, and the dielectric term in proportion to it, ${check.lo.d.toFixed(2)} to ${check.hi.d.toFixed(2)} dB. The small departures from exactly 1.41 and 2 are the internal impedance and the Debye permittivity.`,
          },
          {
            id: 'double',
            text: `About ${(2 * (check.lo.c + check.lo.d)).toFixed(2)} dB: loss is proportional to frequency.`,
            why: 'Only dielectric loss is. Conductor loss rises as the square root of frequency, so doubling everything overstates it.',
          },
          {
            id: 'root',
            text: `About ${(Math.SQRT2 * (check.lo.c + check.lo.d)).toFixed(2)} dB: skin effect scales as root f.`,
            why: 'That is true of the conductor term alone. The dielectric term doubles, and by 4 GHz it has overtaken the conductor term.',
          },
          {
            id: 'six',
            text: `About ${(check.lo.c + check.lo.d + 6).toFixed(2)} dB: an octave adds 6 dB.`,
            why: 'Six dB per octave is the slope of a single-pole roll-off far above its corner. Line loss in dB is proportional to the attenuation constant, which is not a pole.',
          },
        ]}
      />

      <SelfCheck
        moduleId={moduleId}
        id="precursor"
        question="A channel simulation shows the received pulse beginning to rise before the fastest possible arrival time of the route. What is the most likely cause?"
        options={[
          {
            id: 'model',
            text: 'A loss model that is not causal, such as a real roughness factor or a Dk and Df held constant over frequency.',
            correct: true,
            why: 'Loss that varies with frequency must come with a matching phase. A model that supplies the magnitude without the phase produces a response that starts early. The comparison figure above shows exactly that.',
          },
          {
            id: 'crosstalk',
            text: 'Crosstalk from a neighbouring line.',
            why: 'The simulation has one line. Crosstalk on a real board also cannot beat the speed of light in the dielectric.',
          },
          {
            id: 'real',
            text: 'Dispersion: the high harmonics really do travel faster than light in the laminate.',
            why: 'High harmonics are faster than low ones, but none is faster than the high-frequency limit of the permittivity allows. That limit is the earliest-arrival line.',
          },
          {
            id: 'sampling',
            text: 'The scope trigger is placed too early.',
            why: 'This is a simulation, with the launch at a known instant. On a scope, the trigger moves the whole display, not the pulse relative to the launch.',
          },
        ]}
      />

      <SelfCheck
        moduleId={moduleId}
        id="laminate"
        question="A team moves a route from a standard FR-4 class laminate to an ultra-low-loss class, and the insertion loss at Nyquist improves much less than the loss tangents suggested. What is the first thing to check?"
        options={[
          {
            id: 'copper',
            text: 'Whether conductor loss, including the roughness of the new foil, now dominates at that frequency.',
            correct: true,
            why: 'A better laminate removes dielectric loss and leaves the conductor term untouched. On a narrow trace, or with rough foil, the conductor term can be most of what remains. The crossover metric and the materials table show where that happens.',
          },
          {
            id: 'dk',
            text: 'Whether the lower Dk made the line faster, which adds loss.',
            why: 'A lower Dk does make the line faster, and slightly lowers dielectric loss through the square root in equation 4.9. It does not add loss.',
          },
          {
            id: 'length',
            text: 'Whether the route became longer.',
            why: 'Worth ruling out, but the physics already predicts the result on the same route: laminate choice only moves one of the two terms.',
          },
          {
            id: 'nothing',
            text: 'Nothing: loss tangent has little effect on insertion loss.',
            why: 'On a long route at multi-gigabit rates it is often the largest single term. Its effect is only small once it is no longer the dominant one.',
          },
        ]}
      />

      <IllustrativeNotice what="The default route, the copper and laminate values, the four material classes and the via capacitance are illustrative." />

      <p className="text-micro text-lo">
        Next: the pulse above left pieces of itself in the bits that followed. M5 folds a long record of those
        pieces into an eye diagram, adds the jitter a real transmitter has, and turns the opening into a bit
        error rate. Before that, this page will gain measured channels: Touchstone import, differential pairs,
        and the checks a measured file has to pass before its eye can be trusted.
      </p>
    </>
  );
}
