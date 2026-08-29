import {
  BUSINESS_TIMEZONE,
  resolvePerformancePeriod,
  zonedCalendarDate,
} from './performancePeriod';

export const DEMO_DATE_BUCKETS = [
  'last_week',
  'last_month',
  'year_to_date',
  'current_month',
  'older',
  'hours_ago',
  'yesterday',
  'days_ago_3',
  'days_ago_4',
  'days_ago_5',
  'stale_7',
  'stale_14',
  'upcoming',
] as const;

export type DemoDateBucket = (typeof DEMO_DATE_BUCKETS)[number];

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

const ymdCompare = (left: string, right: string): number => left.localeCompare(right);

export const enumerateYmdInclusive = (start: string, end: string): string[] => {
  if (ymdCompare(start, end) > 0) return [];
  const days: string[] = [];
  let cursor = start;
  while (ymdCompare(cursor, end) <= 0) {
    days.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    if (days.length > 800) break;
  }
  return days;
};

/**
 * 10:00 Africa/Johannesburg on a calendar date — SAST is UTC+2 with no DST.
 */
export const johannesburgAt = (ymd: string, hour = 10, minute = 0): Date =>
  new Date(`${ymd}T${pad2(hour)}:${pad2(minute)}:00+02:00`);

export const isDemoDateBucket = (value: string): value is DemoDateBucket =>
  (DEMO_DATE_BUCKETS as readonly string[]).includes(value);

/**
 * Calendar days for a seed bucket relative to `now` in Africa/Johannesburg.
 * last_week issued days exclude last_month so Last Month rankings stay exact.
 */
export const daysForDemoBucket = (bucket: DemoDateBucket, now: Date = new Date()): string[] => {
  const today = zonedCalendarDate(now, BUSINESS_TIMEZONE);
  const lastWeek = resolvePerformancePeriod('last_week', now);
  const lastMonth = resolvePerformancePeriod('last_month', now);
  const ytd = resolvePerformancePeriod('year_to_date', now);
  const lastWeekDays = enumerateYmdInclusive(lastWeek.startDate, lastWeek.endDate);
  const lastMonthDays = enumerateYmdInclusive(lastMonth.startDate, lastMonth.endDate);
  const lastMonthSet = new Set(lastMonthDays);
  const lastWeekSet = new Set(lastWeekDays);

  if (bucket === 'last_month') return lastMonthDays;
  if (bucket === 'last_week') return lastWeekDays.filter((day) => !lastMonthSet.has(day));
  if (bucket === 'current_month') {
    const start = toYmd(today.year, today.monthIndex, 1);
    return enumerateYmdInclusive(start, today.ymd);
  }
  if (bucket === 'year_to_date') {
    return enumerateYmdInclusive(ytd.startDate, ytd.endDate).filter(
      (day) => !lastMonthSet.has(day) && !lastWeekSet.has(day)
    );
  }
  if (bucket === 'hours_ago' || bucket === 'yesterday') return [today.ymd];
  if (bucket === 'days_ago_3') return [addDaysYmd(today.ymd, -3)];
  if (bucket === 'days_ago_4') return [addDaysYmd(today.ymd, -4)];
  if (bucket === 'days_ago_5') return [addDaysYmd(today.ymd, -5)];
  if (bucket === 'stale_7') {
    return [7, 8, 9, 10].map((daysAgo) => addDaysYmd(today.ymd, -daysAgo));
  }
  if (bucket === 'stale_14') {
    return [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((daysAgo) => addDaysYmd(today.ymd, -daysAgo));
  }
  if (bucket === 'upcoming') {
    return [1, 2, 3, 4, 5].map((daysAhead) => addDaysYmd(today.ymd, daysAhead));
  }
  const olderEnd = toYmd(today.year - 1, 11, 15);
  const olderStart = toYmd(today.year - 1, 1, 8);
  return enumerateYmdInclusive(olderStart, olderEnd);
};

export const resolveDemoBucketTimestamp = (
  bucket: DemoDateBucket,
  slot: number,
  now: Date = new Date()
): Date => {
  const today = zonedCalendarDate(now, BUSINESS_TIMEZONE);
  if (bucket === 'hours_ago') {
    const hours = 1 + (Math.abs(slot) % 8);
    const at = new Date(now.getTime() - hours * 3_600_000);
    return at.getTime() > now.getTime() ? new Date(now.getTime() - 3_600_000) : at;
  }

  const days = daysForDemoBucket(bucket, now);
  const fallback =
    bucket === 'last_week'
      ? daysForDemoBucket('current_month', now)
      : daysForDemoBucket('last_month', now);
  const pool = days.length > 0 ? days : fallback;
  const ymd = pool[Math.abs(slot) % pool.length] ?? today.ymd;
  const at = johannesburgAt(ymd, 9 + (Math.abs(slot) % 7), (slot * 11) % 50);
  return at.getTime() > now.getTime() && bucket !== 'upcoming'
    ? johannesburgAt(addDaysYmd(today.ymd, -1), 10, 15)
    : at;
};
