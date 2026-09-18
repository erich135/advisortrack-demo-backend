/**
 * Draft invoice helpers for negotiated enterprise contracts.
 * Prefill is a starting snapshot only. Later contract edits must not rewrite invoices.
 */

import {
  BILLING_FREQUENCY_LABELS,
  ENTERPRISE_PLAN_NAME,
  paymentTermsDueDays,
  paymentTermsLabel,
  type EnterpriseContractRecord,
} from './enterpriseContract';
import { addCalendarDays, johannesburgToday } from './invoiceLifecycle';

export type DraftPrefillLine = {
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
};

export type InvoiceContractPrefill = {
  companyId: string;
  companyName: string;
  planName: string;
  invoiceDate: string;
  dueDate: string;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  poReference: string | null;
  customerReference: string | null;
  paymentTerms: string;
  notes: string | null;
  billingContactName: string | null;
  billingEmail: string | null;
  sourceContractId: string;
  pricingBasis: string;
  billingFrequency: string;
  lines: DraftPrefillLine[];
  pendingAdjustmentIds: string[];
  editableSnapshot: true;
};

export function formatBillingPeriod(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  return `${start ?? 'Open'} – ${end ?? 'Open'}`;
}

export function prefillFromEnterpriseContract(input: {
  company: { id: string; name: string };
  contract: EnterpriseContractRecord;
  pendingAdjustments?: Array<{ id: string; description: string; amountCents: number }>;
}): InvoiceContractPrefill {
  const { company, contract } = input;
  const invoiceDate = contract.contractStartDate || johannesburgToday();
  const dueDays = paymentTermsDueDays(contract.paymentTermsCode) ?? 30;
  const dueDate = addCalendarDays(invoiceDate, dueDays);
  const period = formatBillingPeriod(contract.contractStartDate, contract.contractEndDate);
  const frequency = BILLING_FREQUENCY_LABELS[contract.billingFrequency];
  const lines = [
    ...prefillLines(contract, frequency),
    ...(input.pendingAdjustments ?? []).map((adjustment) => ({
      description: adjustment.description,
      quantity: 1,
      unitPriceCents: adjustment.amountCents,
      discountCents: 0,
    })),
  ];

  return {
    companyId: company.id,
    companyName: company.name,
    planName: ENTERPRISE_PLAN_NAME,
    invoiceDate,
    dueDate,
    billingPeriodStart: contract.contractStartDate,
    billingPeriodEnd: contract.contractEndDate,
    poReference: contract.poReference,
    customerReference: contract.poReference,
    paymentTerms: period
      ? `Billing period: ${period}. ${paymentTermsLabel(contract.paymentTermsCode, contract.paymentTermsCustom)}.`
      : paymentTermsLabel(contract.paymentTermsCode, contract.paymentTermsCustom),
    notes: contract.billingNotes,
    billingContactName: contract.billingContactName,
    billingEmail: contract.billingEmail,
    sourceContractId: contract.id,
    pricingBasis: contract.pricingBasis,
    billingFrequency: contract.billingFrequency,
    lines,
    pendingAdjustmentIds: (input.pendingAdjustments ?? []).map((row) => row.id),
    editableSnapshot: true,
  };
}

function prefillLines(contract: EnterpriseContractRecord, frequency: string): DraftPrefillLine[] {
  if (contract.pricingBasis === 'per_seat') {
    const seats = contract.committedLicences ?? 1;
    const unit = contract.negotiatedUnitPriceCents ?? 0;
    return [
      {
        description: `${seats.toLocaleString('en-ZA')} ${ENTERPRISE_PLAN_NAME} licences (${frequency})`,
        quantity: seats,
        unitPriceCents: unit,
        discountCents: 0,
      },
    ];
  }
  if (contract.pricingBasis === 'fixed_amount') {
    return [
      {
        description: `${ENTERPRISE_PLAN_NAME} ${frequency} subscription`,
        quantity: 1,
        unitPriceCents: contract.negotiatedFixedAmountCents ?? 0,
        discountCents: 0,
      },
    ];
  }
  return [
    {
      description: contract.billingNotes?.trim()
        ? `${ENTERPRISE_PLAN_NAME} — custom terms`
        : `${ENTERPRISE_PLAN_NAME} custom contract — enter amount`,
      quantity: 1,
      unitPriceCents: 0,
      discountCents: 0,
    },
  ];
}
