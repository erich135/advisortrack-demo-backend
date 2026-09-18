import { AppError } from '../middleware/errorHandler';
import { getPool } from '../config/database';
import {
  ENTERPRISE_PLAN_NAME,
  toCustomerSubscriptionSummary,
  type CustomerSubscriptionSummary,
  type EnterpriseContractRecord,
} from '../features/enterpriseContract';
import {
  NORTHSTAR_COMMITTED_LICENCES,
  NORTHSTAR_COMPANY_NAME,
  NORTHSTAR_CONTRACT_END,
  NORTHSTAR_CONTRACT_START,
  NORTHSTAR_SEAT_LIMIT,
  NORTHSTAR_UNIT_PRICE_CENTS,
} from '../features/demoNorthstar';
import { organisationService } from './organisation.service';

function missingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '42P01';
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return null;
}

function northstarRecord(company: { id: string; name: string }): EnterpriseContractRecord {
  return {
    id: `northstar-contract-${company.id}`,
    companyId: company.id,
    onboardingId: null,
    commercialStatus: 'active',
    contractStartDate: NORTHSTAR_CONTRACT_START,
    contractEndDate: NORTHSTAR_CONTRACT_END,
    autoRenew: true,
    committedLicences: NORTHSTAR_COMMITTED_LICENCES,
    billingModel: 'annual',
    billingFrequency: 'annual',
    pricingBasis: 'per_seat',
    negotiatedUnitPriceCents: NORTHSTAR_UNIT_PRICE_CENTS,
    negotiatedFixedAmountCents: null,
    currency: 'ZAR',
    vatApplicable: false,
    vatRatePercent: '0.00',
    paymentTermsCode: 'days_30',
    paymentTermsCustom: null,
    poReference: 'NS-ENT-2026',
    billingContactName: 'Northstar Finance',
    billingEmail: 'finance@northstar.demo.invalid',
    billingNotes: 'AdvisorTrack Enterprise annual agreement for Northstar Advisory.',
    internalNotes: 'Demo internal commercial notes. Never return on customer APIs.',
    additionalSeatPolicy: 'next_invoice',
    seatReductionPolicy: 'renewal_only',
    additionalSeatsAutoActivate: false,
    createdByUserId: 'northstar',
    createdAt: `${NORTHSTAR_CONTRACT_START}T00:00:00.000Z`,
    updatedAt: `${NORTHSTAR_CONTRACT_START}T00:00:00.000Z`,
  };
}

async function loadStored(companyId: string): Promise<EnterpriseContractRecord | null> {
  try {
    const result = await getPool().query(
      `SELECT id, company_id, onboarding_id, commercial_status, contract_start_date, contract_end_date,
              auto_renew, committed_licences, billing_model, billing_frequency, pricing_basis,
              negotiated_unit_price_cents, negotiated_fixed_amount_cents, currency,
              vat_applicable, vat_rate_percent, payment_terms_code, payment_terms_custom,
              po_reference, billing_contact_name, billing_email, billing_notes, internal_notes,
              additional_seat_policy, seat_reduction_policy, additional_seats_auto_activate,
              created_by_user_id, created_at, updated_at
         FROM enterprise_contracts WHERE company_id = $1 LIMIT 1`,
      [companyId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.company_id,
      onboardingId: row.onboarding_id,
      commercialStatus: row.commercial_status,
      contractStartDate: dateOnly(row.contract_start_date),
      contractEndDate: dateOnly(row.contract_end_date),
      autoRenew: Boolean(row.auto_renew),
      committedLicences: row.committed_licences,
      billingModel: row.billing_model,
      billingFrequency: row.billing_frequency,
      pricingBasis: row.pricing_basis,
      negotiatedUnitPriceCents: row.negotiated_unit_price_cents,
      negotiatedFixedAmountCents: row.negotiated_fixed_amount_cents,
      currency: row.currency || 'ZAR',
      vatApplicable: false,
      vatRatePercent: String(row.vat_rate_percent ?? '0'),
      paymentTermsCode: row.payment_terms_code,
      paymentTermsCustom: row.payment_terms_custom,
      poReference: row.po_reference,
      billingContactName: row.billing_contact_name,
      billingEmail: row.billing_email,
      billingNotes: row.billing_notes,
      internalNotes: row.internal_notes,
      additionalSeatPolicy: row.additional_seat_policy,
      seatReductionPolicy: row.seat_reduction_policy,
      additionalSeatsAutoActivate: Boolean(row.additional_seats_auto_activate),
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

export const enterpriseContractService = {
  async getCustomerSummary(userId: string): Promise<CustomerSubscriptionSummary> {
    const org = await organisationService.getMyOrganisation(userId);
    const rank = org.hierarchy?.rank;
    if (org.isPlatformAdmin) {
      // Session-scoped only. Staff still cannot pick another companyId from this route.
    } else if (!org.isOrganisationAdmin && rank !== 'executive') {
      throw new AppError(403, 'Organisation Administrator access is required', 'FORBIDDEN');
    }
    const stored = await loadStored(org.company.id);
    const contract = stored ?? northstarRecord({ id: org.company.id, name: org.company.name || NORTHSTAR_COMPANY_NAME });
    const summary = toCustomerSubscriptionSummary({
      company: { id: org.company.id, name: org.company.name || NORTHSTAR_COMPANY_NAME },
      contract,
      currentPurchasedLicences: org.company.seatLimit ?? NORTHSTAR_SEAT_LIMIT,
    });
    if ('internalNotes' in summary) {
      throw new AppError(500, 'Internal notes must not appear on customer summaries', 'INTERNAL_LEAK');
    }
    return { ...summary, planName: ENTERPRISE_PLAN_NAME };
  },

  async getByCompany(companyId: string): Promise<EnterpriseContractRecord> {
    const stored = await loadStored(companyId);
    if (stored) return stored;
    return northstarRecord({ id: companyId, name: NORTHSTAR_COMPANY_NAME });
  },
};
