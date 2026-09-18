/**
 * AdvisorTrack Assistant A7.6 caching, limits, timeouts, breaker, and cost guards.
 * Run: npm run assistant:resilience-check
 */
import assert from 'node:assert/strict';
import {
  allowAssistantAsk,
  askAssistant,
  ASSISTANT_ASK_LIMITS,
  ASSISTANT_MODEL_LIMITS,
  buildAssistantContext,
  configureLiveBreakerForTests,
  countToolProjectionFields,
  createFakeProvider,
  createFixtureLiveSource,
  createToolExecutionContext,
  liveBreakerFailure,
  liveBreakerOpen,
  liveBreakerSuccess,
  LIVE_LIMITS,
  loadServerBundle,
  minimiseLiveToolsForModel,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
  routeLiveQuestion,
  wrapLiveSource,
  type TrustedAssistantIdentity,
} from '../src/assistant';
import type { AssistantModelProvider } from '../src/assistant/model/types';
import { AssistantProviderError } from '../src/assistant/model/provider';
import type { FixturePerson } from '../src/assistant/live/source';
import type { LiveToolFactGroup } from '../src/assistant/live/types';

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

const jordan: FixturePerson = {
  id: 'jordan-hale',
  companyId: 'company-northstar',
  firstName: 'Jordan',
  lastName: 'Hale',
  reportingRoleLabel: 'Regional Manager',
  rank: 'regional_manager',
  teamName: null,
  regionName: 'Coastal Region',
  accountStatus: 'Active',
  licenceStatus: 'Licensed',
  invitationStatus: 'Accepted',
  lastMobileActivityAt: '2026-09-17T12:32:00.000Z',
  email: 'jordan.hale@northstar.test',
  phone: '0821111111',
  visibleTo: ['exec-1', 'rm-1', 'tl-1'],
};

const priya: FixturePerson = {
  ...jordan,
  id: 'priya-shah',
  firstName: 'Priya',
  lastName: 'Shah',
  reportingRoleLabel: 'Financial Advisor',
  rank: 'financial_advisor',
  teamName: 'Harbour Team',
  visibleTo: ['exec-1', 'rm-1', 'tl-1'],
};

const zeros = { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 };
const thisMonth = { issuedAmount: 1_200_000, issuedCount: 12, nonIssuedAmount: 80_000, nonIssuedCount: 2 };
const lastMonth = { issuedAmount: 1_000_000, issuedCount: 10, nonIssuedAmount: 40_000, nonIssuedCount: 1 };

const source = createFixtureLiveSource({
  people: [jordan, priya],
  pools: { 'company-northstar': { purchased: 40, assigned: 32, available: 8 } },
  production: {
    'jordan-hale': {
      this_week: thisMonth,
      this_month: thisMonth,
      last_week: lastMonth,
      last_month: lastMonth,
      year_to_date: thisMonth,
    },
    'priya-shah': {
      this_week: zeros,
      this_month: { issuedAmount: 100_000, issuedCount: 3, nonIssuedAmount: 20_000, nonIssuedCount: 1 },
      last_week: zeros,
      last_month: zeros,
      year_to_date: zeros,
    },
  },
  pipeline: {
    'jordan-hale': {
      totalCases: 4,
      openCases: 3,
      stageCounts: { Interview: 3 },
      pipelineValue: 250_000,
      estimatedCommissionCaseCount: 3,
    },
  },
});

const bundle = loadServerBundle();
const boomProvider = createFakeProvider(async () => {
  throw new Error('model should not run');
});

const exec = identity({ userId: 'exec-1' });
const otherCompany = identity({ userId: 'exec-1', companyId: 'company-other', companyName: 'Other' });
const rm = identity({
  userId: 'rm-1',
  reportingRank: 'regional_manager',
  hierarchyScopeKind: 'region',
});
const staff = identity({
  userId: 'staff-1',
  reportingRank: 'platform_admin',
  isPlatformStaff: true,
  companyId: null,
  companyName: null,
});

function contextFor(who: TrustedAssistantIdentity, environment: 'production' | 'demo' = 'production') {
  return buildAssistantContext({
    environment,
    identity: who,
    navigation: { pathname: '/', search: '' },
  });
}

async function ask(
  question: string,
  who: TrustedAssistantIdentity = exec,
    extra?: {
      environment?: 'production' | 'demo';
      liveSource?: ReturnType<typeof createFixtureLiveSource>;
      timeoutMs?: number;
      provider?: AssistantModelProvider;
    },
) {
  return askAssistant({
    question,
    identity: who,
    navigation: { pathname: '/' },
    environment: extra?.environment ?? 'production',
    bundle,
    provider: extra?.provider ?? boomProvider,
    liveSource: extra?.liveSource ?? source,
    timeoutMs: extra?.timeoutMs,
  });
}

const timings: Array<{ label: string; firstMs: number; secondMs: number }> = [];

async function timeAsk(label: string, question: string, liveSource = source): Promise<void> {
  resetAssistantLiveRuntime();
  const firstStart = Date.now();
  await ask(question, exec, { liveSource });
  const firstMs = Date.now() - firstStart;
  const secondStart = Date.now();
  await ask(question, exec, { liveSource });
  const secondMs = Date.now() - secondStart;
  timings.push({ label, firstMs, secondMs });
}

async function main(): Promise<void> {
  assert.equal(routeLiveQuestion('Show me every advisor and every case in the company').kind, 'dump');
  assert.equal(routeLiveQuestion('How many advisors do we have?').kind, 'dump');
  assert.equal(routeLiveQuestion('Compare Jordan Hale, Priya Shah, Amara Botha, Keegan Pillay, and Naledi Khumalo').kind, 'compare_entities');

  const dump = await ask('Show me every advisor in the company');
  assert.match(dump.answer.body, /in your current scope/i);
  assert.doesNotMatch(dump.answer.body, /Priya Shah[\s\S]*Jordan Hale|Jordan Hale[\s\S]*Priya Shah/);
  assert.equal(dump.modelAttempted, false);

  const staffDump = await ask('Show me every advisor in the company', staff);
  assert.equal(staffDump.answer.intent, 'live.not_found_in_scope');

  const tooMany = await ask('Compare Jordan Hale, Priya Shah, Amara Botha, Keegan Pillay, and Naledi Khumalo');
  assert.equal(tooMany.answer.mode, 'clarify');
  assert.match(tooMany.answer.body, /up to 4/i);

  resetAssistantLiveRuntime();
  let peopleCalls = 0;
  const counting = createFixtureLiveSource({
    people: [jordan, priya],
  });
  const innerPeople = counting.listPeople.bind(counting);
  counting.listPeople = async (ctx) => {
    peopleCalls += 1;
    return innerPeople(ctx);
  };
  const ctx = createToolExecutionContext({
    identity: exec,
    assistant: contextFor(exec),
    timeoutMs: 2000,
  });
  const wrapped = wrapLiveSource(counting, ctx);
  await wrapped.listPeople(ctx);
  await wrapped.listPeople(ctx);
  assert.equal(peopleCalls, 1, 'same-turn memo executes the tool once');

  resetAssistantLiveRuntime();
  peopleCalls = 0;
  const ctxA = createToolExecutionContext({ identity: exec, assistant: contextFor(exec), timeoutMs: 2000 });
  const wrapA = wrapLiveSource(counting, ctxA);
  await wrapA.listPeople(ctxA);
  const ctxB = createToolExecutionContext({ identity: exec, assistant: contextFor(exec), timeoutMs: 2000 });
  const wrapB = wrapLiveSource(counting, ctxB);
  await wrapB.listPeople(ctxB);
  assert.equal(peopleCalls, 1, 'TTL cache hit on second turn for the same authorised scope');

  resetAssistantLiveRuntime();
  peopleCalls = 0;
  const otherPeople: FixturePerson[] = [{ ...jordan, companyId: 'company-other', visibleTo: ['exec-1'] }];
  const otherSource = createFixtureLiveSource({ people: otherPeople });
  let otherCalls = 0;
  const otherList = otherSource.listPeople.bind(otherSource);
  otherSource.listPeople = async (ctx) => {
    otherCalls += 1;
    return otherList(ctx);
  };
  const northCtx = createToolExecutionContext({ identity: exec, assistant: contextFor(exec), timeoutMs: 2000 });
  await wrapLiveSource(counting, northCtx).listPeople(northCtx);
  const otherCtx = createToolExecutionContext({
    identity: otherCompany,
    assistant: contextFor(otherCompany),
    timeoutMs: 2000,
  });
  await wrapLiveSource(otherSource, otherCtx).listPeople(otherCtx);
  assert.equal(peopleCalls, 1);
  assert.equal(otherCalls, 1, 'different company misses the cache');

  resetAssistantLiveRuntime();
  peopleCalls = 0;
  let rmCalls = 0;
  const rmSource = createFixtureLiveSource({ people: [jordan, priya] });
  const rmList = rmSource.listPeople.bind(rmSource);
  rmSource.listPeople = async (ctx) => {
    rmCalls += 1;
    return rmList(ctx);
  };
  const execCtx = createToolExecutionContext({ identity: exec, assistant: contextFor(exec), timeoutMs: 2000 });
  await wrapLiveSource(counting, execCtx).listPeople(execCtx);
  const rmCtx = createToolExecutionContext({ identity: rm, assistant: contextFor(rm), timeoutMs: 2000 });
  await wrapLiveSource(rmSource, rmCtx).listPeople(rmCtx);
  assert.equal(peopleCalls, 1);
  assert.equal(rmCalls, 1, 'different caller scope misses the cache');

  resetAssistantLiveRuntime();
  peopleCalls = 0;
  let demoCalls = 0;
  const demoSource = createFixtureLiveSource({ people: [jordan, priya] });
  const demoList = demoSource.listPeople.bind(demoSource);
  demoSource.listPeople = async (ctx) => {
    demoCalls += 1;
    return demoList(ctx);
  };
  const prodCtx = createToolExecutionContext({ identity: exec, assistant: contextFor(exec, 'production'), timeoutMs: 2000 });
  await wrapLiveSource(counting, prodCtx).listPeople(prodCtx);
  const demoCtx = createToolExecutionContext({ identity: exec, assistant: contextFor(exec, 'demo'), timeoutMs: 2000 });
  await wrapLiveSource(demoSource, demoCtx).listPeople(demoCtx);
  assert.equal(peopleCalls, 1);
  assert.equal(demoCalls, 1, 'production and demo never share cache');

  resetAssistantLiveRuntime();
  const hang = createFixtureLiveSource({
    people: [jordan, priya],
    production: {
      'jordan-hale': {
        this_week: thisMonth,
        this_month: thisMonth,
        last_week: lastMonth,
        last_month: lastMonth,
        year_to_date: thisMonth,
      },
    },
    hang: ['pipeline'],
  });
  const partial = await ask('How is Jordan doing this month?', exec, { liveSource: hang, timeoutMs: 250, provider: createFakeProvider({ outcome: 'insufficient_context', selectedCardIds: [] }) });
  assert.match(partial.answer.body, /Jordan Hale/);
  assert.match(partial.answer.body, /temporarily unavailable/i);
  assert.ok((partial.provenance?.toolsUnavailable ?? []).includes('PIPELINE_SUMMARY'));
  assert.ok((partial.provenance?.toolTimeouts ?? 0) >= 1);

  resetAssistantLiveRuntime();
  configureLiveBreakerForTests({ failureThreshold: 1, cooldownMs: 60_000 });
  assert.equal(liveBreakerOpen('pipeline', 'production', 'company-northstar'), false);
  assert.equal(liveBreakerFailure('pipeline', 'production', 'company-northstar'), true);
  assert.equal(liveBreakerOpen('pipeline', 'production', 'company-northstar'), true);
  liveBreakerSuccess('pipeline', 'production', 'company-northstar');
  assert.equal(liveBreakerOpen('pipeline', 'production', 'company-northstar'), false);

  const budgetCtx = createToolExecutionContext({
    identity: exec,
    assistant: contextFor(exec),
    timeoutMs: 2000,
    maxFetches: 1,
  });
  const budgetSource = createFixtureLiveSource({
    people: [jordan, priya],
    production: {
      'jordan-hale': {
        this_week: thisMonth,
        this_month: thisMonth,
        last_week: lastMonth,
        last_month: lastMonth,
        year_to_date: thisMonth,
      },
    },
    pipeline: {
      'jordan-hale': {
        totalCases: 4,
        openCases: 3,
        stageCounts: { Interview: 3 },
        pipelineValue: 250_000,
        estimatedCommissionCaseCount: 3,
      },
    },
  });
  const budgetWrapped = wrapLiveSource(budgetSource, budgetCtx);
  await budgetWrapped.listPeople(budgetCtx);
  await assert.rejects(() => budgetWrapped.getLicencePool(budgetCtx));

  assert.ok(ASSISTANT_MODEL_LIMITS.maxPromptChars === LIVE_LIMITS.maxPromptChars);
  assert.ok(ASSISTANT_MODEL_LIMITS.maxOutputTokens > 0);
  assert.ok(ASSISTANT_MODEL_LIMITS.maxOutputTokens <= 4096);
  assert.equal(LIVE_LIMITS.maxComparisonSubjects, 4);
  assert.equal(LIVE_LIMITS.maxRankingRows, 5);
  assert.equal(LIVE_LIMITS.maxToolProjectionFields, 40);

  const oversized: LiveToolFactGroup[] = [{
    tool: 'CUSTOM_SUMMARY',
    version: 1,
    facts: Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`field${index}`, index])),
  }];
  const trimmed = minimiseLiveToolsForModel('Jordan Hale', oversized, contextFor(exec, 'demo'));
  assert.ok(countToolProjectionFields(trimmed) <= LIVE_LIMITS.maxToolProjectionFields);
  assert.equal(countToolProjectionFields(trimmed), LIVE_LIMITS.maxToolProjectionFields);

  const compare = await ask('Compare Jordan this month with last month');
  assert.equal(compare.modelAttempted, false);
  assert.equal(compare.origin, 'deterministic');

  const rank = await ask('Which Regional Manager has the highest issued production this month?');
  assert.equal(rank.modelAttempted, false);

  const attention = await ask('Who needs attention?');
  assert.equal(attention.modelAttempted, false);

  const licences = await ask('How many licences are available?');
  assert.equal(licences.modelAttempted, false);

  const person = await ask('Jordan Hale');
  assert.equal(person.modelAttempted, false);
  assert.doesNotMatch(person.answer.body, /client|policy number|id number/i);

  const staffRank = await ask('Which Regional Manager has the highest issued production this month?', staff);
  assert.equal(staffRank.answer.intent, 'live.not_found_in_scope');

  const timeoutProvider = createFakeProvider(async () => {
    throw new AssistantProviderError('Assistant model timed out', 'timeout');
  });
  const timeoutResult = await ask('How is Jordan doing this month?', exec, { provider: timeoutProvider });
  assert.notEqual(timeoutResult.origin, 'model');
  assert.doesNotMatch(timeoutResult.answer.body, /Assistant model timed out/);

  const malformedProvider = createFakeProvider(async () => {
    throw new AssistantProviderError('Model response was not valid JSON', 'malformed');
  });
  const malformed = await ask('How is Jordan doing this month?', exec, { provider: malformedProvider });
  assert.notEqual(malformed.origin, 'model');
  assert.doesNotMatch(malformed.answer.body, /valid JSON/);

  const rateProvider = createFakeProvider(async () => {
    throw new AssistantProviderError('rate limited', 'rate_limit');
  });
  const rated = await ask('How is Jordan doing this month?', exec, { provider: rateProvider });
  assert.notEqual(rated.origin, 'model');

  const disabled = await ask('How is Jordan doing this month?', exec, {
    provider: { id: 'disabled', complete: async () => { throw new AssistantProviderError('disabled', 'disabled'); } },
  });
  assert.notEqual(disabled.origin, 'model');

  resetAssistantAskThrottle();
  for (let i = 0; i < ASSISTANT_ASK_LIMITS.productionPerUser; i += 1) {
    assert.equal(allowAssistantAsk('user-1', 1_000 + i), true);
  }
  assert.equal(allowAssistantAsk('user-1', 1_000 + ASSISTANT_ASK_LIMITS.productionPerUser), false);

  resetAssistantAskThrottle();
  for (let i = 0; i < 10; i += 1) {
    assert.equal(allowAssistantAsk(`demo-user-${i}`, 2_000 + i, { environment: 'demo', ip: '203.0.113.9' }), true);
  }
  resetAssistantAskThrottle();
  for (let i = 0; i < ASSISTANT_ASK_LIMITS.demoPerIp; i += 1) {
    assert.equal(allowAssistantAsk(`demo-${i}`, 3_000 + i, { environment: 'demo', ip: '198.51.100.10' }), true);
  }
  assert.equal(allowAssistantAsk('demo-overflow', 3_000 + ASSISTANT_ASK_LIMITS.demoPerIp, { environment: 'demo', ip: '198.51.100.10' }), false);

  const delayed = createFixtureLiveSource({
    people: [jordan, priya],
    pools: { 'company-northstar': { purchased: 40, assigned: 32, available: 8 } },
    production: {
      'jordan-hale': {
        this_week: thisMonth,
        this_month: thisMonth,
        last_week: lastMonth,
        last_month: lastMonth,
        year_to_date: thisMonth,
      },
    },
    delayMs: { people: 25, production: 25, licences: 25 },
  });
  await timeAsk('greeting', 'Hello');
  await timeAsk('kb_help', 'How do I assign a licence?');
  await timeAsk('person_lookup', 'Jordan Hale', delayed);
  await timeAsk('production_lookup', "What is Jordan's production?", delayed);
  await timeAsk('comparison', 'Compare Jordan this month with last month', delayed);
  await timeAsk('ranking', 'Which Regional Manager has the highest issued production this month?', delayed);

  console.log('A7.6 timings (ms):');
  for (const row of timings) {
    console.log(`  ${row.label}: first=${row.firstMs} cache=${row.secondMs}`);
  }
  console.log('assistant resilience: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
