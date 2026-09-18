/**
 * Deterministic reporting-period resolver.
 * All windows use Africa/Johannesburg. The model must not interpret dates.
 *
 * this_week  = current Monday through today, incomplete, "This Week So Far"
 * this_month = first day of current month through today, incomplete, "This Month So Far"
 * last_week  = previous completed Monday–Sunday
 * last_month = previous completed calendar month
 * year_to_date = 1 January through today
 */
import {
  BUSINESS_TIMEZONE,
  resolvePerformancePeriod,
  zonedCalendarDate,
} from '../../features/performancePeriod';

export const ASSISTANT_PERIOD_TIMEZONE = BUSINESS_TIMEZONE;

export const ASSISTANT_PERIODS = [
  'this_week',
  'this_month',
  'last_week',
  'last_month',
  'year_to_date',
] as const;

export type AssistantPeriod = (typeof ASSISTANT_PERIODS)[number];

export const ASSISTANT_PERIOD_LABELS: Record<AssistantPeriod, string> = {
  this_week: 'This Week So Far',
  this_month: 'This Month So Far',
  last_week: 'Last Week',
  last_month: 'Last Month',
  year_to_date: 'Year to Date',
};

export const ASSISTANT_PERIOD_COMPLETE: Record<AssistantPeriod, boolean> = {
  this_week: false,
  this_month: false,
  last_week: true,
  last_month: true,
  year_to_date: false,
};

export type AssistantPeriodRange = {
  period: AssistantPeriod;
  label: string;
  startDate: string;
  endDate: string;
  complete: boolean;
  timezone: typeof ASSISTANT_PERIOD_TIMEZONE;
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function isAssistantPeriod(value: string): value is AssistantPeriod {
  return (ASSISTANT_PERIODS as readonly string[]).includes(value);
}

export function detectAssistantPeriod(normalizedQuestion: string): AssistantPeriod | null {
  if (/\blast week\b/.test(normalizedQuestion)) return 'last_week';
  if (/\blast month\b/.test(normalizedQuestion)) return 'last_month';
  if (/\b(year to date|ytd|this year)\b/.test(normalizedQuestion)) return 'year_to_date';
  if (/\bthis week\b/.test(normalizedQuestion)) return 'this_week';
  if (/\b(this month|current month)\b/.test(normalizedQuestion)) return 'this_month';
  return null;
}

export function resolveAssistantPeriod(
  period: AssistantPeriod,
  now: Date = new Date(),
): AssistantPeriodRange {
  if (period === 'last_week' || period === 'last_month' || period === 'year_to_date') {
    const resolved = resolvePerformancePeriod(period, now, ASSISTANT_PERIOD_TIMEZONE);
    return {
      period,
      label: ASSISTANT_PERIOD_LABELS[period],
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      complete: ASSISTANT_PERIOD_COMPLETE[period],
      timezone: ASSISTANT_PERIOD_TIMEZONE,
    };
  }

  const today = zonedCalendarDate(now, ASSISTANT_PERIOD_TIMEZONE);
  if (period === 'this_week') {
    const startDate = addDaysYmd(today.ymd, -today.weekdayIndex);
    return {
      period,
      label: ASSISTANT_PERIOD_LABELS[period],
      startDate,
      endDate: today.ymd,
      complete: false,
      timezone: ASSISTANT_PERIOD_TIMEZONE,
    };
  }

  return {
    period,
    label: ASSISTANT_PERIOD_LABELS[period],
    startDate: `${today.year}-${pad2(today.monthIndex + 1)}-01`,
    endDate: today.ymd,
    complete: false,
    timezone: ASSISTANT_PERIOD_TIMEZONE,
  };
}
