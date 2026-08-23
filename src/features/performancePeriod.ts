/**
 * Leadership performance date windows.
 * Calendar boundaries use the existing database timezone, Africa/Johannesburg.
 */
export const BUSINESS_TIMEZONE = 'Africa/Johannesburg';

export const PERFORMANCE_PERIODS = ['last_week', 'last_month', 'year_to_date'] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

export const DEFAULT_PERFORMANCE_PERIOD: PerformancePeriod = 'last_month';

export const PERFORMANCE_PERIOD_LABELS: Record<PerformancePeriod, string> = {
  last_week: 'Last Week',
  last_month: 'Last Month',
  year_to_date: 'Year to Date',
};

export type PerformanceDateRange = {
  period: PerformancePeriod;
  label: string;
  startDate: string;
  endDate: string;
  timezone: typeof BUSINESS_TIMEZONE;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const pad2 = (value: number): string => String(value).padStart(2, '0');

const toYmd = (year: number, monthIndex: number, day: number): string =>
  `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;

const parseYmd = (ymd: string): { year: number; monthIndex: number; day: number } => {
  const [year, month, day] = ymd.split('-').map(Number);
  return { year, monthIndex: month - 1, day };
};

const addDaysYmd = (ymd: string, days: number): string => {
  const { year, monthIndex, day } = parseYmd(ymd);
  const utc = Date.UTC(year, monthIndex, day + days);
  const date = new Date(utc);
  return toYmd(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const lastDayOfMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/**
 * Calendar parts of `now` in the business timezone.
 */
export const zonedCalendarDate = (
  now: Date,
  timeZone: string = BUSINESS_TIMEZONE
): { ymd: string; weekdayIndex: number; year: number; monthIndex: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);

  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = Number(lookup('year'));
  const monthIndex = Number(lookup('month')) - 1;
  const day = Number(lookup('day'));
  const weekdayIndex = WEEKDAY_INDEX[lookup('weekday')] ?? 0;

  return {
    ymd: toYmd(year, monthIndex, day),
    weekdayIndex,
    year,
    monthIndex,
    day,
  };
};

/**
 * True when the value is a supported performance period key.
 */
export const isPerformancePeriod = (value: string): value is PerformancePeriod =>
  (PERFORMANCE_PERIODS as readonly string[]).includes(value);

/**
 * Resolves inclusive start/end calendar dates for a performance period.
 * Last Week = previous completed Monday–Sunday.
 * Last Month = previous completed calendar month.
 * Year to Date = 1 January through the current local date.
 */
export const resolvePerformancePeriod = (
  period: PerformancePeriod,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIMEZONE
): PerformanceDateRange => {
  const today = zonedCalendarDate(now, timeZone);

  if (period === 'last_week') {
    const thisMonday = addDaysYmd(today.ymd, -today.weekdayIndex);
    const endDate = addDaysYmd(thisMonday, -1);
    const startDate = addDaysYmd(endDate, -6);
    return {
      period,
      label: PERFORMANCE_PERIOD_LABELS[period],
      startDate,
      endDate,
      timezone: BUSINESS_TIMEZONE,
    };
  }

  if (period === 'last_month') {
    const monthIndex = today.monthIndex === 0 ? 11 : today.monthIndex - 1;
    const year = today.monthIndex === 0 ? today.year - 1 : today.year;
    return {
      period,
      label: PERFORMANCE_PERIOD_LABELS[period],
      startDate: toYmd(year, monthIndex, 1),
      endDate: toYmd(year, monthIndex, lastDayOfMonth(year, monthIndex)),
      timezone: BUSINESS_TIMEZONE,
    };
  }

  return {
    period,
    label: PERFORMANCE_PERIOD_LABELS[period],
    startDate: toYmd(today.year, 0, 1),
    endDate: today.ymd,
    timezone: BUSINESS_TIMEZONE,
  };
};
