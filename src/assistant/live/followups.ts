import { BUSINESS_TIMEZONE, zonedCalendarDate } from '../../features/performancePeriod';

export type SelfActivityRow = {
  type: string;
  status: string;
  scheduledAt: string;
};

export type MyFollowupsProjection = {
  todayCount: number;
  overdueCount: number;
  thisWeekCount: number;
  completedTodayCount: number;
  followUpTodayCount: number;
  followUpOverdueCount: number;
  callCount: number;
  meetingCount: number;
  todayCallCount: number;
  todayMeetingCount: number;
  emailCount: number;
  followUpTypeCount: number;
  presentationCount: number;
  otherCount: number;
};

export type MyFollowupsFocus =
  | 'today_followups'
  | 'today_activities'
  | 'today_calls'
  | 'today_meetings'
  | 'overdue'
  | 'this_week';

const pad2 = (value: number): string => String(value).padStart(2, '0');

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function johannesburgYmd(at: Date | string): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  return zonedCalendarDate(Number.isNaN(date.getTime()) ? new Date() : date, BUSINESS_TIMEZONE).ymd;
}

export function johannesburgWeekBounds(now = new Date()): { monday: string; sunday: string; today: string } {
  const zoned = zonedCalendarDate(now, BUSINESS_TIMEZONE);
  const today = zoned.ymd;
  const monday = addDaysYmd(today, -zoned.weekdayIndex);
  return { monday, sunday: addDaysYmd(monday, 6), today };
}

export function isOpenActivity(status: string): boolean {
  return status === 'scheduled';
}

export function isCompletedActivity(status: string): boolean {
  return status === 'completed';
}

export function isFollowUpType(type: string): boolean {
  return type === 'follow_up';
}

export function projectMyFollowups(rows: SelfActivityRow[], now = new Date()): MyFollowupsProjection {
  const { monday, sunday, today } = johannesburgWeekBounds(now);
  const empty: MyFollowupsProjection = {
    todayCount: 0,
    overdueCount: 0,
    thisWeekCount: 0,
    completedTodayCount: 0,
    followUpTodayCount: 0,
    followUpOverdueCount: 0,
    callCount: 0,
    meetingCount: 0,
    todayCallCount: 0,
    todayMeetingCount: 0,
    emailCount: 0,
    followUpTypeCount: 0,
    presentationCount: 0,
    otherCount: 0,
  };

  return rows.reduce((summary, row) => {
    const scheduled = new Date(row.scheduledAt);
    if (Number.isNaN(scheduled.getTime())) return summary;
    const day = johannesburgYmd(scheduled);
    const followUp = isFollowUpType(row.type);
    if (isOpenActivity(row.status) && scheduled.getTime() < now.getTime()) {
      summary.overdueCount += 1;
      if (followUp) summary.followUpOverdueCount += 1;
    }
    if (isOpenActivity(row.status) && day === today) {
      summary.todayCount += 1;
      if (followUp) summary.followUpTodayCount += 1;
      if (row.type === 'call') summary.todayCallCount += 1;
      if (row.type === 'meeting') summary.todayMeetingCount += 1;
    }
    if (isCompletedActivity(row.status) && day === today) {
      summary.completedTodayCount += 1;
    }
    if (isOpenActivity(row.status) && day >= monday && day <= sunday) {
      summary.thisWeekCount += 1;
    }
    if (isOpenActivity(row.status)) {
      if (row.type === 'call') summary.callCount += 1;
      else if (row.type === 'meeting') summary.meetingCount += 1;
      else if (row.type === 'email') summary.emailCount += 1;
      else if (row.type === 'follow_up') summary.followUpTypeCount += 1;
      else if (row.type === 'presentation') summary.presentationCount += 1;
      else summary.otherCount += 1;
    }
    return summary;
  }, empty);
}

export function detectMyFollowupsFocus(normalized: string): MyFollowupsFocus {
  if (/\boverdue\b/.test(normalized)) return 'overdue';
  if (/\bthis week\b/.test(normalized)) return 'this_week';
  if (/\bcalls?\b/.test(normalized)) return 'today_calls';
  if (/\bmeetings?\b/.test(normalized)) return 'today_meetings';
  if (/\bfollow[- ]?ups?\b/.test(normalized)) return 'today_followups';
  return 'today_activities';
}
