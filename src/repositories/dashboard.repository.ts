import { getPool } from '../config/database';

import {

  DashboardActivityStat,

  DashboardSummary,

} from '../types/dashboard';

import { financialProfileRepository } from './financialProfile.repository';

import { generalSettingsRepository } from './generalSettings.repository';

import { adaptiveRatioService } from '../services/adaptiveRatio.service';

import { buildPlanningInputs } from '../services/planning.service';

import { activityRepository } from './activity.repository';
import { caseRepository } from './case.repository';
import { getPipelineAnalytics } from '../services/activityOutcome.service';

import {

  calculateEarnedPoints,

  calculatePlanningTargets,

  weeklyDeliverablesToStatTargets,

} from '../services/planningEngine';



const DEFAULT_MONTHLY_GOAL = 50000;



interface IncomeRow {

  estimated_total: string;

  issued_total: string;

  monthly_goal: string | null;

}



interface ActivityCountRow {

  pipeline_stage: string;

  count: string;

}



/**

 * Builds weekly stat tiles using calculated targets from the planning engine.

 */

const buildWeeklyStats = (

  counts: { calls: number; meetings: number; quotes: number; submission: number },

  targets: { calls: number; meetings: number; quotes: number; submission: number }

): DashboardActivityStat[] => [

  {

    id: 'calls',

    label: 'Calls',

    current: counts.calls,

    target: targets.calls,

    icon: 'call',

  },

  {

    id: 'meetings',

    label: 'Meetings',

    current: counts.meetings,

    target: targets.meetings,

    icon: 'people',

  },

  {

    id: 'quotes',

    label: 'Quotes',

    current: counts.quotes,

    target: targets.quotes,

    icon: 'document',

  },

  {

    id: 'submission',

    label: 'Submission',

    current: counts.submission,

    target: targets.submission,

    icon: 'upload',

  },

];



/**

 * PostgreSQL queries for the home dashboard.

 */

export const dashboardRepository = {

  /**

   * Loads aggregated dashboard metrics for an advisor.

   */

  async getSummary(userId: string): Promise<DashboardSummary> {

    await adaptiveRatioService.ensureMonthlyAdjustment(userId);

    const pool = getPool();



    const [financial, settings] = await Promise.all([

      financialProfileRepository.findByUserId(userId),

      generalSettingsRepository.findByUserId(userId),

    ]);



    const planningInputs = buildPlanningInputs(

      {

        monthlyGoalNett: financial?.monthlyGoalNett,

        monthlyDeductions: financial?.monthlyDeductions,

        commissionSplit: financial?.commissionSplit,

        workingWeeksPerYear: financial?.workingWeeksPerYear,

        workingDaysPerWeek: financial?.workingDaysPerWeek,

      },

      settings

    );

    const planning = calculatePlanningTargets(planningInputs);

    const statTargets = weeklyDeliverablesToStatTargets(planning.weekly);



    const incomeResult = await pool.query<IncomeRow>(
      `WITH production AS (
         SELECT
           COALESCE(SUM(pe.amount), 0) AS estimated_total,
           COALESCE(SUM(pe.amount) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           ), 0) AS issued_total
         FROM production_entries pe
         WHERE pe.user_id = $1
           AND DATE_TRUNC(
             'month',
             COALESCE(pe.due_date, pe.created_at::date)
           ) = DATE_TRUNC('month', CURRENT_DATE)::date
       )
       SELECT
         production.estimated_total::text,
         production.issued_total::text,
         $2::text AS monthly_goal
       FROM production`,
      [userId, String(financial?.monthlyGoalNett ?? DEFAULT_MONTHLY_GOAL)]
    );



    const incomeRow = incomeResult.rows[0];

    const estimatedTotal = Number(incomeRow?.estimated_total ?? 0);

    const issuedTotal = Number(incomeRow?.issued_total ?? 0);

    const monthlyGoal = Number(incomeRow?.monthly_goal ?? DEFAULT_MONTHLY_GOAL);

    const estimatedProgressPercent =
      monthlyGoal > 0 ? Math.min(Math.round((estimatedTotal / monthlyGoal) * 100), 100) : 0;

    const progressPercent =
      monthlyGoal > 0 ? Math.min(Math.round((issuedTotal / monthlyGoal) * 100), 100) : 0;



    const activityResult = await pool.query<ActivityCountRow>(

      `SELECT pipeline_stage::text, COUNT(*)::text AS count

       FROM activities

       WHERE user_id = $1

         AND status = 'completed'

         AND COALESCE(due_date, created_at::date) >= DATE_TRUNC('week', CURRENT_DATE)::date

         AND COALESCE(due_date, created_at::date) < DATE_TRUNC('week', CURRENT_DATE)::date + INTERVAL '7 days'

       GROUP BY pipeline_stage`,

      [userId]

    );

    const quotesResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM client_cases cc,
            jsonb_array_elements(cc.analysis_quotes) AS quote
       WHERE cc.user_id = $1
         AND cc.updated_at >= DATE_TRUNC('week', CURRENT_DATE)
         AND (quote->>'premium') IS NOT NULL
         AND (quote->>'commission') IS NOT NULL
         AND COALESCE(quote->>'premium', '') <> ''
         AND COALESCE(quote->>'commission', '') <> ''`,
      [userId]
    );



    const submissionResult = await pool.query<{ count: string }>(

      `SELECT COUNT(*)::text AS count

       FROM production_entries

       WHERE user_id = $1

         AND COALESCE(due_date, created_at::date) >= DATE_TRUNC('week', CURRENT_DATE)::date

         AND COALESCE(due_date, created_at::date) < DATE_TRUNC('week', CURRENT_DATE)::date + INTERVAL '7 days'`,

      [userId]

    );



    const issuedResult = await pool.query<{ count: string }>(

      `SELECT COUNT(*)::text AS count

       FROM production_entries

       WHERE user_id = $1

         AND is_issued = TRUE

         AND COALESCE(due_date, issued_at::date, created_at::date) >= DATE_TRUNC('week', CURRENT_DATE)::date

         AND COALESCE(due_date, issued_at::date, created_at::date) < DATE_TRUNC('week', CURRENT_DATE)::date + INTERVAL '7 days'`,

      [userId]

    );



    const stageCounts: Record<string, number> = {};

    for (const row of activityResult.rows) {

      stageCounts[row.pipeline_stage] = Number(row.count);

    }



    const submissionCount = Number(submissionResult.rows[0]?.count ?? 0);

    const issuedCount = Number(issuedResult.rows[0]?.count ?? 0);

    const quotesCount = Number(quotesResult.rows[0]?.count ?? 0);



    const weeklyStats = buildWeeklyStats(

      {

        calls: stageCounts['Initial Contact'] ?? 0,

        meetings: stageCounts['Interview'] ?? 0,

        quotes: quotesCount,

        submission: submissionCount,

      },

      statTargets

    );



    const earnedPoints = calculateEarnedPoints(stageCounts, issuedCount);

    const weeklyPointTarget = planning.weeklyPointTarget;

    const upcomingActivities = await activityRepository.listUpcoming(userId, 8);
    const upcomingCaseSteps = await caseRepository.listUpcomingStepDates(userId, 8);
    const pipeline = await getPipelineAnalytics(userId);

    const upcomingEvents = [
      ...upcomingActivities.map(({ userId: _uid, createdAt: _ca, ...event }) => ({
        id: event.id,
        title: event.title,
        type: event.type,
        status: event.status,
        contactName: event.contactName,
        scheduledAt: event.scheduledAt,
        source: 'activity' as const,
      })),
      ...upcomingCaseSteps.map((step) => ({
        id: step.id,
        title: step.title,
        type: 'case_step' as const,
        status: 'scheduled' as const,
        contactName: step.contactName,
        contactId: step.contactId,
        scheduledAt: step.scheduledAt,
        source: 'case' as const,
      })),
    ]
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .slice(0, 8);



    const weekStartResult = await pool.query<{ week_start: Date; week_end: Date; month: Date }>(

      `SELECT

         DATE_TRUNC('week', CURRENT_DATE)::date AS week_start,

         (DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '6 days')::date AS week_end,

         DATE_TRUNC('month', CURRENT_DATE)::date AS month`

    );

    const periodRow = weekStartResult.rows[0];



    return {

      income: {

        estimatedCommission: estimatedTotal,

        issuedCommission: issuedTotal,

        progressPercent,

        estimatedProgressPercent,

        monthlyGoal,

      },

      weeklyPoints: {

        earned: earnedPoints,

        total: weeklyPointTarget,

      },

      weeklyStats,

      upcomingEvents: upcomingEvents.map(({ source: _s, ...event }) => event),

      pipeline,

      period: {

        month: periodRow.month.toISOString().slice(0, 10),

        weekStart: periodRow.week_start.toISOString().slice(0, 10),

        weekEnd: periodRow.week_end.toISOString().slice(0, 10),

      },

    };

  },

};


