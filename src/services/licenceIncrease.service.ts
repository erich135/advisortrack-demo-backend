import { getPool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import {
  ADDITIONAL_SEAT_POLICY_LABELS,
  type AdditionalSeatPolicy,
  type EnterpriseContractRecord,
} from '../features/enterpriseContract';
import { toLicencePool } from '../features/licencePool';
import {
  customerBillingTreatment,
  decideSeatIncreaseBilling,
  isUuid,
  normalizeLicenceIncreaseStatus,
  type SeatBillingDecision,
} from '../features/seatIncrease';
import { sellerChargesVat } from '../features/advisortrackVat';
import { enterpriseContractRepository } from '../repositories/enterpriseContract.repository';
import {
  enterpriseBillingAdjustmentRepository,
  enterpriseSeatChangeRepository,
} from '../repositories/enterpriseSeatChange.repository';
import { licenceIncreaseRequestRepository } from '../repositories/licenceIncreaseRequest.repository';
import { organisationRepository } from '../repositories/organisation.repository';
import {
  NORTHSTAR_COMMITTED_LICENCES,
  NORTHSTAR_CONTRACT_END,
  NORTHSTAR_CONTRACT_START,
  NORTHSTAR_UNIT_PRICE_CENTS,
} from '../features/demoNorthstar';

const UNLIMITED_POOL_MESSAGE = 'Unlimited licence pools cannot request a numeric seat increase.';

function northstarContractFallback(companyId: string): EnterpriseContractRecord {
  return {
    id: `northstar-contract-${companyId}`,
    companyId,
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

async function loadContract(companyId: string): Promise<EnterpriseContractRecord | null> {
  const row = await enterpriseContractRepository.findByCompanyId(companyId);
  if (!row) return northstarContractFallback(companyId);
  return {
    id: row.id,
    companyId: row.company_id,
    onboardingId: row.onboarding_id,
    commercialStatus: row.commercial_status as EnterpriseContractRecord['commercialStatus'],
    contractStartDate: row.contract_start_date ? String(row.contract_start_date).slice(0, 10) : null,
    contractEndDate: row.contract_end_date ? String(row.contract_end_date).slice(0, 10) : null,
    autoRenew: Boolean(row.auto_renew),
    committedLicences: row.committed_licences,
    billingModel: row.billing_model as EnterpriseContractRecord['billingModel'],
    billingFrequency: row.billing_frequency as EnterpriseContractRecord['billingFrequency'],
    pricingBasis: row.pricing_basis as EnterpriseContractRecord['pricingBasis'],
    negotiatedUnitPriceCents: row.negotiated_unit_price_cents,
    negotiatedFixedAmountCents: row.negotiated_fixed_amount_cents,
    currency: row.currency || 'ZAR',
    vatApplicable: false,
    vatRatePercent: String(row.vat_rate_percent ?? '0'),
    paymentTermsCode: row.payment_terms_code as EnterpriseContractRecord['paymentTermsCode'],
    paymentTermsCustom: row.payment_terms_custom,
    poReference: row.po_reference,
    billingContactName: row.billing_contact_name,
    billingEmail: row.billing_email,
    billingNotes: row.billing_notes,
    internalNotes: row.internal_notes,
    additionalSeatPolicy: row.additional_seat_policy as AdditionalSeatPolicy,
    seatReductionPolicy: row.seat_reduction_policy as EnterpriseContractRecord['seatReductionPolicy'],
    additionalSeatsAutoActivate: Boolean(
      (row as { additional_seats_auto_activate?: boolean }).additional_seats_auto_activate
    ),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function contractIdForFk(contract: EnterpriseContractRecord | null): string | null {
  return contract && isUuid(contract.id) ? contract.id : null;
}

function customerRequestDto(
  row: {
    id: string;
    company_id: string;
    current_purchased: number | null;
    additional_requested: number;
    proposed_total: number | null;
    status: string;
    notes: string | null;
    billing_treatment: string | null;
    created_at: Date;
    applied_at?: Date | null;
    reviewed_at?: Date | null;
  },
  extras?: { seatLimitUnchanged?: boolean; autoApplied?: boolean }
) {
  const status = normalizeLicenceIncreaseStatus(row.status);
  const treatment = (row.billing_treatment as AdditionalSeatPolicy | null) ?? null;
  return {
    id: row.id,
    companyId: row.company_id,
    currentPurchased: row.current_purchased,
    additionalRequested: row.additional_requested,
    proposedTotal: row.proposed_total,
    status,
    statusLabel: status.charAt(0).toUpperCase() + status.slice(1),
    notes: row.notes,
    billingTreatment: treatment,
    billingTreatmentLabel: treatment ? ADDITIONAL_SEAT_POLICY_LABELS[treatment] : null,
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? null,
    reviewedAt: row.reviewed_at ?? null,
    seatLimitUnchanged: extras?.seatLimitUnchanged ?? status !== 'applied',
    autoApplied: extras?.autoApplied ?? false,
    vatCharged: false as const,
  };
}

function staffRequestDto(
  row: Awaited<ReturnType<typeof licenceIncreaseRequestRepository.findById>>,
  extras?: {
    assigned?: number;
    available?: number | null;
    ledger?: unknown;
    adjustment?: unknown;
    alreadyApplied?: boolean;
    conflict?: { current: number | null; expected: number | null; proposed: number | null };
  }
) {
  if (!row) {
    throw new AppError(404, 'Licence request not found', 'NOT_FOUND');
  }
  const status = normalizeLicenceIncreaseStatus(row.status);
  const treatment = (row.billing_treatment as AdditionalSeatPolicy | null) ?? null;
  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name ?? null,
    contractId: row.contract_id,
    currentPurchased: row.current_purchased,
    additionalRequested: row.additional_requested,
    proposedTotal: row.proposed_total,
    status,
    statusLabel: status.charAt(0).toUpperCase() + status.slice(1),
    billingTreatment: treatment,
    billingTreatmentLabel: treatment ? ADDITIONAL_SEAT_POLICY_LABELS[treatment] : null,
    requestedByUserId: row.requested_by_user_id,
    requestedByName: row.requested_by_name || row.requested_by_email || null,
    requestedAt: row.created_at,
    notes: row.notes,
    decision: row.decision,
    decisionNotes: row.decision_notes,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at,
    appliedAt: row.applied_at,
    billingAmountCents: row.billing_amount_cents,
    vatAmountCents: 0,
    vatCharged: false,
    assigned: extras?.assigned,
    available: extras?.available,
    ledger: extras?.ledger ?? null,
    adjustment: extras?.adjustment ?? null,
    alreadyApplied: extras?.alreadyApplied ?? status === 'applied',
    conflict: extras?.conflict ?? null,
  };
}

async function poolFor(companyId: string, purchased: number | null) {
  const assigned = await organisationRepository.countLicensedSeats(companyId);
  return toLicencePool(purchased, assigned);
}

export const licenceIncreaseService = {
  async contextForCompany(companyId: string) {
    const company = await organisationRepository.findCompanyById(companyId);
    if (!company) throw new AppError(404, 'Company not found', 'NOT_FOUND');
    const assigned = await organisationRepository.countLicensedSeats(companyId);
    const pool = toLicencePool(company.seat_limit, assigned);
    const contract = await loadContract(companyId);
    const treatment = customerBillingTreatment(contract);
    const requests = await licenceIncreaseRequestRepository.listForCompany(companyId);
    return {
      purchased: pool.purchased,
      assigned: pool.assigned,
      available: pool.available,
      additionalSeatPolicy: treatment.additionalSeatPolicy,
      additionalSeatPolicyLabel: treatment.additionalSeatPolicyLabel,
      requests: requests.map((row) => customerRequestDto(row)),
    };
  },

  async submitForCompany(input: {
    companyId: string;
    userId: string;
    additional: number;
    notes?: string | null;
  }) {
    if (!Number.isInteger(input.additional) || input.additional < 1) {
      throw new AppError(400, 'additional must be a positive whole number', 'VALIDATION_ERROR');
    }
    const company = await organisationRepository.findCompanyById(input.companyId);
    if (!company) throw new AppError(404, 'Company not found', 'NOT_FOUND');
    if (company.seat_limit == null) {
      throw new AppError(400, UNLIMITED_POOL_MESSAGE, 'UNLIMITED_POOL');
    }
    const assigned = await organisationRepository.countLicensedSeats(input.companyId);
    const pool = toLicencePool(company.seat_limit, assigned);
    const proposedTotal = company.seat_limit + input.additional;
    const contract = await loadContract(input.companyId);
    const decision = decideSeatIncreaseBilling({
      contract,
      additionalSeats: input.additional,
    });
    const row = await licenceIncreaseRequestRepository.insert({
      companyId: input.companyId,
      contractId: contractIdForFk(contract),
      requestedByUserId: input.userId,
      currentPurchased: company.seat_limit,
      additionalRequested: input.additional,
      proposedTotal,
      billingTreatment: decision.billingTreatment,
      notes: input.notes ?? null,
    });

    const autoActivate = Boolean(contract?.additionalSeatsAutoActivate) && !decision.requiresManualReview;
    if (autoActivate) {
      const applied = await this.apply(input.userId, row.id, { autoActivate: true });
      return {
        ...customerRequestDto(row, { seatLimitUnchanged: false, autoApplied: true }),
        status: 'applied',
        statusLabel: 'Applied',
        appliedAt: applied.appliedAt,
        seatLimitUnchanged: false,
        autoApplied: true,
        contractTerms: {
          billingModel: contract?.billingModel ?? null,
          additionalSeatPolicy: decision.billingTreatment,
          handledAccordingToContract: true,
        },
      };
    }

    return {
      ...customerRequestDto(row, { seatLimitUnchanged: true }),
      contractTerms: {
        billingModel: contract?.billingModel ?? null,
        additionalSeatPolicy: decision.billingTreatment,
        handledAccordingToContract: true,
      },
      purchased: pool.purchased,
      assigned: pool.assigned,
      available: pool.available,
    };
  },

  async cancelForCompany(userId: string, companyId: string, requestId: string) {
    const row = await licenceIncreaseRequestRepository.findById(requestId);
    if (!row || row.company_id !== companyId) {
      throw new AppError(404, 'Licence request not found', 'NOT_FOUND');
    }
    const cancelled = await licenceIncreaseRequestRepository.markCancelled({ id: requestId, actorUserId: userId });
    if (!cancelled) {
      throw new AppError(409, 'Only pending requests can be cancelled', 'REQUEST_NOT_CANCELLABLE');
    }
    return customerRequestDto(cancelled);
  },

  async listStaff() {
    const rows = await licenceIncreaseRequestRepository.listAll();
    return { requests: rows.map((row) => staffRequestDto(row)) };
  },

  async getStaff(requestId: string) {
    const row = await licenceIncreaseRequestRepository.findById(requestId);
    if (!row) throw new AppError(404, 'Licence request not found', 'NOT_FOUND');
    const pool = await poolFor(row.company_id, row.current_purchased);
    const ledger = await enterpriseSeatChangeRepository.findByRequestId(requestId);
    const adjustments = await enterpriseBillingAdjustmentRepository.listForRequest(requestId);
    return staffRequestDto(row, {
      assigned: pool.assigned,
      available: pool.purchased == null ? null : Math.max(0, (row.proposed_total ?? 0) - pool.assigned),
      ledger,
      adjustment: adjustments[0] ?? null,
    });
  },

  async reject(actorUserId: string, requestId: string, notes?: string | null) {
    const existing = await licenceIncreaseRequestRepository.findById(requestId);
    if (!existing) throw new AppError(404, 'Licence request not found', 'NOT_FOUND');
    if (normalizeLicenceIncreaseStatus(existing.status) === 'applied') {
      throw new AppError(409, 'An applied request cannot be rejected', 'ALREADY_APPLIED');
    }
    const rejected = await licenceIncreaseRequestRepository.markRejected({
      id: requestId,
      actorUserId,
      notes,
    });
    if (!rejected) {
      throw new AppError(409, 'Only pending requests can be rejected', 'REQUEST_NOT_REJECTABLE');
    }
    return this.getStaff(requestId);
  },

  async approve(
    actorUserId: string,
    requestId: string,
    input?: { notes?: string | null; amountCents?: number | null }
  ) {
    return this.apply(actorUserId, requestId, {
      decisionNotes: input?.notes ?? null,
      amountCentsOverride: input?.amountCents,
    });
  },

  async apply(
    actorUserId: string,
    requestId: string,
    options?: {
      autoActivate?: boolean;
      decisionNotes?: string | null;
      amountCentsOverride?: number | null;
    }
  ) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const request = await licenceIncreaseRequestRepository.lockById(requestId, client);
      if (!request) {
        await client.query('ROLLBACK');
        throw new AppError(404, 'Licence request not found', 'NOT_FOUND');
      }
      const status = normalizeLicenceIncreaseStatus(request.status);
      if (status === 'applied') {
        await client.query('ROLLBACK');
        const current = await licenceIncreaseRequestRepository.findById(requestId);
        const ledger = await enterpriseSeatChangeRepository.findByRequestId(requestId);
        const adjustments = await enterpriseBillingAdjustmentRepository.listForRequest(requestId);
        return staffRequestDto(current, { alreadyApplied: true, ledger, adjustment: adjustments[0] ?? null });
      }
      if (status === 'rejected' || status === 'cancelled') {
        await client.query('ROLLBACK');
        throw new AppError(409, 'This licence request cannot be applied', 'REQUEST_NOT_APPLIABLE');
      }

      const company = await client.query<{ seat_limit: number | null; name: string }>(
        `SELECT seat_limit, name FROM companies WHERE id = $1 FOR UPDATE`,
        [request.company_id]
      );
      if (!company.rows[0]) {
        await client.query('ROLLBACK');
        throw new AppError(404, 'Company not found', 'NOT_FOUND');
      }
      const currentPurchased = company.rows[0].seat_limit;
      const expected = request.expected_previous_purchased ?? request.current_purchased;
      if (currentPurchased == null || expected == null || currentPurchased !== expected) {
        await client.query('ROLLBACK');
        throw new AppError(
          409,
          'The purchased licence pool has changed since this request was submitted. Recalculate before applying.',
          'SEAT_POOL_CONFLICT',
          {
            current: currentPurchased,
            expected,
            requestedIncrease: request.additional_requested,
            staleProposedTotal: request.proposed_total,
          }
        );
      }

      const usedResult = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM users u
         INNER JOIN user_subscriptions us ON us.user_id = u.id
         INNER JOIN subscription_packages p ON p.id = us.package_id
         WHERE u.company_id = $1
           AND us.status IN ('active', 'trialing')
           AND p.slug <> 'free'`,
        [request.company_id]
      );
      const assigned = Number(usedResult.rows[0]?.count ?? 0);
      const nextPurchased = expected + request.additional_requested;

      await client.query(`UPDATE companies SET seat_limit = $2, updated_at = NOW() WHERE id = $1`, [
        request.company_id,
        nextPurchased,
      ]);

      const contract = await loadContract(request.company_id);
      let billing: SeatBillingDecision = decideSeatIncreaseBilling({
        contract,
        additionalSeats: request.additional_requested,
      });
      if (options?.amountCentsOverride != null) {
        if (!Number.isInteger(options.amountCentsOverride) || options.amountCentsOverride < 0) {
          await client.query('ROLLBACK');
          throw new AppError(400, 'amountCents must be a non-negative integer', 'VALIDATION_ERROR');
        }
        billing = {
          ...billing,
          amountCents: options.amountCentsOverride,
          requiresManualReview: false,
        };
      }

      const applied = await licenceIncreaseRequestRepository.markApplied(
        {
          id: requestId,
          actorUserId,
          billingTreatment: billing.billingTreatment,
          billingAmountCents: billing.amountCents,
          decisionNotes: options?.decisionNotes ?? null,
        },
        client
      );

      const ledger = await enterpriseSeatChangeRepository.insert(
        {
          companyId: request.company_id,
          contractId: contractIdForFk(contract) ?? request.contract_id,
          requestId,
          previousPurchasedSeats: expected,
          delta: request.additional_requested,
          newPurchasedSeats: nextPurchased,
          billingTreatment: billing.billingTreatment,
          commercialReference: contract?.poReference ?? `seat-increase:${requestId}`,
          actorUserId,
        },
        client
      );

      const adjustmentStatus =
        billing.billingTreatment === 'quarterly_true_up' || billing.billingTreatment === 'annual_true_up'
          ? 'recorded'
          : billing.requiresManualReview && billing.amountCents == null
            ? 'pending'
            : 'pending';

      const adjustment = await enterpriseBillingAdjustmentRepository.insert(
        {
          companyId: request.company_id,
          contractId: contractIdForFk(contract) ?? request.contract_id,
          seatChangeId: ledger.id,
          requestId,
          adjustmentType: billing.billingTreatment,
          status: adjustmentStatus,
          amountCents: billing.requiresManualReview && options?.amountCentsOverride == null ? null : billing.amountCents,
          periodStart: billing.periodStart,
          periodEnd: billing.periodEnd,
          description: billing.description,
          actorUserId,
        },
        client
      );

      if (sellerChargesVat() === false && adjustment.vat_amount_cents !== 0) {
        await client.query('ROLLBACK');
        throw new AppError(500, 'VAT must remain zero on seat-increase adjustments', 'VAT_LOCK');
      }

      await client.query(
        `INSERT INTO popia_audit_log (user_id, action, resource_type, resource_count, metadata)
         VALUES ($1, 'purchased_licences_changed', 'subscription', $2, $3::jsonb)`,
        [
          actorUserId,
          request.additional_requested,
          JSON.stringify({
            companyId: request.company_id,
            previousQuantity: expected,
            newQuantity: nextPurchased,
            difference: request.additional_requested,
            requestId,
            billingTreatment: billing.billingTreatment,
            assignedUnchanged: assigned,
          }),
        ]
      );

      if (contractIdForFk(contract)) {
        await client.query(
          `INSERT INTO enterprise_contract_events (contract_id, event_type, changed_fields, actor_user_id, note)
           VALUES ($1, 'seat_increase_applied', $2::jsonb, $3, $4)`,
          [
            contract!.id,
            JSON.stringify({
              previousPurchasedSeats: { from: expected, to: nextPurchased },
              delta: { from: 0, to: request.additional_requested },
            }),
            actorUserId,
            billing.description,
          ]
        );
      }

      await client.query('COMMIT');
      return staffRequestDto(applied, {
        alreadyApplied: false,
        assigned,
        available: Math.max(0, nextPurchased - assigned),
        ledger,
        adjustment: { ...adjustment, vatAmountCents: 0 },
      });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505') {
        throw new AppError(409, 'This licence request has already been applied', 'ALREADY_APPLIED');
      }
      throw error;
    } finally {
      client.release();
    }
  },
};
