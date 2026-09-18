/**
 * AdvisorTrack Assistant A7.2 production, pipeline, and advisor intelligence — demo backend snapshot.
 * Run: npm run assistant:intelligence-check
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADVISOR_SUMMARY_TOOL,
  askAssistant,
  createFakeProvider,
  createFixtureLiveSource,
  loadServerBundle,
  PIPELINE_SUMMARY_TOOL,
  PRODUCTION_SUMMARY_TOOL,
  REGION_SUMMARY_TOOL,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
  resolveAssistantPeriod,
  routeLiveQuestion,
  TEAM_SUMMARY_TOOL,
  type TrustedAssistantIdentity,
} from '../src/assistant';
import type { FixturePerson, FixtureRegion, FixtureTeam } from '../src/assistant/live/source';
import type { PipelineAggregate } from '../src/assistant/live/types';

resetAssistantAskThrottle();
resetAssistantLiveRuntime();

const NOW = new Date('2026-09-18T10:00:00.000Z');

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
const OTHER_RM = 'other-rm';

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
  visibleTo: [EXEC, RM, TL],
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
  visibleTo: [EXEC, OTHER_RM],
});

const teamAlpha: FixtureTeam = {
  id: 'team-alpha',
  companyId: 'company-northstar',
  name: 'Team Alpha',
  regionName: 'Coastal Region',
  leaderName: 'Priya Naidoo',
  memberIds: ['keegan-pillay'],
  advisorCount: 1,
  visibleTo: [EXEC, RM, TL],
};
const ridgeTeam: FixtureTeam = {
  id: 'team-ridge',
  companyId: 'company-northstar',
  name: 'Ridge Team',
  regionName: 'Highveld Region',
  leaderName: 'Amara Botha',
  memberIds: ['sam-okonkwo'],
  advisorCount: 1,
  visibleTo: [EXEC, OTHER_RM],
};
const coastal: FixtureRegion = {
  id: 'coastal',
  companyId: 'company-northstar',
  name: 'Coastal Region',
  managerName: 'Jordan Hale',
  memberIds: ['jordan-hale', 'keegan-pillay'],
  teamCount: 1,
  advisorCount: 1,
  visibleTo: [EXEC, RM],
};
const highveld: FixtureRegion = {
  id: 'highveld',
  companyId: 'company-northstar',
  name: 'Highveld Region',
  managerName: 'Daniel Okoro',
  memberIds: ['sam-okonkwo'],
  teamCount: 1,
  advisorCount: 1,
  visibleTo: [EXEC, OTHER_RM],
};

const zeros = { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 };
const jordanMonth = { issuedAmount: 2_450_000, issuedCount: 37, nonIssuedAmount: 920_000, nonIssuedCount: 8 };
const keeganMonth = { issuedAmount: 124_800, issuedCount: 4, nonIssuedAmount: 40_000, nonIssuedCount: 2 };
const keeganPipeline: PipelineAggregate = {
  totalCases: 10,
  openCases: 6,
  stageCounts: { Interview: 3, Implementation: 3, Review: 4 },
  pipelineValue: 180_000,
  estimatedCommissionCaseCount: 6,
};

const source = createFixtureLiveSource({
  people: [jordan, keegan, sam],
  teams: [teamAlpha, ridgeTeam],
  regions: [coastal, highveld],
  production: {
    'jordan-hale': {
      this_week: jordanMonth,
      this_month: jordanMonth,
      last_week: { issuedAmount: 400_000, issuedCount: 6, nonIssuedAmount: 50_000, nonIssuedCount: 1 },
      last_month: { issuedAmount: 2_100_000, issuedCount: 33, nonIssuedAmount: 0, nonIssuedCount: 0 },
      year_to_date: { issuedAmount: 9_000_000, issuedCount: 140, nonIssuedAmount: 920_000, nonIssuedCount: 8 },
    },
    'keegan-pillay': {
      this_week: keeganMonth,
      this_month: keeganMonth,
      last_week: zeros,
      last_month: { issuedAmount: 90_000, issuedCount: 3, nonIssuedAmount: 10_000, nonIssuedCount: 1 },
      year_to_date: keeganMonth,
    },
    'sam-okonkwo': {
      this_week: zeros,
      this_month: { issuedAmount: 50_000, issuedCount: 1, nonIssuedAmount: 0, nonIssuedCount: 0 },
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
const boomProvider = createFakeProvider(async () => {
  throw new Error('model should not run');
});

const exec = identity({ userId: EXEC });
const rm = identity({
  userId: RM,
  reportingRank: 'regional_manager',
  hierarchyScopeKind: 'region',
});
const tl = identity({
  userId: TL,
  reportingRank: 'team_leader',
  hierarchyScopeKind: 'team',
  canViewRegions: false,
});

async function ask(question: string, who: TrustedAssistantIdentity, environment: 'production' | 'demo' = 'demo') {
  return askAssistant({
    question,
    identity: who,
    navigation: { pathname: '/' },
    environment,
    bundle,
    provider: boomProvider,
    liveSource: source,
  });
}

function assertNoClientPii(text: string): void {
  assert.doesNotMatch(text, /caseId|contactName|policy|document/i);
  assert.doesNotMatch(text, /poor performer|weak advisor|lazy|underperforming|excellent/i);
}

async function main(): Promise<void> {
  const sourceFile = fs.readFileSync(
    path.join(process.cwd(), 'src/assistant/live/organisationSource.ts'),
    'utf8',
  );
  assert.doesNotMatch(sourceFile, /api\.advisortrack/);
  assert.match(sourceFile, /advisortrack_demo|Demo adapter/);

  const thisMonth = resolveAssistantPeriod('this_month', NOW);
  const lastMonth = resolveAssistantPeriod('last_month', NOW);
  const lastWeek = resolveAssistantPeriod('last_week', NOW);
  const thisWeek = resolveAssistantPeriod('this_week', NOW);
  const ytd = resolveAssistantPeriod('year_to_date', NOW);
  assert.equal(thisMonth.startDate, '2026-09-01');
  assert.equal(thisMonth.endDate, '2026-09-18');
  assert.equal(thisMonth.label, 'This Month So Far');
  assert.equal(thisWeek.startDate, '2026-09-14');
  assert.equal(thisWeek.endDate, '2026-09-18');
  assert.equal(lastWeek.startDate, '2026-09-07');
  assert.equal(lastWeek.endDate, '2026-09-13');
  assert.equal(lastMonth.startDate, '2026-08-01');
  assert.equal(lastMonth.endDate, '2026-08-31');
  assert.equal(ytd.startDate, '2026-01-01');
  assert.equal(ytd.endDate, '2026-09-18');

  assert.equal(routeLiveQuestion('How do I add an advisor?').kind, 'none');
  assert.equal(routeLiveQuestion('How do I use Production?').kind, 'none');
  assert.equal(routeLiveQuestion('What does pipeline mean?').kind, 'none');
  assert.equal(routeLiveQuestion('Jordan Hale').kind, 'person');
  assert.equal(routeLiveQuestion('How is Jordan doing this month?').kind, 'advisor');
  assert.equal(routeLiveQuestion("What is Jordan's production?").kind, 'production');
  assert.equal(routeLiveQuestion('How many cases does Jordan have?').kind, 'pipeline');
  assert.equal(routeLiveQuestion('Coastal Region').kind, 'region');
  assert.equal(routeLiveQuestion('How is Coastal Region doing this month?').kind, 'region');
  assert.equal(routeLiveQuestion('How is Team Alpha doing?').kind, 'team');

  const helpAdd = await ask('How do I add an advisor?', exec);
  assert.equal(helpAdd.answer.intent.startsWith('live.'), false);

  const helpProd = await ask('How do I use Production?', exec);
  assert.notEqual(helpProd.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.equal(helpProd.answer.intent.startsWith('live.'), false);

  const helpPipe = await ask('What does pipeline mean?', exec);
  assert.notEqual(helpPipe.answer.intent, 'live.PIPELINE_SUMMARY');
  assert.equal(helpPipe.answer.intent.startsWith('live.'), false);

  const execJordan = await ask('How is Jordan doing this month?', exec);
  assert.equal(execJordan.modelAttempted, true);
  assert.equal(execJordan.origin, 'fallback');
  assert.equal(execJordan.provenance?.modelCalled, false);
  assert.equal(execJordan.answer.intent, 'live.ADVISOR_SUMMARY');
  assert.match(execJordan.answer.body, /Jordan Hale/);
  assert.match(execJordan.answer.body, /This Month So Far/);
  assert.match(execJordan.answer.body, /2[\s\u00a0]?450[\s\u00a0]?000/);
  assert.match(execJordan.answer.body, /Issued cases: 37/);
  assert.match(execJordan.answer.body, /Last mobile activity:/);
  assert.doesNotMatch(execJordan.answer.body, /productivity|attendance|working hard/i);
  assertNoClientPii(execJordan.answer.body);
  assert.equal(execJordan.answer.body.includes(JSON.stringify(keeganPipeline)), false);

  const rmAdvisor = await ask('How is Keegan doing this month?', rm);
  assert.equal(rmAdvisor.answer.intent, 'live.ADVISOR_SUMMARY');
  assert.match(rmAdvisor.answer.body, /Keegan Pillay/);

  const tlAdvisor = await ask('How is Keegan doing this month?', tl);
  assert.equal(tlAdvisor.answer.intent, 'live.ADVISOR_SUMMARY');

  const rmOut = await ask('How is Sam doing this month?', rm);
  const rmMissing = await ask('How is Zelda Nobody doing this month?', rm);
  assert.equal(rmOut.modelAttempted, false);
  assert.equal(rmOut.answer.intent, 'live.not_found_in_scope');
  assert.equal(rmMissing.answer.intent, 'live.not_found_in_scope');
  assert.equal(rmOut.answer.body, rmMissing.answer.body);

  const jordanProd = await ask("What is Jordan's production?", exec);
  assert.equal(jordanProd.modelAttempted, false);
  assert.equal(jordanProd.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.match(jordanProd.answer.body, /This Month So Far/);
  assert.match(jordanProd.answer.body, /Not yet issued/);
  assertNoClientPii(jordanProd.answer.body);

  const lastMonthProd = await ask("What is Jordan's production last month?", exec);
  assert.equal(lastMonthProd.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.match(lastMonthProd.answer.body, /Last Month/);
  assert.match(lastMonthProd.answer.body, /2[\s\u00a0]?100[\s\u00a0]?000/);

  const lastWeekProd = await ask("What is Jordan's production last week?", exec);
  assert.match(lastWeekProd.answer.body, /Last Week/);

  const ytdProd = await ask("What is Jordan's production year to date?", exec);
  assert.match(ytdProd.answer.body, /Year to Date/);
  assert.match(ytdProd.answer.body, /9[\s\u00a0]?000[\s\u00a0]?000/);

  const cases = await ask('How many cases does Keegan have?', exec);
  assert.equal(cases.answer.intent, 'live.PIPELINE_SUMMARY');
  assert.match(cases.answer.body, /Open pipeline cases: 6/);
  assert.match(cases.answer.body, /Fact-finding: 3/);
  assert.doesNotMatch(cases.answer.body, /contactName|caseId/);
  assert.equal(Object.prototype.hasOwnProperty.call(cases.answer, 'cases'), false);
  assertNoClientPii(cases.answer.body);

  const team = await ask('How is Team Alpha doing?', exec);
  assert.equal(team.answer.intent, 'live.TEAM_SUMMARY');
  assert.match(team.answer.body, /Team Alpha/);
  assert.match(team.answer.body, /Priya Naidoo/);
  assert.match(team.answer.body, /Advisors: 1/);

  const rmTeam = await ask('How is Team Alpha doing?', rm);
  assert.equal(rmTeam.answer.intent, 'live.TEAM_SUMMARY');
  const rmDeniedTeam = await ask('How is Ridge Team doing?', rm);
  assert.equal(rmDeniedTeam.answer.intent, 'live.not_found_in_scope');

  const tlTeam = await ask('How is Team Alpha doing?', tl);
  assert.equal(tlTeam.answer.intent, 'live.TEAM_SUMMARY');

  const region = await ask('Coastal Region', exec);
  assert.equal(region.answer.intent, 'live.REGION_SUMMARY');
  assert.match(region.answer.body, /Coastal Region/);
  assert.match(region.answer.body, /Jordan Hale/);

  const regionMonth = await ask('How is Coastal Region doing this month?', exec);
  assert.equal(regionMonth.answer.intent, 'live.REGION_SUMMARY');
  assert.match(regionMonth.answer.body, /This Month So Far/);
  assertNoClientPii(regionMonth.answer.body);

  const rmRegion = await ask('How is Coastal Region doing this month?', rm);
  assert.equal(rmRegion.answer.intent, 'live.REGION_SUMMARY');
  const rmOtherRegion = await ask('How is Highveld Region doing this month?', rm);
  assert.equal(rmOtherRegion.answer.intent, 'live.not_found_in_scope');

  const tlRegion = await ask('How is Coastal Region doing this month?', tl);
  assert.notEqual(tlRegion.answer.intent, 'live.REGION_SUMMARY');

  const staff = identity({
    userId: EXEC,
    reportingRank: 'platform_admin',
    isPlatformStaff: true,
  });
  const staffAdvisor = await ask('How is Jordan doing this month?', staff);
  assert.notEqual(staffAdvisor.answer.intent, 'live.ADVISOR_SUMMARY');
  assert.notEqual(staffAdvisor.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.doesNotMatch(staffAdvisor.answer.body, /@northstar\.test/);
  assert.doesNotMatch(staffAdvisor.answer.body, /Last mobile activity:/);

  const demoAdvisor = await ask('How is Jordan doing this month?', exec, 'demo');
  assert.equal(demoAdvisor.answer.intent, 'live.ADVISOR_SUMMARY');
  assert.equal(demoAdvisor.origin, 'fallback');
  assert.equal(demoAdvisor.modelAttempted, true);
  assert.match(demoAdvisor.answer.body, /This Month So Far/);

  assert.equal(routeLiveQuestion("Why can't Jordan see Production?").kind, 'access');
  assert.equal(routeLiveQuestion("Why can't I see Production?").kind, 'none');

  assert.equal(ADVISOR_SUMMARY_TOOL.domain, 'reporting');
  assert.equal(PRODUCTION_SUMMARY_TOOL.scopeResolver, 'management_reporting');
  assert.equal(PIPELINE_SUMMARY_TOOL.limits.maxRows, 12);
  assert.equal(TEAM_SUMMARY_TOOL.acceptsEntityKinds.includes('team'), true);
  assert.equal(REGION_SUMMARY_TOOL.acceptsEntityKinds.includes('region'), true);

  const hello = await ask('hello', exec);
  assert.equal(hello.answer.intent, 'conversation.greeting');

  console.log('Demo Assistant intelligence checks passed (A7.2/A7.3 snapshot, no production calls, synthetic data, scope simulated)');
}

void main();
