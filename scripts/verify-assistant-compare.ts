/**
 * AdvisorTrack Assistant A7.5 comparisons and product-defined rankings.
 * Run: npm run assistant:compare-check
 */
import assert from 'node:assert/strict';
import {
  askAssistant,
  ATTENTION_SUMMARY_TOOL,
  COMPARISON_SUMMARY_TOOL,
  createFakeProvider,
  createFixtureLiveSource,
  loadServerBundle,
  RANKING_SUMMARY_TOOL,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
  routeLiveQuestion,
  type TrustedAssistantIdentity,
} from '../src/assistant';
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
const TL = 'tl-1';
const OTHER_RM = 'other-rm';

function person(
  partial: Omit<FixturePerson, 'visibleTo' | 'companyId'> & { visibleTo: string[]; companyId?: string },
): FixturePerson {
  return {
    companyId: 'company-northstar',
    licenceStatus: 'Licensed',
    invitationStatus: 'Accepted',
    lastMobileActivityAt: null,
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
  teamName: null,
  regionId: 'coastal',
  regionName: 'Coastal Region',
  lastMobileActivityAt: '2026-01-01T08:00:00.000Z',
  visibleTo: [EXEC, RM],
});
const daniel = person({
  id: 'daniel-okoro',
  firstName: 'Daniel',
  lastName: 'Okoro',
  reportingRoleLabel: 'Regional Manager',
  rank: 'regional_manager',
  teamName: null,
  regionId: 'highveld',
  regionName: 'Highveld Region',
  visibleTo: [EXEC, OTHER_RM],
});
const priya = person({
  id: 'priya-shah',
  firstName: 'Priya',
  lastName: 'Shah',
  reportingRoleLabel: 'Team Leader',
  rank: 'team_leader',
  reportsToUserId: 'jordan-hale',
  teamId: 'harbour',
  teamName: 'Harbour Team',
  regionId: 'coastal',
  regionName: 'Coastal Region',
  visibleTo: [EXEC, RM],
});
const amara = person({
  id: 'amara-botha',
  firstName: 'Amara',
  lastName: 'Botha',
  reportingRoleLabel: 'Team Leader',
  rank: 'team_leader',
  reportsToUserId: 'daniel-okoro',
  teamId: 'ridge',
  teamName: 'Ridge Team',
  regionId: 'highveld',
  regionName: 'Highveld Region',
  visibleTo: [EXEC, OTHER_RM],
});
const keegan = person({
  id: 'keegan-pillay',
  firstName: 'Keegan',
  lastName: 'Pillay',
  reportingRoleLabel: 'Financial Advisor',
  reportsToUserId: 'priya-shah',
  teamId: 'harbour',
  teamName: 'Harbour Team',
  regionId: 'coastal',
  regionName: 'Coastal Region',
  visibleTo: [EXEC, RM, TL],
});
const naledi = person({
  id: 'naledi-khumalo',
  firstName: 'Naledi',
  lastName: 'Khumalo',
  reportingRoleLabel: 'Financial Advisor',
  reportsToUserId: 'priya-shah',
  teamId: 'harbour',
  teamName: 'Harbour Team',
  regionId: 'coastal',
  regionName: 'Coastal Region',
  visibleTo: [EXEC, RM, TL],
});
const sam = person({
  id: 'sam-okonkwo',
  firstName: 'Sam',
  lastName: 'Okonkwo',
  reportingRoleLabel: 'Financial Advisor',
  reportsToUserId: 'amara-botha',
  teamId: 'ridge',
  teamName: 'Ridge Team',
  regionId: 'highveld',
  regionName: 'Highveld Region',
  visibleTo: [EXEC, OTHER_RM],
});

const harbour: FixtureTeam = {
  id: 'harbour',
  companyId: 'company-northstar',
  name: 'Harbour Team',
  regionName: 'Coastal Region',
  leaderName: 'Priya Shah',
  memberIds: ['priya-shah', 'keegan-pillay', 'naledi-khumalo'],
  advisorCount: 2,
  visibleTo: [EXEC, RM, TL],
};
const ridge: FixtureTeam = {
  id: 'ridge',
  companyId: 'company-northstar',
  name: 'Ridge Team',
  regionName: 'Highveld Region',
  leaderName: 'Amara Botha',
  memberIds: ['amara-botha', 'sam-okonkwo'],
  advisorCount: 1,
  visibleTo: [EXEC, OTHER_RM],
};
const coastal: FixtureRegion = {
  id: 'coastal',
  companyId: 'company-northstar',
  name: 'Coastal Region',
  managerName: 'Jordan Hale',
  memberIds: ['jordan-hale', 'priya-shah', 'keegan-pillay', 'naledi-khumalo'],
  teamCount: 1,
  advisorCount: 2,
  visibleTo: [EXEC, RM],
};
const highveld: FixtureRegion = {
  id: 'highveld',
  companyId: 'company-northstar',
  name: 'Highveld Region',
  managerName: 'Daniel Okoro',
  memberIds: ['daniel-okoro', 'amara-botha', 'sam-okonkwo'],
  teamCount: 1,
  advisorCount: 1,
  visibleTo: [EXEC, OTHER_RM],
};

const zeros = { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 };
const period = (
  thisMonth: { issuedAmount: number; issuedCount: number; nonIssuedAmount: number; nonIssuedCount: number },
  lastMonth = thisMonth,
) => ({
  this_week: thisMonth,
  this_month: thisMonth,
  last_week: zeros,
  last_month: lastMonth,
  year_to_date: thisMonth,
});

const harbourPipeline: PipelineAggregate = {
  totalCases: 8,
  openCases: 5,
  stageCounts: { Interview: 5 },
  pipelineValue: 400_000,
  estimatedCommissionCaseCount: 5,
};
const ridgePipeline: PipelineAggregate = {
  totalCases: 3,
  openCases: 2,
  stageCounts: { Review: 2 },
  pipelineValue: 50_000,
  estimatedCommissionCaseCount: 2,
};

const source = createFixtureLiveSource({
  people: [jordan, daniel, priya, amara, keegan, naledi, sam],
  teams: [harbour, ridge],
  regions: [coastal, highveld],
  production: {
    'jordan-hale': period(
      { issuedAmount: 1_200_000, issuedCount: 12, nonIssuedAmount: 80_000, nonIssuedCount: 2 },
      { issuedAmount: 1_000_000, issuedCount: 10, nonIssuedAmount: 40_000, nonIssuedCount: 1 },
    ),
    'daniel-okoro': period({ issuedAmount: 400_000, issuedCount: 4, nonIssuedAmount: 10_000, nonIssuedCount: 1 }),
    'priya-shah': period({ issuedAmount: 100_000, issuedCount: 3, nonIssuedAmount: 20_000, nonIssuedCount: 1 }),
    'amara-botha': period({ issuedAmount: 50_000, issuedCount: 1, nonIssuedAmount: 5_000, nonIssuedCount: 1 }),
    'keegan-pillay': period(
      { issuedAmount: 80_000, issuedCount: 2, nonIssuedAmount: 30_000, nonIssuedCount: 1 },
      zeros,
    ),
    'naledi-khumalo': period({ issuedAmount: 20_000, issuedCount: 1, nonIssuedAmount: 90_000, nonIssuedCount: 3 }),
    'sam-okonkwo': period({ issuedAmount: 30_000, issuedCount: 1, nonIssuedAmount: 8_000, nonIssuedCount: 1 }),
  },
  pipeline: {
    'priya-shah': harbourPipeline,
    'keegan-pillay': harbourPipeline,
    'sam-okonkwo': ridgePipeline,
  },
  attention: {
    'jordan-hale': { stalledCount: 2, missingDocumentsCount: 0, noNextActionCount: 0 },
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
const staff = identity({
  userId: EXEC,
  reportingRank: 'platform_admin',
  isPlatformStaff: true,
});

async function ask(question: string, who: TrustedAssistantIdentity, environment: 'production' | 'demo' = 'production') {
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

function assertNeutral(text: string): void {
  assert.doesNotMatch(text, /better|worse|weak|poor|excellent|bad performer|lazy|struggling|underperforming/i);
}

function assertNoClientPii(text: string): void {
  assert.doesNotMatch(text, /@northstar\.test/);
  assert.doesNotMatch(text, /0820000000/);
  assert.doesNotMatch(text, /caseId|contactName|policyNumber/i);
}

async function main(): Promise<void> {
  assert.equal(routeLiveQuestion('How is Jordan doing compared with last month?').kind, 'compare_period');
  assert.equal(routeLiveQuestion('Compare Jordan this month with last month').kind, 'compare_period');
  assert.equal(routeLiveQuestion('Is Jordan up or down from last month?').kind, 'compare_period');
  assert.equal(routeLiveQuestion('Compare Jordan Hale and Priya Shah').kind, 'compare_entities');
  assert.equal(routeLiveQuestion('Which Regional Manager has the highest issued production this month?').kind, 'rank');
  assert.equal(routeLiveQuestion('Who needs attention?').kind, 'attention');
  assert.equal(routeLiveQuestion('Why does Jordan need attention?').kind, 'attention');
  assert.equal(routeLiveQuestion('How is Jordan doing this month?').kind, 'advisor');

  const periodCompare = await ask('Compare Jordan this month with last month', exec);
  assert.equal(periodCompare.modelAttempted, false);
  assert.equal(periodCompare.provenance?.modelCalled, false);
  assert.equal(periodCompare.answer.intent, 'live.COMPARISON_SUMMARY');
  assert.match(periodCompare.answer.body, /This Month So Far/);
  assert.match(periodCompare.answer.body, /Last Month/);
  assert.match(periodCompare.answer.body, /1[\s\u00a0,]?200[\s\u00a0,]?000/);
  assert.match(periodCompare.answer.body, /1[\s\u00a0,]?000[\s\u00a0,]?000/);
  assert.match(periodCompare.answer.body, /200[\s\u00a0,]?000/);
  assert.match(periodCompare.answer.body, /\+20%/);
  assert.match(periodCompare.answer.body, /still in progress/);
  assertNeutral(periodCompare.answer.body);
  assert.equal(periodCompare.provenance?.items.some((item) => item.kind === 'derivation' && item.derivationId === 'ABSOLUTE_CHANGE'), true);
  assert.equal(periodCompare.provenance?.items.some((item) => item.kind === 'derivation' && item.derivationId === 'PERCENT_CHANGE'), true);
  assert.equal(periodCompare.provenance?.toolsUsed.includes('PRODUCTION_SUMMARY'), true);
  assert.doesNotMatch(periodCompare.answer.body, /jordan-hale|ent_/);

  const upDown = await ask('Is Jordan up or down from last month?', exec);
  assert.equal(upDown.modelAttempted, false);
  assert.equal(upDown.answer.intent, 'live.COMPARISON_SUMMARY');
  assert.match(upDown.answer.body, /higher/);

  const zero = await ask('Compare Keegan this month with last month', exec);
  assert.equal(zero.answer.intent, 'live.COMPARISON_SUMMARY');
  assert.match(zero.answer.body, /No percentage change is shown because the earlier period was zero/);
  assert.doesNotMatch(zero.answer.body, /Infinity|NaN/);

  const peopleCompare = await ask('Compare Jordan Hale and Priya Shah', exec);
  assert.equal(peopleCompare.modelAttempted, false);
  assert.equal(peopleCompare.answer.intent, 'live.COMPARISON_SUMMARY');
  assert.match(peopleCompare.answer.body, /Jordan Hale/);
  assert.match(peopleCompare.answer.body, /Priya Shah/);
  assertNeutral(peopleCompare.answer.body);

  const teamCompare = await ask('Compare Harbour Team and Ridge Team', exec);
  assert.equal(teamCompare.answer.intent, 'live.COMPARISON_SUMMARY');
  assert.match(teamCompare.answer.body, /Harbour Team/);
  assert.match(teamCompare.answer.body, /Ridge Team/);

  const mixed = await ask('Compare Jordan and Harbour Team', exec);
  assert.equal(mixed.answer.mode, 'clarify');
  assert.match(mixed.answer.body, /people with people/);

  const denied = await ask('Compare Harbour Team and Ridge Team', rm);
  const missing = await ask('Compare Harbour Team and Ghost Team', rm);
  assert.equal(denied.answer.intent, 'live.not_found_in_scope');
  assert.equal(missing.answer.intent, 'live.not_found_in_scope');
  assert.equal(denied.answer.body, missing.answer.body);
  assert.doesNotMatch(denied.answer.body, /Ridge Team/);

  const execRm = await ask('Which Regional Manager has the highest issued production this month?', exec);
  assert.equal(execRm.modelAttempted, false);
  assert.equal(execRm.answer.intent, 'live.RANKING_SUMMARY');
  assert.match(execRm.answer.body, /Jordan Hale/);
  assert.match(execRm.answer.body, /Daniel Okoro/);
  assert.doesNotMatch(execRm.answer.body, /Keegan Pillay|Priya Shah/);
  assertNeutral(execRm.answer.body);

  const execAdvisor = await ask('Which advisor has the highest issued production this month?', exec);
  assert.match(execAdvisor.answer.body, /Regional Manager/);
  assert.doesNotMatch(execAdvisor.answer.body, /Keegan Pillay|Naledi Khumalo/);

  const rmTl = await ask('Which Team Leader has the highest issued production this month?', rm);
  assert.equal(rmTl.answer.intent, 'live.RANKING_SUMMARY');
  assert.match(rmTl.answer.body, /Priya Shah/);
  assert.doesNotMatch(rmTl.answer.body, /Amara Botha|Daniel Okoro/);

  const rmRm = await ask('Which Regional Manager has the highest issued production this month?', rm);
  assert.match(rmRm.answer.body, /Team Leader/);
  assert.doesNotMatch(rmRm.answer.body, /Jordan Hale|Daniel Okoro/);

  const tlFa = await ask('Which advisor has the highest issued production this month?', tl);
  assert.equal(tlFa.answer.intent, 'live.RANKING_SUMMARY');
  assert.match(tlFa.answer.body, /Keegan Pillay/);
  assert.doesNotMatch(tlFa.answer.body, /Jordan Hale|Priya Shah|Sam Okonkwo/);

  const regionPipe = await ask('Which region has the most pipeline value?', exec);
  assert.equal(regionPipe.modelAttempted, false);
  assert.match(regionPipe.answer.body, /Coastal Region/);

  const teamNotIssued = await ask('Which team has the most not-yet-issued business?', exec);
  assert.match(teamNotIssued.answer.body, /Harbour Team/);

  const attentionWhy = await ask('Why does Jordan need attention?', exec);
  assert.equal(attentionWhy.modelAttempted, false);
  assert.equal(attentionWhy.answer.intent, 'live.ATTENTION_SUMMARY');
  assert.match(attentionWhy.answer.body, /AdvisorTrack currently flags Jordan Hale as Needs Attention because/);
  assert.match(attentionWhy.answer.body, /No mobile activity for \d+ days/);
  assert.match(attentionWhy.answer.body, /stalled 7\+ days/);
  assert.doesNotMatch(attentionWhy.answer.body, /lazy|not working|attendance|poor effort/i);
  assert.equal(
    attentionWhy.provenance?.businessRules.includes('RULE.TELEMETRY.LAST_MOBILE_ACTIVITY_IS_NOT_PERFORMANCE'),
    true,
  );

  const whoAttention = await ask('Who needs attention?', exec);
  assert.equal(whoAttention.answer.intent, 'live.ATTENTION_SUMMARY');
  assert.match(whoAttention.answer.body, /Jordan Hale/);
  assert.doesNotMatch(whoAttention.answer.body, /Sam Okonkwo/);

  const staffRank = await ask('Which Regional Manager has the highest issued production this month?', staff);
  assert.notEqual(staffRank.answer.intent, 'live.RANKING_SUMMARY');
  assert.doesNotMatch(staffRank.answer.body, /Jordan Hale|Daniel Okoro|1[\s\u00a0,]?400[\s\u00a0,]?000/);
  assertNoClientPii(staffRank.answer.body);

  const staffCompare = await ask('Compare Jordan this month with last month', staff);
  assert.notEqual(staffCompare.answer.intent, 'live.COMPARISON_SUMMARY');
  assertNoClientPii(staffCompare.answer.body);

  const demoRank = await ask('Which Regional Manager has the highest issued production this month?', exec, 'demo');
  assert.equal(demoRank.answer.intent, 'live.RANKING_SUMMARY');
  assert.match(demoRank.answer.body, /Jordan Hale/);

  const demoScope = await ask('Which Team Leader has the highest issued production this month?', rm, 'demo');
  assert.match(demoScope.answer.body, /Priya Shah/);
  assert.doesNotMatch(demoScope.answer.body, /Amara Botha/);

  assert.equal(COMPARISON_SUMMARY_TOOL.limits.maxRows, 4);
  assert.equal(RANKING_SUMMARY_TOOL.limits.maxRows, 5);
  assert.equal(ATTENTION_SUMMARY_TOOL.limits.maxRows, 5);

  console.log('Assistant compare/ranking checks passed (A7.5)');
}

void main();
