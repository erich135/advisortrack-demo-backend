import type { DashboardSummary } from '../../types/dashboard';
import type { PublicPlanningTargets } from '../../services/planning.service';

export type MyTargetProgressProjection = {
  period: string;
  monthlyGoal: number;
  issuedCommission: number;
  potentialCommission: number;
  progressPercent: number;
  remainingAmount: number;
  weeklyPointTarget: number;
  weeklyPointsEarned: number;
  coldCallsPerWeek: number;
  interviewsPerWeek: number;
  quotesPerWeek: number;
  recommendationsPerWeek: number;
  casesSubmittedPerWeek: number;
  casesIssuedPerWeek: number;
  issuedBasis: 'home';
};

export type MyTargetProgressFocus =
  | 'remaining'
  | 'monthly_goal'
  | 'issued_toward_target'
  | 'percent'
  | 'weekly_targets'
  | 'overview';

export function projectMyTargetProgress(input: {
  dashboard: Pick<DashboardSummary, 'income' | 'weeklyPoints' | 'period'>;
  targets: PublicPlanningTargets;
}): MyTargetProgressProjection {
  const monthlyGoal = input.dashboard.income.monthlyGoal;
  const issuedCommission = input.dashboard.income.issuedCommission;
  return {
    period: input.dashboard.period.month.slice(0, 7),
    monthlyGoal,
    issuedCommission,
    potentialCommission: input.dashboard.income.estimatedCommission,
    progressPercent: input.dashboard.income.progressPercent,
    remainingAmount: Math.max(0, monthlyGoal - issuedCommission),
    weeklyPointTarget: input.targets.weeklyPointTarget,
    weeklyPointsEarned: input.dashboard.weeklyPoints.earned,
    coldCallsPerWeek: input.targets.weekly.coldCallsPerWeek,
    interviewsPerWeek: input.targets.weekly.interviewsPerWeek,
    quotesPerWeek: input.targets.weekly.quotesPerWeek,
    recommendationsPerWeek: input.targets.weekly.recommendationsPerWeek,
    casesSubmittedPerWeek: input.targets.weekly.casesSubmittedPerWeek,
    casesIssuedPerWeek: input.targets.weekly.casesIssuedPerWeek,
    issuedBasis: 'home',
  };
}

export function detectMyTargetProgressFocus(normalized: string): MyTargetProgressFocus {
  if (/\b(how far|remaining|left to go|still need|short of)\b/.test(normalized)) return 'remaining';
  if (/\b(percent|percentage|%|progress)\b/.test(normalized)) return 'percent';
  if (/\b(weekly|initial contacts?|fact-?find|cold calls?|quotes per week|recommendations? per week)\b/.test(normalized)) {
    return 'weekly_targets';
  }
  if (/\b(what is my monthly|monthly (nett )?(goal|target)|nett goal)\b/.test(normalized)) return 'monthly_goal';
  if (/\b(issued|earned) (toward|towards|against)\b/.test(normalized)) return 'issued_toward_target';
  return 'overview';
}
