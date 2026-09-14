/**
 * Anchors for the numbered sections of PHYSICS.md, so an equation's source note can
 * link to the derivation it cites rather than just naming it.
 *
 * PHYSICS.md is not part of the build, so the anchors cannot be read at runtime.
 * They are restated here, and `physics-sections.test.ts` regenerates the table from
 * the file's headings and compares it both ways: renaming or renumbering a section
 * without updating this table fails the suite, and so does citing a section that
 * does not exist from any module.
 *
 * The anchors follow GitHub's heading slugs: lower case, punctuation other than
 * hyphens removed, spaces to hyphens.
 */

import { repoDocumentUrl } from './repo';

export const PHYSICS_SECTIONS: Readonly<Record<string, string>> = {
  '1': '1-conventions',
  '2': '2-fourier-series-and-the-gibbs-phenomenon',
  '2.1': '21-harmonic-coefficients',
  '2.2': '22-gibbs-constant',
  '2.3': '23-sine-integral',
  '2.4': '24-the-convergence-reference-and-the-error-metric',
  '2.5': '25-the-coefficient-envelope-and-duty-cycle-from-the-second-harmonic',
  '3': '3-edges-bandwidth-and-the-knee',
  '3.1': '31-knee-frequency',
  '3.2': '32-rise-timebandwidth-product',
  '3.3': '33-analogue-response-shapes',
  '3.4': '34-rlc-step-response',
  '3.5': '35-group-delay',
  '3.6': '36-applying-a-response-to-a-waveform',
  '3.7': '37-rise-times-in-series-the-quadrature-rule-and-its-error',
  '4': '4-pseudo-random-sequences',
  '5': '5-test-patterns',
  '5.1': '51-worst-case-isi-by-peak-distortion-analysis',
  '6': '6-statistics-noise-and-jitter',
  '6.1': '61-reproducibility',
  '6.2': '62-error-function-and-the-q-function',
  '6.3': '63-inverse-normal-cdf',
  '6.4': '64-dual-dirac-total-jitter',
  '7': '7-windows-and-spectra',
  '8': '8-convolution',
  '9': '9-interpolation-and-edge-timing',
  '9.1': '91-reconstruction',
  '9.2': '92-threshold-crossings',
  '9.3': '93-rise-time-from-a-waveform',
  '10': '10-hilbert-transform-and-minimum-phase',
  '10.1': '101-analytic-signal',
  '10.2': '102-minimum-phase-construction',
  '11': '11-plotting-mathematics',
  '11.1': '111-histogram-bin-centres',
  '11.2': '112-eye-folding',
  '11.3': '113-eye-measurements',
  '11.4': '114-colormaps',
  '11.5': '115-per-division-readouts',
  '12': '12-transmission-lines',
  '12.1': '121-delay-velocity-and-critical-length',
  '12.2': '122-characteristic-impedance-from-per-unit-length-l-and-c',
  '12.3': '123-launch-and-the-reflection-coefficient',
  '12.4': '124-the-lattice-and-the-final-level',
  '12.5': '125-the-simulator-and-a-capacitive-far-end',
  '12.6': '126-tdr',
  '13': '13-lossy-lines',
  '13.1': '131-skin-effect-and-the-internal-impedance',
  '13.2': '132-surface-roughness-and-its-causal-form',
  '13.3': '133-wideband-debye-dielectric',
  '13.4': '134-rlgc-abcd-s-parameters-and-group-delay',
  '13.5': '135-low-loss-attenuation-formulas',
  '13.6': '136-pulse-step-and-bit-stream',
  '14': '14-open-items',
};

/** Link to a numbered section of PHYSICS.md, or undefined if there is no such section. */
export function physicsSectionUrl(section: string): string | undefined {
  const anchor = PHYSICS_SECTIONS[section];
  return anchor === undefined ? undefined : `${repoDocumentUrl('PHYSICS.md')}#${anchor}`;
}

/** A piece of an equation's source note: plain text, or a citation of a section. */
export type SourcePart = { kind: 'text'; text: string } | { kind: 'section'; text: string; section: string };

/**
 * Split a source note into text and section citations.
 *
 * Matches `§12.3` wherever it appears, since notes cite a second section as
 * "§2.5 and §3.1" without repeating the file name. A citation of a section that
 * does not exist stays plain text here and fails the test suite.
 */
export function splitSource(source: string): SourcePart[] {
  const parts: SourcePart[] = [];
  const re = /§(\d+(?:\.\d+)?)/g;
  let last = 0;
  for (let m = re.exec(source); m !== null; m = re.exec(source)) {
    if (m.index > last) parts.push({ kind: 'text', text: source.slice(last, m.index) });
    parts.push({ kind: 'section', text: m[0], section: m[1] });
    last = m.index + m[0].length;
  }
  if (last < source.length) parts.push({ kind: 'text', text: source.slice(last) });
  return parts;
}
