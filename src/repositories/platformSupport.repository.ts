import { getPool } from '../config/database';

export interface PlatformSupportFilters {
  companyId?: string;
  search?: string;
  inactiveDays?: number;
}

interface PlatformSupportAdvisorRow {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  company_id: string;
  company_name: string;
  company_is_active: boolean;
  role_name: string | null;
  account_is_active: boolean;
  subscription_status: string | null;
  subscription_package_name: string | null;
  last_login_at: Date | null;
  days_since_last_login: number | null;
  reports_to_user_id: string | null;
  case_count: number;
  open_case_count: number;
  cases_without_next_action: number;
  stage_counts: unknown;
  last_case_movement_at: Date | null;
  days_since_last_case_movement: number | null;
  last_workflow_activity_at: Date | null;
  days_since_workflow_activity: number | null;
}

export interface PlatformSupportAdvisorTelemetry {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  companyId: string;
  companyName: string;
  companyIsActive: boolean;
  roleName: string | null;
  accountIsActive: boolean;
  subscriptionStatus: string | null;
  subscriptionPackageName: string | null;
  lastLoginAt: string | null;
  daysSinceLastLogin: number | null;
  reportsToUserId: string | null;
  caseCount: number;
  openCaseCount: number;
  casesWithoutNextAction: number;
  stageCounts: Record<string, number>;
  lastCaseMovementAt: string | null;
  daysSinceLastCaseMovement: number | null;
  lastWorkflowActivityAt: string | null;
  daysSinceWorkflowActivity: number | null;
}

const asStageCounts = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([stage, count]) => [stage, Number(count)]),
  );
};

const toIso = (value: Date | null): string | null => value?.toISOString() ?? null;

const mapAdvisor = (row: PlatformSupportAdvisorRow): PlatformSupportAdvisorTelemetry => ({
  userId: row.user_id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  companyId: row.company_id,
  companyName: row.company_name,
  companyIsActive: row.company_is_active,
  roleName: row.role_name,
  accountIsActive: row.account_is_active,
  subscriptionStatus: row.subscription_status,
  subscriptionPackageName: row.subscription_package_name,
  lastLoginAt: toIso(row.last_login_at),
  daysSinceLastLogin: row.days_since_last_login,
  reportsToUserId: row.reports_to_user_id,
  caseCount: row.case_count,
  openCaseCount: row.open_case_count,
  casesWithoutNextAction: row.cases_without_next_action,
  stageCounts: asStageCounts(row.stage_counts),
  lastCaseMovementAt: toIso(row.last_case_movement_at),
  daysSinceLastCaseMovement: row.days_since_last_case_movement,
  lastWorkflowActivityAt: toIso(row.last_workflow_activity_at),
  daysSinceWorkflowActivity: row.days_since_workflow_activity,
});

/**
 * Privacy-safe platform support telemetry. This deliberately omits future hierarchy
 * concepts (Region, Branch, Team) until those entities exist.
 */
export const platformSupportRepository = {
  async listAdvisorTelemetry(
    filters: PlatformSupportFilters,
  ): Promise<PlatformSupportAdvisorTelemetry[]> {
    const search = filters.search ? `%${filters.search}%` : null;
    const result = await getPool().query<PlatformSupportAdvisorRow>(
      `WITH scoped_advisors AS (
         SELECT
           u.id AS user_id,
           u.first_name,
           u.last_name,
           u.email::text AS email,
           c.id AS company_id,
           c.name AS company_name,
           c.is_active AS company_is_active,
           r.name AS role_name,
           u.is_active AS account_is_active,
           us.status AS subscription_status,
           p.name AS subscription_package_name,
           u.last_login_at,
           u.reports_to_user_id
         FROM users u
         JOIN companies c ON c.id = u.company_id
         LEFT JOIN company_roles r ON r.id = u.company_role_id
         LEFT JOIN user_subscriptions us ON us.user_id = u.id
         LEFT JOIN subscription_packages p ON p.id = us.package_id
         WHERE ($1::uuid IS NULL OR c.id = $1::uuid)
           AND (
             $2::text IS NULL
             OR c.name ILIKE $2::text
             OR CONCAT_WS(' ', u.first_name, u.last_name) ILIKE $2::text
             OR u.email::text ILIKE $2::text
           )
           AND (
             $3::int IS NULL
             OR u.last_login_at IS NULL
             OR u.last_login_at <= NOW() - ($3::int * INTERVAL '1 day')
           )
       ),
       case_base AS (
         SELECT
           sa.user_id,
           cc.current_stage::text AS current_stage,
           cc.status::text AS status,
           cc.next_step_date,
           cc.updated_at
         FROM client_cases cc
         JOIN scoped_advisors sa ON sa.user_id = cc.user_id
       ),
       case_aggregates AS (
         SELECT
           user_id,
           COUNT(*)::int AS case_count,
           COUNT(*) FILTER (WHERE status = 'open')::int AS open_case_count,
           COUNT(*) FILTER (WHERE status = 'open' AND next_step_date IS NULL)::int
             AS cases_without_next_action,
           MAX(updated_at) AS last_case_movement_at
         FROM case_base
         GROUP BY user_id
       ),
       stage_count_rows AS (
         SELECT user_id, current_stage, COUNT(*)::int AS stage_count
         FROM case_base
         GROUP BY user_id, current_stage
       ),
       stage_distributions AS (
         SELECT user_id, jsonb_object_agg(current_stage, stage_count) AS stage_counts
         FROM stage_count_rows
         GROUP BY user_id
       ),
       workflow_aggregates AS (
         SELECT
           sa.user_id,
           MAX(GREATEST(a.created_at, a.updated_at)) AS last_workflow_activity_at
         FROM scoped_advisors sa
         JOIN activities a ON a.user_id = sa.user_id
         WHERE a.pipeline_stage IS NOT NULL
         GROUP BY sa.user_id
       ),
       telemetry AS (
         SELECT
           sa.*,
           COALESCE(ca.case_count, 0)::int AS case_count,
           COALESCE(ca.open_case_count, 0)::int AS open_case_count,
           COALESCE(ca.cases_without_next_action, 0)::int AS cases_without_next_action,
           COALESCE(sd.stage_counts, '{}'::jsonb) AS stage_counts,
           ca.last_case_movement_at,
           wa.last_workflow_activity_at
         FROM scoped_advisors sa
         LEFT JOIN case_aggregates ca ON ca.user_id = sa.user_id
         LEFT JOIN stage_distributions sd ON sd.user_id = sa.user_id
         LEFT JOIN workflow_aggregates wa ON wa.user_id = sa.user_id
       )
       SELECT
         user_id,
         first_name,
         last_name,
         email,
         company_id,
         company_name,
         company_is_active,
         role_name,
         account_is_active,
         subscription_status,
         subscription_package_name,
         last_login_at,
         CASE
           WHEN last_login_at IS NULL THEN NULL
           ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - last_login_at)) / 86400))::int
         END AS days_since_last_login,
         reports_to_user_id,
         case_count,
         open_case_count,
         cases_without_next_action,
         stage_counts,
         last_case_movement_at,
         CASE
           WHEN last_case_movement_at IS NULL THEN NULL
           ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - last_case_movement_at)) / 86400))::int
         END AS days_since_last_case_movement,
         last_workflow_activity_at,
         CASE
           WHEN last_workflow_activity_at IS NULL THEN NULL
           ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - last_workflow_activity_at)) / 86400))::int
         END AS days_since_workflow_activity
       FROM telemetry
       ORDER BY company_name ASC, last_name ASC, first_name ASC`,
      [filters.companyId ?? null, search, filters.inactiveDays ?? null],
    );

    return result.rows.map(mapAdvisor);
  },

  /** Records the privileged support read without storing company, advisor, or search values. */
  async recordSupportRead(
    actorUserId: string,
    metadata: {
      companyFilterApplied: boolean;
      searchApplied: boolean;
      inactiveDays: number | null;
      companyCount: number;
      advisorCount: number;
    },
  ): Promise<void> {
    await getPool().query(
      `INSERT INTO popia_audit_log (user_id, action, resource_type, resource_count, metadata)
       VALUES ($1, 'platform_support_read', 'platform_support', $2, $3::jsonb)`,
      [actorUserId, metadata.advisorCount, JSON.stringify(metadata)],
    );
  },
};
