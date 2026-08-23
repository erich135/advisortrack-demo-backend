import { DataStore, PRODUCTION_GOAL } from '../data/store';
import { isDatabaseActive } from '../config/database';
import { dashboardRepository } from '../repositories/dashboard.repository';
import { DashboardSummary } from '../types/dashboard';
import { getInMemoryGeneralSettings } from './planning.service';
import { buildPlanningInputs } from './planning.service';
import {
  calculateEarnedPoints,
  calculatePlanningTargets,
  weeklyDeliverablesToStatTargets,
} from './planningEngine';
import { subscriptionService } from './subscription.service';

/**
 * Returns ISO week bounds (Mon–Sun) for in-memory fallback calculations.
 */
const getCurrentWeekRange = (): { start: string; end: string } => {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIsoDate(monday), end: toIsoDate(sunday) };
};

const isDateInRange = (dateStr: string, start: string, end: string): boolean =>
  dateStr >= start && dateStr <= end;

/**
 * Builds dashboard summary from in-memory store using Excel planning formulas.
 */
const buildInMemorySummary = (store: DataStore, userId: string): DashboardSummary => {
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const { start: weekStart, end: weekEnd } = getCurrentWeekRange();

  const planning = calculatePlanningTargets(
    buildPlanningInputs(
      { monthlyGoalNett: PRODUCTION_GOAL, monthlyDeductions: 0, commissionSplit: '80%' },
      getInMemoryGeneralSettings(userId)
    )
  );
  const statTargets = weeklyDeliverablesToStatTargets(planning.weekly);

  const productions = store.productions.filter((entry) => entry.userId === userId);
  const monthProductions = productions.filter((entry) => entry.date.startsWith(monthPrefix));

  const estimatedCommission = monthProductions.reduce((sum, entry) => sum + entry.amount, 0);
  const issuedCommission = monthProductions.reduce((sum, entry) => sum + entry.amount, 0);
  const monthlyGoal = PRODUCTION_GOAL;
  const estimatedProgressPercent =
    monthlyGoal > 0 ? Math.min(Math.round((estimatedCommission / monthlyGoal) * 100), 100) : 0;
  const progressPercent =
    monthlyGoal > 0 ? Math.min(Math.round((issuedCommission / monthlyGoal) * 100), 100) : 0;

  const weekProductions = productions.filter((entry) =>
    isDateInRange(entry.date, weekStart, weekEnd)
  );
  const weekProductionCount = weekProductions.length;

  const typeToStage: Record<string, string> = {
    call: 'Initial Contact',
    meeting: 'Interview',
    email: 'Initial Contact',
    follow_up: 'Analysis',
    presentation: 'Recommendation',
    other: 'Implementation',
  };

  const weekCompletedActivities = store.activities.filter(
    (activity) =>
      activity.userId === userId &&
      activity.status === 'completed' &&
      isDateInRange(activity.scheduledAt.slice(0, 10), weekStart, weekEnd)
  );

  const stageCounts: Record<string, number> = {};
  for (const activity of weekCompletedActivities) {
    const stage = typeToStage[activity.type] ?? 'Initial Contact';
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
  }

  const weeklyStats = [
    {
      id: 'calls' as const,
      label: 'Calls',
      current: weekCompletedActivities.filter((a) => a.type === 'call').length,
      target: statTargets.calls,
      icon: 'call' as const,
    },
    {
      id: 'meetings' as const,
      label: 'Meetings',
      current: weekCompletedActivities.filter((a) => a.type === 'meeting').length,
      target: statTargets.meetings,
      icon: 'people' as const,
    },
    {
      id: 'quotes' as const,
      label: 'Quotes',
      current: weekCompletedActivities.filter((a) => a.type === 'follow_up').length,
      target: statTargets.quotes,
      icon: 'document' as const,
    },
    {
      id: 'submission' as const,
      label: 'Submission',
      current: weekProductionCount,
      target: statTargets.submission,
      icon: 'upload' as const,
    },
  ];

  const earnedPoints = calculateEarnedPoints(stageCounts, 0);

  const upcomingEvents = store.activities
    .filter(
      (activity) =>
        activity.userId === userId &&
        activity.status === 'scheduled' &&
        new Date(activity.scheduledAt).getTime() >= Date.now()
    )
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 5)
    .map((activity) => ({
      id: activity.id,
      title: activity.title,
      type: activity.type,
      status: activity.status,
      contactName: activity.contactName,
      scheduledAt: activity.scheduledAt,
    }));

  return {
    income: {
      estimatedCommission,
      issuedCommission,
      progressPercent,
      estimatedProgressPercent,
      monthlyGoal,
    },
    weeklyPoints: {
      earned: earnedPoints,
      total: planning.weeklyPointTarget,
    },
    weeklyStats,
    upcomingEvents,
    pipeline: {
      period: { month: `${monthPrefix}-01` },
      stages: [],
      overall: {
        totalProceeded: 0,
        totalLost: 0,
        lostRatio: 0,
        conversionRatio: 0,
      },
    },
    period: {
      month: `${monthPrefix}-01`,
      weekStart,
      weekEnd,
    },
  };
};

/**
 * Home dashboard business logic — PostgreSQL when connected, in-memory otherwise.
 */
export class DashboardService {
  constructor(private store: DataStore) {}

  /**
   * Returns aggregated home screen metrics for the authenticated advisor.
   */
  async getSummary(userId: string): Promise<DashboardSummary> {
    const features = await subscriptionService.getUserFeatures(userId);
    const summary = isDatabaseActive()
      ? await dashboardRepository.getSummary(userId)
      : buildInMemorySummary(this.store, userId);

    return subscriptionService.applyDashboardFeatureGates(summary, features);
  }
}

