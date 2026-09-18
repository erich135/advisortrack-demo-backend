import type { PoolClient } from 'pg';
import { getPool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export type SeatChangeRow = {
  id: string;
  company_id: string;
  contract_id: string | null;
  request_id: string | null;
  previous_purchased_seats: number;
  delta: number;
  new_purchased_seats: number;
  effective_at: Date;
  billing_treatment: string;
  commercial_reference: string | null;
  actor_user_id: string | null;
  created_at: Date;
};

export type BillingAdjustmentRow = {
  id: string;
  company_id: string;
  contract_id: string | null;
  seat_change_id: string | null;
  request_id: string | null;
  invoice_id: string | null;
  adjustment_type: string;
  status: string;
  amount_cents: number | null;
  vat_amount_cents: number;
  currency: string;
  period_start: string | Date | null;
  period_end: string | Date | null;
  description: string | null;
  actor_user_id: string | null;
  created_at: Date;
};

function missingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '42P01';
}

function requireTable(error: unknown): never {
  if (missingTable(error)) {
    throw new AppError(
      503,
      'Seat-increase tables are not on this database. Apply database/demo/007_licence_seat_increases.sql to advisortrack_demo only.',
      'SEAT_INCREASE_SCHEMA_MISSING'
    );
  }
  throw error;
}

function db(client?: PoolClient) {
  return client ?? getPool();
}

export const enterpriseSeatChangeRepository = {
  async insert(
    input: {
      companyId: string;
      contractId?: string | null;
      requestId?: string | null;
      previousPurchasedSeats: number;
      delta: number;
      newPurchasedSeats: number;
      billingTreatment: string;
      commercialReference?: string | null;
      actorUserId: string | null;
    },
    client?: PoolClient
  ): Promise<SeatChangeRow> {
    try {
      const result = await db(client).query<SeatChangeRow>(
        `INSERT INTO enterprise_contract_seat_changes (
           company_id, contract_id, request_id, previous_purchased_seats, delta,
           new_purchased_seats, billing_treatment, commercial_reference, actor_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, company_id, contract_id, request_id, previous_purchased_seats, delta,
                   new_purchased_seats, effective_at, billing_treatment, commercial_reference,
                   actor_user_id, created_at`,
        [
          input.companyId,
          input.contractId ?? null,
          input.requestId ?? null,
          input.previousPurchasedSeats,
          input.delta,
          input.newPurchasedSeats,
          input.billingTreatment,
          input.commercialReference ?? null,
          input.actorUserId,
        ]
      );
      return result.rows[0];
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505') {
        throw new AppError(409, 'This licence request has already been applied', 'ALREADY_APPLIED');
      }
      requireTable(error);
    }
  },

  async listForCompany(companyId: string): Promise<SeatChangeRow[]> {
    try {
      const result = await getPool().query<SeatChangeRow>(
        `SELECT id, company_id, contract_id, request_id, previous_purchased_seats, delta,
                new_purchased_seats, effective_at, billing_treatment, commercial_reference,
                actor_user_id, created_at
         FROM enterprise_contract_seat_changes
         WHERE company_id = $1
         ORDER BY effective_at ASC, created_at ASC`,
        [companyId]
      );
      return result.rows;
    } catch (error) {
      requireTable(error);
    }
  },

  async findByRequestId(requestId: string, client?: PoolClient): Promise<SeatChangeRow | null> {
    try {
      const result = await db(client).query<SeatChangeRow>(
        `SELECT id, company_id, contract_id, request_id, previous_purchased_seats, delta,
                new_purchased_seats, effective_at, billing_treatment, commercial_reference,
                actor_user_id, created_at
         FROM enterprise_contract_seat_changes
         WHERE request_id = $1`,
        [requestId]
      );
      return result.rows[0] ?? null;
    } catch (error) {
      requireTable(error);
    }
  },
};

export const enterpriseBillingAdjustmentRepository = {
  async insert(
    input: {
      companyId: string;
      contractId?: string | null;
      seatChangeId?: string | null;
      requestId?: string | null;
      adjustmentType: string;
      status: string;
      amountCents?: number | null;
      periodStart?: string | null;
      periodEnd?: string | null;
      description?: string | null;
      actorUserId: string | null;
    },
    client?: PoolClient
  ): Promise<BillingAdjustmentRow> {
    try {
      const result = await db(client).query<BillingAdjustmentRow>(
        `INSERT INTO enterprise_billing_adjustments (
           company_id, contract_id, seat_change_id, request_id, adjustment_type, status,
           amount_cents, vat_amount_cents, period_start, period_end, description, actor_user_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11)
         RETURNING id, company_id, contract_id, seat_change_id, request_id, invoice_id,
                   adjustment_type, status, amount_cents, vat_amount_cents, currency,
                   period_start, period_end, description, actor_user_id, created_at`,
        [
          input.companyId,
          input.contractId ?? null,
          input.seatChangeId ?? null,
          input.requestId ?? null,
          input.adjustmentType,
          input.status,
          input.amountCents ?? null,
          input.periodStart ?? null,
          input.periodEnd ?? null,
          input.description ?? null,
          input.actorUserId,
        ]
      );
      return result.rows[0];
    } catch (error) {
      requireTable(error);
    }
  },

  async listPendingForCompany(companyId: string): Promise<BillingAdjustmentRow[]> {
    try {
      const result = await getPool().query<BillingAdjustmentRow>(
        `SELECT id, company_id, contract_id, seat_change_id, request_id, invoice_id,
                adjustment_type, status, amount_cents, vat_amount_cents, currency,
                period_start, period_end, description, actor_user_id, created_at
         FROM enterprise_billing_adjustments
         WHERE company_id = $1
           AND invoice_id IS NULL
           AND status IN ('pending', 'recorded')
           AND amount_cents IS NOT NULL
         ORDER BY created_at ASC`,
        [companyId]
      );
      return result.rows;
    } catch (error) {
      if (missingTable(error)) return [];
      throw error;
    }
  },

  async attachToInvoice(invoiceId: string, adjustmentIds: string[], client?: PoolClient): Promise<number> {
    if (adjustmentIds.length === 0) return 0;
    try {
      const result = await db(client).query(
        `UPDATE enterprise_billing_adjustments
         SET invoice_id = $1, status = 'included'
         WHERE id = ANY($2::uuid[])
           AND invoice_id IS NULL
           AND status IN ('pending', 'recorded')`,
        [invoiceId, adjustmentIds]
      );
      return result.rowCount ?? 0;
    } catch (error) {
      if (missingTable(error)) return 0;
      throw error;
    }
  },

  async listForRequest(requestId: string, client?: PoolClient): Promise<BillingAdjustmentRow[]> {
    try {
      const result = await db(client).query<BillingAdjustmentRow>(
        `SELECT id, company_id, contract_id, seat_change_id, request_id, invoice_id,
                adjustment_type, status, amount_cents, vat_amount_cents, currency,
                period_start, period_end, description, actor_user_id, created_at
         FROM enterprise_billing_adjustments
         WHERE request_id = $1
         ORDER BY created_at ASC`,
        [requestId]
      );
      return result.rows;
    } catch (error) {
      if (missingTable(error)) return [];
      throw error;
    }
  },
};
