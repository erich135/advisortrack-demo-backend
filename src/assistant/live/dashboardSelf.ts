import type { MyFollowupsProjection } from './followups';
import type { MyPipelineProjection } from './pipelineSelf';
import type { MyProductionProjection } from './productionSelf';
import type { MyTargetProgressProjection } from './targetProgress';
import type { CompanionFocus, CompanionSnapshot } from './companion';

export type MyDashboardProjection = CompanionSnapshot;

export type MyDashboardFocus = 'overview' | 'attention' | CompanionFocus;

export type AttentionItem = {
  order: number;
  label: string;
  count: number;
};

/**
 * Documented Advisor attention order (workflow state only):
 * 1. overdue scheduled activity
 * 2. review due
 * 3. case with no next action
 * 4. incomplete FICA/documents
 */
export function attentionItems(projection: MyDashboardProjection): AttentionItem[] {
  return [
    { order: 1, label: 'overdue scheduled activities', count: projection.overdueActivities },
    { order: 2, label: 'reviews due', count: projection.reviewDue },
    { order: 3, label: 'cases with no next action', count: projection.casesWithoutNextAction },
    { order: 4, label: 'cases with incomplete FICA', count: projection.ficaIncomplete },
    { order: 5, label: 'cases with incomplete documents', count: projection.documentsIncomplete },
  ].filter((item) => item.count > 0);
}

export function projectMyDashboard(input: {
  followups: MyFollowupsProjection | null;
  pipeline: MyPipelineProjection | null;
  target: MyTargetProgressProjection | null;
  production?: MyProductionProjection | null;
  activitiesAvailable?: boolean;
  casesAvailable?: boolean;
}): MyDashboardProjection {
  const followups = input.followups;
  const pipeline = input.pipeline;
  const activitiesAvailable = input.activitiesAvailable ?? followups != null;
  const casesAvailable = input.casesAvailable ?? pipeline != null;
  const production = input.production ?? null;
  return {
    monthlyGoal: input.target?.monthlyGoal ?? 0,
    issuedCommission: input.target?.issuedCommission ?? 0,
    progressPercent: input.target?.progressPercent ?? 0,
    remainingAmount: input.target?.remainingAmount ?? 0,
    openCases: pipeline?.openCaseCount ?? 0,
    casesWithoutNextAction: pipeline?.casesWithoutNextActionCount ?? 0,
    ficaIncomplete: pipeline?.ficaIncompleteCount ?? 0,
    documentsIncomplete: pipeline?.casesWithIncompleteDocumentsCount ?? 0,
    reviewDue: pipeline?.reviewDueCount ?? 0,
    overdueActivities: followups?.overdueCount ?? 0,
    todayActivities: followups?.todayCount ?? 0,
    followUpsToday: followups?.followUpTodayCount ?? 0,
    todayMeetingCount: followups?.todayMeetingCount ?? 0,
    todayCallCount: followups?.todayCallCount ?? 0,
    thisWeekCount: followups?.thisWeekCount ?? 0,
    completedTodayCount: followups?.completedTodayCount ?? 0,
    followUpOverdueCount: followups?.followUpOverdueCount ?? 0,
    pendingUnderwritingCount: production ? production.pendingUnderwritingCount : null,
    awaitingAdvisorInfoCount: production ? production.awaitingAdvisorInfoCount : null,
    activitiesAvailable,
    casesAvailable,
    targetAvailable: Boolean(input.target && input.target.monthlyGoal > 0),
    productionAvailable: production != null,
  };
}

export function detectMyDashboardFocus(normalized: string): MyDashboardFocus {
  if (/\b(attention|outstanding|sort out|waiting on me|look at today|what should i do now)\b/.test(normalized)) {
    return 'attention';
  }
  return 'overview';
}
