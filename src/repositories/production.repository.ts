import { getPool } from '../config/database';
import { CreateProductionInput, UpdateProductionInput } from '../validators/schemas';

export interface ProductionEntry {
  id: string;
  title: string;
  type: CreateProductionInput['type'];
  amount: number;
  contactId?: string;
  contactName?: string;
  productName?: string;
  date: string;
  notes?: string;
  pipelineStage?: string;
  tags: string[];
  isIssued: boolean;
  applicationStatus?: string;
  createdAt: string;
}

export type ManagementProductionSummaryRow = {
  userId: string;
  firstName: string;
  lastName: string;
  issuedAmount: number;
  issuedCount: number;
  nonIssuedAmount: number;
  nonIssuedCount: number;
  goalAmount: number | null;
  attainmentPercent: number | null;
};

export type ManagementProductionTotals = {
  issuedAmount: number;
  issuedCount: number;
  nonIssuedAmount: number;
  nonIssuedCount: number;
};

export type ManagementProductionEntry = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  contactName: string | null;
  title: string;
  productName: string | null;
  amount: number;
  isIssued: boolean;
  applicationStatus: string | null;
  submittedAt: string;
  issuedAt: string | null;
};

interface ProductionRow {
  id: string;
  title: string;
  entry_type: string;
  amount: string;
  contact_id: string | null;
  contact_name: string | null;
  product_name: string | null;
  due_date: Date | null;
  notes: string | null;
  pipeline_stage: string | null;
  tags: string[] | null;
  is_issued: boolean;
  application_status: string | null;
  created_at: Date;
}

/**
 * Maps a PostgreSQL production_entries row to the API DTO.
 */
const mapProductionRow = (row: ProductionRow): ProductionEntry => ({
  id: row.id,
  title: row.title,
  type: row.entry_type as ProductionEntry['type'],
  amount: Number(row.amount),
  contactId: row.contact_id ?? undefined,
  contactName: row.contact_name?.trim() || undefined,
  productName: row.product_name ?? undefined,
  date: row.due_date ? row.due_date.toISOString().slice(0, 10) : row.created_at.toISOString().slice(0, 10),
  notes: row.notes ?? undefined,
  pipelineStage: row.pipeline_stage ?? undefined,
  tags: Array.isArray(row.tags) ? row.tags : [],
  isIssued: row.is_issued,
  applicationStatus: row.application_status ?? undefined,
  createdAt: row.created_at.toISOString(),
});

/**
 * PostgreSQL persistence for production entries.
 */
export const productionRepository = {
  /**
   * Aggregates one calendar month's advisor-entered production for a
   * server-resolved management scope. `userIds` must never come from request input.
   */
  async getManagementMonthlySummary(
    userIds: string[],
    monthStart: string
  ): Promise<{ totals: ManagementProductionTotals; advisors: ManagementProductionSummaryRow[] }> {
    if (userIds.length === 0) {
      return {
        totals: { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 },
        advisors: [],
      };
    }

    const pool = getPool();
    const [totalsResult, advisorsResult] = await Promise.all([
      pool.query<{
        issued_amount: string;
        issued_count: string;
        non_issued_amount: string;
        non_issued_count: string;
      }>(
        `SELECT
           COALESCE(SUM(pe.amount) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           ), 0)::text AS issued_amount,
           COUNT(*) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           )::text AS issued_count,
           COALESCE(SUM(pe.amount) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           ), 0)::text AS non_issued_amount,
           COUNT(*) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           )::text AS non_issued_count
         FROM production_entries pe
         WHERE pe.user_id = ANY($1::uuid[])
           AND DATE_TRUNC('month', COALESCE(pe.due_date, pe.created_at::date)) = $2::date`,
        [userIds, monthStart]
      ),
      pool.query<{
        user_id: string;
        first_name: string;
        last_name: string;
        issued_amount: string;
        issued_count: string;
        non_issued_amount: string;
        non_issued_count: string;
        goal_amount: string | null;
        attainment_percent: string | null;
      }>(
        `SELECT
           u.id AS user_id,
           u.first_name,
           u.last_name,
           COALESCE(SUM(pe.amount) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           ), 0)::text AS issued_amount,
           COUNT(pe.id) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           )::text AS issued_count,
           COALESCE(SUM(pe.amount) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           ), 0)::text AS non_issued_amount,
           COUNT(pe.id) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           )::text AS non_issued_count,
           g.goal_amount::text AS goal_amount,
           CASE
             WHEN g.goal_amount > 0 THEN (
               COALESCE(SUM(pe.amount) FILTER (
                 WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
               ), 0) / g.goal_amount * 100
             )::text
             ELSE NULL
           END AS attainment_percent
         FROM users u
         LEFT JOIN production_entries pe
           ON pe.user_id = u.id
          AND DATE_TRUNC('month', COALESCE(pe.due_date, pe.created_at::date)) = $2::date
         LEFT JOIN production_monthly_goals g
           ON g.user_id = u.id
          AND g.month = $2::date
         WHERE u.id = ANY($1::uuid[])
         GROUP BY u.id, u.first_name, u.last_name, g.goal_amount
         ORDER BY u.last_name ASC, u.first_name ASC, u.id ASC`,
        [userIds, monthStart]
      ),
    ]);

    const totals = totalsResult.rows[0];
    return {
      totals: {
        issuedAmount: Number(totals?.issued_amount ?? 0),
        issuedCount: Number(totals?.issued_count ?? 0),
        nonIssuedAmount: Number(totals?.non_issued_amount ?? 0),
        nonIssuedCount: Number(totals?.non_issued_count ?? 0),
      },
      advisors: advisorsResult.rows.map((row) => ({
        userId: row.user_id,
        firstName: row.first_name,
        lastName: row.last_name,
        issuedAmount: Number(row.issued_amount),
        issuedCount: Number(row.issued_count),
        nonIssuedAmount: Number(row.non_issued_amount),
        nonIssuedCount: Number(row.non_issued_count),
        goalAmount: row.goal_amount == null ? null : Number(row.goal_amount),
        attainmentPercent: row.attainment_percent == null ? null : Number(row.attainment_percent),
      })),
    };
  },

  /**
   * Inclusive date-range totals using the same issued rule as getManagementMonthlySummary:
   * issued = is_issued OR application_status = 'accepted_issued'.
   * Bucket date is COALESCE(due_date, created_at::date).
   */
  async getManagementRangeSummary(
    userIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<{ totals: ManagementProductionTotals; advisors: ManagementProductionSummaryRow[] }> {
    if (userIds.length === 0) {
      return {
        totals: { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 },
        advisors: [],
      };
    }

    const pool = getPool();
    const [totalsResult, advisorsResult] = await Promise.all([
      pool.query<{
        issued_amount: string;
        issued_count: string;
        non_issued_amount: string;
        non_issued_count: string;
      }>(
        `SELECT
           COALESCE(SUM(pe.amount) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           ), 0)::text AS issued_amount,
           COUNT(*) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           )::text AS issued_count,
           COALESCE(SUM(pe.amount) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           ), 0)::text AS non_issued_amount,
           COUNT(*) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           )::text AS non_issued_count
         FROM production_entries pe
         WHERE pe.user_id = ANY($1::uuid[])
           AND COALESCE(pe.due_date, pe.created_at::date) >= $2::date
           AND COALESCE(pe.due_date, pe.created_at::date) <= $3::date`,
        [userIds, startDate, endDate],
      ),
      pool.query<{
        user_id: string;
        first_name: string;
        last_name: string;
        issued_amount: string;
        issued_count: string;
        non_issued_amount: string;
        non_issued_count: string;
      }>(
        `SELECT
           u.id AS user_id,
           u.first_name,
           u.last_name,
           COALESCE(SUM(pe.amount) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           ), 0)::text AS issued_amount,
           COUNT(pe.id) FILTER (
             WHERE pe.is_issued OR pe.application_status = 'accepted_issued'
           )::text AS issued_count,
           COALESCE(SUM(pe.amount) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           ), 0)::text AS non_issued_amount,
           COUNT(pe.id) FILTER (
             WHERE NOT (pe.is_issued OR COALESCE(pe.application_status = 'accepted_issued', FALSE))
           )::text AS non_issued_count
         FROM users u
         LEFT JOIN production_entries pe
           ON pe.user_id = u.id
          AND COALESCE(pe.due_date, pe.created_at::date) >= $2::date
          AND COALESCE(pe.due_date, pe.created_at::date) <= $3::date
         WHERE u.id = ANY($1::uuid[])
         GROUP BY u.id, u.first_name, u.last_name
         ORDER BY u.last_name ASC, u.first_name ASC, u.id ASC`,
        [userIds, startDate, endDate],
      ),
    ]);

    const totals = totalsResult.rows[0];
    return {
      totals: {
        issuedAmount: Number(totals?.issued_amount ?? 0),
        issuedCount: Number(totals?.issued_count ?? 0),
        nonIssuedAmount: Number(totals?.non_issued_amount ?? 0),
        nonIssuedCount: Number(totals?.non_issued_count ?? 0),
      },
      advisors: advisorsResult.rows.map((row) => ({
        userId: row.user_id,
        firstName: row.first_name,
        lastName: row.last_name,
        issuedAmount: Number(row.issued_amount),
        issuedCount: Number(row.issued_count),
        nonIssuedAmount: Number(row.non_issued_amount),
        nonIssuedCount: Number(row.non_issued_count),
        goalAmount: null,
        attainmentPercent: null,
      })),
    };
  },

  /**
   * Case-level production rows for one calendar month in a management scope.
   * Uses the same month and issued rules as getManagementMonthlySummary.
   */
  async listManagementMonthlyEntries(
    userIds: string[],
    monthStart: string
  ): Promise<ManagementProductionEntry[]> {
    if (userIds.length === 0) return [];

    const result = await getPool().query<{
      id: string;
      user_id: string;
      first_name: string;
      last_name: string;
      contact_name: string | null;
      title: string;
      product_name: string | null;
      amount: string;
      is_issued: boolean;
      application_status: string | null;
      due_date: Date | null;
      issued_at: Date | null;
      created_at: Date;
    }>(
      `SELECT
         pe.id,
         u.id AS user_id,
         u.first_name,
         u.last_name,
         NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS contact_name,
         pe.title,
         pe.product_name,
         pe.amount::text AS amount,
         pe.is_issued,
         pe.application_status,
         pe.due_date,
         pe.issued_at,
         pe.created_at
       FROM production_entries pe
       INNER JOIN users u ON u.id = pe.user_id
       LEFT JOIN contacts c ON c.id = pe.contact_id
       WHERE pe.user_id = ANY($1::uuid[])
         AND DATE_TRUNC('month', COALESCE(pe.due_date, pe.created_at::date)) = $2::date
       ORDER BY COALESCE(pe.due_date, pe.created_at::date) DESC, pe.created_at DESC, pe.id ASC`,
      [userIds, monthStart]
    );

    return result.rows.map((row) => {
      const isIssued = row.is_issued || row.application_status === 'accepted_issued';
      const submittedAt = (row.due_date ?? row.created_at).toISOString();
      return {
        id: row.id,
        userId: row.user_id,
        firstName: row.first_name,
        lastName: row.last_name,
        contactName: row.contact_name,
        title: row.title,
        productName: row.product_name,
        amount: Number(row.amount),
        isIssued,
        applicationStatus: row.application_status,
        submittedAt,
        issuedAt: isIssued ? (row.issued_at ?? row.due_date ?? row.created_at).toISOString() : null,
      };
    });
  },

  /**
   * Counts production entries for setup completion checklist.
   */
  async countByUserId(userId: string): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM production_entries WHERE user_id = $1',
      [userId]
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  /**
   * Counts submitted vs issued production in a date range (adaptive submission ratio).
   */
  async countSubmissionStatsBetween(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<{ submitted: number; issued: number }> {
    const result = await getPool().query<{ submitted: string; issued: string }>(
      `SELECT
         COUNT(*)::text AS submitted,
         COUNT(*) FILTER (WHERE is_issued)::text AS issued
       FROM production_entries
       WHERE user_id = $1
         AND COALESCE(due_date, created_at::date) >= $2::date
         AND COALESCE(due_date, created_at::date) < $3::date`,
      [userId, startDate, endDate]
    );
    const row = result.rows[0];
    return {
      submitted: Number(row?.submitted ?? 0),
      issued: Number(row?.issued ?? 0),
    };
  },

  /**
   * Inserts a production entry for the authenticated advisor.
   */
  async create(userId: string, input: CreateProductionInput): Promise<ProductionEntry> {
    const title =
      input.title?.trim() ||
      `${input.pipelineStage ?? 'Production'}${input.contactName ? ` — ${input.contactName}` : ''}`;

    const tags = input.tags ?? [];
    const issuedAt =
      input.isIssued || input.applicationStatus === 'accepted_issued' ? new Date() : null;
    const isIssued = input.isIssued || input.applicationStatus === 'accepted_issued';

    const result = await getPool().query<ProductionRow>(
      `INSERT INTO production_entries (
         user_id,
         contact_id,
         title,
         pipeline_stage,
         entry_type,
         tags,
         due_date,
         amount,
         product_name,
         notes,
         is_issued,
         issued_at,
         application_status,
         source_activity_id,
         case_id
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::pipeline_stage,
         $5::production_entry_type,
         $6::product_tag[],
         $7::date,
         $8,
         $9,
         $10,
         $11,
         $12,
         $13,
         $14,
         $15
       )
       RETURNING
         id,
         title,
         entry_type,
         amount::text,
         contact_id,
         (SELECT TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, ''))
          FROM contacts c WHERE c.id = contact_id) AS contact_name,
         product_name,
         due_date,
         notes,
         pipeline_stage::text,
         tags::text[],
         is_issued,
         application_status,
         created_at`,
      [
        userId,
        input.contactId ?? null,
        title,
        input.pipelineStage ?? null,
        input.type,
        tags,
        input.date,
        input.amount,
        input.productName ?? null,
        input.notes ?? null,
        isIssued,
        issuedAt,
        input.applicationStatus ?? null,
        input.sourceActivityId ?? null,
        input.caseId ?? null,
      ]
    );

    return mapProductionRow(result.rows[0]);
  },

  /**
   * Loads a single production entry for the owning advisor.
   */
  async findByIdForUser(userId: string, entryId: string): Promise<ProductionEntry | null> {
    const result = await getPool().query<ProductionRow>(
      `SELECT
         pe.id,
         pe.title,
         pe.entry_type,
         pe.amount::text,
         pe.contact_id,
         TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact_name,
         pe.product_name,
         pe.due_date,
         pe.notes,
         pe.pipeline_stage::text AS pipeline_stage,
         pe.tags::text[],
         pe.is_issued,
         pe.application_status,
         pe.created_at
       FROM production_entries pe
       LEFT JOIN contacts c ON c.id = pe.contact_id
       WHERE pe.id = $1 AND pe.user_id = $2
       LIMIT 1`,
      [entryId, userId]
    );
    const row = result.rows[0];
    return row ? mapProductionRow(row) : null;
  },

  /**
   * Partially updates a production entry.
   */
  async update(
    userId: string,
    entryId: string,
    input: UpdateProductionInput
  ): Promise<ProductionEntry | null> {
    const sets: string[] = [];
    const params: unknown[] = [entryId, userId];

    if (input.title !== undefined) {
      params.push(input.title.trim());
      sets.push(`title = $${params.length}`);
    }
    if (input.type !== undefined) {
      params.push(input.type);
      sets.push(`entry_type = $${params.length}::production_entry_type`);
    }
    if (input.amount !== undefined) {
      params.push(input.amount);
      sets.push(`amount = $${params.length}`);
    }
    if (input.contactId !== undefined) {
      params.push(input.contactId || null);
      sets.push(`contact_id = $${params.length}`);
    }
    if (input.productName !== undefined) {
      params.push(input.productName || null);
      sets.push(`product_name = $${params.length}`);
    }
    if (input.pipelineStage !== undefined) {
      params.push(input.pipelineStage);
      sets.push(`pipeline_stage = $${params.length}::pipeline_stage`);
    }
    if (input.tags !== undefined) {
      params.push(input.tags);
      sets.push(`tags = $${params.length}::product_tag[]`);
    }
    if (input.date !== undefined) {
      params.push(input.date);
      sets.push(`due_date = $${params.length}::date`);
    }
    if (input.notes !== undefined) {
      params.push(input.notes?.trim() || null);
      sets.push(`notes = $${params.length}`);
    }
    if (input.isIssued !== undefined) {
      params.push(input.isIssued);
      sets.push(`is_issued = $${params.length}`);
      if (input.isIssued) {
        sets.push(`issued_at = NOW()`);
        if (input.applicationStatus === undefined) {
          params.push('accepted_issued');
          sets.push(`application_status = $${params.length}`);
        }
      } else {
        sets.push(`issued_at = NULL`);
      }
    }
    if (input.applicationStatus !== undefined) {
      params.push(input.applicationStatus);
      sets.push(`application_status = $${params.length}`);
      if (input.applicationStatus === 'accepted_issued') {
        sets.push(`is_issued = TRUE`);
        sets.push(`issued_at = COALESCE(issued_at, NOW())`);
      }
    }

    if (sets.length === 0) {
      return this.findByIdForUser(userId, entryId);
    }

    const result = await getPool().query<{ id: string }>(
      `UPDATE production_entries
       SET ${sets.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      params
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.findByIdForUser(userId, entryId);
  },

  /**
   * Deletes a production entry scoped to the owning advisor.
   */
  async delete(userId: string, entryId: string): Promise<boolean> {
    const result = await getPool().query(
      'DELETE FROM production_entries WHERE id = $1 AND user_id = $2',
      [entryId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },
};
