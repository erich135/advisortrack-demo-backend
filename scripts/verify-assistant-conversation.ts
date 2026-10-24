/**
 * AdvisorTrack Assistant conversational layer — demo backend snapshot.
 * Canonical Dex 2.0 behaviour lives in Abel. This check confirms the isolated
 * demo runtime stays in parity and never proxies production.
 * Run: npm run assistant:conversation-check
 */
import assert from 'node:assert/strict';
import {
  askAssistant,
  createDisabledProvider,
  createFakeProvider,
  loadServerBundle,
  resetAssistantAskThrottle,
  resetAssistantConversationMemory,
  visibleConversationAreas,
  type TrustedAssistantIdentity,
} from '../src/assistant';

resetAssistantAskThrottle();
resetAssistantConversationMemory();

async function main(): Promise<void> {
  const boomProvider = createFakeProvider(async () => {
    throw new Error('model should not run');
  });
  const disabled = createDisabledProvider();
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
    conversationScope: 'demo-conversation-check',
  };

  const ask = (question: string, environment: 'production' | 'demo' = 'demo') =>
    askAssistant({
      question,
      identity,
      navigation: { pathname: '/' },
      environment,
      bundle,
      provider: disabled,
      resetConversation: true,
    });

  const hello = await ask('hello');
  assert.equal(hello.modelAttempted, false);
  assert.equal(hello.origin, 'deterministic');
  assert.equal(hello.answer.intent, 'conversation.greeting');
  assert.match(hello.answer.body, /\bDex\b/);
  assert.doesNotMatch(hello.answer.body, /AdvisorTrack Assistant/);

  const addUser = await ask('Hi, how do I add a user?');
  assert.equal(addUser.answer.intent, 'PEOPLE.ADD_USER');
  assert.equal(addUser.modelAttempted, false);

  const france = await ask('What is the capital of France?');
  assert.equal(france.answer.intent, 'conversation.off_topic');
  assert.match(france.answer.body, /limited|conversational side/i);
  assert.equal(france.modelAttempted, false);

  const productionHelp = await ask('what can you help me with', 'production');
  assert.doesNotMatch(productionHelp.answer.body, /Demo Tips/);
  assert.equal(visibleConversationAreas(bundle.categories, 'demo').includes('Demo Tips'), true);

  const demoHelp = await ask('what can you help me with');
  assert.match(demoHelp.answer.body, /Demo Tips/);

  const suck = await ask('you suck');
  assert.equal(suck.answer.intent, 'conversation.frustration');
  assert.equal(suck.modelAttempted, false);
  assert.match(suck.answer.body, /listening/i);

  const swearyLicence = await askAssistant({
    question: 'This is fucking useless, how do I assign a licence?',
    identity,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
    resetConversation: true,
  });
  assert.equal(swearyLicence.answer.intent, 'LIC.ASSIGN');
  assert.equal(swearyLicence.modelAttempted, false);

  const listening = await ask("you're not listening");
  assert.equal(listening.answer.intent, 'conversation.misunderstanding');

  for (const question of [
    'Hi dex buddy',
    'How are you?',
    "What's up?",
    'Thanks buddy',
    'Haha',
    'Can you help me?',
  ]) {
    const result = await ask(question);
    assert.equal(result.modelAttempted, false, question);
    assert.match(result.answer.intent, /^conversation\./, question);
    assert.doesNotMatch(
      `${result.answer.headline} ${result.answer.body}`,
      /financial adviser|couldn't confidently match/i,
      question,
    );
  }

  console.log('Demo Assistant conversation checks passed (Dex 2.0 snapshot, no production proxy)');
}

void main();
