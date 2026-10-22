/**
 * A8.5 demo Maya pipeline / MY_PIPELINE isolation checks.
 * Run: npm run test:a85-maya
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extraMayaWorkspaceCases } from '../src/features/northstarAdvisorStories';
import { NORTHSTAR_SEED_VERSION } from '../src/features/demoNorthstar';
import { routeLiveQuestion } from '../src/assistant/live/router';
import { MY_PIPELINE_TOOL, MY_CASE_SUMMARY_TOOL } from '../src/assistant/live/tools';
import { TOOL_FIELD_CATALOG } from '../src/assistant/live/classify';
import { assertAssistantToolRegistry } from '../src/assistant/live/registry';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(`${root}/${relative}`, 'utf8');

assert.doesNotMatch(read('src/config/env.ts'), /advisor_track(?!_demo)/);
assert.match(read('src/routes/cases.routes.ts'), /caseService\.list\(userId, query\)/);
assert.doesNotMatch(read('src/routes/cases.routes.ts'), /req\.query\.userId|req\.query\.advisorId/);
assert.match(read('src/assistant/live/organisationSource.ts'), /caseService\.list\(ctx\.identity\.userId\)/);
assert.equal(MY_PIPELINE_TOOL.scopeResolver, 'self');
assert.equal(MY_CASE_SUMMARY_TOOL.scopeResolver, 'self');
assert.ok(Object.values(TOOL_FIELD_CATALOG.MY_PIPELINE ?? {}).every((dataClass) => dataClass === 'operational'));
assertAssistantToolRegistry();
assert.equal(routeLiveQuestion('How many open cases do I have?').kind, 'mypipeline');
assert.equal(routeLiveQuestion('How do I submit to Production?').kind, 'none');

const cases = extraMayaWorkspaceCases();
assert.equal(new Set(cases.map((item) => item.stage)).size, 6, 'Maya extras cover all six stages');
assert.ok(cases.some((item) => item.nextAction === false), 'Maya has a no-next-action case');
assert.ok(cases.some((item) => item.reviewDue), 'Maya has a review-due case');
assert.ok(cases.some((item) => item.linkProduction), 'Maya has a production-linked case');
assert.equal(NORTHSTAR_SEED_VERSION, 20, 'A8.6 production extras require a Northstar reseed');
assert.ok(cases.some((item) => item.analysisQuotes && item.analysisQuotes.length > 0), 'Maya has quote data');
assert.ok(cases.some((item) => !item.ficaId || !item.ficaResidence || !item.ficaBank), 'Maya has mixed FICA');

const kb = JSON.parse(read('src/assistant/knowledge-bundle.json')) as { cards: Array<{ id: string }> };
assert.ok(kb.cards.some((card) => card.id === 'PIPELINE.WHAT'));
assert.ok(kb.cards.some((card) => card.id === 'PIPELINE.SUBMIT'));

console.log('A8.5 demo Maya pipeline checks passed');
