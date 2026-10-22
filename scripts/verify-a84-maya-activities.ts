/**
 * A8.4 demo Maya activities / MY_FOLLOWUPS isolation checks.
 * Run: npm run test:a84-maya-activities
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { routeLiveQuestion } from '../src/assistant/live/router';
import { MY_FOLLOWUPS_TOOL } from '../src/assistant/live/tools';
import { TOOL_FIELD_CATALOG } from '../src/assistant/live/classify';
import { assertAssistantToolRegistry } from '../src/assistant/live/registry';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

assert.doesNotMatch(read('src/config/env.ts'), /advisor_track(?!_demo)/);
assert.match(read('src/routes/activities.routes.ts'), /androidResourceAuth/);
assert.doesNotMatch(read('src/assistant/live/organisationSource.ts'), /listSelfActivities\([\s\S]*req\.(body|query)\.userId/);
assert.match(read('src/assistant/live/organisationSource.ts'), /listByUserId\(ctx\.identity\.userId\)/);
assert.equal(MY_FOLLOWUPS_TOOL.scopeResolver, 'self');
assert.ok(Object.values(TOOL_FIELD_CATALOG.MY_FOLLOWUPS ?? {}).every((dataClass) => dataClass === 'operational'));
assertAssistantToolRegistry();
assert.equal(routeLiveQuestion('What follow-ups do I have today?').kind, 'followups');
assert.equal(routeLiveQuestion('How do I add an activity?').kind, 'none');

const kb = JSON.parse(read('src/assistant/knowledge-bundle.json')) as { cards: Array<{ id: string }> };
assert.ok(kb.cards.some((card) => card.id === 'ACTIVITY.ADD'));
assert.ok(kb.cards.some((card) => card.id === 'ACTIVITY.PROCEED'));

console.log('A8.4 demo Maya activity checks passed');
