import type { AssistantPeriod } from './period';
import { sanitizeIdentityText } from './sanitizeDisplay';
import type {
  DirectoryRegion,
  DirectoryTeam,
  EntityRef,
  LicenceSummaryProjection,
  LiveToolFactGroup,
  PersonSummaryProjection,
  PipelineSummaryProjection,
  ProductionTotals,
} from './types';
import type { MyFollowupsProjection } from './followups';
import type { MyCaseSummaryProjection, MyPipelineProjection } from './pipelineSelf';
import type { MyProductionProjection } from './productionSelf';
import type { MyTargetProgressProjection } from './targetProgress';
import type { MyContactsSummaryProjection } from './contactsSummary';
import type { MyDashboardProjection } from './dashboardSelf';

function projectedFacts(facts: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(facts)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'string' ? sanitizeIdentityText(value) : value]),
  );
}

export function personToolFacts(
  projection: PersonSummaryProjection,
  input: { entity: EntityRef; includeDirectoryContact: boolean },
): LiveToolFactGroup {
  return {
    tool: 'PERSON_SUMMARY',
    version: 1,
    entity: input.entity,
    facts: projectedFacts({
      displayName: projection.displayName,
      reportingRoleLabel: projection.reportingRoleLabel,
      teamName: projection.teamName,
      regionName: projection.regionName,
      accountStatus: projection.accountStatus,
      licenceStatus: projection.licenceStatus,
      invitationStatus: projection.invitationStatus,
      lastMobileActivity: projection.lastMobileActivity,
      email: input.includeDirectoryContact ? projection.email : null,
      phone: input.includeDirectoryContact ? projection.phone : null,
    }),
  };
}

export function licenceToolFacts(projection: LicenceSummaryProjection): LiveToolFactGroup {
  return {
    tool: 'LICENCE_SUMMARY',
    version: 1,
    facts: projectedFacts({
      purchased: projection.purchased,
      assigned: projection.assigned,
      available: projection.available,
    }),
  };
}

export function productionToolFacts(input: {
  entity: EntityRef;
  period: AssistantPeriod;
  production: ProductionTotals;
}): LiveToolFactGroup {
  return {
    tool: 'PRODUCTION_SUMMARY',
    version: 1,
    entity: input.entity,
    period: input.period,
    facts: projectedFacts({
      issuedAmount: input.production.issuedAmount,
      issuedCount: input.production.issuedCount,
      notIssuedAmount: input.production.nonIssuedAmount,
      notIssuedCount: input.production.nonIssuedCount,
    }),
  };
}

export function pipelineToolFacts(input: {
  entity: EntityRef;
  projection: PipelineSummaryProjection;
}): LiveToolFactGroup {
  return {
    tool: 'PIPELINE_SUMMARY',
    version: 1,
    entity: input.entity,
    facts: projectedFacts({
      totalCases: input.projection.totalCases,
      openCases: input.projection.openCases,
      pipelineValue: input.projection.pipelineValue,
      topStageLabel: input.projection.stageCounts[0]?.label ?? null,
      topStageCount: input.projection.stageCounts[0]?.count ?? null,
    }),
  };
}

export function teamToolFacts(input: {
  entity: EntityRef;
  period: AssistantPeriod;
  team: DirectoryTeam;
}): LiveToolFactGroup {
  return {
    tool: 'TEAM_SUMMARY',
    version: 1,
    entity: input.entity,
    period: input.period,
    facts: projectedFacts({
      name: input.team.name,
      leaderName: input.team.leaderName,
      regionName: input.team.regionName,
      advisorCount: input.team.advisorCount,
    }),
  };
}

export function comparisonToolFacts(input: {
  entity: EntityRef;
  subjectName: string;
  metric: string;
  currentPeriod: AssistantPeriod;
  baselinePeriod?: AssistantPeriod;
  currentValue: number;
  baselineValue: number | null;
  currentComplete: boolean;
  baselineComplete: boolean | null;
}): LiveToolFactGroup {
  return {
    tool: 'COMPARISON_SUMMARY',
    version: 1,
    entity: input.entity,
    period: input.currentPeriod,
    facts: projectedFacts({
      subjectName: input.subjectName,
      metric: input.metric,
      currentPeriod: input.currentPeriod,
      baselinePeriod: input.baselinePeriod ?? null,
      currentValue: input.currentValue,
      baselineValue: input.baselineValue,
      currentComplete: input.currentComplete,
      baselineComplete: input.baselineComplete,
    }),
  };
}

export function rankingToolFacts(input: {
  period: AssistantPeriod;
  metric: string;
  universe: string;
  comparisonRole: string | null;
  ordering: string;
  scopeKind: string | null;
  sourceTool: string;
  rows: Array<{ name: string; value: number }>;
}): LiveToolFactGroup {
  const facts: Record<string, string | number | boolean | null> = {
    metric: input.metric,
    periodLabel: input.period,
    universe: input.universe,
    comparisonRole: input.comparisonRole,
    ordering: input.ordering,
    scopeKind: input.scopeKind,
    sourceTool: input.sourceTool,
    rowCount: input.rows.length,
  };
  input.rows.forEach((row, index) => {
    facts[`name${index + 1}`] = row.name;
    facts[`value${index + 1}`] = row.value;
  });
  return {
    tool: 'RANKING_SUMMARY',
    version: 1,
    period: input.period,
    facts: projectedFacts(facts),
  };
}

export function attentionToolFacts(input: {
  entity: EntityRef;
  subjectName: string;
  flagged: boolean;
  reasons: string[];
}): LiveToolFactGroup {
  const facts: Record<string, string | number | boolean | null> = {
    subjectName: input.subjectName,
    flagged: input.flagged,
    reasonCount: input.reasons.length,
  };
  input.reasons.forEach((reason, index) => {
    facts[`reason${index + 1}`] = reason;
  });
  return {
    tool: 'ATTENTION_SUMMARY',
    version: 1,
    entity: input.entity,
    facts: projectedFacts(facts),
  };
}

export function regionToolFacts(input: {
  entity: EntityRef;
  period: AssistantPeriod;
  region: DirectoryRegion;
}): LiveToolFactGroup {
  return {
    tool: 'REGION_SUMMARY',
    version: 1,
    entity: input.entity,
    period: input.period,
    facts: projectedFacts({
      name: input.region.name,
      managerName: input.region.managerName,
      teamCount: input.region.teamCount,
      advisorCount: input.region.advisorCount,
    }),
  };
}

export function myFollowupsToolFacts(projection: MyFollowupsProjection): LiveToolFactGroup {
  return {
    tool: 'MY_FOLLOWUPS',
    version: 1,
    facts: projectedFacts({
      todayCount: projection.todayCount,
      overdueCount: projection.overdueCount,
      thisWeekCount: projection.thisWeekCount,
      completedTodayCount: projection.completedTodayCount,
      followUpTodayCount: projection.followUpTodayCount,
      followUpOverdueCount: projection.followUpOverdueCount,
      callCount: projection.callCount,
      meetingCount: projection.meetingCount,
      todayCallCount: projection.todayCallCount,
      todayMeetingCount: projection.todayMeetingCount,
      emailCount: projection.emailCount,
      followUpTypeCount: projection.followUpTypeCount,
      presentationCount: projection.presentationCount,
      otherCount: projection.otherCount,
    }),
  };
}

export function myPipelineToolFacts(projection: MyPipelineProjection): LiveToolFactGroup {
  return {
    tool: 'MY_PIPELINE',
    version: 1,
    facts: projectedFacts({
      openCaseCount: projection.openCaseCount,
      wonCaseCount: projection.wonCaseCount,
      lostCaseCount: projection.lostCaseCount,
      closedCaseCount: projection.closedCaseCount,
      initialContactCount: projection.initialContactCount,
      factFindingCount: projection.factFindingCount,
      analysisCount: projection.analysisCount,
      recommendationCount: projection.recommendationCount,
      implementationCount: projection.implementationCount,
      reviewCount: projection.reviewCount,
      totalEstimatedCommission: projection.totalEstimatedCommission,
      casesWithoutNextActionCount: projection.casesWithoutNextActionCount,
      ficaIncompleteCount: projection.ficaIncompleteCount,
      casesWithIncompleteDocumentsCount: projection.casesWithIncompleteDocumentsCount,
      reviewDueCount: projection.reviewDueCount,
      submittedToProductionCount: projection.submittedToProductionCount,
    }),
  };
}

export function myProductionToolFacts(projection: MyProductionProjection): LiveToolFactGroup {
  return {
    tool: 'MY_PRODUCTION',
    version: 1,
    facts: projectedFacts({
      period: projection.period,
      entryCount: projection.entryCount,
      issuedCount: projection.issuedCount,
      issuedCommission: projection.issuedCommission,
      notIssuedCount: projection.notIssuedCount,
      notIssuedCommission: projection.notIssuedCommission,
      totalCommission: projection.totalCommission,
      acceptedIssuedStatusCount: projection.acceptedIssuedStatusCount,
      applicationReceivedCount: projection.applicationReceivedCount,
      qualityAssessmentCount: projection.qualityAssessmentCount,
      pendingUnderwritingCount: projection.pendingUnderwritingCount,
      awaitingMedicalsCount: projection.awaitingMedicalsCount,
      pmaPendingCount: projection.pmaPendingCount,
      awaitingAdvisorInfoCount: projection.awaitingAdvisorInfoCount,
      counterOfferCount: projection.counterOfferCount,
      postponedCount: projection.postponedCount,
      declinedCount: projection.declinedCount,
      withdrawnCount: projection.withdrawnCount,
    }),
  };
}

export function myTargetProgressToolFacts(projection: MyTargetProgressProjection): LiveToolFactGroup {
  return {
    tool: 'MY_TARGET_PROGRESS',
    version: 1,
    facts: projectedFacts({
      period: projection.period,
      monthlyGoal: projection.monthlyGoal,
      issuedCommission: projection.issuedCommission,
      potentialCommission: projection.potentialCommission,
      progressPercent: projection.progressPercent,
      remainingAmount: projection.remainingAmount,
      weeklyPointTarget: projection.weeklyPointTarget,
      weeklyPointsEarned: projection.weeklyPointsEarned,
      coldCallsPerWeek: projection.coldCallsPerWeek,
      interviewsPerWeek: projection.interviewsPerWeek,
      quotesPerWeek: projection.quotesPerWeek,
      recommendationsPerWeek: projection.recommendationsPerWeek,
      casesSubmittedPerWeek: projection.casesSubmittedPerWeek,
      casesIssuedPerWeek: projection.casesIssuedPerWeek,
      issuedBasis: projection.issuedBasis,
    }),
  };
}

export function myCaseSummaryToolFacts(projection: MyCaseSummaryProjection): LiveToolFactGroup {
  return {
    tool: 'MY_CASE_SUMMARY',
    version: 1,
    facts: projectedFacts({
      currentStage: projection.currentStage,
      stageLabel: projection.stageLabel,
      status: projection.status,
      ficaComplete: projection.ficaComplete,
      documentCount: projection.documentCount,
      documentsSent: projection.documentsSent,
      documentsReceived: projection.documentsReceived,
      quoteCount: projection.quoteCount,
      insurerSelected: projection.insurerSelected,
      estimatedCommission: projection.estimatedCommission,
      hasNextAction: projection.hasNextAction,
      reviewDue: projection.reviewDue,
      submittedToProduction: projection.submittedToProduction,
    }),
  };
}

export function myContactsSummaryToolFacts(projection: MyContactsSummaryProjection): LiveToolFactGroup {
  return {
    tool: 'MY_CONTACTS_SUMMARY',
    version: 1,
    facts: projectedFacts({
      totalContacts: projection.totalContacts,
      activeContacts: projection.activeContacts,
      prospectCount: projection.prospectCount,
      clientCount: projection.clientCount,
      inactiveCount: projection.inactiveCount,
      practiceContactCount: projection.practiceContactCount,
      realContactCount: projection.realContactCount,
      livePreviewActiveRealCount: projection.livePreviewActiveRealCount,
      livePreviewLimit: projection.livePreviewLimit,
    }),
  };
}

export function myDashboardToolFacts(projection: MyDashboardProjection): LiveToolFactGroup {
  return {
    tool: 'MY_DASHBOARD',
    version: 1,
    facts: projectedFacts({
      monthlyGoal: projection.monthlyGoal,
      issuedCommission: projection.issuedCommission,
      progressPercent: projection.progressPercent,
      remainingAmount: projection.remainingAmount,
      openCases: projection.openCases,
      casesWithoutNextAction: projection.casesWithoutNextAction,
      ficaIncomplete: projection.ficaIncomplete,
      documentsIncomplete: projection.documentsIncomplete,
      reviewDue: projection.reviewDue,
      overdueActivities: projection.overdueActivities,
      todayActivities: projection.todayActivities,
      followUpsToday: projection.followUpsToday,
      todayMeetingCount: projection.todayMeetingCount,
      todayCallCount: projection.todayCallCount,
      thisWeekCount: projection.thisWeekCount,
      completedTodayCount: projection.completedTodayCount,
      followUpOverdueCount: projection.followUpOverdueCount,
      pendingUnderwritingCount: projection.pendingUnderwritingCount,
      awaitingAdvisorInfoCount: projection.awaitingAdvisorInfoCount,
    }),
  };
}
