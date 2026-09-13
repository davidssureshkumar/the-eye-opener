/**
 * The router.
 *
 * Hash-based, and a switch rather than a routing library. The site is static and
 * deploys to a bare object store: with a hash, every URL is one request for
 * `index.html` and a deep link survives a refresh with no server rewrite rule. The
 * route already lives in `src/state/store.ts` because the scenario travels with it,
 * so a router would be a second source of truth for something that has one.
 *
 * Four destinations, and an honest fourth wall: an unknown module id gets a page
 * that says so and lists what does exist, rather than a blank screen.
 */

import { isModuleId } from '../content/modules';
import { useRoute } from '../state/store';
import { HomePage } from './HomePage';
import { ModulePage } from './ModulePage';
import { GlossaryPage } from './GlossaryPage';
import { SiteHeader } from './SiteHeader';

function NotFound({ what }: { what: string }): JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-h1">Nothing at that address</h1>
      <p className="mt-3 text-lo">
        There is no <span className="readout text-hi">{what}</span> here. The course has eleven modules, m1 to
        m11, plus a glossary.
      </p>
      <p className="mt-4">
        <a href="#/">Back to the contents</a>
      </p>
    </main>
  );
}

export function App(): JSX.Element {
  const route = useRoute();

  let page: JSX.Element;
  if (route.module === '') page = <HomePage />;
  else if (route.module === 'glossary') page = <GlossaryPage termId={route.section} />;
  else if (isModuleId(route.module)) page = <ModulePage moduleId={route.module} />;
  else page = <NotFound what={route.module} />;

  return (
    <div className="min-h-screen bg-ink-900">
      <SiteHeader />
      {page}
    </div>
  );
}
