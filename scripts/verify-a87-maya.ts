/**
 * A8.7 demo Maya planning / MY_TARGET_PROGRESS isolation checks.
 * Run: npm run test:a87-maya
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NORTHSTAR_SEED_VERSION, NORTHSTAR_VERSION_LABEL } from '../src/features/demoNorthstar';
import { routeLiveQuestion } from '../src/assistant/live/router';
import { MY_TARGET_PROGRESS_TOOL, canUseMyTargetProgress } from '../src/assistant/live/tools';
import { TOOL_FIELD_CATALOG } from '../src/assistant/live/classify';
import { assertAssistantToolRegistry } from '../src/assistant/live/registry';
import type { ToolExecutionContext } from '../src/assistant/live/types';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(`${root}/${relative}`, 'utf8');

assert.doesNotMatch(read('src/config/env.ts'), /advisor_track(?!_demo)/);
assert.match(read('src/routes/planning.routes.ts'), /planningService\.getTargets/);
assert.doesNotMatch(read('src/routes/planning.routes.ts'), /req\.query\.userId|req\.query\.advisorId/);
assert.match(read('src/assistant/live/organisationSource.ts'), /getSelfTargetProgress/);
assert.match(read('scripts/seed-northstar-master.ts'), /monthly_goal_nett = 60000/);
assert.match(read('scripts/seed-northstar-master.ts'), /commission_advisor_type = 'independent'/);
assert.match(read('scripts/seed-northstar-master.ts'), /cold_call_to_interview_ratio = 3.5/);
assert.equal(NORTHSTAR_SEED_VERSION, 21);
assert.equal(NORTHSTAR_VERSION_LABEL, 'a87-advisor-planning');
assert.equal(MY_TARGET_PROGRESS_TOOL.scopeResolver, 'self');
assert.equal(MY_TARGET_PROGRESS_TOOL.audiences[0], 'mobile_advisor');
assert.ok(Object.values(TOOL_FIELD_CATALOG.MY_TARGET_PROGRESS ?? {}).every((dataClass) => dataClass === 'operational'));
assert.ok(!('email' in (TOOL_FIELD_CATALOG.MY_TARGET_PROGRESS ?? {})));
assertAssistantToolRegistry();
assert.equal(routeLiveQuestion('How far am I from my target?').kind, 'mytarget');
assert.equal(routeLiveQuestion('How much have I issued this month?').kind, 'myproduction');
assert.equal(routeLiveQuestion('How do I change my monthly target?').kind, 'none');
const execCtx = {
  assistant: { capabilities: { canViewAdvisorWorkspace: false, canViewProduction: true } },
} as ToolExecutionContext;
assert.equal(canUseMyTargetProgress(execCtx), false);

const kb = JSON.parse(read('src/assistant/knowledge-bundle.json')) as { cards: Array<{ id: string }> };
assert.ok(kb.cards.some((card) => card.id === 'PLANNING.WHAT'));
assert.ok(kb.cards.some((card) => card.id === 'SUBSCRIPTION.UPGRADE'));

console.log('A8.7 Maya planning / MY_TARGET_PROGRESS checks passed');
