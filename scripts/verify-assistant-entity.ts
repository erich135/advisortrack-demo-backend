/**
 * AdvisorTrack Assistant A7.1 entity resolution — demo backend snapshot.
 * Run: npm run assistant:entity-check
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  askAssistant,
  createFakeProvider,
  createFixtureLiveSource,
  createTurnRefTable,
  executePersonSummary,
  ForgedEntityRefError,
  loadServerBundle,
  mintPersonRef,
  readEntityRef,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
  routeLiveQuestion,
  type TrustedAssistantIdentity,
} from '../src/assistant';
import type { FixturePerson } from '../src/assistant/live/source';

resetAssistantAskThrottle();
resetAssistantLiveRuntime();

function identity(
  partial: Partial<TrustedAssistantIdentity> & Pick<TrustedAssistantIdentity, 'userId'>,
): TrustedAssistantIdentity {
  return {
    companyId: 'company-northstar',
    companyName: 'Northstar Advisory',
    reportingRank: 'executive',
    isOrganisationAdmin: false,
    isPlatformStaff: false,
    portalAccess: true,
    hierarchyScopeKind: 'organisation',
    canViewRegions: true,
    canViewTeams: true,
    permissions: [],
    canAccessEngineeringChangelog: false,
    ...partial,
  };
}

const EXEC = 'exec-1';
const RM = 'rm-1';
const TL = 'tl-1';
const FA_ADMIN = 'fa-admin-1';
const FA = 'fa-1';

function person(
  partial: Omit<FixturePerson, 'visibleTo' | 'companyId'> & { visibleTo: string[]; companyId?: string },
): FixturePerson {
  return {
    companyId: 'company-northstar',
    licenceStatus: 'Licensed',
    invitationStatus: 'Accepted',
    lastMobileActivityAt: '2026-09-17T12:32:00.000Z',
    email: `${partial.firstName.toLowerCase()}@northstar.test`,
    phone: '0820000000',
    accountStatus: 'Active',
    ...partial,
  };
}

const jordan = person({
  id: 'jordan-hale',
  firstName: 'Jordan',
  lastName: 'Hale',
  reportingRoleLabel: 'Regional Manager',
  teamName: null,
  regionName: 'Gauteng North',
  visibleTo: [EXEC, RM, FA_ADMIN],
});
const jordanBotha = person({
  id: 'jordan-botha',
  firstName: 'Jordan',
  lastName: 'Botha',
  reportingRoleLabel: 'Financial Advisor',
  teamName: 'Johannesburg East',
  regionName: 'Gauteng North',
  visibleTo: [EXEC, RM, FA_ADMIN],
});
const keegan = person({
  id: 'keegan-pillay',
  firstName: 'Keegan',
  lastName: 'Pillay',
  reportingRoleLabel: 'Financial Advisor',
  teamName: 'Johannesburg East',
  regionName: 'Gauteng North',
  visibleTo: [EXEC, RM, TL, FA_ADMIN],
});
const sam = person({
  id: 'sam-okonkwo',
  firstName: 'Sam',
  lastName: 'Okonkwo',
  reportingRoleLabel: 'Financial Advisor',
  teamName: 'Cape Town',
  regionName: 'Western Cape',
  visibleTo: [EXEC, FA_ADMIN],
});

const source = createFixtureLiveSource({
  people: [jordan, jordanBotha, keegan, sam],
  pools: { 'company-northstar': { purchased: 40, assigned: 32, available: 8 } },
});

const bundle = loadServerBundle();
const boomProvider = createFakeProvider(async () => {
  throw new Error('model should not run');
});

const exec = identity({ userId: EXEC });
const rm = identity({ userId: RM, reportingRank: 'regional_manager', hierarchyScopeKind: 'region' });
const tl = identity({
  userId: TL,
  reportingRank: 'team_leader',
  hierarchyScopeKind: 'team',
  canViewRegions: false,
});
const faAdmin = identity({
  userId: FA_ADMIN,
  reportingRank: 'financial_advisor',
  portalAccess: false,
  isOrganisationAdmin: true,
  hierarchyScopeKind: null,
});
const fa = identity({
  userId: FA,
  reportingRank: 'financial_advisor',
  portalAccess: false,
  hierarchyScopeKind: null,
  canViewRegions: false,
  canViewTeams: false,
});

async function ask(question: string, who: TrustedAssistantIdentity) {
  return askAssistant({
    question,
    identity: who,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
    liveSource: source,
  });
}

async function main(): Promise<void> {
  const sourceFile = fs.readFileSync(
    path.join(process.cwd(), 'src/assistant/live/organisationSource.ts'),
    'utf8',
  );
  assert.doesNotMatch(sourceFile, /api\.advisortrack/);
  assert.match(sourceFile, /advisortrack_demo|Demo adapter/);

  const execJordan = await ask('Jordan Hale', exec);
  assert.equal(execJordan.modelAttempted, false);
  assert.equal(execJordan.answer.intent, 'live.PERSON_SUMMARY');
  assert.match(execJordan.answer.body, /jordan@northstar\.test/);

  const rmOut = await ask('Sam Okonkwo', rm);
  const rmMissing = await ask('Zelda Nobody', rm);
  assert.equal(rmOut.answer.body, rmMissing.answer.body);

  const tlIn = await ask('Keegan Pillay', tl);
  assert.equal(tlIn.answer.intent, 'live.PERSON_SUMMARY');
  assert.equal((await ask('Sam Okonkwo', tl)).answer.intent, 'live.not_found_in_scope');

  const ambiguous = await ask('Jordan', exec);
  assert.equal(ambiguous.answer.mode, 'disambiguate');

  const table = createTurnRefTable();
  mintPersonRef(table, jordan);
  assert.throws(() => readEntityRef(table, 'ent_deadbeef', 'person'), ForgedEntityRefError);

  assert.equal((await ask('Jordan Hale', faAdmin)).answer.intent, 'live.PERSON_SUMMARY');
  assert.equal((await ask('Jordan Hale', fa)).answer.intent, 'live.not_found_in_scope');
  assert.equal(routeLiveQuestion('How do I assign a licence?').kind, 'none');
  assert.equal(typeof executePersonSummary, 'function');

  console.log('Demo Assistant entity checks passed (A7.1 snapshot, synthetic details not redacted)');
}

void main();
