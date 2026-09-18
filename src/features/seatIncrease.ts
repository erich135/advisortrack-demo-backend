/**
 * Enterprise additional-licence / seat-increase helpers.
 * Operational purchased pool remains companies.seat_limit.
 * Money is integer cents. AdvisorTrack does not charge VAT.
 */

import { ADDITIONAL_SEAT_POLICY_LABELS, type AdditionalSeatPolicy, type EnterpriseContractRecord } from './enterpriseContract';
import { johannesburgToday, toDateOnly } from './invoiceLifecycle';

export const LICENCE_INCREASE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'applied',
] as const;
export type LicenceIncreaseStatus = (typeof LICENCE_INCREASE_STATUSES)[number];

export const LEGACY_LICENCE_INCREASE_STATUSES = ['queued_local', 'submitted'] as const;

export const LICENCE_INCREASE_STATUS_LABELS: Record<LicenceIncreaseStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  applied: 'Applied',
};

export type SeatBillingDecision = {
  billingTreatment: AdditionalSeatPolicy;
  requiresManualReview: boolean;
  amountCents: number | null;
  vatAmountCents: 0;
  periodStart: string | null;
  periodEnd: string | null;
  description: string;
  remainingDays: number | null;
  periodDays: number | null;
};

export function normalizeLicenceIncreaseStatus(status: string): LicenceIncreaseStatus {
  if (status === 'queued_local' || status === 'submitted') return 'pending';
  if ((LICENCE_INCREASE_STATUSES as readonly string[]).includes(status)) {
    return status as LicenceIncreaseStatus;
  }
  return 'pending';
}

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(
    value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Integer division with round-half-up. Never uses floating-point money. */
export function divideRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) {
    throw new Error('Proration requires positive integer cents math');
  }
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  const quotient = Math.trunc(abs / denominator);
  const remainder = abs % denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return sign * rounded;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = toDateOnly(value).split('-').map(Number);
  return { year, month, day };
}

export function calendarDaysInclusive(from: string, to: string): number {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  const a = Date.UTC(start.year, start.month - 1, start.day);
  const b = Date.UTC(end.year, end.month - 1, end.day);
  return Math.floor((b - a) / 86_400_000) + 1;
}

function lastDayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function addMonthsClamped(isoDate: string, months: number): string {
  const { year, month, day } = parseIsoDate(isoDate);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

function monthlyPeriod(asOf: string): { start: string; end: string } {
  const { year, month } = parseIsoDate(asOf);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  return { start, end: lastDayOfMonth(year, month) };
}

function quarterlyPeriod(asOf: string): { start: string; end: string } {
  const { year, month } = parseIsoDate(asOf);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const start = `${year}-${String(quarterStartMonth).padStart(2, '0')}-01`;
  const endMonth = quarterStartMonth + 2;
  return { start, end: lastDayOfMonth(year, endMonth) };
}

function annualPeriod(asOf: string, contractStartDate: string | null): { start: string; end: string } {
  if (!contractStartDate) {
    const { year } = parseIsoDate(asOf);
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  const startParts = parseIsoDate(contractStartDate);
  const asOfParts = parseIsoDate(asOf);
  let startYear = asOfParts.year;
  const anniversaryThisYear = `${startYear}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`;
  if (asOf < anniversaryThisYear) startYear -= 1;
  const start = `${startYear}-${String(startParts.month).padStart(2, '0')}-${String(startParts.day).padStart(2, '0')}`;
  const next = addMonthsClamped(start, 12);
  const endParts = parseIsoDate(next);
  const endDate = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day - 1));
  const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
  return { start, end };
}

function remainingInPeriod(asOf: string, period: { start: string; end: string }): {
  remainingDays: number;
  periodDays: number;
} {
  const periodDays = calendarDaysInclusive(period.start, period.end);
  if (asOf > period.end) return { remainingDays: 0, periodDays };
  const from = asOf < period.start ? period.start : asOf;
  return { remainingDays: calendarDaysInclusive(from, period.end), periodDays };
}

export function proratePerSeatCents(input: {
  additionalSeats: number;
  unitPriceCents: number;
  remainingDays: number;
  periodDays: number;
}): number {
  if (!Number.isInteger(input.additionalSeats) || input.additionalSeats < 1) {
    throw new Error('additionalSeats must be a positive integer');
  }
  if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0) {
    throw new Error('unitPriceCents must be a non-negative integer');
  }
  if (input.remainingDays <= 0 || input.periodDays <= 0) return 0;
  const remaining = Math.min(input.remainingDays, input.periodDays);
  return divideRoundHalfUp(input.unitPriceCents * input.additionalSeats * remaining, input.periodDays);
}

function periodForFrequency(
  frequency: EnterpriseContractRecord['billingFrequency'],
  asOf: string,
  contractStartDate: string | null
): { start: string; end: string } | null {
  if (frequency === 'monthly') return monthlyPeriod(asOf);
  if (frequency === 'quarterly') return quarterlyPeriod(asOf);
  if (frequency === 'annual') return annualPeriod(asOf, contractStartDate);
  return null;
}

function perSeatPeriodAmountCents(contract: EnterpriseContractRecord, additionalSeats: number): number | null {
  if (contract.pricingBasis !== 'per_seat' || contract.negotiatedUnitPriceCents == null) return null;
  return contract.negotiatedUnitPriceCents * additionalSeats;
}

/**
 * Billing treatment for an approved seat increase.
 * Immediate proration only when per-seat terms make integer-cents math safe.
 * Fixed Amount / Custom never invent a charge.
 */
export function decideSeatIncreaseBilling(input: {
  contract: Pick<
    EnterpriseContractRecord,
    | 'additionalSeatPolicy'
    | 'pricingBasis'
    | 'billingFrequency'
    | 'negotiatedUnitPriceCents'
    | 'contractStartDate'
    | 'committedLicences'
  > | null;
  additionalSeats: number;
  asOf?: string;
}): SeatBillingDecision {
  const asOf = input.asOf ?? johannesburgToday();
  const policy = input.contract?.additionalSeatPolicy ?? 'manual_review';
  const vatAmountCents = 0 as const;
  const base = {
    vatAmountCents,
    remainingDays: null as number | null,
    periodDays: null as number | null,
    periodStart: null as string | null,
    periodEnd: null as string | null,
  };

  if (policy === 'manual_review') {
    return {
      ...base,
      billingTreatment: 'manual_review',
      requiresManualReview: true,
      amountCents: null,
      description: 'Additional licences — manual billing review',
    };
  }

  if (policy === 'quarterly_true_up' || policy === 'annual_true_up') {
    const label = ADDITIONAL_SEAT_POLICY_LABELS[policy];
    return {
      ...base,
      billingTreatment: policy,
      requiresManualReview: false,
      amountCents: null,
      description: `+${input.additionalSeats.toLocaleString('en-ZA')} licences recorded for ${label.toLowerCase()}`,
    };
  }

  const perSeatNext = input.contract ? perSeatPeriodAmountCents(input.contract as EnterpriseContractRecord, input.additionalSeats) : null;

  if (policy === 'next_invoice') {
    return {
      ...base,
      billingTreatment: 'next_invoice',
      requiresManualReview: perSeatNext == null,
      amountCents: perSeatNext,
      description:
        perSeatNext == null
          ? `+${input.additionalSeats.toLocaleString('en-ZA')} licences for the next invoice (amount to be entered)`
          : `+${input.additionalSeats.toLocaleString('en-ZA')} licences — next invoice`,
    };
  }

  // immediate_proration
  const pricingBasis = input.contract?.pricingBasis;
  const frequency = input.contract?.billingFrequency;
  if (pricingBasis !== 'per_seat' || input.contract?.negotiatedUnitPriceCents == null || !frequency) {
    return {
      ...base,
      billingTreatment: 'manual_review',
      requiresManualReview: true,
      amountCents: null,
      description: 'Immediate proration cannot be determined from Fixed Amount or Custom terms',
    };
  }
  const period = periodForFrequency(frequency, asOf, input.contract.contractStartDate);
  if (!period) {
    return {
      ...base,
      billingTreatment: 'manual_review',
      requiresManualReview: true,
      amountCents: null,
      description: 'Immediate proration cannot be determined for custom billing frequency',
    };
  }
  const remaining = remainingInPeriod(asOf, period);
  const amountCents = proratePerSeatCents({
    additionalSeats: input.additionalSeats,
    unitPriceCents: input.contract.negotiatedUnitPriceCents,
    remainingDays: remaining.remainingDays,
    periodDays: remaining.periodDays,
  });
  return {
    billingTreatment: 'immediate_proration',
    requiresManualReview: false,
    amountCents,
    vatAmountCents,
    periodStart: period.start,
    periodEnd: period.end,
    remainingDays: remaining.remainingDays,
    periodDays: remaining.periodDays,
    description: `+${input.additionalSeats.toLocaleString('en-ZA')} licences prorated (${remaining.remainingDays} of ${remaining.periodDays} days)`,
  };
}

export function customerBillingTreatment(contract: { additionalSeatPolicy?: string | null } | null): {
  additionalSeatPolicy: AdditionalSeatPolicy | null;
  additionalSeatPolicyLabel: string | null;
} {
  const policy = contract?.additionalSeatPolicy;
  if (policy && policy in ADDITIONAL_SEAT_POLICY_LABELS) {
    const typed = policy as AdditionalSeatPolicy;
    return { additionalSeatPolicy: typed, additionalSeatPolicyLabel: ADDITIONAL_SEAT_POLICY_LABELS[typed] };
  }
  return { additionalSeatPolicy: null, additionalSeatPolicyLabel: null };
}

export function adjustmentPrefillLine(description: string, amountCents: number): {
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
} {
  return { description, quantity: 1, unitPriceCents: amountCents, discountCents: 0 };
}
