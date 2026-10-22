import type { MyFollowupsProjection } from './followups';
import type { MyPipelineProjection } from './pipelineSelf';
import type { MyTargetProgressProjection } from './targetProgress';

export type MyDashboardProjection = {
  monthlyGoal: number;
  issuedCommission: number;
  progressPercent: number;
  remainingAmount: number;
  openCases: number;
  casesWithoutNextAction: number;
  ficaIncomplete: number;
  documentsIncomplete: number;
  reviewDue: number;
  overdueActivities: number;
  todayActivities: number;
  followUpsToday: number;
};

export type MyDashboardFocus = 'overview' | 'attention';

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
  followups: MyFollowupsProjection;
  pipeline: MyPipelineProjection;
  target: MyTargetProgressProjection | null;
}): MyDashboardProjection {
  return {
    monthlyGoal: input.target?.monthlyGoal ?? 0,
    issuedCommission: input.target?.issuedCommission ?? 0,
    progressPercent: input.target?.progressPercent ?? 0,
    remainingAmount: input.target?.remainingAmount ?? 0,
    openCases: input.pipeline.openCaseCount,
    casesWithoutNextAction: input.pipeline.casesWithoutNextActionCount,
    ficaIncomplete: input.pipeline.ficaIncompleteCount,
    documentsIncomplete: input.pipeline.casesWithIncompleteDocumentsCount,
    reviewDue: input.pipeline.reviewDueCount,
    overdueActivities: input.followups.overdueCount,
    todayActivities: input.followups.todayCount,
    followUpsToday: input.followups.followUpTodayCount,
  };
}

export function detectMyDashboardFocus(normalized: string): MyDashboardFocus {
  if (/\b(attention|outstanding|sort out|waiting on me|look at today)\b/.test(normalized)) {
    return 'attention';
  }
  return 'overview';
}
