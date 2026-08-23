import { getPool } from '../config/database';
import { financialProfileRepository } from './financialProfile.repository';
import { generalSettingsRepository } from './generalSettings.repository';
import { adaptiveRatioService } from '../services/adaptiveRatio.service';
import { buildPlanningInputs } from '../services/planning.service';
import { calculatePlanningTargets } from '../services/planningEngine';

export interface ProductionGauge {
  label: string;
  percent: number;
  color: 'blue' | 'green';
}

export interface ProductionChartBar {
  primary: number;
  secondary: number;
}

export interface ProductionFeedEntry {
  id: string;
  clientName: string;
  stage: string;
  status: string;
  applicationStatus?: string;
  statusCategory: 'issued' | 'submitted' | 'underwriting' | 'closed';
  amount: number;
  tags: string[];
  providerName?: string;
  productCategory?: string;
  completed: boolean;
  dateGroup: string;
  submittedAt: string;
}

/**
 * Maps stored application status and issued flag to a feed filter category.
 */
const feedStatusCategory = (
  isIssued: boolean,
  applicationStatus: string | null
): 'issued' | 'submitted' | 'underwriting' | 'closed' => {
  if (isIssued || applicationStatus === 'accepted_issued') {
    return 'issued';
  }
  if (
    applicationStatus === 'declined' ||
    applicationStatus === 'withdrawn' ||
    applicationStatus === 'postponed'
  ) {
    return 'closed';
  }
  if (!applicationStatus || applicationStatus === 'application_received') {
    return 'submitted';
  }
  return 'underwriting';
};

/**
 * Human-readable status label for production feed cards.
 */
const feedStatusLabel = (isIssued: boolean, applicationStatus: string | null): string => {
  if (isIssued || applicationStatus === 'accepted_issued') {
    return 'Issued';
  }
  if (!applicationStatus) {
    return 'Draft';
  }
  if (applicationStatus === 'application_received') {
    return 'Submitted';
  }
  if (applicationStatus === 'pending_underwriting') {
    return 'In underwriting';
  }
  if (applicationStatus === 'awaiting_medicals') {
    return 'Awaiting medicals';
  }
  if (applicationStatus === 'quality_assessment') {
    return 'Quality assessment';
  }
  if (applicationStatus === 'declined') {
    return 'Declined';
  }
  if (applicationStatus === 'withdrawn') {
    return 'Withdrawn';
  }
  if (applicationStatus === 'postponed') {
    return 'Postponed';
  }
  return 'In progress';
};

/**
 * Extracts provider name from a production notes field (`Provider: Sanlam`).
 */
const providerFromNotes = (notes: string | null): string | undefined => {
  if (!notes?.trim()) {
    return undefined;
  }
  const match = notes.match(/^Provider:\s*(.+)$/i);
  return match?.[1]?.trim() || undefined;
};

export interface ProductionDashboard {
  monthLabel: string;
  chart: ProductionChartBar[];
  gauges: ProductionGauge[];
  entries: ProductionFeedEntry[];
}

/**
 * Parses `YYYY-MM` into the first day of that month (UTC noon to avoid TZ day shifts).
 * Falls back to the current calendar month when invalid/missing.
 */
const parseMonthKey = (monthKey?: string): Date => {
  if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
    const [year, month] = monthKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1, 12, 0, 0));
};

/**
 * Ensures PostgreSQL tag arrays are always a string[] for the API response.
 */
const normalizeTags = (tags: unknown): string[] => {
  if (!tags) {
    return [];
  }
  if (Array.isArray(tags)) {
    return tags.map(String);
  }
  return [];
};

/**
 * PostgreSQL queries for the Production tab dashboard.
 */
export const productionDashboardRepository = {
  /**
   * Loads production chart, gauges, and case list for a calendar month.
   * @param monthKey - Optional `YYYY-MM`; defaults to the current calendar month.
   */
  async getDashboard(userId: string, monthKey?: string): Promise<ProductionDashboard> {
    await adaptiveRatioService.ensureMonthlyAdjustment(userId);

    const pool = getPool();

    const [financial, settings] = await Promise.all([
      financialProfileRepository.findByUserId(userId),
      generalSettingsRepository.findByUserId(userId),
    ]);

    const planning = calculatePlanningTargets(
      buildPlanningInputs(
        {
          monthlyGoalNett: financial?.monthlyGoalNett,
          monthlyDeductions: financial?.monthlyDeductions,
          commissionSplit: financial?.commissionSplit,
          workingWeeksPerYear: financial?.workingWeeksPerYear,
          workingDaysPerWeek: financial?.workingDaysPerWeek,
        },
        settings
      )
    );

    const monthlyGoalNett = financial?.monthlyGoalNett ?? 50000;
    const weeklySubmissionTarget = planning.weekly.casesSubmittedPerWeek;

    const monthAnchor = parseMonthKey(monthKey);
    const monthStartSql = monthAnchor.toISOString().slice(0, 10);

    const totalsResult = await pool.query<{
      estimated_total: string;
      issued_total: string;
      submission_count: string;
      issued_count: string;
    }>(
      `SELECT
         COALESCE(SUM(amount), 0)::text AS estimated_total,
         COALESCE(SUM(amount) FILTER (WHERE is_issued), 0)::text AS issued_total,
         COUNT(*)::text AS submission_count,
         COUNT(*) FILTER (WHERE is_issued)::text AS issued_count
       FROM production_entries
       WHERE user_id = $1
         AND DATE_TRUNC('month', COALESCE(due_date, created_at::date)) = DATE_TRUNC('month', $2::date)`,
      [userId, monthStartSql]
    );

    const weekTotals = await pool.query<{ week_num: string; submissions: string; issued: string }>(
      `SELECT
         EXTRACT(WEEK FROM COALESCE(due_date, created_at::date))::text AS week_num,
         COUNT(*)::text AS submissions,
         COUNT(*) FILTER (WHERE is_issued)::text AS issued
       FROM production_entries
       WHERE user_id = $1
         AND DATE_TRUNC('month', COALESCE(due_date, created_at::date)) = DATE_TRUNC('month', $2::date)
       GROUP BY 1
       ORDER BY 1
       LIMIT 5`,
      [userId, monthStartSql]
    );

    const entriesResult = await pool.query<{
      id: string;
      title: string;
      pipeline_stage: string | null;
      amount: string;
      is_issued: boolean;
      application_status: string | null;
      tags: string[] | null;
      product_name: string | null;
      notes: string | null;
      due_date: Date | null;
      created_at: Date;
      contact_name: string | null;
    }>(
      `SELECT
         pe.id,
         pe.title,
         pe.pipeline_stage::text,
         pe.amount::text,
         pe.is_issued,
         pe.application_status,
         pe.tags,
         pe.product_name,
         pe.notes,
         pe.due_date,
         pe.created_at,
         TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact_name
       FROM production_entries pe
       LEFT JOIN contacts c ON c.id = pe.contact_id
       WHERE pe.user_id = $1
         AND DATE_TRUNC('month', COALESCE(pe.due_date, pe.created_at::date)) = DATE_TRUNC('month', $2::date)
       ORDER BY COALESCE(pe.due_date, pe.created_at::date) DESC
       LIMIT 50`,
      [userId, monthStartSql]
    );

    const row = totalsResult.rows[0];
    const estimatedTotal = Number(row?.estimated_total ?? 0);
    const issuedTotal = Number(row?.issued_total ?? 0);
    const submissionCount = Number(row?.submission_count ?? 0);

    const weeklySubmissionsResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM production_entries
       WHERE user_id = $1
         AND COALESCE(due_date, created_at::date) >= DATE_TRUNC('week', CURRENT_DATE)::date
         AND COALESCE(due_date, created_at::date) < DATE_TRUNC('week', CURRENT_DATE)::date + INTERVAL '7 days'`,
      [userId]
    );
    const weeklySubmissions = Number(weeklySubmissionsResult.rows[0]?.count ?? 0);

    const casesSubmittedPercent =
      weeklySubmissionTarget > 0
        ? Math.min(Math.round((weeklySubmissions / weeklySubmissionTarget) * 100), 100)
        : 0;
    const potentialPercent =
      monthlyGoalNett > 0
        ? Math.min(Math.round((estimatedTotal / monthlyGoalNett) * 100), 100)
        : 0;
    const issuedPercent =
      monthlyGoalNett > 0
        ? Math.min(Math.round((issuedTotal / monthlyGoalNett) * 100), 100)
        : 0;

    const chart: ProductionChartBar[] =
      weekTotals.rows.length > 0
        ? weekTotals.rows.map((w) => ({
            primary: Number(w.submissions),
            secondary: Number(w.issued),
          }))
        : [
            { primary: 0, secondary: 0 },
            { primary: 0, secondary: 0 },
            { primary: 0, secondary: 0 },
            { primary: submissionCount, secondary: Number(row?.issued_count ?? 0) },
            { primary: 0, secondary: 0 },
          ];

    const monthLabel = monthAnchor.toLocaleDateString('en-ZA', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const entries: ProductionFeedEntry[] = entriesResult.rows.map((entry) => {
      const date = entry.due_date ?? entry.created_at;
      const submittedAt = date.toISOString().slice(0, 10);
      const tagList = normalizeTags(entry.tags);
      const providerName = providerFromNotes(entry.notes) ?? tagList[0];
      return {
        id: entry.id,
        clientName:
          entry.contact_name?.trim() ||
          entry.title.replace(/^.+?—\s*/, '').trim() ||
          entry.title,
        stage: entry.pipeline_stage ?? 'Implementation',
        status: feedStatusLabel(entry.is_issued, entry.application_status),
        applicationStatus: entry.application_status ?? undefined,
        statusCategory: feedStatusCategory(entry.is_issued, entry.application_status),
        amount: Number(entry.amount),
        tags: tagList,
        providerName,
        productCategory: entry.product_name ?? undefined,
        completed: entry.is_issued,
        dateGroup: date.toLocaleDateString('en-ZA', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        submittedAt,
      };
    });

    return {
      monthLabel,
      chart,
      gauges: [
        { label: 'Cases Submitted', percent: casesSubmittedPercent, color: 'blue' },
        { label: 'Potential Commission', percent: potentialPercent, color: 'green' },
        { label: 'Issued Commission', percent: issuedPercent, color: 'blue' },
      ],
      entries,
    };
  },
};
