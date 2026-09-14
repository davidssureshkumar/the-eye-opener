/**
 * The eleven modules, as data.
 *
 * The course has one through-line: a transmitter sent a square wave, the receiver
 * measured something else, how do we get back to ones and zeros? Each module owns
 * one step of that argument, and `question` is the step it answers. Keeping the
 * list here rather than in a router means the navigation, the progress tracker,
 * the glossary cross-links and the help text all read from the same source and
 * cannot disagree about what M6 is called.
 *
 * `status` is honest about the build. It is asserted against the filesystem by no
 * test - nothing can check "is this module good" - so it is maintained by hand
 * alongside PROGRESS.md and is the one field here that can go stale.
 */

export type ModuleStatus = 'planned' | 'in-progress' | 'done';

export interface ModuleMeta {
  /** Route segment: the '#/m5' in a permalink. */
  id: string;
  /** Display number. Matches the id, kept separate so sorting is numeric. */
  number: number;
  title: string;
  /** The question this module answers, in the reader's words. */
  question: string;
  /** Two sentences on what is inside. Shown on the index card. */
  summary: string;
  /** Build milestone this module belongs to, per the working agreement. */
  milestone: number;
  status: ModuleStatus;
}

export const MODULES: ModuleMeta[] = [
  {
    id: 'm1',
    number: 1,
    title: 'Building a square wave from nothing',
    question: 'What is a square wave actually made of?',
    summary:
      'Add sine waves one harmonic at a time and watch an edge appear. Gibbs overshoot, the sinc envelope of a pulse train, and the knee frequency that decides how much bandwidth an edge really needs.',
    milestone: 2,
    status: 'done',
  },
  {
    id: 'm2',
    number: 2,
    title: 'From ideal edge to real edge',
    question: 'Why does a real edge have a slope?',
    summary:
      'Bandwidth limiting as a filter, not as a defect. First-order RC, second-order RLC ringing and damping, and the 0.35/BW rule with the conditions under which it is true.',
    milestone: 2,
    status: 'done',
  },
  {
    id: 'm3',
    number: 3,
    title: 'Transmission lines and reflections',
    question: 'Where did that second edge come from?',
    summary:
      'When a trace stops being a wire. Characteristic impedance, the lattice/bounce diagram, termination schemes, and TDR read as the time-domain picture of an impedance profile.',
    milestone: 3,
    status: 'done',
  },
  {
    id: 'm4',
    number: 4,
    title: 'Loss: where the harmonics actually go',
    question: 'Why does the far end look smaller as well as slower?',
    summary:
      'Skin effect, dielectric loss and copper roughness, each with its own frequency dependence. RLGC to ABCD to S-parameters, insertion loss in dB, and Touchstone import for a measured channel.',
    milestone: 4,
    status: 'done',
  },
  {
    id: 'm5',
    number: 5,
    title: 'ISI, eye diagrams, and jitter',
    question: 'Why does this bit depend on the last one?',
    summary:
      'Intersymbol interference as the memory of the channel, the eye diagram as a fold of the record, jitter decomposition into RJ/DJ/PJ/DCD, and the bathtub curve that turns all of it into a BER.',
    milestone: 5,
    status: 'planned',
  },
  {
    id: 'm6',
    number: 6,
    title: 'Crosstalk, noise, and the power delivery network',
    question: 'What is the neighbouring net doing to mine?',
    summary:
      'NEXT and FEXT from the coupling coefficients, simultaneous switching noise and ground bounce, and a PDN impedance profile that explains why the supply sags exactly when the data switches.',
    milestone: 7,
    status: 'planned',
  },
  {
    id: 'm7',
    number: 7,
    title: 'Equalization: rebuilding the square wave',
    question: 'How does the receiver undo all of that?',
    summary:
      'FFE, CTLE and DFE as three different answers to the same loss, the slicer that turns volts into bits, and a CDR whose loop bandwidth decides which jitter it tracks and which it must tolerate.',
    milestone: 6,
    status: 'planned',
  },
  {
    id: 'm8',
    number: 8,
    title: 'Memory interfaces: DDR5, LPDDR5/5X, HBM',
    question: 'How does a real memory bus do this?',
    summary:
      'Where a parallel memory interface differs from a serial link: strobes instead of embedded clocks, per-bit deskew, write/read training walkthroughs, and the 2D shmoo that a validation engineer actually ships.',
    milestone: 8,
    status: 'planned',
  },
  {
    id: 'm9',
    number: 9,
    title: 'The wireless view of the same problem',
    question: 'Is this the same problem radio people solve?',
    summary:
      'The duality: IQ constellations and EVM against eye diagrams and margin, multipath against reflections, channel equalization against FFE. Same mathematics, different vocabulary.',
    milestone: 9,
    status: 'planned',
  },
  {
    id: 'm10',
    number: 10,
    title: 'Measuring it in the lab',
    question: 'How much of what I see is the instrument?',
    summary:
      'The oscilloscope as a system under test: bandwidth and response shape, sample rate and interpolation, ADC bits and noise floor, probe loading, averaging, and the trigger and FFT settings that decide what you can see.',
    milestone: 9,
    status: 'planned',
  },
  {
    id: 'm11',
    number: 11,
    title: 'Sandbox',
    question: 'What happens if I change everything at once?',
    summary:
      'Every model in one workbench with no guard rails, plus PAM4, scenario save and load, and diagnostic challenges that show a broken eye and ask what caused it.',
    milestone: 10,
    status: 'planned',
  },
];

const BY_ID = new Map(MODULES.map((m) => [m.id, m]));

export function getModule(id: string): ModuleMeta | undefined {
  return BY_ID.get(id);
}

export function isModuleId(id: string): boolean {
  return BY_ID.has(id);
}

/** Reading order. The modules are authored to be read front to back. */
export function moduleOrder(): string[] {
  return MODULES.map((m) => m.id);
}

/** The module before and after this one, for the previous/next footer links. */
export function moduleNeighbours(id: string): {
  previous: ModuleMeta | undefined;
  next: ModuleMeta | undefined;
} {
  const i = MODULES.findIndex((m) => m.id === id);
  if (i < 0) return { previous: undefined, next: undefined };
  return { previous: MODULES[i - 1], next: MODULES[i + 1] };
}
