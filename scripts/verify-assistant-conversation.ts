/**
 * AdvisorTrack Assistant A6.1 conversational layer — demo backend snapshot.
 * Run: npm run assistant:conversation-check
 */
import assert from 'node:assert/strict';
import {
  askAssistant,
  createFakeProvider,
  loadServerBundle,
  resetAssistantAskThrottle,
  visibleConversationAreas,
  type TrustedAssistantIdentity,
} from '../src/assistant';

resetAssistantAskThrottle();

async function main(): Promise<void> {
  const boomProvider = createFakeProvider(async () => {
    throw new Error('model should not run');
  });
  const bundle = loadServerBundle();
  const identity: TrustedAssistantIdentity = {
    userId: 'exec-admin-1',
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
  };

  const hello = await askAssistant({
    question: 'hello',
    identity,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(hello.modelAttempted, false);
  assert.equal(hello.answer.intent, 'conversation.greeting');

  const addUser = await askAssistant({
    question: 'Hi, how do I add a user?',
    identity,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(addUser.answer.intent, 'PEOPLE.ADD_USER');

  const france = await askAssistant({
    question: 'What is the capital of France?',
    identity,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(france.answer.intent, 'conversation.off_topic');
  assert.match(france.answer.body, /Demo Tips/);

  const productionHelp = await askAssistant({
    question: 'what can you help me with',
    identity,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boomProvider,
  });
  assert.doesNotMatch(productionHelp.answer.body, /Demo Tips/);
  assert.equal(visibleConversationAreas(bundle.categories, 'demo').includes('Demo Tips'), true);

  const suck = await askAssistant({
    question: 'you suck',
    identity,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(suck.answer.intent, 'conversation.frustration');
  assert.equal(suck.modelAttempted, false);
  assert.match(suck.answer.body, /Fair enough/);

  const swearyLicence = await askAssistant({
    question: 'This is fucking useless, how do I assign a licence?',
    identity,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(swearyLicence.answer.intent, 'LIC.ASSIGN');
  assert.equal(swearyLicence.modelAttempted, false);

  const listening = await askAssistant({
    question: "you're not listening",
    identity,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(listening.answer.intent, 'conversation.misunderstanding');

  console.log('Demo Assistant conversation checks passed (A6.1/A7.2.1 snapshot, no production proxy)');
}

void main();
