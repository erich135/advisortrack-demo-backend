/**
 * A8.2 Maya Advisor Workspace seed checks (demo-only).
 * Run: npm run test:a82-maya
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';
import { extraMayaWorkspaceActivities, extraMayaWorkspaceCases } from '../src/features/northstarAdvisorStories';
import { NORTHSTAR_SEED_VERSION, NORTHSTAR_VERSION_LABEL } from '../src/features/demoNorthstar';

const root = process.cwd();
const seed = fs.readFileSync(path.join(root, 'scripts/seed-northstar-master.ts'), 'utf8');
const clone = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspaceClone.ts'), 'utf8');
const northstar = fs.readFileSync(path.join(root, 'src/features/demoNorthstar.ts'), 'utf8');

assert.equal(NORTHSTAR_SEED_VERSION, 20);
assert.equal(NORTHSTAR_VERSION_LABEL, 'a86-advisor-production');
assert.match(northstar, /NORTHSTAR_SEED_VERSION = 20/);
assert.match(seed, /extraMayaWorkspaceCases/);
assert.match(seed, /extraMayaWorkspaceActivities/);
assert.match(seed, /monthly_goal_nett = 60000/);
assert.match(seed, /commission_advisor_type = 'independent'/);
assert.match(clone, /review_due_at/);
assert.doesNotMatch(seed, /advisor_track(?!_demo)/);

const cases = extraMayaWorkspaceCases();
const stages = new Set(cases.map((row) => row.stage));
assert.equal(stages.size, 6, 'Maya extras cover all six stages');
assert.ok(cases.some((row) => row.ficaId && row.ficaResidence && row.ficaBank));
assert.ok(cases.some((row) => !row.ficaId || !row.ficaResidence || !row.ficaBank));
assert.ok(cases.some((row) => row.docsReceived > 0 && row.docsReceived < 3));
assert.ok(cases.some((row) => Boolean(row.chosenInsurer)));
assert.ok(cases.some((row) => row.nextAction === false));
assert.ok(cases.some((row) => row.reviewDue));
assert.ok(cases.some((row) => row.linkProduction === false));
assert.equal(cases.length, 12);

const activities = extraMayaWorkspaceActivities();
assert.ok(activities.some((row) => row.bucket === 'upcoming' && row.status === 'scheduled'));
assert.ok(activities.some((row) => row.bucket.startsWith('days_ago') && row.status === 'scheduled'));
assert.ok(activities.some((row) => row.status === 'completed'));
assert.ok(activities.some((row) => row.bucket === 'hours_ago'));
assert.ok(new Set(activities.map((row) => row.type)).size >= 3);

assert.equal(fs.existsSync(path.join(root, 'database/local')), false);

console.log('A8.2 Maya seed checks passed');
