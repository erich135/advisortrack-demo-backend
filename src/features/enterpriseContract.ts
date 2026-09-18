/**
 * Enterprise commercial contract model.
 * Separate from reporting hierarchy, Organisation Admin, licence assignment,
 * mobile entitlement, and invoice lifecycle / payment status.
 */

import {
  ADVISORTRACK_VAT_REGISTERED,
  customerInvoiceVatLabel,
  sellerChargesVat,
} from './advisortrackVat';

export const CONTRACT_COMMERCIAL_STATUSES = [
  'lead',
  'onboarding',
  'active',
  'suspended',
  'cancelled',
  'expired',
] as const;
export type ContractCommercialStatus = (typeof CONTRACT_COMMERCIAL_STATUSES)[number];

export const BILLING_MODELS = ['monthly', 'annual', 'custom'] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

export const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'custom'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const PRICING_BASES = ['per_seat', 'fixed_amount', 'custom'] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];

export const PAYMENT_TERMS_CODES = ['due_on_receipt', 'days_7', 'days_15', 'days_30', 'custom'] as const;
export type PaymentTermsCode = (typeof PAYMENT_TERMS_CODES)[number];

export const ADDITIONAL_SEAT_POLICIES = [
  'immediate_proration',
  'next_invoice',
  'quarterly_true_up',
  'annual_true_up',
  'manual_review',
] as const;
export type AdditionalSeatPolicy = (typeof ADDITIONAL_SEAT_POLICIES)[number];

export const SEAT_REDUCTION_POLICIES = [
  'immediate',
  'next_billing_cycle',
  'renewal_only',
  'manual_review',
] as const;
export type SeatReductionPolicy = (typeof SEAT_REDUCTION_POLICIES)[number];

export const DEFAULT_CURRENCY = 'ZAR';
export const ENTERPRISE_PLAN_NAME = 'AdvisorTrack Enterprise';

export const PAYMENT_TERMS_LABELS: Record<PaymentTermsCode, string> = {
  due_on_receipt: 'Due on receipt',
  days_7: '7 days',
  days_15: '15 days',
  days_30: '30 days',
  custom: 'Custom',
};

export const BILLING_FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
  custom: 'Custom',
};

export const PRICING_BASIS_LABELS: Record<PricingBasis, string> = {
  per_seat: 'Per Seat',
  fixed_amount: 'Fixed Amount',
  custom: 'Custom',
};

export const ADDITIONAL_SEAT_POLICY_LABELS: Record<AdditionalSeatPolicy, string> = {
  immediate_proration: 'Immediate proration',
  next_invoice: 'Next invoice',
  quarterly_true_up: 'Quarterly true-up',
  annual_true_up: 'Annual true-up',
  manual_review: 'Manual review',
};

export const SEAT_REDUCTION_POLICY_LABELS: Record<SeatReductionPolicy, string> = {
  immediate: 'Immediate',
  next_billing_cycle: 'Next billing cycle',
  renewal_only: 'Renewal only',
  manual_review: 'Manual review',
};

export const CONTRACT_HISTORY_FIELDS = [
  'commercialStatus',
  'contractStartDate',
  'contractEndDate',
  'autoRenew',
  'committedLicences',
  'billingModel',
  'billingFrequency',
  'pricingBasis',
  'negotiatedUnitPriceCents',
  'negotiatedFixedAmountCents',
  'currency',
  'vatApplicable',
  'vatRatePercent',
  'paymentTermsCode',
  'paymentTermsCustom',
  'poReference',
  'billingContactName',
  'billingEmail',
  'billingNotes',
  'internalNotes',
  'additionalSeatPolicy',
  'seatReductionPolicy',
  'additionalSeatsAutoActivate',
] as const;

export type ContractHistoryField = (typeof CONTRACT_HISTORY_FIELDS)[number];

export type EnterpriseContractRecord = {
  id: string;
  companyId: string | null;
  onboardingId: string | null;
  commercialStatus: ContractCommercialStatus;
  contractStartDate: string | null;
  contractEndDate: string | null;
  autoRenew: boolean;
  committedLicences: number | null;
  billingModel: BillingModel;
  billingFrequency: BillingFrequency;
  pricingBasis: PricingBasis;
  negotiatedUnitPriceCents: number | null;
  negotiatedFixedAmountCents: number | null;
  currency: string;
  vatApplicable: boolean;
  vatRatePercent: string;
  paymentTermsCode: PaymentTermsCode;
  paymentTermsCustom: string | null;
  poReference: string | null;
  billingContactName: string | null;
  billingEmail: string | null;
  billingNotes: string | null;
  internalNotes: string | null;
  additionalSeatPolicy: AdditionalSeatPolicy;
  seatReductionPolicy: SeatReductionPolicy;
  additionalSeatsAutoActivate?: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerSubscriptionSummary = {
  company: { id: string; name: string };
  planName: string;
  commercialStatus: ContractCommercialStatus;
  contractStartDate: string | null;
  contractEndDate: string | null;
  autoRenew: boolean;
  billingModel: BillingModel;
  billingFrequency: BillingFrequency;
  billingFrequencyLabel: string;
  pricingBasis: PricingBasis;
  currency: string;
  committedLicences: number | null;
  currentPurchasedLicences: number | null;
  unitPriceCents: number | null;
  fixedAmountCents: number | null;
  amountDueCents: number | null;
  amountDueLabel: string;
  paymentTermsCode: PaymentTermsCode;
  paymentTermsLabel: string;
  poReference: string | null;
  billingContactName: string | null;
  billingEmail: string | null;
  billingNotes: string | null;
  vatCharged: false;
  vatLabel: string;
  readOnly: true;
};

export function paymentTermsLabel(code: PaymentTermsCode, custom?: string | null): string {
  if (code === 'custom' && custom?.trim()) return custom.trim();
  return PAYMENT_TERMS_LABELS[code];
}

export function paymentTermsDueDays(code: PaymentTermsCode, customDays?: number | null): number | null {
  switch (code) {
    case 'due_on_receipt':
      return 0;
    case 'days_7':
      return 7;
    case 'days_15':
      return 15;
    case 'days_30':
      return 30;
    case 'custom':
      return customDays ?? null;
    default:
      return null;
  }
}

export function commercialAmountDueCents(input: {
  pricingBasis: PricingBasis;
  negotiatedUnitPriceCents: number | null;
  negotiatedFixedAmountCents: number | null;
  committedLicences: number | null;
}): number | null {
  if (input.pricingBasis === 'custom') return null;
  if (input.pricingBasis === 'fixed_amount') return input.negotiatedFixedAmountCents;
  if (input.negotiatedUnitPriceCents == null || input.committedLicences == null) return null;
  return input.negotiatedUnitPriceCents * input.committedLicences;
}

export function toCustomerSubscriptionSummary(input: {
  company: { id: string; name: string };
  contract: EnterpriseContractRecord;
  currentPurchasedLicences: number | null;
}): CustomerSubscriptionSummary {
  const { contract } = input;
  const amountDueCents = commercialAmountDueCents(contract);
  return {
    company: input.company,
    planName: ENTERPRISE_PLAN_NAME,
    commercialStatus: contract.commercialStatus,
    contractStartDate: contract.contractStartDate,
    contractEndDate: contract.contractEndDate,
    autoRenew: contract.autoRenew,
    billingModel: contract.billingModel,
    billingFrequency: contract.billingFrequency,
    billingFrequencyLabel: BILLING_FREQUENCY_LABELS[contract.billingFrequency],
    pricingBasis: contract.pricingBasis,
    currency: contract.currency || DEFAULT_CURRENCY,
    committedLicences: contract.committedLicences,
    currentPurchasedLicences: input.currentPurchasedLicences,
    unitPriceCents: contract.pricingBasis === 'per_seat' ? contract.negotiatedUnitPriceCents : null,
    fixedAmountCents: contract.pricingBasis === 'fixed_amount' ? contract.negotiatedFixedAmountCents : null,
    amountDueCents,
    amountDueLabel:
      amountDueCents == null
        ? 'Custom terms — see billing notes'
        : formatContractAmount(amountDueCents, contract.currency),
    paymentTermsCode: contract.paymentTermsCode,
    paymentTermsLabel: paymentTermsLabel(contract.paymentTermsCode, contract.paymentTermsCustom),
    poReference: contract.poReference,
    billingContactName: contract.billingContactName,
    billingEmail: contract.billingEmail,
    billingNotes: contract.billingNotes,
    vatCharged: false,
    vatLabel: customerInvoiceVatLabel(),
    readOnly: true,
  };
}

export function formatContractAmount(cents: number, currency = DEFAULT_CURRENCY): string {
  const amount = (cents / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if ((currency || DEFAULT_CURRENCY).toUpperCase() === 'ZAR') return `R${amount}`;
  return `${currency} ${amount}`;
}

export function stripInternalContractFields<T extends { internalNotes?: unknown }>(
  value: T
): Omit<T, 'internalNotes'> {
  const { internalNotes: _hidden, ...rest } = value;
  return rest;
}

export const ADVISORTRACK_SELLER_VAT_REGISTERED = ADVISORTRACK_VAT_REGISTERED;
export { sellerChargesVat };
