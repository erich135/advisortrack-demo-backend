import { getPool } from '../config/database';

export interface ManagementPipelineFilters {
  advisorId?: string;
  stage?: string;
  status?: string;
  search?: string;
}

export interface ManagementPipelineCase {
  caseId: string;
  advisor: {
    userId: string;
    firstName: string;
    lastName: string;
  };
  contactName: string | null;
  currentStage: string;
  status: string;
  createdAt: string;
  lastUpdatedAt: string;
  estimatedCommission: number | null;
  nextStepDate: string | null;
  nextScheduledActivity: {
    title: string | null;
    pipelineStage: string | null;
    dueAt: string | null;
    dueDate: string | null;
  } | null;
  fica: {
    idReceived: boolean;
    residenceReceived: boolean;
    bankReceived: boolean;
    skipAcknowledged: boolean;
  };
  documents: {
    totalCount: number;
    receivedCount: number;
  };
}

interface ManagementPipelineCaseRow {
  case_id: string;
  advisor_user_id: string;
  advisor_first_name: string;
  advisor_last_name: string;
  contact_name: string | null;
  current_stage: string;
  status: string;
  created_at: Date;
  last_updated_at: Date;
  estimated_commission: string | null;
  next_step_date: string | null;
  next_activity_title: string | null;
  next_activity_stage: string | null;
  next_activity_due_at: Date | null;
  next_activity_due_date: string | null;
  fica_id_received: boolean;
  fica_residence_received: boolean;
  fica_bank_received: boolean;
  fica_skip_acknowledged: boolean;
  document_count: string;
  received_document_count: string;
}

const toIsoString = (value: Date): string => value.toISOString();

const mapCase = (row: ManagementPipelineCaseRow): ManagementPipelineCase => ({
  caseId: row.case_id,
  advisor: {
    userId: row.advisor_user_id,
    firstName: row.advisor_first_name,
    lastName: row.advisor_last_name,
  },
  contactName: row.contact_name,
  currentStage: row.current_stage,
  status: row.status,
  createdAt: toIsoString(row.created_at),
  lastUpdatedAt: toIsoString(row.last_updated_at),
  estimatedCommission:
    row.estimated_commission === null ? null : Number(row.estimated_commission),
  nextStepDate: row.next_step_date,
  nextScheduledActivity:
    row.next_activity_title ||
    row.next_activity_stage ||
    row.next_activity_due_at ||
    row.next_activity_due_date
      ? {
          title: row.next_activity_title,
          pipelineStage: row.next_activity_stage,
          dueAt: row.next_activity_due_at ? toIsoString(row.next_activity_due_at) : null,
          dueDate: row.next_activity_due_date,
        }
      : null,
  fica: {
    idReceived: row.fica_id_received,
    residenceReceived: row.fica_residence_received,
    bankReceived: row.fica_bank_received,
    skipAcknowledged: row.fica_skip_acknowledged,
  },
  documents: {
    totalCount: Number(row.document_count),
    receivedCount: Number(row.received_document_count),
  },
});

/**
 * Set-based read model for management-scoped pipeline data.
 * The service supplies server-derived permitted advisor IDs only.
 */
export const managementPipelineRepository = {
  async listCases(
    permittedUserIds: string[],
    filters: ManagementPipelineFilters
  ): Promise<ManagementPipelineCase[]> {
    if (permittedUserIds.length === 0) return [];

    const params: unknown[] = [permittedUserIds];
    const conditions = ['c.user_id = ANY($1::uuid[])'];

    if (filters.advisorId) {
      params.push(filters.advisorId);
      conditions.push(`c.user_id = $${params.length}::uuid`);
    }
    if (filters.stage) {
      params.push(filters.stage);
      conditions.push(`c.current_stage = $${params.length}::pipeline_stage`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`c.status = $${params.length}::case_status`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(
        COALESCE(c.title, '') ILIKE $${params.length}
        OR CONCAT_WS(' ', ct.first_name, ct.last_name) ILIKE $${params.length}
      )`);
    }

    const result = await getPool().query<ManagementPipelineCaseRow>(
      `WITH activity_updates AS (
         SELECT
           a.case_id,
           MAX(GREATEST(a.created_at, a.updated_at)) AS last_activity_updated_at
         FROM activities a
         WHERE a.case_id IS NOT NULL
           AND a.user_id = ANY($1::uuid[])
         GROUP BY a.case_id
       ),
       next_scheduled_activities AS (
         SELECT case_id, title, pipeline_stage, due_at, due_date
         FROM (
           SELECT
             a.case_id,
             a.title,
             a.pipeline_stage::text AS pipeline_stage,
             a.due_at,
             a.due_date::text AS due_date,
             ROW_NUMBER() OVER (
               PARTITION BY a.case_id
               ORDER BY COALESCE(a.due_at, a.due_date::timestamp) ASC, a.created_at ASC
             ) AS row_number
           FROM activities a
           WHERE a.case_id IS NOT NULL
             AND a.user_id = ANY($1::uuid[])
             AND a.status = 'scheduled'
             AND COALESCE(a.due_at, a.due_date::timestamp) IS NOT NULL
         ) scheduled
         WHERE row_number = 1
       ),
       document_summaries AS (
         SELECT
           d.case_id,
           COUNT(*)::text AS document_count,
           COUNT(*) FILTER (WHERE d.received_at IS NOT NULL)::text AS received_document_count,
           MAX(d.updated_at) AS last_document_updated_at
         FROM case_documents d
         JOIN client_cases scoped_cases ON scoped_cases.id = d.case_id
         WHERE scoped_cases.user_id = ANY($1::uuid[])
         GROUP BY d.case_id
       )
       SELECT
         c.id AS case_id,
         c.user_id AS advisor_user_id,
         u.first_name AS advisor_first_name,
         u.last_name AS advisor_last_name,
         NULLIF(CONCAT_WS(' ', ct.first_name, ct.last_name), '') AS contact_name,
         c.current_stage::text AS current_stage,
         c.status::text AS status,
         c.created_at,
         GREATEST(
           c.updated_at,
           COALESCE(activity_updates.last_activity_updated_at, c.updated_at),
           COALESCE(document_summaries.last_document_updated_at, c.updated_at)
         ) AS last_updated_at,
         c.estimated_commission::text AS estimated_commission,
         c.next_step_date::text AS next_step_date,
         next_scheduled_activities.title AS next_activity_title,
         next_scheduled_activities.pipeline_stage AS next_activity_stage,
         next_scheduled_activities.due_at AS next_activity_due_at,
         next_scheduled_activities.due_date AS next_activity_due_date,
         c.fica_id_received,
         c.fica_residence_received,
         c.fica_bank_received,
         c.fica_skip_acknowledged,
         COALESCE(document_summaries.document_count, '0') AS document_count,
         COALESCE(document_summaries.received_document_count, '0') AS received_document_count
       FROM client_cases c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN activity_updates ON activity_updates.case_id = c.id
       LEFT JOIN next_scheduled_activities ON next_scheduled_activities.case_id = c.id
       LEFT JOIN document_summaries ON document_summaries.case_id = c.id
       WHERE ${conditions.join('\n         AND ')}
       ORDER BY last_updated_at DESC, c.created_at DESC`,
      params
    );

    return result.rows.map(mapCase);
  },
};
