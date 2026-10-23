/**
 * A8.8.3 Dex daily companion. Deterministic counts and priority only.
 * Groq is never used for urgency, ranking, or invented completed work.
 */
import { normalizeQuestion } from '../normalise';
import type { AssistantPublicAnswer } from '../model/types';
import { cheekyClearOverdue, cheekyManyWithoutNextAction, cheekyTargetReached } from '../voice';
import { publicFactSource } from './classify';

export type CompanionFocus = 'briefing' | 'eod' | 'first' | 'next' | 'why' | 'else';

export type CompanionPriorityId =
  | 'overdue'
  | 'due_today'
  | 'no_next_action'
  | 'incomplete_workflow'
  | 'upcoming'
  | 'target';

export type CompanionPriorityItem = {
  id: CompanionPriorityId;
  rank: number;
  count: number;
  label: string;
  shortLabel: string;
  reason: string;
};

export type CompanionSnapshot = {
  overdueActivities: number;
  todayActivities: number;
  followUpsToday: number;
  todayMeetingCount: number;
  todayCallCount: number;
  thisWeekCount: number;
  completedTodayCount: number;
  followUpOverdueCount: number;
  casesWithoutNextAction: number;
  ficaIncomplete: number;
  documentsIncomplete: number;
  reviewDue: number;
  openCases: number;
  progressPercent: number;
  remainingAmount: number;
  monthlyGoal: number;
  issuedCommission: number;
  pendingUnderwritingCount: number | null;
  awaitingAdvisorInfoCount: number | null;
  activitiesAvailable: boolean;
  casesAvailable: boolean;
  targetAvailable: boolean;
  productionAvailable: boolean;
};

const noun = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

function joinList(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

export function looksCompanionBriefingQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (/\bwhats happening with my cases\b/.test(normalized)) return false;
  return (
    /\b(whats on my plate|what is on my plate|whats on the book)\b/.test(normalized)
    || /\b(give me (my |a )?(morning )?briefing|morning briefing|my briefing)\b/.test(normalized)
    || /\bwhats happening today\b/.test(normalized)
    || /\bhappening with my work\b/.test(normalized)
    || /\bwhat should i focus on\b/.test(normalized)
    || /\bwhats happening with my work today\b/.test(normalized)
  );
}

export function looksCompanionEndOfDayQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return (
    /\b(im done for today|i am done for today|done for today)\b/.test(normalized)
    || /\b(wrap up my day|wrap up the day)\b/.test(normalized)
    || /\bhow did today go\b/.test(normalized)
    || /\banything left for tomorrow\b/.test(normalized)
    || /\bend of (the )?day\b/.test(normalized)
  );
}

export function looksCompanionFirstQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return /^(what should i do first|what first|what should i do now briefing)\b/.test(normalized)
    || /\bwhat should i do first\b/.test(normalized);
}

export function looksCompanionNextQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return /^(and )?after that\b/.test(normalized)
    || /^(and then|whats after that|what after that)\b/.test(normalized);
}

export function looksCompanionWhyQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return /^(why(?: that| those| that first| the overdue)?)\b/.test(normalized);
}

export function looksCompanionElseQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return /^(anything else|what else|is that all|and the rest)\b/.test(normalized);
}

export function looksCompanionFollowUpQuestion(question: string): boolean {
  return looksCompanionFirstQuestion(question)
    || looksCompanionNextQuestion(question)
    || looksCompanionWhyQuestion(question)
    || looksCompanionElseQuestion(question);
}

export function previousWasCompanionTurn(previousQuestion?: string | null): boolean {
  if (!previousQuestion?.trim()) return false;
  return looksCompanionBriefingQuestion(previousQuestion)
    || looksCompanionEndOfDayQuestion(previousQuestion)
    || looksCompanionFollowUpQuestion(previousQuestion)
    || looksCompanionAttentionQuestion(previousQuestion)
    || /\b(how am i doing|what should i do now|what should i look at today|give me a quick overview)\b/.test(
      normalizeQuestion(previousQuestion),
    );
}

export function looksCompanionAttentionQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return (
    /\bwhat needs (my )?attention\b/.test(normalized)
    || /\bwhat should i look at today\b/.test(normalized)
    || /\banything i need to sort out\b/.test(normalized)
    || /\bwhat is outstanding\b/.test(normalized)
    || /\bwhats waiting on me\b/.test(normalized)
    || /\bwhat still needs attention\b/.test(normalized)
    || /\bwhat should i do now\b/.test(normalized)
    || /\bwhat should i do here\b/.test(normalized)
  );
}

function followUpHasOtherDomain(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return /\b(fica|submit|quotes?|popia|contact|underwriting)\b/.test(normalized)
    && !/\bbriefing\b/.test(normalized);
}

export function looksCompanionQuestion(question: string): boolean {
  return looksCompanionBriefingQuestion(question)
    || looksCompanionEndOfDayQuestion(question)
    || (looksCompanionFollowUpQuestion(question) && !followUpHasOtherDomain(question));
}

export type CompanionLiveHint =
  | { kind: 'live'; live: 'followups' | 'mypipeline' | 'myproduction' | 'mytarget' | 'mycontacts' | 'mydashboard' }
  | { kind: 'card'; cardId: string };

export function companionPhraseHint(normalized: string, routeId?: string | null): CompanionLiveHint | null {
  const here = /^(what should i do here|what do i do here|what now|now what|what needs (my )?attention)$/.test(normalized);
  if (here) {
    if (routeId === 'advisor-activities' || routeId === 'advisor-activity-detail') {
      return { kind: 'live', live: 'followups' };
    }
    if (routeId === 'advisor-pipeline') return { kind: 'live', live: 'mypipeline' };
    if (routeId === 'advisor-production') return { kind: 'live', live: 'myproduction' };
    if (routeId === 'advisor-planning') return { kind: 'live', live: 'mytarget' };
    if (routeId === 'advisor-contacts' || routeId === 'advisor-contact-detail') {
      return { kind: 'card', cardId: 'CONTACT.ADD_ACTIVITY' };
    }
    if (routeId === 'advisor-case-detail') return null;
    return { kind: 'live', live: 'mydashboard' };
  }
  if (/^(whats overdue|what is overdue)$/.test(normalized)) {
    return { kind: 'live', live: 'followups' };
  }
  if (/^(am i on target)$/.test(normalized) || (routeId === 'advisor-planning' && /^how am i doing/.test(normalized))) {
    return { kind: 'live', live: 'mytarget' };
  }
  if (/^(whats still pending|what is still pending|whats holding things up|what is holding things up)$/.test(normalized)) {
    return { kind: 'live', live: 'myproduction' };
  }
  if (
    looksCompanionBriefingQuestion(normalized)
    || looksCompanionEndOfDayQuestion(normalized)
    || (looksCompanionFollowUpQuestion(normalized) && !followUpHasOtherDomain(normalized))
  ) {
    return { kind: 'live', live: 'mydashboard' };
  }
  return null;
}

export function detectCompanionFocus(
  question: string,
  previousQuestion?: string | null,
): CompanionFocus | null {
  if (looksCompanionEndOfDayQuestion(question)) return 'eod';
  if (looksCompanionBriefingQuestion(question)) return 'briefing';
  if (looksCompanionNextQuestion(question) && previousWasCompanionTurn(previousQuestion)) return 'next';
  if (looksCompanionWhyQuestion(question) && previousWasCompanionTurn(previousQuestion)) return 'why';
  if (looksCompanionElseQuestion(question) && previousWasCompanionTurn(previousQuestion)) return 'else';
  if (looksCompanionFirstQuestion(question)) return 'first';
  if (looksCompanionAttentionQuestion(question)) return 'briefing';
  return null;
}

function overdueLabel(snapshot: CompanionSnapshot): string {
  if (
    snapshot.followUpOverdueCount > 0
    && snapshot.followUpOverdueCount === snapshot.overdueActivities
  ) {
    return noun(snapshot.overdueActivities, 'overdue follow-up', 'overdue follow-ups');
  }
  return noun(snapshot.overdueActivities, 'overdue activity', 'overdue activities');
}

function dueTodayLabel(snapshot: CompanionSnapshot): string {
  const total = snapshot.todayActivities;
  const meetings = snapshot.todayMeetingCount;
  const calls = snapshot.todayCallCount;
  if (meetings > 0 && meetings === total) return noun(meetings, 'meeting today', 'meetings today');
  if (calls > 0 && calls === total) return noun(calls, 'call today', 'calls today');
  if (meetings > 0) {
    return `${noun(total, 'activity due today', 'activities due today')} (${noun(meetings, 'meeting', 'meetings')})`;
  }
  return noun(total, 'activity due today', 'activities due today');
}

function incompleteLabel(snapshot: CompanionSnapshot): { count: number; label: string; shortLabel: string } {
  const bits: string[] = [];
  let count = 0;
  if (snapshot.casesAvailable) {
    if (snapshot.ficaIncomplete > 0) {
      count += snapshot.ficaIncomplete;
      bits.push(noun(snapshot.ficaIncomplete, 'incomplete FICA check', 'incomplete FICA checks'));
    }
    if (snapshot.documentsIncomplete > 0) {
      count += snapshot.documentsIncomplete;
      bits.push(noun(snapshot.documentsIncomplete, 'incomplete document checklist', 'incomplete document checklists'));
    }
    if (snapshot.reviewDue > 0) {
      count += snapshot.reviewDue;
      bits.push(noun(snapshot.reviewDue, 'review due', 'reviews due'));
    }
  }
  if (snapshot.productionAvailable && (snapshot.pendingUnderwritingCount ?? 0) > 0) {
    count += snapshot.pendingUnderwritingCount ?? 0;
    bits.push(noun(snapshot.pendingUnderwritingCount ?? 0, 'application pending underwriting', 'applications pending underwriting'));
  }
  return {
    count,
    label: joinList(bits),
    shortLabel: 'the incomplete workflow items',
  };
}

/**
 * Trusted operational order. Never reordered by the model.
 * 1 overdue, 2 due today, 3 no next action, 4 incomplete workflow, 5 upcoming, 6 targets.
 */
export function companionPriorityItems(snapshot: CompanionSnapshot): CompanionPriorityItem[] {
  snapshot = withAvailability(snapshot);
  const items: CompanionPriorityItem[] = [];
  if (snapshot.activitiesAvailable && snapshot.overdueActivities > 0) {
    items.push({
      id: 'overdue',
      rank: 1,
      count: snapshot.overdueActivities,
      label: overdueLabel(snapshot),
      shortLabel: snapshot.followUpOverdueCount === snapshot.overdueActivities
        ? 'the overdue follow-ups'
        : 'the overdue activities',
      reason: 'Overdue commitments come first because they are already past their due date.',
    });
  }
  if (snapshot.activitiesAvailable && snapshot.todayActivities > 0) {
    items.push({
      id: 'due_today',
      rank: 2,
      count: snapshot.todayActivities,
      label: dueTodayLabel(snapshot),
      shortLabel: snapshot.todayMeetingCount === snapshot.todayActivities && snapshot.todayMeetingCount > 0
        ? "today's meetings"
        : "today's activities",
      reason: 'Work dated today comes after overdue items because it is due now, not already late.',
    });
  }
  if (snapshot.casesAvailable && snapshot.casesWithoutNextAction > 0) {
    items.push({
      id: 'no_next_action',
      rank: 3,
      count: snapshot.casesWithoutNextAction,
      label: noun(snapshot.casesWithoutNextAction, 'case without a next action', 'cases without a next action'),
      shortLabel: 'the cases without a next step',
      reason: 'Cases without a next action have no booked follow-up, so they stall unless you set one.',
    });
  }
  const incomplete = incompleteLabel(snapshot);
  if (incomplete.count > 0) {
    items.push({
      id: 'incomplete_workflow',
      rank: 4,
      count: incomplete.count,
      label: incomplete.label,
      shortLabel: incomplete.shortLabel,
      reason: 'Incomplete FICA, documents, reviews, or recorded pending production block the workflow after live work.',
    });
  }
  if (snapshot.activitiesAvailable) {
    const upcoming = Math.max(0, snapshot.thisWeekCount - snapshot.todayActivities);
    if (upcoming > 0) {
      items.push({
        id: 'upcoming',
        rank: 5,
        count: upcoming,
        label: noun(upcoming, 'upcoming activity later this week', 'upcoming activities later this week'),
        shortLabel: 'the later-this-week follow-ups',
        reason: 'Upcoming work is after today’s commitments because it is not due yet.',
      });
    }
  }
  if (snapshot.targetAvailable && snapshot.monthlyGoal > 0) {
    items.push({
      id: 'target',
      rank: 6,
      count: snapshot.progressPercent,
      label: `${snapshot.progressPercent}% of this month's target`,
      shortLabel: 'monthly target progress',
      reason: 'Target progress is last because it is a performance reading, not an operational blocker.',
    });
  }
  return items;
}

function operationalItems(snapshot: CompanionSnapshot): CompanionPriorityItem[] {
  return companionPriorityItems(snapshot).filter((item) => item.id !== 'target');
}

function targetLine(snapshot: CompanionSnapshot): string | null {
  if (!snapshot.targetAvailable || snapshot.monthlyGoal <= 0) return null;
  return cheekyTargetReached(snapshot.progressPercent)
    ?? `You're at ${snapshot.progressPercent}% of your monthly target.`;
}

function salutationHeadline(question?: string | null): string | null {
  const text = (question ?? '').toLowerCase();
  if (/\bgood afternoon\b|\bafternoon\b/.test(text)) return 'Afternoon';
  if (/\bgood evening\b|\bevening\b/.test(text)) return 'Evening';
  if (/\bgood morning\b|\bmorning\b/.test(text)) return 'Morning';
  return null;
}

function startLine(items: CompanionPriorityItem[]): string | null {
  if (!items.length) return null;
  if (items.length === 1) return `I'd start with ${items[0].shortLabel}.`;
  return `I'd start with ${items[0].shortLabel}, then check ${items[1].shortLabel}.`;
}

function briefingBody(snapshot: CompanionSnapshot): string {
  const items = operationalItems(snapshot);
  const situation = items.slice(0, 3).map((item) => item.label);
  const target = targetLine(snapshot);
  const start = startLine(items);
  const joke = items[0]?.id === 'no_next_action'
    ? cheekyManyWithoutNextAction(items[0].count)
    : items.length === 0 && snapshot.activitiesAvailable && snapshot.overdueActivities === 0
      ? cheekyClearOverdue()
      : null;
  if (!situation.length) {
    const clear = snapshot.activitiesAvailable
      ? cheekyClearOverdue()
      : 'I could not load today’s activities.';
    const cases = snapshot.casesAvailable && snapshot.casesWithoutNextAction === 0
      ? 'No cases are waiting for a next action.'
      : snapshot.casesAvailable && snapshot.casesWithoutNextAction > 0
        ? noun(snapshot.casesWithoutNextAction, 'case has no next action', 'cases have no next action') + '.'
        : null;
    return [clear, cases, target].filter(Boolean).join(' ');
  }
  return [`You've got ${joinList(situation)}.`, start, joke, target].filter(Boolean).join(' ');
}

function eodBody(snapshot: CompanionSnapshot): string {
  const completed = snapshot.activitiesAvailable && snapshot.completedTodayCount > 0
    ? `You completed ${noun(snapshot.completedTodayCount, 'activity', 'activities')} today.`
    : null;
  const outstanding = operationalItems(snapshot).filter((item) => item.id !== 'upcoming');
  const tomorrow = operationalItems(snapshot).find((item) => item.id === 'upcoming');
  const leftover = outstanding.slice(0, 2).map((item) => item.label);
  const lines: string[] = [];
  if (completed) lines.push(completed);
  if (leftover.length) {
    lines.push(`Still outstanding: ${joinList(leftover)}.`);
    lines.push(`I'd leave ${outstanding[0].shortLabel} for first thing tomorrow.`);
  } else if (snapshot.activitiesAvailable || snapshot.casesAvailable) {
    lines.push('Nothing overdue is sitting on the book.');
  }
  if (tomorrow && leftover.length === 0) {
    lines.push(`${tomorrow.label[0].toUpperCase()}${tomorrow.label.slice(1)} ${tomorrow.count === 1 ? 'is' : 'are'} on the week.`);
  } else if (tomorrow) {
    lines.push(`${tomorrow.label[0].toUpperCase()}${tomorrow.label.slice(1)} can wait until scheduled.`);
  }
  if (!completed && !lines.length) {
    lines.push('I do not have a completed-activity count for today, and no outstanding operational items were returned.');
  }
  return lines.join(' ');
}

function whyItem(snapshot: CompanionSnapshot, previousQuestion?: string | null): CompanionPriorityItem | null {
  const items = operationalItems(snapshot);
  if (!items.length) return null;
  if (previousQuestion && looksCompanionNextQuestion(previousQuestion)) return items[1] ?? items[0];
  return items[0];
}

function companionFacts(snapshot: CompanionSnapshot): AssistantPublicAnswer['facts'] {
  const source = publicFactSource('MY_DASHBOARD');
  const facts: AssistantPublicAnswer['facts'] = [];
  if (snapshot.activitiesAvailable) {
    facts.push(
      { label: 'Overdue activities', value: String(snapshot.overdueActivities), source },
      { label: 'Due today', value: String(snapshot.todayActivities), source },
    );
  }
  if (snapshot.casesAvailable) {
    facts.push({ label: 'No next action', value: String(snapshot.casesWithoutNextAction), source });
  }
  if (snapshot.targetAvailable) {
    facts.push({ label: 'Target progress', value: `${snapshot.progressPercent}%`, source });
  }
  return facts;
}

const CAVEATS = [
  'Priority follows the trusted operational order. This is not a performance rating or financial advice.',
  'Completed work is only mentioned when a completed-activity count was returned.',
];

function withAvailability(snapshot: CompanionSnapshot): CompanionSnapshot {
  return {
    ...snapshot,
    activitiesAvailable: snapshot.activitiesAvailable !== false,
    casesAvailable: snapshot.casesAvailable !== false,
    targetAvailable: snapshot.targetAvailable === true
      || (snapshot.targetAvailable !== false && snapshot.monthlyGoal > 0),
    productionAvailable: snapshot.productionAvailable === true,
  };
}

export function companionAnswer(
  snapshot: CompanionSnapshot,
  focus: CompanionFocus,
  question?: string | null,
  previousQuestion?: string | null,
): AssistantPublicAnswer {
  snapshot = withAvailability(snapshot);
  const items = operationalItems(snapshot);
  const sourceTitle = 'My dashboard';
  const wrap = (headline: string, body: string): AssistantPublicAnswer => ({
    answerId: 'live:MY_DASHBOARD',
    intent: 'live.MY_DASHBOARD',
    confidence: 1,
    mode: 'allowed',
    headline,
    body,
    facts: companionFacts(snapshot),
    sources: [{ cardId: 'MY_DASHBOARD', title: sourceTitle }],
    caveats: CAVEATS,
  });

  if (focus === 'eod') {
    return wrap('Wrap', eodBody(snapshot));
  }
  if (focus === 'first') {
    if (!items.length) {
      return wrap('First', briefingBody(snapshot));
    }
    return wrap('First', `Start with ${items[0].shortLabel}. ${items[0].reason}`);
  }
  if (focus === 'next') {
    if (items.length < 2) {
      return wrap('After that', items.length
        ? `That's the main item from the trusted order: ${items[0].label}.`
        : briefingBody(snapshot));
    }
    return wrap('After that', `Then ${items[1].shortLabel}. ${items[1].reason}`);
  }
  if (focus === 'why') {
    const item = whyItem(snapshot, previousQuestion);
    if (!item) return wrap('Why that', briefingBody(snapshot));
    return wrap('Why that', item.reason);
  }
  if (focus === 'else') {
    const rest = items.slice(2);
    const target = targetLine(snapshot);
    if (!rest.length) {
      return wrap('Anything else', ['Nothing else operational is ahead of target.', target].filter(Boolean).join(' '));
    }
    return wrap('Anything else', [`Still on the list: ${joinList(rest.map((item) => item.label))}.`, target].filter(Boolean).join(' '));
  }

  const greeting = salutationHeadline(question);
  return wrap(greeting ?? "Today's book", briefingBody(snapshot));
}
