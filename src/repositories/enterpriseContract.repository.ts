import { getPool } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export type EnterpriseContractRow = {
  id: string;
  company_id: string | null;
  onboarding_id: string | null;
  commercial_status: string;
  contract_start_date: string | Date | null;
  contract_end_date: string | Date | null;
  auto_renew: boolean;
  committed_licences: number | null;
  billing_model: string;
  billing_frequency: string;
  pricing_basis: string;
  negotiated_unit_price_cents: number | null;
  negotiated_fixed_amount_cents: number | null;
  currency: string;
  vat_applicable: boolean;
  vat_rate_percent: string | number;
  payment_terms_code: string;
  payment_terms_custom: string | null;
  po_reference: string | null;
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_notes: string | null;
  internal_notes: string | null;
  additional_seat_policy: string;
  seat_reduction_policy: string;
  additional_seats_auto_activate: boolean;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

export type EnterpriseContractEventRow = {
  id: string;
  contract_id: string;
  event_type: string;
  changed_fields: Record<string, unknown> | null;
  actor_user_id: string | null;
  note: string | null;
  created_at: Date;
};

const COLS = `
  id, company_id, onboarding_id, commercial_status, contract_start_date, contract_end_date,
  auto_renew, committed_licences, billing_model, billing_frequency, pricing_basis,
  negotiated_unit_price_cents, negotiated_fixed_amount_cents, currency,
  vat_applicable, vat_rate_percent, payment_terms_code, payment_terms_custom,
  po_reference, billing_contact_name, billing_email, billing_notes, internal_notes,
  additional_seat_policy, seat_reduction_policy, additional_seats_auto_activate,
  created_by_user_id, created_at, updated_at
`;

function missingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '42P01';
}

function requireTable(error: unknown): never {
  if (missingTable(error)) {
    throw new AppError(
      503,
      'Enterprise contract tables are not on this database. Apply database/demo/005_enterprise_contracts.sql to advisortrack_demo only.',
      'CONTRACT_SCHEMA_MISSING'
    );
  }
  throw error;
}

const PATCH_MAP: Record<string, string> = {
  companyId: 'company_id',
  onboardingId: 'onboarding_id',
  commercialStatus: 'commercial_status',
  contractStartDate: 'contract_start_date',
  contractEndDate: 'contract_end_date',
  autoRenew: 'auto_renew',
  committedLicences: 'committed_licences',
  billingModel: 'billing_model',
  billingFrequency: 'billing_frequency',
  pricingBasis: 'pricing_basis',
  negotiatedUnitPriceCents: 'negotiated_unit_price_cents',
  negotiatedFixedAmountCents: 'negotiated_fixed_amount_cents',
  currency: 'currency',
  vatApplicable: 'vat_applicable',
  vatRatePercent: 'vat_rate_percent',
  paymentTermsCode: 'payment_terms_code',
  paymentTermsCustom: 'payment_terms_custom',
  poReference: 'po_reference',
  billingContactName: 'billing_contact_name',
  billingEmail: 'billing_email',
  billingNotes: 'billing_notes',
  internalNotes: 'internal_notes',
  additionalSeatPolicy: 'additional_seat_policy',
  seatReductionPolicy: 'seat_reduction_policy',
  additionalSeatsAutoActivate: 'additional_seats_auto_activate',
};

export const enterpriseContractRepository = {
  async findById(id: string): Promise<EnterpriseContractRow | null> {
    try {
      const result = await getPool().query<EnterpriseContractRow>(
        `SELECT ${COLS} FROM enterprise_contracts WHERE id = $1`,
        [id]
      );
      return result.rows[0] ?? null;
    } catch (error) {
      requireTable(error);
    }
  },

  async findByCompanyId(companyId: string): Promise<EnterpriseContractRow | null> {
    try {
      const result = await getPool().query<EnterpriseContractRow>(
        `SELECT ${COLS} FROM enterprise_contracts WHERE company_id = $1 LIMIT 1`,
        [companyId]
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (missingTable(error)) return null;
      throw error;
    }
  },

  async findByOnboardingId(onboardingId: string): Promise<EnterpriseContractRow | null> {
    try {
      const result = await getPool().query<EnterpriseContractRow>(
        `SELECT ${COLS} FROM enterprise_contracts WHERE onboarding_id = $1 LIMIT 1`,
        [onboardingId]
      );
      return result.rows[0] ?? null;
    } catch (error) {
      if (missingTable(error)) return null;
      throw error;
    }
  },

  async insert(input: {
    createdByUserId: string;
    companyId?: string | null;
    onboardingId?: string | null;
    commercialStatus?: string;
    billingModel?: string;
    billingFrequency?: string;
    pricingBasis?: string;
  }): Promise<EnterpriseContractRow> {
    try {
      const result = await getPool().query<EnterpriseContractRow>(
        `INSERT INTO enterprise_contracts (
           created_by_user_id, company_id, onboarding_id, commercial_status,
           billing_model, billing_frequency, pricing_basis, vat_applicable, vat_rate_percent
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, 0)
         RETURNING ${COLS}`,
        [
          input.createdByUserId,
          input.companyId ?? null,
          input.onboardingId ?? null,
          input.commercialStatus ?? 'lead',
          input.billingModel ?? 'monthly',
          input.billingFrequency ?? 'monthly',
          input.pricingBasis ?? 'per_seat',
        ]
      );
      return result.rows[0];
    } catch (error) {
      requireTable(error);
    }
  },

  async update(id: string, patch: Record<string, unknown>): Promise<EnterpriseContractRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    let i = 2;
    for (const [key, column] of Object.entries(PATCH_MAP)) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (sets.length === 0) return this.findById(id);
    sets.push('updated_at = NOW()');
    try {
      const result = await getPool().query<EnterpriseContractRow>(
        `UPDATE enterprise_contracts SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
        values
      );
      return result.rows[0] ?? null;
    } catch (error) {
      requireTable(error);
    }
  },

  async appendEvent(input: {
    contractId: string;
    eventType: string;
    changedFields: Record<string, unknown>;
    actorUserId: string | null;
    note?: string | null;
  }): Promise<EnterpriseContractEventRow> {
    try {
      const result = await getPool().query<EnterpriseContractEventRow>(
        `INSERT INTO enterprise_contract_events (contract_id, event_type, changed_fields, actor_user_id, note)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING id, contract_id, event_type, changed_fields, actor_user_id, note, created_at`,
        [
          input.contractId,
          input.eventType,
          JSON.stringify(input.changedFields ?? {}),
          input.actorUserId,
          input.note ?? null,
        ]
      );
      return result.rows[0];
    } catch (error) {
      requireTable(error);
    }
  },

  async listEvents(contractId: string): Promise<EnterpriseContractEventRow[]> {
    try {
      const result = await getPool().query<EnterpriseContractEventRow>(
        `SELECT id, contract_id, event_type, changed_fields, actor_user_id, note, created_at
         FROM enterprise_contract_events
         WHERE contract_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [contractId]
      );
      return result.rows;
    } catch (error) {
      requireTable(error);
    }
  },
};
