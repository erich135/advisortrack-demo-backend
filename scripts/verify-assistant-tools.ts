/**
 * AdvisorTrack Assistant A7.1 live tools — demo backend snapshot.
 * Run: npm run assistant:tools-check
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  askAssistant,
  createFakeProvider,
  createFixtureLiveSource,
  LICENCE_SUMMARY_TOOL,
  loadServerBundle,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
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
    isOrganisationAdmin: true,
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

const jordan: FixturePerson = {
  id: 'jordan-hale',
  companyId: 'company-northstar',
  firstName: 'Jordan',
  lastName: 'Hale',
  reportingRoleLabel: 'Regional Manager',
  teamName: null,
  regionName: 'Gauteng North',
  accountStatus: 'Active',
  licenceStatus: 'Licensed',
  invitationStatus: 'Accepted',
  lastMobileActivityAt: '2026-09-17T12:32:00.000Z',
  email: 'jordan.hale@northstar.test',
  phone: '0821111111',
  visibleTo: ['exec-1'],
};

const source = createFixtureLiveSource({
  people: [jordan],
  pools: {
    'company-northstar': { purchased: 40, assigned: 32, available: 8 },
    'company-unlimited': { purchased: null, assigned: 4, available: null },
  },
});

const bundle = loadServerBundle();
const boomProvider = createFakeProvider(async () => {
  throw new Error('model should not run');
});
const exec = identity({ userId: 'exec-1' });
const fa = identity({
  userId: 'fa-1',
  reportingRank: 'financial_advisor',
  isOrganisationAdmin: false,
  portalAccess: false,
  hierarchyScopeKind: null,
  canViewRegions: false,
  canViewTeams: false,
});

async function main(): Promise<void> {
  const orgSource = fs.readFileSync(
    path.join(process.cwd(), 'src/assistant/live/organisationSource.ts'),
    'utf8',
  );
  assert.doesNotMatch(orgSource, /api\.advisortrack/);

  const licences = await askAssistant({
    question: 'How many licences are available?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
    liveSource: source,
  });
  assert.equal(licences.modelAttempted, false);
  assert.equal(licences.answer.intent, 'live.LICENCE_SUMMARY');
  assert.match(licences.answer.body, /8 licences available/);

  const denied = await askAssistant({
    question: 'How many licences are available?',
    identity: fa,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
    liveSource: source,
  });
  assert.notEqual(denied.answer.intent, 'live.LICENCE_SUMMARY');

  const unlimited = await askAssistant({
    question: 'How many licences are available?',
    identity: identity({ userId: 'exec-1', companyId: 'company-unlimited' }),
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
    liveSource: source,
  });
  assert.match(unlimited.answer.body, /unlimited licences available/i);

  const person = await askAssistant({
    question: 'Jordan Hale',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
    liveSource: source,
  });
  assert.match(person.answer.body, /jordan\.hale@northstar\.test/);
  assert.match(person.answer.body, /Last mobile activity:/);
  assert.equal(LICENCE_SUMMARY_TOOL.requiredCapabilities.includes('canViewLicences'), true);

  console.log('Demo Assistant tool checks passed (A7.1 snapshot, no production proxy, no demo PII redaction)');
}

void main();
