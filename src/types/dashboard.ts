/**
 * Home dashboard API types — aligned with mobile app models.
 */

export interface DashboardIncomeSummary {
  estimatedCommission: number;
  issuedCommission: number;
  /** Issued commission as % of monthly nett goal. */
  progressPercent: number;
  /** Estimated pipeline commission as % of monthly nett goal. */
  estimatedProgressPercent: number;
  monthlyGoal: number;
}

export type DashboardActivityIcon = 'call' | 'people' | 'document' | 'upload';

export interface DashboardActivityStat {
  id: string;
  label: string;
  current: number;
  target: number;
  icon: DashboardActivityIcon;
  /** Present when the user's plan does not include weekly_points. */
  locked?: boolean;
}

export interface DashboardWeeklyPoints {
  earned: number;
  total: number;
  /** Present when the user's plan does not include weekly_points. */
  locked?: boolean;
}

export interface DashboardUpcomingEvent {
  id: string;
  title: string;
  type: 'call' | 'meeting' | 'email' | 'follow_up' | 'presentation' | 'other' | 'case_step';
  status: 'scheduled' | 'completed' | 'cancelled';
  contactName?: string;
  contactId?: string;
  scheduledAt: string;
}

export interface DashboardPipelineStageStat {
  stage: string;
  proceeded: number;
  lost: number;
  completed: number;
  conversionPercent: number;
  lostPercent: number;
}

export interface DashboardPipelineAnalytics {
  period: { month: string };
  stages: DashboardPipelineStageStat[];
  overall: {
    totalProceeded: number;
    totalLost: number;
    lostRatio: number;
    conversionRatio: number;
  };
  /** Present when the user's plan does not include pipeline_analytics. */
  locked?: boolean;
}

export interface DashboardSummary {
  income: DashboardIncomeSummary;
  weeklyPoints: DashboardWeeklyPoints;
  weeklyStats: DashboardActivityStat[];
  upcomingEvents: DashboardUpcomingEvent[];
  /** True when upcoming_events feature is locked (events list is empty). */
  upcomingEventsLocked?: boolean;
  pipeline: DashboardPipelineAnalytics;
  period: {
    month: string;
    weekStart: string;
    weekEnd: string;
  };
}
