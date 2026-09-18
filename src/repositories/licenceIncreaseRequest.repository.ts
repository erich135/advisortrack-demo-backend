import type { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export type LicenceIncreaseRequestRow = {
  id: string;
  company_id: string;
  contract_id: string | null;
  requested_by_user_id: string;
  current_purchased: number | null;
  additional_requested: number;
  proposed_total: number | null;
  expected_previous_purchased: number | null;
  status: string;
  billing_treatment: string | null;
  notes: string | null;
  decision: string | null;
  decision_notes: string | null;
  billing_amount_cents: number | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  applied_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by_user_id: string | null;
  created_at: Date;
  updated_at?: Date;
  company_name?: string;
  requested_by_email?: string | null;
  requested_by_name?: string | null;
};

const COLS = `
  r.id, r.company_id, r.contract_id, r.requested_by_user_id, r.current_purchased,
  r.additional_requested, r.proposed_total, r.expected_previous_purchased, r.status,
  r.billing_treatment, r.notes, r.decision, r.decision_notes, r.billing_amount_cents,
  r.reviewed_by_user_id, r.reviewed_at, r.applied_at, r.cancelled_at, r.cancelled_by_user_id,
  r.created_at, r.updated_at
`;

function missingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '42P01';
}

function requireTable(error: unknown): never {
  if (missingTable(error)) {
    throw new AppError(
      503,
      'Licence request tables are not on this database. Apply database/demo/007_licence_seat_increases.sql to advisortrack_demo only.',
      'LICENCE_REQUEST_SCHEMA_MISSING'
    );
  }
  throw error;
}

function db(client?: PoolClient) {
  return client ?? getPool();
}

export const licenceIncreaseRequestRepository = {
  async insert(
    input: {
      companyId: string;
      contractId?: string | null;
      requestedByUserId: string;
      currentPurchased: number | null;
      additionalRequested: number;
      proposedTotal: number | null;
      billingTreatment?: string | null;
      notes?: string | null;
    },
    client?: PoolClient
  ): Promise<LicenceIncreaseRequestRow> {
    try {
      const result = await db(client).query<LicenceIncreaseRequestRow>(
        `INSERT INTO licence_increase_requests (
           company_id, contract_id, requested_by_user_id, current_purchased, additional_requested,
           proposed_total, expected_previous_purchased, status, billing_treatment, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $4, 'pending', $7, $8)
         RETURNING ${COLS.replace(/r\./g, '')}`,
        [
          input.companyId,
          input.contractId ?? null,
          input.requestedByUserId,
          input.currentPurchased,
          input.additionalRequested,
          input.proposedTotal,
          input.billingTreatment ?? null,
          input.notes ?? null,
        ]
      );
      return result.rows[0];
    } catch (error) {
      requireTable(error);
    }
  },

  async listForCompany(companyId: string): Promise<LicenceIncreaseRequestRow[]> {
    try {
      const result = await getPool().query<LicenceIncreaseRequestRow>(
        `SELECT ${COLS}
         FROM licence_increase_requests r
         WHERE r.company_id = $1
         ORDER BY r.created_at DESC
         LIMIT 50`,
        [companyId]
      );
      return result.rows;
    } catch (error) {
      requireTable(error);
    }
  },

  async listAll(limit = 100): Promise<LicenceIncreaseRequestRow[]> {
    try {
      const result = await getPool().query<LicenceIncreaseRequestRow>(
        `SELECT ${COLS},
                c.name AS company_name,
                u.email AS requested_by_email,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS requested_by_name
         FROM licence_increase_requests r
         INNER JOIN companies c ON c.id = r.company_id
         INNER JOIN users u ON u.id = r.requested_by_user_id
         ORDER BY r.created_at DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows;
    } catch (error) {
      requireTable(error);
    }
  },

  async findById(id: string, client?: PoolClient): Promise<LicenceIncreaseRequestRow | null> {
    try {
      const result = await db(client).query<LicenceIncreaseRequestRow>(
        `SELECT ${COLS},
                c.name AS company_name,
                u.email AS requested_by_email,
                TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS requested_by_name
         FROM licence_increase_requests r
         INNER JOIN companies c ON c.id = r.company_id
         INNER JOIN users u ON u.id = r.requested_by_user_id
         WHERE r.id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    } catch (error) {
      requireTable(error);
    }
  },

  async lockById(id: string, client: PoolClient): Promise<LicenceIncreaseRequestRow | null> {
    try {
      const result = await client.query<LicenceIncreaseRequestRow>(
        `SELECT ${COLS.replace(/r\./g, '')}
         FROM licence_increase_requests
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      return result.rows[0] ?? null;
    } catch (error) {
      requireTable(error);
    }
  },

  async markApplied(
    input: {
      id: string;
      actorUserId: string;
      billingTreatment: string;
      billingAmountCents: number | null;
      decisionNotes?: string | null;
    },
    client: PoolClient
  ): Promise<LicenceIncreaseRequestRow> {
    const result = await client.query<LicenceIncreaseRequestRow>(
      `UPDATE licence_increase_requests
       SET status = 'applied',
           decision = 'approved',
           reviewed_by_user_id = $2,
           reviewed_at = COALESCE(reviewed_at, NOW()),
           applied_at = NOW(),
           billing_treatment = $3,
           billing_amount_cents = $4,
           decision_notes = COALESCE($5, decision_notes)
       WHERE id = $1
         AND status IN ('pending', 'approved', 'queued_local', 'submitted')
       RETURNING ${COLS.replace(/r\./g, '')}`,
      [input.id, input.actorUserId, input.billingTreatment, input.billingAmountCents, input.decisionNotes ?? null]
    );
    if (!result.rows[0]) {
      throw new AppError(409, 'This licence request cannot be applied', 'REQUEST_NOT_APPLIABLE');
    }
    return result.rows[0];
  },

  async markRejected(
    input: { id: string; actorUserId: string; notes?: string | null },
    client?: PoolClient
  ): Promise<LicenceIncreaseRequestRow | null> {
    const result = await db(client).query<LicenceIncreaseRequestRow>(
      `UPDATE licence_increase_requests
       SET status = 'rejected',
           decision = 'rejected',
           reviewed_by_user_id = $2,
           reviewed_at = NOW(),
           decision_notes = $3
       WHERE id = $1
         AND status IN ('pending', 'approved', 'queued_local', 'submitted')
       RETURNING ${COLS.replace(/r\./g, '')}`,
      [input.id, input.actorUserId, input.notes ?? null]
    );
    return result.rows[0] ?? null;
  },

  async markCancelled(
    input: { id: string; actorUserId: string },
    client?: PoolClient
  ): Promise<LicenceIncreaseRequestRow | null> {
    const result = await db(client).query<LicenceIncreaseRequestRow>(
      `UPDATE licence_increase_requests
       SET status = 'cancelled',
           decision = 'cancelled',
           cancelled_by_user_id = $2,
           cancelled_at = NOW()
       WHERE id = $1
         AND status IN ('pending', 'queued_local', 'submitted')
       RETURNING ${COLS.replace(/r\./g, '')}`,
      [input.id, input.actorUserId]
    );
    return result.rows[0] ?? null;
  },
};
