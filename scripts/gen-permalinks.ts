import { writeFileSync } from 'node:fs';
import { PRESETS } from '../src/state/presets';
import { encodeScenario, permalinkFor } from '../src/state/url-codec';
import { defaultScenario } from '../src/state/scenario';

const payloads: Record<string, string> = { __default__: encodeScenario(defaultScenario()) };
for (const p of PRESETS) payloads[p.id] = encodeScenario(p.scenario);

const links: Record<string, string> = {};
for (const p of PRESETS) {
  links[p.id] = permalinkFor(p.modules[0], 'top', p.scenario, 'https://example.org', '/eye/');
}

writeFileSync(
  'src/state/__tests__/__goldens__/permalinks.json',
  JSON.stringify({ payloads, links }, null, 2) + '\n',
);
console.log('presets:', PRESETS.length);
console.log('longest payload:', Math.max(...Object.values(payloads).map((s) => s.length)));
