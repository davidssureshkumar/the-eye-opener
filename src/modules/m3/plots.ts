/**
 * The three figures of M3, as pure functions of a `tline` job result.
 *
 * Same arrangement as M1 and M2: a `ChromeSpec` is a claim, and
 * `__tests__/plots.test.ts` checks the claims against the closed forms.
 *
 * The lattice is drawn from the analytic bounce diagram and the waveforms from the
 * simulator, and the waveform figure overlays the one on the other. That is the
 * point of drawing both: the staircase is what a reader can compute by hand, the
 * waveform is what a scope would show, and the reader should be able to see where
 * they agree (every plateau) and where they do not (the edges, which the lattice
 * draws as vertical and the simulator draws with the driver's rise time).
 */

import type { TlineResult } from '../../dsp/jobs';
import { font, fontSize, semantic, signal, surface as ink } from '../../design/tokens';
import type { Surface } from '../../plots/canvas';
import type { ChromeSpec, MetricSpec } from '../../plots/chrome';
import { formatEng, linearScale, niceDomain } from '../../plots/scale';
import { drawHLine, drawUniformTrace, drawXY } from '../../plots/trace';
import type { PlotRender } from '../../ui';
import { tdrDistance } from '../../sim/channel/tline';

/** The staircase a lattice predicts, sampled on the job's own time grid, volts. */
export function staircaseOf(r: TlineResult, end: 'near' | 'far'): Float64Array {
  const n = r.t.length;
  const out = new Float64Array(n);
  const events = r.bounce.events.filter((e) => e.end === end);
  let k = 0;
  let level = 0;
  for (let i = 0; i < n; i++) {
    while (k < events.length && events[k].time <= r.t[i]) {
      level = events[k].level;
      k++;
    }
    out[i] = r.initialLevel + level;
  }
  return out;
}

/* ----------------------------------------------------------------- lattice */

export interface LatticeOptions {
  /** Physical length of the line, metres. */
  length: number;
  /** One-way traversals to draw. */
  rows: number;
  /** Load capacitance, farads. Non-zero means the lattice is the resistive part only. */
  loadC: number;
}

/** One wave on the lattice: where it starts, which way it goes, how big it is. */
export interface LatticeSegment {
  forward: boolean;
  t0: number;
  t1: number;
  amplitude: number;
}

/**
 * The waves the lattice draws, in order.
 *
 * Wave k leaves event k and arrives at event k + 1. A wave whose amplitude is zero
 * to rounding is not drawn and nothing after it is either, because nothing after a
 * matched termination exists to draw.
 */
export function latticeSegments(r: TlineResult, rows: number): LatticeSegment[] {
  const out: LatticeSegment[] = [];
  const { events, delay } = r.bounce;
  const floor = 1e-12 * Math.max(Math.abs(r.bounce.launch), 1e-300);
  const count = Math.min(Math.max(1, Math.floor(rows)), events.length - 1);
  for (let k = 0; k < count; k++) {
    const amplitude = events[k].departing;
    if (Math.abs(amplitude) <= floor) break;
    out.push({ forward: events[k].end === 'near', t0: k * delay, t1: (k + 1) * delay, amplitude });
  }
  return out;
}

/**
 * The reflection lattice: position across, time down.
 *
 * Each diagonal is one travelling wave, labelled with its amplitude; each vertex is
 * an arrival, labelled with the voltage at that end just after it. Levels are the
 * change from where the line sat before the step, which is what the lattice
 * arithmetic produces - the DC level underneath is added back on the waveform plot.
 */
export function latticeRender(r: TlineResult, o: LatticeOptions): (s: Surface) => PlotRender {
  const b = r.bounce;
  const rows = Math.max(1, Math.floor(o.rows));
  const segments = latticeSegments(r, rows);
  const tMax = rows * b.delay;
  const length = o.length > 0 ? o.length : 1;
  const anyBackward = segments.some((sg) => !sg.forward);

  const metrics: MetricSpec[] = [
    {
      key: 'gs',
      label: 'Reflection coefficient at the driver',
      value: b.gammaSource,
      unit: '1',
      sig: 4,
      note: '(R_S - Z0)/(R_S + Z0)',
    },
    {
      key: 'gl',
      label: 'Reflection coefficient at the load',
      value: b.gammaLoad,
      unit: '1',
      sig: 4,
      note:
        o.loadC > 0 ? 'resistance only; the capacitor makes it a function of time' : '(R_L - Z0)/(R_L + Z0)',
    },
    {
      key: 'launch',
      label: 'First wave down the line',
      value: b.launch,
      unit: 'V',
      note: 'V_s Z0/(R_S + Z0)',
    },
    {
      key: 'final',
      label: 'Level both ends converge to',
      value: b.steadyState,
      unit: 'V',
      note: 'V_s R_L/(R_S + R_L); Z0 does not appear',
    },
    { key: 'td', label: 'One-way delay', value: b.delay, unit: 's' },
    {
      key: 'residual',
      label: 'Distance from the final level after the lattice as computed',
      value: b.truncationError,
      unit: 'V',
      note: `${Math.floor((b.events.length - 1) / 2)} round trips; the product of the two coefficients sets how fast this shrinks`,
    },
  ];

  const notes: string[] = [];
  if (o.loadC > 0) {
    notes.push(
      'The lattice uses the load resistance only. A capacitive load reflects a waveform, not a number.',
    );
  }
  if (segments.length < rows && segments.length < b.events.length - 1) {
    notes.push('The lattice stops where a wave of zero amplitude would be drawn: a matched end absorbs it.');
  }

  return (s: Surface): PlotRender => {
    const xScale = linearScale([0, length], [s.plot.x, s.plot.x + s.plot.width]);
    // Time runs down the page, which is how the diagram is drawn on paper.
    const yScale = linearScale([0, tMax], [s.plot.y, s.plot.y + s.plot.height]);

    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 'm', title: 'Position along the line, driver at left' },
      y: { scale: yScale, unit: 's', title: 'Time, increasing downward' },
      traces: [
        { key: 'forward', label: 'Wave toward the load', color: semantic.ideal },
        {
          key: 'backward',
          label: 'Wave toward the driver',
          color: semantic.measured,
          dash: [6, 3],
          hidden: !anyBackward,
        },
      ],
      caption: `Reflection lattice for a ${formatEng(b.launch, 'V', 3)} launch: every diagonal is one travelling wave and its amplitude, every vertex an arrival and the voltage change at that end afterwards.`,
      metrics,
      grid: 'auto',
      legend: 'tr',
      readout: 'none',
      notes,
    };

    return {
      spec,
      drawTraces(sf: Surface): void {
        const { ctx } = sf;
        const x0 = xScale(0);
        const x1 = xScale(length);
        for (const sg of segments) {
          const forward = sg.forward;
          const color = forward ? semantic.ideal : semantic.measured;
          drawXY(sf, [forward ? 0 : length, forward ? length : 0], [sg.t0, sg.t1], xScale, yScale, {
            color,
            width: 1.5,
            dash: forward ? undefined : [6, 3],
          });
        }

        ctx.save();
        ctx.font = `${fontSize.tick}px ${font.mono}`;
        ctx.textBaseline = 'middle';
        // Wave amplitudes at each diagonal's midpoint, in the wave's own colour.
        ctx.textAlign = 'center';
        for (const sg of segments) {
          ctx.fillStyle = sg.forward ? semantic.ideal : semantic.measured;
          const ym = yScale((sg.t0 + sg.t1) / 2);
          ctx.fillText(formatEng(sg.amplitude, 'V', 3), (x0 + x1) / 2, ym - 8);
        }
        // Levels after each arrival, at the end where it arrives.
        ctx.fillStyle = ink.textHi;
        for (let k = 0; k <= segments.length && k < b.events.length; k++) {
          const e = b.events[k];
          if (e.time > tMax) break;
          const near = e.end === 'near';
          ctx.textAlign = near ? 'left' : 'right';
          ctx.fillText(`Δ${formatEng(e.level, 'V', 3)}`, near ? x0 + 4 : x1 - 4, yScale(e.time) + 8);
        }
        ctx.restore();
      },
    };
  };
}

/* --------------------------------------------------------------- waveforms */

export interface WaveformOptions {
  /** Draw the open-circuit source voltage. */
  showSource: boolean;
  /** Overlay the lattice staircases. */
  showLattice: boolean;
  /** Load capacitance, farads. */
  loadC: number;
  /** Show only this many one-way delays after the step. Omit for the whole record. */
  delays?: number;
}

/**
 * The same edge at the driver pin and at the receiver pad.
 *
 * Two probes on one line, one delay apart, and the reason M3 exists: the near end
 * shows a step, a shelf, and a second step when the reflection comes home; the far
 * end shows an edge that overshoots because the reflection adds to it on arrival.
 */
export function waveformRender(r: TlineResult, o: WaveformOptions): (s: Surface) => PlotRender {
  const n = r.t.length;
  const t0 = n > 0 ? r.t[0] : 0;
  const dt = r.dt;
  const tEnd = n > 0 ? r.t[n - 1] : 1;
  const shown = o.delays !== undefined && o.delays > 0 ? Math.min(tEnd, o.delays * r.delay) : tEnd;
  const last = Math.min(n - 1, r.stepIndex + Math.ceil(shown / dt));

  const nearStairs = staircaseOf(r, 'near');
  const farStairs = staircaseOf(r, 'far');

  let lo = Math.min(r.initialLevel, r.finalLevel);
  let hi = Math.max(r.initialLevel, r.finalLevel);
  const widen = (y: Float64Array): void => {
    for (let i = 0; i <= last; i++) {
      if (y[i] < lo) lo = y[i];
      if (y[i] > hi) hi = y[i];
    }
  };
  widen(r.near);
  widen(r.far);
  if (o.showSource) widen(r.source);
  if (o.showLattice) {
    widen(nearStairs);
    widen(farStairs);
  }
  const pad = 0.06 * Math.max(hi - lo, 1e-6);
  const [yLo, yHi] = niceDomain([lo - pad, hi + pad], 6);

  const nearPlateau = r.near[Math.min(n - 1, r.stepIndex + Math.round(r.delay / dt))];

  const metrics: MetricSpec[] = [
    {
      key: 'launch',
      label: 'Near-end shelf, above the starting level',
      value: nearPlateau - r.initialLevel,
      unit: 'V',
      target: r.launch,
      note: 'read at one delay; the target is the divider V_s Z0/(R_S + Z0)',
    },
    { key: 'initial', label: 'Level before the step', value: r.initialLevel, unit: 'V' },
    { key: 'final', label: 'Level both ends settle to', value: r.finalLevel, unit: 'V' },
    {
      key: 'overshoot',
      label: 'Far-end overshoot',
      value: r.overshoot,
      unit: '%',
      sig: 3,
      note: 'of the far-end step',
    },
    {
      key: 'ringback',
      label: 'Far-end ringback, after the peak',
      value: r.ringback,
      unit: '%',
      sig: 3,
      note: 'below the final level; this is what eats a receiver threshold margin',
    },
    {
      key: 'settling',
      label: 'Far-end settling, to within 2%',
      value: r.settling2pct,
      unit: 's',
      note: r.settled
        ? 'last time the trace leaves the band'
        : 'not settled within the record; this is a lower bound',
    },
    { key: 'td', label: 'One-way delay', value: r.delay, unit: 's' },
    {
      key: 'spr',
      label: 'Samples per rise time',
      value: r.samplesPerRise,
      unit: '1',
      sig: 3,
      note: 'below about 4 the edge is not resolved and the shape on screen is the grid',
    },
  ];

  const notes: string[] = ['Source is an ideal voltage behind R_S; the amplitude is its open-circuit swing.'];
  if (o.showLattice && o.loadC > 0) {
    notes.push('The staircases use the load resistance only, so they disagree with the waveform on purpose.');
  }

  return (s: Surface): PlotRender => {
    const xScale = linearScale([t0, r.t[last] ?? tEnd], [s.plot.x, s.plot.x + s.plot.width]);
    const yScale = linearScale([yLo, yHi], [s.plot.y + s.plot.height, s.plot.y]);

    const spec: ChromeSpec = {
      x: { scale: xScale, unit: 's', title: 'Time, from the commanded step', target: 0 },
      y: { scale: yScale, unit: 'V', title: 'Voltage' },
      traces: [
        {
          key: 'source',
          label: 'Source, open circuit',
          color: signal.ch3,
          dash: [2, 3],
          hidden: !o.showSource,
        },
        {
          key: 'near-lattice',
          label: 'Driver pin, lattice',
          color: semantic.ideal,
          dash: [2, 3],
          hidden: !o.showLattice,
        },
        {
          key: 'far-lattice',
          label: 'Receiver pad, lattice',
          color: semantic.measured,
          dash: [2, 3],
          hidden: !o.showLattice,
        },
        { key: 'near', label: 'Driver pin, simulated', color: semantic.ideal },
        { key: 'far', label: 'Receiver pad, simulated', color: semantic.measured },
      ],
      caption: `One ${formatEng(r.response.bw, 'Hz', 3)}-bandwidth edge seen at both ends of a line with a ${formatEng(r.delay, 's', 3)} one-way delay${o.showLattice ? ', with the staircase the lattice predicts' : ''}.`,
      metrics,
      grid: 'auto',
      legend: 'br',
      readout: 'none',
      notes,
    };

    return {
      spec,
      drawTraces(sf: Surface): void {
        const range: [number, number] = [0, last + 1];
        drawHLine(sf, r.finalLevel, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        if (o.showSource) {
          drawUniformTrace(
            sf,
            r.source,
            t0,
            dt,
            xScale,
            yScale,
            { color: signal.ch3, width: 1.25, dash: [2, 3] },
            range,
          );
        }
        if (o.showLattice) {
          drawUniformTrace(
            sf,
            nearStairs,
            t0,
            dt,
            xScale,
            yScale,
            { color: semantic.ideal, width: 1, dash: [2, 3] },
            range,
          );
          drawUniformTrace(
            sf,
            farStairs,
            t0,
            dt,
            xScale,
            yScale,
            { color: semantic.measured, width: 1, dash: [2, 3] },
            range,
          );
        }
        drawUniformTrace(sf, r.near, t0, dt, xScale, yScale, { color: semantic.ideal, width: 1.75 }, range);
        drawUniformTrace(sf, r.far, t0, dt, xScale, yScale, { color: semantic.measured, width: 1.75 }, range);
      },
    };
  };
}

/* --------------------------------------------------------------------- TDR */

export interface TdrOptions {
  /** Velocity factor, for the distance axis. */
  velocityFactor: number;
  /** Characteristic impedance of the line as specified, ohms. */
  z0: number;
  /** Load resistance as specified, ohms. */
  loadZ: number;
  /** Load capacitance, farads. */
  loadC: number;
  /** Horizontal axis. */
  axis: 'time' | 'distance';
  /** Reference impedance of the instrument, ohms. */
  reference: number;
}

/** Highest impedance the TDR plot will scale to, ohms. Opens read far above it. */
export const TDR_DISPLAY_CEILING = 250;

/**
 * Apparent impedance against round-trip time or distance, as a TDR displays it.
 *
 * Plotted beside the impedance the line actually has, so the reader can see that
 * the first discontinuity reads exactly and a later one does not: the instrument
 * assumes every reflection it receives came straight from one interface, and after
 * the first mismatch that is no longer true.
 */
export function tdrRender(r: TlineResult, o: TdrOptions): (s: Surface) => PlotRender {
  const n = r.tdrZ.length;
  const has = n > 0 && n === r.t.length;
  const dt = r.dt;
  const vf = o.velocityFactor;
  const toX = (t: number): number => (o.axis === 'distance' ? tdrDistance(t, vf) : t);

  // Round trip to the load and back, plus a little more, but never less than enough
  // to see the edge itself.
  const tStart = r.t.length > 0 ? r.t[0] : 0;
  const tRecordEnd = r.t.length > 0 ? r.t[r.t.length - 1] : 1;
  const tShown = Math.min(tRecordEnd, Math.max(3.5 * r.delay, 16 * (r.samplesPerRise * dt)));
  const last = Math.min(r.t.length - 1, r.stepIndex + Math.ceil(tShown / dt));

  let observed = o.reference;
  if (has) for (let i = 0; i <= last; i++) if (r.tdrZ[i] > observed) observed = r.tdrZ[i];
  const top = Math.min(TDR_DISPLAY_CEILING, Math.max(1.08 * observed, 1.2 * o.z0, 1.2 * o.reference, 60));
  const [yLo, yHi] = niceDomain([0, top], 6);
  const clipped = observed > yHi;
  // An open end reads tens of kilohms. Clamp far outside the view so the clipped
  // stroke still leaves the top of the plot rather than overflowing the canvas maths.
  const view = has ? r.tdrZ.map((z) => Math.min(z, yHi * 4)) : r.tdrZ;

  // The impedance the instrument is looking into, piecewise: its own cable before
  // the launch, the line for one round trip, the load after.
  const truthX = [
    toX(tStart),
    toX(0),
    toX(0),
    toX(2 * r.delay),
    toX(2 * r.delay),
    toX(r.t[last] ?? tRecordEnd),
  ];
  const loadShown = Number.isFinite(o.loadZ) ? o.loadZ : Number.MAX_VALUE;
  const truthY = [o.reference, o.reference, o.z0, o.z0, loadShown, loadShown];

  const metrics: MetricSpec[] = [];
  if (has) {
    metrics.push(
      {
        key: 'line',
        label: 'Reading halfway down the line',
        value: r.tdrLine,
        unit: 'ohm',
        target: o.z0,
        note: 'first discontinuity: reads exactly',
      },
      {
        key: 'load',
        label: 'Reading one delay after the load returns',
        value: r.tdrLoad,
        unit: 'ohm',
        note:
          o.z0 === o.reference
            ? 'the line matches the instrument, so this one reads exactly too'
            : 'past a mismatch: the instrument sees it through the first interface and reads it wrong',
      },
    );
    if (Number.isFinite(o.loadZ) && o.loadC === 0) metrics[1] = { ...metrics[1], target: o.loadZ };
    metrics.push(
      {
        key: 'roundtrip',
        label: 'Round trip to the load',
        value: 2 * r.delay,
        unit: 's',
        note: 'twice the one-way delay',
      },
      {
        key: 'distance',
        label: 'Distance the instrument infers',
        value: tdrDistance(2 * r.delay, vf),
        unit: 'm',
        note: 'v t / 2; wrong in proportion if the velocity factor entered is wrong',
      },
    );
  }

  const notes: string[] = [
    `Matched ${formatEng(o.reference, 'ohm', 3)} instrument, same edge as the driver.`,
  ];
  if (clipped)
    notes.push('The trace leaves the top of the scale: an open end reads as a very large impedance.');
  if (o.loadC > 0)
    notes.push('A capacitor looks like a short when the edge arrives, and like nothing afterwards.');
  if (!has) notes.push('TDR not run for this result.');

  const xTitle = o.axis === 'distance' ? 'Distance, from the instrument port' : 'Time, round trip';
  const xUnit = o.axis === 'distance' ? 'm' : 's';

  return (s: Surface): PlotRender => {
    const xScale = linearScale(
      [toX(tStart), toX(r.t[last] ?? tRecordEnd)],
      [s.plot.x, s.plot.x + s.plot.width],
    );
    const yScale = linearScale([yLo, yHi], [s.plot.y + s.plot.height, s.plot.y]);

    const spec: ChromeSpec = {
      x: { scale: xScale, unit: xUnit, title: xTitle },
      y: { scale: yScale, unit: 'ohm', title: 'Apparent impedance' },
      traces: [
        {
          key: 'truth',
          label: o.loadC > 0 ? 'Impedance as built, resistance only' : 'Impedance as built',
          color: semantic.ideal,
          dash: [6, 3],
        },
        { key: 'tdr', label: 'TDR reading', color: semantic.measured, hidden: !has },
      ],
      caption: `What a ${formatEng(o.reference, 'ohm', 3)} TDR displays looking into a ${formatEng(o.z0, 'ohm', 3)} line, against ${o.axis === 'distance' ? 'the distance it infers' : 'round-trip time'}, beside the impedance actually there.`,
      metrics,
      grid: 'auto',
      legend: 'tl',
      readout: 'none',
      notes,
    };

    return {
      spec,
      drawTraces(sf: Surface): void {
        drawHLine(sf, o.reference, yScale, { color: ink.textLo, width: 1, dash: [1, 4], alpha: 0.6 });
        drawXY(
          sf,
          truthX,
          truthY.map((z) => Math.min(z, yHi * 4)),
          xScale,
          yScale,
          {
            color: semantic.ideal,
            width: 1.25,
            dash: [6, 3],
          },
        );
        if (has) {
          const range: [number, number] = [0, last + 1];
          if (o.axis === 'distance') {
            drawUniformTrace(
              sf,
              view,
              toX(tStart),
              tdrDistance(dt, vf),
              xScale,
              yScale,
              { color: semantic.measured, width: 1.75 },
              range,
            );
          } else {
            drawUniformTrace(
              sf,
              view,
              tStart,
              dt,
              xScale,
              yScale,
              { color: semantic.measured, width: 1.75 },
              range,
            );
          }
        }
      },
    };
  };
}
