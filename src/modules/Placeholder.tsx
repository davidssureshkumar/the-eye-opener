/**
 * What a module looks like before it is written.
 *
 * Not a "coming soon" page. The shell, the controls, the help text and the schema
 * behind them are real and working here, so a reader can open M7, move the CTLE
 * peaking slider and read what it does. What is missing is the module's argument -
 * the derivation, the plots and the prose - and this says exactly that, names the
 * milestone it lands in, and does not fill the gap with anything.
 *
 * That last part is deliberate. Inventing a paragraph of plausible-sounding physics
 * to make the page look finished is the failure mode this whole project is written
 * against, and a page that is honestly empty is worth more than one that is
 * dishonestly full.
 */

import { getModule } from '../content/modules';
import { repoDocumentUrl, type RepoDocument } from '../content/repo';
import { Callout } from '../ui/Callout';

export function Placeholder({ moduleId }: { moduleId: string }): JSX.Element {
  const meta = getModule(moduleId);
  if (!meta) return <p className="text-lo">No module {moduleId}.</p>;

  return (
    <>
      <p className="text-lead text-hi">{meta.summary}</p>

      <Callout variant="notice" title="This module is not written yet">
        <p>
          The instrument panel beside this text is live: the controls, their ranges and their explanations all
          come from the real schema, and moving them changes the scenario in the URL. What is not here yet is
          this module&rsquo;s own argument - its derivations, its plots and the prose that connects them.
        </p>
        <p>
          It is scheduled for build milestone {meta.milestone}. Nothing has been written in its place: a page
          of plausible filler would be worse than an empty one, because it would be indexed, quoted and
          believed.
        </p>
      </Callout>

      <h2>What this module will answer</h2>
      <p>{meta.question}</p>

      <p className="text-micro text-lo">
        The course outline, what is built, what is stubbed and every known inaccuracy are tracked in{' '}
        <DocLink file="PROGRESS.md" />; every formula the site implements is derived, sourced and bounded in{' '}
        <DocLink file="PHYSICS.md" />. Both open on GitHub in a new tab.
      </p>
    </>
  );
}

/** A repository document, which is not part of the build and so has to be linked. */
function DocLink({ file }: { file: RepoDocument }): JSX.Element {
  return (
    <a className="readout" href={repoDocumentUrl(file)} target="_blank" rel="noopener noreferrer">
      {file}
    </a>
  );
}
