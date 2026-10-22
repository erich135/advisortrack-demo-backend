/**
 * A8.6 demo Maya production / MY_PRODUCTION isolation checks.
 * Run: npm run test:a86-maya
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extraMayaWorkspaceCases } from '../src/features/northstarAdvisorStories';
import { NORTHSTAR_SEED_VERSION, NORTHSTAR_VERSION_LABEL } from '../src/features/demoNorthstar';
import { routeLiveQuestion } from '../src/assistant/live/router';
import { MY_PRODUCTION_TOOL } from '../src/assistant/live/tools';
import { TOOL_FIELD_CATALOG } from '../src/assistant/live/classify';
import { assertAssistantToolRegistry } from '../src/assistant/live/registry';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(`${root}/${relative}`, 'utf8');

assert.doesNotMatch(read('src/config/env.ts'), /advisor_track(?!_demo)/);
assert.match(read('src/routes/production.routes.ts'), /productionService\.list\(userId/);
assert.doesNotMatch(read('src/routes/production.routes.ts'), /req\.query\.userId|req\.query\.advisorId/);
assert.match(read('src/assistant/live/organisationSource.ts'), /productionRepository\.listByUserId\(ctx\.identity\.userId/);
assert.equal(MY_PRODUCTION_TOOL.scopeResolver, 'self');
assert.ok(Object.values(TOOL_FIELD_CATALOG.MY_PRODUCTION ?? {}).every((dataClass) => dataClass === 'operational'));
assert.ok(!('contactName' in (TOOL_FIELD_CATALOG.MY_PRODUCTION ?? {})));
assertAssistantToolRegistry();
assert.equal(routeLiveQuestion('How much have I issued this month?').kind, 'myproduction');
assert.equal(routeLiveQuestion('How many applications are pending underwriting?').kind, 'myproduction');
assert.equal(routeLiveQuestion('How do I capture production?').kind, 'none');

const cases = extraMayaWorkspaceCases();
assert.ok(cases.some((item) => item.applicationStatus === 'accepted_issued' && item.issued === false));
assert.ok(cases.some((item) => item.applicationStatus === 'awaiting_medicals'));
assert.ok(cases.some((item) => item.applicationStatus === 'pma_pending'));
assert.ok(cases.some((item) => item.applicationStatus === 'awaiting_advisor_info'));
assert.ok(cases.some((item) => item.applicationStatus === 'declined'));
assert.ok(cases.some((item) => item.applicationStatus === 'withdrawn'));
assert.equal(NORTHSTAR_SEED_VERSION, 21, 'A8.7 planning seed requires a Northstar reseed');
assert.equal(NORTHSTAR_VERSION_LABEL, 'a87-advisor-planning');

const kb = JSON.parse(read('src/assistant/knowledge-bundle.json')) as { cards: Array<{ id: string }> };
assert.ok(kb.cards.some((card) => card.id === 'PRODUCTION.WHAT'));

console.log('A8.6 Maya production / MY_PRODUCTION checks passed');
