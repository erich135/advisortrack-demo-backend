/**
 * AdvisorTrack Assistant A7.3 grounded model composition — demo backend snapshot.
 * Consumes Abel-generated knowledge-bundle.json. Never calls production.
 * Run: npm run assistant:compose-check
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  askAssistant,
  createDisabledProvider,
  createFakeProvider,
  createFixtureLiveSource,
  loadServerBundle,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
  routeLiveQuestion,
  type TrustedAssistantIdentity,
} from '../src/assistant';
import { asModelResult } from '../src/assistant/model/provider';
import type { AssistantModelDecision } from '../src/assistant/model/types';
import type { FixturePerson, FixtureRegion, FixtureTeam } from '../src/assistant/live/source';
import type { PipelineAggregate } from '../src/assistant/live/types';

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
    rank: 'financial_advisor',
    ...partial,
  };
}

const jordan = person({
  id: 'jordan-hale',
  firstName: 'Jordan',
  lastName: 'Hale',
  reportingRoleLabel: 'Regional Manager',
  rank: 'regional_manager',
  teamId: null,
  teamName: null,
  regionId: 'coastal',
  regionName: 'Coastal Region',
  visibleTo: [EXEC, RM],
});
const keegan = person({
  id: 'keegan-pillay',
  firstName: 'Keegan',
  lastName: 'Pillay',
  reportingRoleLabel: 'Financial Advisor',
  teamId: 'team-alpha',
  teamName: 'Team Alpha',
  regionId: 'coastal',
  regionName: 'Coastal Region',
  visibleTo: [EXEC, RM],
});
const sam = person({
  id: 'sam-okonkwo',
  firstName: 'Sam',
  lastName: 'Okonkwo',
  reportingRoleLabel: 'Financial Advisor',
  teamId: 'team-ridge',
  teamName: 'Ridge Team',
  regionId: 'highveld',
  regionName: 'Highveld Region',
  visibleTo: [EXEC],
});

const teamAlpha: FixtureTeam = {
  id: 'team-alpha',
  companyId: 'company-northstar',
  name: 'Team Alpha',
  regionName: 'Coastal Region',
  leaderName: 'Priya Naidoo',
  memberIds: ['keegan-pillay'],
  advisorCount: 1,
  visibleTo: [EXEC, RM],
};
const coastal: FixtureRegion = {
  id: 'coastal',
  companyId: 'company-northstar',
  name: 'Coastal Region',
  managerName: 'Jordan Hale',
  memberIds: ['jordan-hale', 'keegan-pillay'],
  teamCount: 1,
  advisorCount: 2,
  visibleTo: [EXEC, RM],
};

const jordanMonth = {
  issuedAmount: 2_450_000,
  issuedCount: 37,
  nonIssuedAmount: 920_000,
  nonIssuedCount: 18,
};
const zeros = { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 };
const keeganPipeline: PipelineAggregate = {
  totalCases: 8,
  openCases: 6,
  stageCounts: { 'Fact-finding': 3, Review: 2, Submitted: 1 },
  pipelineValue: 180_000,
  estimatedCommissionCaseCount: 4,
};

const source = createFixtureLiveSource({
  people: [jordan, keegan, sam],
  pools: { 'company-northstar': { purchased: 20, assigned: 8, available: 12 } },
  teams: [teamAlpha],
  regions: [coastal],
  production: {
    'jordan-hale': {
      this_week: jordanMonth,
      this_month: jordanMonth,
      last_week: zeros,
      last_month: zeros,
      year_to_date: jordanMonth,
    },
    'keegan-pillay': {
      this_week: zeros,
      this_month: { issuedAmount: 80_000, issuedCount: 2, nonIssuedAmount: 10_000, nonIssuedCount: 1 },
      last_week: zeros,
      last_month: zeros,
      year_to_date: zeros,
    },
  },
  pipeline: {
    'keegan-pillay': keeganPipeline,
    'jordan-hale': {
      totalCases: 2,
      openCases: 1,
      stageCounts: { Review: 2 },
      pipelineValue: 20_000,
      estimatedCommissionCaseCount: 1,
    },
  },
});

const bundle = loadServerBundle();
const exec = identity({ userId: EXEC, isOrganisationAdmin: true });
const rm = identity({
  userId: RM,
  reportingRank: 'regional_manager',
  hierarchyScopeKind: 'region',
});

type PromptPayload = {
  tools?: Array<{ tool: string; facts?: Record<string, unknown> }>;
  derivations?: Array<{ derivationId: string }>;
  candidates?: Array<{ id: string }>;
  question?: string;
};

function parsePrompt(user: string): PromptPayload {
  const raw = JSON.parse(user) as PromptPayload & {
    trustedInstructions?: { candidates?: Array<{ id: string }> };
    untrustedLiveData?: {
      question?: string;
      tools?: Array<{ tool: string; facts?: Record<string, unknown> }>;
      derivations?: Array<{ derivationId: string }>;
    };
  };
  return {
    candidates: raw.trustedInstructions?.candidates ?? raw.candidates ?? [],
    tools: raw.untrustedLiveData?.tools ?? raw.tools ?? [],
    derivations: raw.untrustedLiveData?.derivations ?? raw.derivations ?? [],
    question: raw.untrustedLiveData?.question ?? raw.question,
  };
}

async function main(): Promise<void> {
  assert.equal(routeLiveQuestion('How is Jordan doing this month?').kind, 'advisor');
  assert.equal(routeLiveQuestion("What is Jordan's production?").kind, 'production');
  assert.equal(routeLiveQuestion("Why can't Jordan see Production?").kind, 'access');

  let jordanPrompt = '';
  let jordanCalled = 0;
  const jordanProvider = createFakeProvider(async (input) => {
    jordanCalled += 1;
    jordanPrompt = input.user;
    const payload = parsePrompt(input.user);
    const tools = (payload.tools ?? []).map((tool) => tool.tool);
    const decision: AssistantModelDecision = {
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: tools.filter((id) => ['PERSON_SUMMARY', 'PRODUCTION_SUMMARY', 'PIPELINE_SUMMARY'].includes(id)),
      intent: 'composed.ADVISOR_MONTH',
      headline: 'Jordan Hale — Regional Manager, Coastal Region',
      body: 'This Month So Far\n- Issued production: R 2 450 000 across 37 issued cases\n- Not yet issued: R 920 000 across 18 cases',
    };
    return asModelResult(decision);
  });

  const jordanDoing = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: jordanProvider,
    liveSource: source,
  });
  assert.equal(jordanDoing.origin, 'model');
  assert.equal(jordanDoing.modelAttempted, true);
  assert.equal(jordanDoing.provenance?.modelCalled, true);
  assert.match(jordanDoing.answer.body, /2[\s\u00a0]?450[\s\u00a0]?000/);
  assert.match(jordanDoing.answer.body, /37/);
  assert.doesNotMatch(jordanPrompt, /lastMobileActivity/);
  assert.doesNotMatch(jordanPrompt, /invitationStatus/);
  assert.equal(jordanDoing.answer.facts?.some((fact) => fact.label === 'Last mobile activity'), true);
  assert.doesNotMatch(jordanDoing.answer.body, /lazy|underperforming|excellent/i);
  const jordanPayload = parsePrompt(jordanPrompt);
  const jordanTools = (jordanPayload.tools ?? []).map((tool) => tool.tool);
  assert.equal(jordanTools.includes('PERSON_SUMMARY'), true);
  assert.equal(jordanTools.includes('PRODUCTION_SUMMARY'), true);
  assert.equal(jordanTools.includes('PIPELINE_SUMMARY'), true);
  assert.doesNotMatch(jordanPrompt, /contactName|caseId|SELECT |FROM cases/i);
  assert.doesNotMatch(jordanPrompt, /@northstar\.test/);
  assert.doesNotMatch(jordanPrompt, /0820000000/);
  assert.doesNotMatch(jordanPrompt, /sam-okonkwo|Sam Okonkwo/);
  const productionTool = jordanPayload.tools?.find((tool) => tool.tool === 'PRODUCTION_SUMMARY');
  assert.equal(productionTool?.facts?.issuedAmount, 2_450_000);
  assert.equal(productionTool?.facts?.issuedCount, 37);
  assert.equal(Object.prototype.hasOwnProperty.call(productionTool?.facts ?? {}, 'cases'), false);

  const simpleName = await askAssistant({
    question: 'Jordan Hale',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: jordanProvider,
    liveSource: source,
  });
  assert.equal(simpleName.origin, 'deterministic');
  assert.equal(simpleName.modelAttempted, false);
  assert.equal(simpleName.answer.intent, 'live.PERSON_SUMMARY');
  assert.equal(jordanCalled, 1);

  const productionOnly = await askAssistant({
    question: "What is Jordan's production?",
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: jordanProvider,
    liveSource: source,
  });
  assert.equal(productionOnly.modelAttempted, false);
  assert.equal(productionOnly.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.equal(jordanCalled, 1);

  let hybridPrompt = '';
  const hybridProvider = createFakeProvider(async (input) => {
    hybridPrompt = input.user;
    const payload = parsePrompt(input.user);
    const selectedCardIds = (payload.candidates ?? [])
      .map((card) => card.id)
      .filter((id) => ['PEOPLE.REPORTING_ROLE_DIFFERENCES', 'START.WHO_USES_MOBILE', 'REPORT.PRODUCTION', 'BLOCK.ADVISOR_USES_MOBILE'].includes(id))
      .slice(0, 5);
    const decision: AssistantModelDecision = {
      outcome: 'answer',
      selectedCardIds,
      selectedToolIds: ['PERSON_SUMMARY'],
      selectedDerivationIds: ['SUBJECT_LEADERSHIP_ACCESS'],
      intent: 'composed.ACCESS',
      headline: 'Keegan Pillay — Financial Advisor',
      body: "Keegan's stored reporting role is Financial Advisor. Production is a leadership portal page. Financial Advisors do advisor work in the Android app, not leadership reporting pages.",
    };
    return asModelResult(decision);
  });
  const hybrid = await askAssistant({
    question: "Why can't Keegan see Production?",
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: hybridProvider,
    liveSource: source,
  });
  assert.equal(hybrid.origin, 'model');
  assert.match(hybrid.answer.body, /Financial Advisor/);
  assert.match(hybridPrompt, /PERSON_SUMMARY/);
  assert.match(hybridPrompt, /SUBJECT_LEADERSHIP_ACCESS/);
  assert.match(hybridPrompt, /PEOPLE\.REPORTING_ROLE_DIFFERENCES|START\.WHO_USES_MOBILE|REPORT\.PRODUCTION/);
  assert.doesNotMatch(hybrid.answer.body, /because he is lazy|job title alone/i);

  let licencePrompt = '';
  const licenceProvider = createFakeProvider(async (input) => {
    licencePrompt = input.user;
    const payload = parsePrompt(input.user);
    const preferred = ['LIC.POOL_MEANING', 'LIC.REQUEST_MORE', 'PEOPLE.BULK_IMPORT_UPLOAD', 'LIC.ASSIGN', 'START.WHO_USES_MOBILE'];
    const selectedCardIds = [
      ...preferred.filter((id) => (payload.candidates ?? []).some((card) => card.id === id)),
      ...(payload.candidates ?? []).map((card) => card.id),
    ].filter((id, index, list) => list.indexOf(id) === index).slice(0, 5);
    const decision: AssistantModelDecision = {
      outcome: 'answer',
      selectedCardIds,
      selectedToolIds: ['LICENCE_SUMMARY'],
      selectedDerivationIds: ['LICENCE_SHORTFALL'],
      intent: 'composed.LICENCE_PLAN',
      headline: 'Request licences, then import',
      body: 'You currently have 12 licences available, so another 28 would be needed for 40 new licensed users. Request additional licences, prepare Bulk Import, assign licences, then advisors activate on Android.',
    };
    return asModelResult(decision);
  });
  const licencePlan = await askAssistant({
    question: 'We hired 40 advisors and only have 12 licences available. What should I do?',
    identity: exec,
    navigation: { pathname: '/licences' },
    environment: 'production',
    bundle,
    licencePool: { purchased: 20, assigned: 8, available: 12 },
    provider: licenceProvider,
    liveSource: source,
  });
  assert.equal(licencePlan.origin, 'model');
  assert.match(licencePlan.answer.body, /28/);
  assert.match(licencePrompt, /LICENCE_SUMMARY/);
  assert.match(licencePrompt, /LICENCE_SHORTFALL/);
  assert.match(licencePrompt, /PEOPLE\.BULK_IMPORT_UPLOAD|LIC\.REQUEST_MORE/);

  const forgedTotal = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: ['PRODUCTION_SUMMARY'],
      headline: 'Totals',
      body: 'Issued production is R 2 450 000 so the unsupported total is 3370000.',
    }),
    liveSource: source,
  });
  assert.equal(forgedTotal.origin, 'fallback');
  assert.doesNotMatch(forgedTotal.answer.body, /3370000/);

  const forgedTool = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: ['SECRET_LEDGER'],
      headline: 'Secret',
      body: 'Issued production is 2450000.',
    }),
    liveSource: source,
  });
  assert.equal(forgedTool.origin, 'fallback');
  assert.doesNotMatch(forgedTool.answer.body, /SECRET_LEDGER/);

  const forgedCard = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: ['STAFF.ENTERPRISE_CUSTOMERS'],
      selectedToolIds: ['PERSON_SUMMARY'],
      headline: 'Internal',
      body: 'Open Enterprise Customers.',
    }),
    liveSource: source,
  });
  assert.equal(forgedCard.origin, 'fallback');
  assert.equal(forgedCard.answer.sources.some((sourceItem) => sourceItem.cardId === 'STAFF.ENTERPRISE_CUSTOMERS'), false);

  const telemetry = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: ['PERSON_SUMMARY', 'PRODUCTION_SUMMARY'],
      headline: 'Jordan Hale',
      body: 'Last mobile activity means poor performance and low effort.',
    }),
    liveSource: source,
  });
  assert.equal(telemetry.origin, 'fallback');
  assert.doesNotMatch(telemetry.answer.body, /poor performance/);

  const pii = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: ['PRODUCTION_SUMMARY'],
      headline: 'Client leak',
      body: 'Issued production is 2450000 for contactName Jane Client caseId 99.',
    }),
    liveSource: source,
  });
  assert.equal(pii.origin, 'fallback');
  assert.doesNotMatch(pii.answer.body, /Jane Client/);

  const writeAction = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: ['PRODUCTION_SUMMARY'],
      headline: 'Write',
      body: 'Issued production is 2450000. Now void the invoice and hard-delete the case.',
    }),
    liveSource: source,
  });
  assert.equal(writeAction.origin, 'fallback');
  assert.doesNotMatch(writeAction.answer.body, /void the invoice/i);
  assert.doesNotMatch(writeAction.answer.body, /hard-delete/i);

  let scopeCalled = 0;
  const scopeProvider = createFakeProvider(async () => {
    scopeCalled += 1;
    throw new Error('out-of-scope entities must not reach the model');
  });
  const outOfScope = await askAssistant({
    question: 'How is Sam doing this month?',
    identity: rm,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: scopeProvider,
    liveSource: source,
  });
  assert.equal(outOfScope.answer.intent, 'live.not_found_in_scope');
  assert.equal(outOfScope.modelAttempted, false);
  assert.equal(scopeCalled, 0);

  const providerDown = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: createDisabledProvider(),
    liveSource: source,
  });
  assert.equal(providerDown.origin, 'deterministic');
  assert.equal(providerDown.modelAttempted, false);
  assert.equal(providerDown.answer.intent, 'live.ADVISOR_SUMMARY');
  assert.match(providerDown.answer.body, /2[\s\u00a0]?450[\s\u00a0]?000/);

  const boom = createFakeProvider(async () => {
    throw new Error('provider down');
  });
  const boomFallback = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.equal(boomFallback.origin, 'fallback');
  assert.equal(boomFallback.answer.intent, 'live.ADVISOR_SUMMARY');
  assert.doesNotMatch(boomFallback.answer.body, /provider down/);

  const demoCompose = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: jordanProvider,
    liveSource: source,
  });
  assert.equal(demoCompose.origin, 'model');
  assert.match(`${demoCompose.answer.headline}\n${demoCompose.answer.body}`, /Jordan Hale/);

  const askSource = fs.readFileSync(path.join(process.cwd(), 'src/assistant/ask.ts'), 'utf8');
  assert.doesNotMatch(askSource, /api\.advisortrack/);
  assert.doesNotMatch(fs.readFileSync(path.join(process.cwd(), 'src/assistant/live/answer.ts'), 'utf8'), /api\.advisortrack/);

  console.log('Demo Assistant compose checks passed (A7.3 snapshot, no production calls)');
}

void main();
