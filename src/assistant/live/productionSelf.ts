import { APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, type ApplicationStatus } from '../../features/applicationStatus';
import { BUSINESS_TIMEZONE, zonedCalendarDate } from '../../features/performancePeriod';
import { resolveAssistantPeriod, type AssistantPeriod } from './period';

export type SelfProductionRow = {
  amount: number;
  isIssued: boolean;
  applicationStatus?: string | null;
  date: string;
};

export type MyProductionProjection = {
  period: string;
  entryCount: number;
  issuedCount: number;
  issuedCommission: number;
  notIssuedCount: number;
  notIssuedCommission: number;
  totalCommission: number;
  acceptedIssuedStatusCount: number;
  applicationReceivedCount: number;
  qualityAssessmentCount: number;
  pendingUnderwritingCount: number;
  awaitingMedicalsCount: number;
  pmaPendingCount: number;
  awaitingAdvisorInfoCount: number;
  counterOfferCount: number;
  postponedCount: number;
  declinedCount: number;
  withdrawnCount: number;
};

export type MyProductionFocus =
  | 'issued_amount'
  | 'entry_count'
  | 'not_issued'
  | 'accepted_issued'
  | 'pending_underwriting'
  | 'awaiting_medicals'
  | 'pma_pending'
  | 'awaiting_advisor_info'
  | 'declined'
  | 'withdrawn'
  | 'overview';

const STATUS_COUNT_KEYS: Record<ApplicationStatus, keyof MyProductionProjection> = {
  application_received: 'applicationReceivedCount',
  quality_assessment: 'qualityAssessmentCount',
  pending_underwriting: 'pendingUnderwritingCount',
  awaiting_medicals: 'awaitingMedicalsCount',
  pma_pending: 'pmaPendingCount',
  awaiting_advisor_info: 'awaitingAdvisorInfoCount',
  counter_offer: 'counterOfferCount',
  accepted_issued: 'acceptedIssuedStatusCount',
  postponed: 'postponedCount',
  declined: 'declinedCount',
  withdrawn: 'withdrawnCount',
};

function emptyProjection(period: string): MyProductionProjection {
  return {
    period,
    entryCount: 0,
    issuedCount: 0,
    issuedCommission: 0,
    notIssuedCount: 0,
    notIssuedCommission: 0,
    totalCommission: 0,
    acceptedIssuedStatusCount: 0,
    applicationReceivedCount: 0,
    qualityAssessmentCount: 0,
    pendingUnderwritingCount: 0,
    awaitingMedicalsCount: 0,
    pmaPendingCount: 0,
    awaitingAdvisorInfoCount: 0,
    counterOfferCount: 0,
    postponedCount: 0,
    declinedCount: 0,
    withdrawnCount: 0,
  };
}

function ymdOf(value: string): string {
  return value.slice(0, 10);
}

export function productionMonthKey(at: Date = new Date()): string {
  return zonedCalendarDate(at, BUSINESS_TIMEZONE).ymd.slice(0, 7);
}

export function monthKeyForAssistantPeriod(period: AssistantPeriod, now: Date = new Date()): string | undefined {
  if (period === 'this_month' || period === 'last_month') {
    return resolveAssistantPeriod(period, now).startDate.slice(0, 7);
  }
  return undefined;
}

export function projectMyProduction(
  rows: SelfProductionRow[],
  input: { period: AssistantPeriod; now: Date },
): MyProductionProjection {
  const range = resolveAssistantPeriod(input.period, input.now);
  const monthKey = monthKeyForAssistantPeriod(input.period, input.now);
  const projection = emptyProjection(monthKey ?? range.label);
  for (const row of rows) {
    const day = ymdOf(row.date);
    if (monthKey) {
      if (day.slice(0, 7) !== monthKey) continue;
    } else if (day < range.startDate || day > range.endDate) {
      continue;
    }
    projection.entryCount += 1;
    projection.totalCommission += row.amount;
    if (row.isIssued) {
      projection.issuedCount += 1;
      projection.issuedCommission += row.amount;
    } else {
      projection.notIssuedCount += 1;
      projection.notIssuedCommission += row.amount;
    }
    const status = APPLICATION_STATUSES.find((value) => value === row.applicationStatus);
    if (status) {
      const key = STATUS_COUNT_KEYS[status];
      const current = projection[key];
      if (typeof current === 'number') {
        Object.assign(projection, { [key]: current + 1 });
      }
    }
  }
  return projection;
}

export function detectMyProductionFocus(normalized: string): MyProductionFocus {
  if (/\b(pending underwriting|underwriting)\b/.test(normalized)) return 'pending_underwriting';
  if (/\b(awaiting medicals|medicals)\b/.test(normalized)) return 'awaiting_medicals';
  if (/\b(pma pending|pma)\b/.test(normalized)) return 'pma_pending';
  if (/\b(awaiting advisor information|awaiting advisor info|advisor information)\b/.test(normalized)) {
    return 'awaiting_advisor_info';
  }
  if (/\bdeclined\b/.test(normalized)) return 'declined';
  if (/\bwithdrawn\b/.test(normalized)) return 'withdrawn';
  if (/\b(accepted \/ issued|accepted issued|accepted\/issued)\b/.test(normalized)) return 'accepted_issued';
  if (/\b(not yet issued|not issued|potential|pending production)\b/.test(normalized)) return 'not_issued';
  if (/\bhow many\b/.test(normalized) && /\b(entries|applications|production)\b/.test(normalized)) {
    return 'entry_count';
  }
  if (/\b(how much|issued)\b/.test(normalized)) return 'issued_amount';
  return 'overview';
}

export function applicationStatusLabel(status: ApplicationStatus): string {
  return APPLICATION_STATUS_LABELS[status];
}
