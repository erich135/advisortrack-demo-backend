import type { AssistantPublicAnswer } from '../model/types';
import { navigateActionForRoute } from '../model/compose';
import type { AssistantContext } from '../context';
import { ASSISTANT_ROUTES } from '../routes';
import { publicFactSource } from './classify';
import {
  changeDirectionWord,
  COMPARISON_METRIC_LABELS,
  type ComparisonMetric,
} from './compare';
import { formatLiveRand } from './money';
import type { ResolvedPersonCandidate, ResolvedUnitCandidate } from './resolve';
import type {
  AdvisorSummaryProjection,
  LicenceSummaryProjection,
  PersonSummaryProjection,
  PipelineSummaryProjection,
  ProductionSummaryProjection,
  ProductionTotals,
  RegionSummaryProjection,
  TeamSummaryProjection,
} from './types';
import type { MyFollowupsFocus, MyFollowupsProjection } from './followups';
import {
  myCaseNextStepBody,
  topPipelineStage,
  type MyCaseSummaryProjection,
  type MyPipelineFocus,
  type MyPipelineProjection,
} from './pipelineSelf';
import { APPLICATION_STATUS_LABELS } from '../../features/applicationStatus';
import type { MyProductionFocus, MyProductionProjection } from './productionSelf';
import type { MyTargetProgressFocus, MyTargetProgressProjection } from './targetProgress';
import type { MyContactsSummaryFocus, MyContactsSummaryProjection } from './contactsSummary';
import { companionAnswer, type CompanionFocus } from './companion';
import { type MyDashboardFocus, type MyDashboardProjection } from './dashboardSelf';
import {
  cheekyClearOverdue,
  cheekyManyWithoutNextAction,
  cheekyTargetReached,
} from '../voice';

const NOT_FOUND_COPY =
  "I couldn't find that in your AdvisorTrack scope. If you're looking for someone on your team or in your region, try their full name.";

function personLines(projection: PersonSummaryProjection): string[] {
  const lines = [projection.displayName, projection.reportingRoleLabel];
  if (projection.regionName) lines.push(`Region: ${projection.regionName}`);
  if (projection.teamName) lines.push(`Team: ${projection.teamName}`);
  lines.push(`Account: ${projection.accountStatus}`);
  if (projection.licenceStatus) lines.push(`Licence: ${projection.licenceStatus}`);
  if (projection.invitationStatus) lines.push(`Invitation: ${projection.invitationStatus}`);
  if (projection.lastMobileActivity) {
    lines.push(`Last mobile activity: ${projection.lastMobileActivity}`);
  }
  if (projection.email) lines.push(`Email: ${projection.email}`);
  if (projection.phone) lines.push(`Phone: ${projection.phone}`);
  return lines;
}

export function personSummaryAnswer(projection: PersonSummaryProjection): AssistantPublicAnswer {
  const lines = personLines(projection);
  const source = publicFactSource('PERSON_SUMMARY');
  const facts = [
    { label: 'Role', value: projection.reportingRoleLabel, source },
    ...(projection.regionName ? [{ label: 'Region', value: projection.regionName, source }] : []),
    ...(projection.teamName ? [{ label: 'Team', value: projection.teamName, source }] : []),
    { label: 'Account', value: projection.accountStatus, source },
    ...(projection.licenceStatus
      ? [{ label: 'Licence', value: projection.licenceStatus, source }]
      : []),
    ...(projection.invitationStatus
      ? [{ label: 'Invitation', value: projection.invitationStatus, source }]
      : []),
    ...(projection.lastMobileActivity
      ? [{ label: 'Last mobile activity', value: projection.lastMobileActivity, source }]
      : []),
  ];
  return {
    answerId: 'live:PERSON_SUMMARY',
    intent: 'live.PERSON_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: projection.displayName,
    body: lines.join('\n'),
    facts,
    caveats: projection.lastMobileActivity
      ? ['Last Mobile Activity is Android resource telemetry. It is not productivity, attendance, or performance.']
      : undefined,
    sources: [{ cardId: 'PERSON_SUMMARY', title: 'Person summary' }],
  };
}

function formatPoolCount(value: number | null): string {
  return value == null ? 'Unlimited' : String(value);
}

export function myFollowupsAnswer(
  projection: MyFollowupsProjection,
  focus: MyFollowupsFocus,
): AssistantPublicAnswer {
  const source = publicFactSource('MY_FOLLOWUPS');
  const noun = (count: number, singular: string, plural: string) =>
    `${count} ${count === 1 ? singular : plural}`;
  let headline = 'Your follow-ups';
  let body = `You have ${noun(projection.followUpTodayCount, 'follow-up', 'follow-ups')} scheduled today and ${noun(projection.followUpOverdueCount, 'overdue follow-up', 'overdue follow-ups')}.`;
  if (focus === 'overdue') {
    headline = projection.overdueCount === 0 ? 'Nothing overdue' : 'Overdue activities';
    body = projection.overdueCount === 0
      ? cheekyClearOverdue()
      : `You have ${noun(projection.overdueCount, 'overdue activity', 'overdue activities')}, including ${noun(projection.followUpOverdueCount, 'follow-up', 'follow-ups')}.`;
  } else if (focus === 'this_week') {
    headline = 'This week';
    body = `You have ${noun(projection.thisWeekCount, 'scheduled activity', 'scheduled activities')} this week (Monday to Sunday), including ${noun(projection.followUpTodayCount, 'follow-up today', 'follow-ups today')}.`;
  } else if (focus === 'today_calls') {
    headline = 'Calls today';
    body = `You have ${noun(projection.todayCallCount, 'call', 'calls')} scheduled today (${noun(projection.callCount, 'open call', 'open calls')} in total).`;
  } else if (focus === 'today_meetings') {
    headline = 'Meetings today';
    body = `You have ${noun(projection.todayMeetingCount, 'meeting', 'meetings')} scheduled today (${noun(projection.meetingCount, 'open meeting', 'open meetings')} in total).`;
  } else if (focus === 'today_activities') {
    headline = 'Today';
    body = `You have ${noun(projection.todayCount, 'activity', 'activities')} scheduled today and ${noun(projection.overdueCount, 'overdue activity', 'overdue activities')}.`;
  }
  return {
    answerId: 'live:MY_FOLLOWUPS',
    intent: 'live.MY_FOLLOWUPS',
    confidence: 1,
    mode: 'allowed',
    headline,
    body,
    facts: [
      { label: 'Today', value: String(projection.todayCount), source },
      { label: 'Overdue', value: String(projection.overdueCount), source },
      { label: 'This week', value: String(projection.thisWeekCount), source },
      { label: 'Follow-ups today', value: String(projection.followUpTodayCount), source },
      { label: 'Follow-ups overdue', value: String(projection.followUpOverdueCount), source },
      { label: 'Completed today', value: String(projection.completedTodayCount), source },
    ],
    sources: [{ cardId: 'MY_FOLLOWUPS', title: 'My follow-ups' }],
    caveats: ['These counts are your own scheduled work. They do not include another advisor’s book.'],
  };
}

export function myPipelineAnswer(
  projection: MyPipelineProjection,
  focus: MyPipelineFocus,
): AssistantPublicAnswer {
  const source = publicFactSource('MY_PIPELINE');
  const noun = (count: number, singular: string, plural: string) =>
    `${count} ${count === 1 ? singular : plural}`;
  const top = topPipelineStage(projection);
  let headline = 'Your pipeline';
  let body = `You have ${noun(projection.openCaseCount, 'open case', 'open cases')}.`;
  if (focus === 'open_count') {
    headline = 'Open cases';
    body = `You have ${noun(projection.openCaseCount, 'open case', 'open cases')} in your pipeline.`;
  } else if (focus === 'stage_count') {
    headline = 'Fact-finding';
    body = `You have ${noun(projection.factFindingCount, 'open case', 'open cases')} in Fact-finding.`;
  } else if (focus === 'top_stage') {
    headline = 'Busiest stage';
    body = top && top.count > 0
      ? `${top.label} currently has the most of your open cases (${top.count}).`
      : 'You have no open cases in your pipeline.';
  } else if (focus === 'commission') {
    headline = 'Estimated commission';
    body = `Estimated commission on your open cases is ${formatLiveRand(projection.totalEstimatedCommission)}.`;
  } else if (focus === 'no_next_action') {
    headline = 'Next actions';
    body = cheekyManyWithoutNextAction(projection.casesWithoutNextActionCount)
      ?? `You have ${noun(projection.casesWithoutNextActionCount, 'open case', 'open cases')} without a next action. A next action is optional.`;
    if (projection.casesWithoutNextActionCount >= 3) {
      body = `${body} Set a next action on the case if you want it moving.`;
    }
  } else if (focus === 'fica') {
    headline = 'FICA';
    body = `You have ${noun(projection.ficaIncompleteCount, 'open case', 'open cases')} still needing FICA. Incomplete FICA is a warning, not a hard block.`;
  } else if (focus === 'documents') {
    headline = 'Documents';
    body = `You have ${noun(projection.casesWithIncompleteDocumentsCount, 'open case', 'open cases')} with an incomplete document checklist.`;
  } else if (focus === 'reviews') {
    headline = 'Reviews due';
    body = projection.reviewDueCount === 0
      ? 'You have no reviews due on your open cases.'
      : `You have ${noun(projection.reviewDueCount, 'open case', 'open cases')} with a review date due.`;
  }
  return {
    answerId: 'live:MY_PIPELINE',
    intent: 'live.MY_PIPELINE',
    confidence: 1,
    mode: 'allowed',
    headline,
    body,
    facts: [
      { label: 'Open cases', value: String(projection.openCaseCount), source },
      { label: 'Fact-finding', value: String(projection.factFindingCount), source },
      { label: 'Estimated commission', value: formatLiveRand(projection.totalEstimatedCommission), source },
      { label: 'Without next action', value: String(projection.casesWithoutNextActionCount), source },
      { label: 'FICA incomplete', value: String(projection.ficaIncompleteCount), source },
      { label: 'Incomplete documents', value: String(projection.casesWithIncompleteDocumentsCount), source },
      { label: 'Reviews due', value: String(projection.reviewDueCount), source },
    ],
    sources: [{ cardId: 'MY_PIPELINE', title: 'My pipeline' }],
    caveats: ['These counts are your own book. They do not include another advisor’s pipeline or Team Pipeline.'],
  };
}

export function myProductionAnswer(
  projection: MyProductionProjection,
  focus: MyProductionFocus,
): AssistantPublicAnswer {
  const source = publicFactSource('MY_PRODUCTION');
  const noun = (count: number, singular: string, plural: string) =>
    `${count} ${count === 1 ? singular : plural}`;
  const mismatch = projection.acceptedIssuedStatusCount !== projection.issuedCount;
  const mismatchLine = mismatch
    ? ` ${noun(projection.acceptedIssuedStatusCount, 'application has', 'applications have')} status ${APPLICATION_STATUS_LABELS.accepted_issued}. ${noun(projection.issuedCount, 'is', 'are')} currently counted as issued production under the Production issued flag.`
    : '';
  let headline = 'Your production';
  let body = `You have ${noun(projection.entryCount, 'production entry', 'production entries')} this period. Issued commission is ${formatLiveRand(projection.issuedCommission)}.`;
  if (focus === 'issued_amount') {
    headline = 'Issued this month';
    body = `You have issued ${formatLiveRand(projection.issuedCommission)} under the Production issued flag (${noun(projection.issuedCount, 'entry', 'entries')}).${mismatchLine}`;
  } else if (focus === 'entry_count') {
    headline = 'Production entries';
    body = `You have ${noun(projection.entryCount, 'production entry', 'production entries')} this period.`;
  } else if (focus === 'not_issued') {
    headline = 'Not yet issued';
    body = `${formatLiveRand(projection.notIssuedCommission)} is not yet issued (${noun(projection.notIssuedCount, 'entry', 'entries')}).`;
  } else if (focus === 'accepted_issued') {
    headline = APPLICATION_STATUS_LABELS.accepted_issued;
    body = `${noun(projection.acceptedIssuedStatusCount, 'application has', 'applications have')} status ${APPLICATION_STATUS_LABELS.accepted_issued}.${mismatchLine || ` ${noun(projection.issuedCount, 'is', 'are')} counted as issued production under the Production issued flag.`}`;
  } else if (focus === 'pending_underwriting') {
    headline = APPLICATION_STATUS_LABELS.pending_underwriting;
    body = `You have ${noun(projection.pendingUnderwritingCount, 'application', 'applications')} pending underwriting.`;
  } else if (focus === 'awaiting_medicals') {
    headline = APPLICATION_STATUS_LABELS.awaiting_medicals;
    body = `You have ${noun(projection.awaitingMedicalsCount, 'application', 'applications')} awaiting medicals.`;
  } else if (focus === 'pma_pending') {
    headline = APPLICATION_STATUS_LABELS.pma_pending;
    body = `You have ${noun(projection.pmaPendingCount, 'application', 'applications')} with PMA pending.`;
  } else if (focus === 'awaiting_advisor_info') {
    headline = APPLICATION_STATUS_LABELS.awaiting_advisor_info;
    body = `You have ${noun(projection.awaitingAdvisorInfoCount, 'application', 'applications')} awaiting advisor information.`;
  } else if (focus === 'declined') {
    headline = APPLICATION_STATUS_LABELS.declined;
    body = `You have ${noun(projection.declinedCount, 'application', 'applications')} declined.`;
  } else if (focus === 'withdrawn') {
    headline = APPLICATION_STATUS_LABELS.withdrawn;
    body = `You have ${noun(projection.withdrawnCount, 'application', 'applications')} withdrawn.`;
  } else if (focus === 'blockers') {
    headline = 'Recorded pending statuses';
    const pending = [
      projection.pendingUnderwritingCount > 0
        ? noun(projection.pendingUnderwritingCount, 'application pending underwriting', 'applications pending underwriting')
        : null,
      projection.awaitingMedicalsCount > 0
        ? noun(projection.awaitingMedicalsCount, 'application awaiting medicals', 'applications awaiting medicals')
        : null,
      projection.pmaPendingCount > 0
        ? noun(projection.pmaPendingCount, 'application with PMA pending', 'applications with PMA pending')
        : null,
      projection.awaitingAdvisorInfoCount > 0
        ? noun(projection.awaitingAdvisorInfoCount, 'application awaiting advisor information', 'applications awaiting advisor information')
        : null,
    ].filter(Boolean);
    body = pending.length
      ? `Recorded statuses: ${pending.join(', ')}. Dex cannot see insurer decisions that are not on the record.`
      : 'Nothing in your recorded application statuses is sitting in a pending bucket. Dex cannot see insurer decisions that are not on the record.';
  }
  return {
    answerId: 'live:MY_PRODUCTION',
    intent: 'live.MY_PRODUCTION',
    confidence: 1,
    mode: 'allowed',
    headline,
    body,
    facts: [
      { label: 'Period', value: projection.period, source },
      { label: 'Entries', value: String(projection.entryCount), source },
      { label: 'Issued commission', value: formatLiveRand(projection.issuedCommission), source },
      { label: 'Issued entries', value: String(projection.issuedCount), source },
      { label: 'Not yet issued', value: formatLiveRand(projection.notIssuedCommission), source },
      { label: APPLICATION_STATUS_LABELS.accepted_issued, value: String(projection.acceptedIssuedStatusCount), source },
      { label: APPLICATION_STATUS_LABELS.pending_underwriting, value: String(projection.pendingUnderwritingCount), source },
    ],
    sources: [{ cardId: 'MY_PRODUCTION', title: 'My production' }],
    caveats: [
      'Issued commission uses the Production issued flag (is_issued). Home may count Accepted / Issued even when that flag is false.',
      'These figures are your own production book. They are not Management Production, team production, or financial advice.',
    ],
  };
}

export function myTargetProgressAnswer(
  projection: MyTargetProgressProjection,
  focus: MyTargetProgressFocus,
): AssistantPublicAnswer {
  const source = publicFactSource('MY_TARGET_PROGRESS');
  const remaining = formatLiveRand(projection.remainingAmount);
  const issued = formatLiveRand(projection.issuedCommission);
  const goal = formatLiveRand(projection.monthlyGoal);
  let headline = 'Target progress';
  const reached = cheekyTargetReached(projection.progressPercent);
  let body = reached
    ? `${reached} Your monthly nett goal is ${goal}. Home issued toward that goal is ${issued}.`
    : `Your monthly nett goal is ${goal}. Home issued toward that goal is ${issued} (${projection.progressPercent}%). ${remaining} remains.`;
  if (focus === 'remaining') {
    headline = 'Remaining to target';
    body = `You have ${remaining} remaining against a ${goal} monthly nett goal. Home issued so far is ${issued}.`;
  } else if (focus === 'monthly_goal') {
    headline = 'Monthly nett goal';
    body = `Your monthly nett goal is ${goal}.`;
  } else if (focus === 'issued_toward_target') {
    headline = 'Issued toward target';
    body = `Home issued toward your ${goal} goal is ${issued} (${projection.progressPercent}%).`;
  } else if (focus === 'percent') {
    headline = 'Target percent';
    body = `You are at ${projection.progressPercent}% of your ${goal} monthly nett goal.`;
  } else if (focus === 'weekly_targets') {
    headline = 'Weekly activity targets';
    body = `This week’s computed targets are ${projection.coldCallsPerWeek} initial contacts, ${projection.interviewsPerWeek} fact-finds, ${projection.quotesPerWeek} analysis/quotes, ${projection.recommendationsPerWeek} recommendations, and ${projection.casesSubmittedPerWeek} implementations. Weekly point target is ${projection.weeklyPointTarget}.`;
  }
  return {
    answerId: 'live:MY_TARGET_PROGRESS',
    intent: 'live.MY_TARGET_PROGRESS',
    confidence: 1,
    mode: 'allowed',
    headline,
    body,
    facts: [
      { label: 'Period', value: projection.period, source },
      { label: 'Monthly nett goal', value: goal, source },
      { label: 'Home issued', value: issued, source },
      { label: 'Progress', value: `${projection.progressPercent}%`, source },
      { label: 'Remaining', value: remaining, source },
      { label: 'Weekly point target', value: String(projection.weeklyPointTarget), source },
      { label: 'Initial contacts / week', value: String(projection.coldCallsPerWeek), source },
      { label: 'Fact-finding / week', value: String(projection.interviewsPerWeek), source },
    ],
    sources: [{ cardId: 'MY_TARGET_PROGRESS', title: 'My target progress' }],
    caveats: [
      'Target progress uses the Home issued definition (is_issued OR Accepted / Issued). Production issued totals use the issued flag only.',
      'These figures are your own planning workspace. They are not Management reporting or financial advice.',
    ],
  };
}

export function myContactsSummaryAnswer(
  projection: MyContactsSummaryProjection,
  focus: MyContactsSummaryFocus,
): AssistantPublicAnswer {
  const source = publicFactSource('MY_CONTACTS_SUMMARY');
  const noun = (count: number, singular: string, plural: string) =>
    `${count} ${count === 1 ? singular : plural}`;
  let headline = 'Your contacts';
  let body = `You have ${noun(projection.totalContacts, 'contact', 'contacts')} (${noun(projection.prospectCount, 'prospect', 'prospects')}, ${noun(projection.clientCount, 'client', 'clients')}).`;
  if (focus === 'total') {
    headline = 'Contact count';
    body = `You have ${noun(projection.totalContacts, 'contact', 'contacts')}.`;
  } else if (focus === 'prospects') {
    headline = 'Prospects';
    body = `You have ${noun(projection.prospectCount, 'prospect', 'prospects')}.`;
  } else if (focus === 'clients') {
    headline = 'Clients';
    body = `You have ${noun(projection.clientCount, 'client', 'clients')} marked as Client.`;
  } else if (focus === 'inactive') {
    headline = 'Inactive contacts';
    body = `You have ${noun(projection.inactiveCount, 'inactive contact', 'inactive contacts')}.`;
  } else if (focus === 'practice') {
    headline = 'Practice contacts';
    body = `You have ${noun(projection.practiceContactCount, 'practice contact', 'practice contacts')}. Practice contacts are excluded from the Live Preview cap.`;
  } else if (focus === 'real') {
    headline = 'Real contacts';
    body = `You have ${noun(projection.realContactCount, 'real contact', 'real contacts')}.`;
  } else if (focus === 'live_preview') {
    headline = 'Live Preview slots';
    body = `You are using ${projection.livePreviewActiveRealCount} of ${projection.livePreviewLimit} active real-contact slots. Practice contacts are excluded.`;
  }
  return {
    answerId: 'live:MY_CONTACTS_SUMMARY',
    intent: 'live.MY_CONTACTS_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline,
    body,
    facts: [
      { label: 'Total', value: String(projection.totalContacts), source },
      { label: 'Prospects', value: String(projection.prospectCount), source },
      { label: 'Clients', value: String(projection.clientCount), source },
      { label: 'Inactive', value: String(projection.inactiveCount), source },
      { label: 'Practice', value: String(projection.practiceContactCount), source },
      { label: 'Live Preview used', value: `${projection.livePreviewActiveRealCount}/${projection.livePreviewLimit}`, source },
    ],
    sources: [{ cardId: 'MY_CONTACTS_SUMMARY', title: 'My contacts' }],
    caveats: ['These are counts from your own book. Names, emails, and phone numbers are not included.'],
  };
}

const COMPANION_FOCUS: CompanionFocus[] = ['briefing', 'eod', 'first', 'next', 'why', 'else'];

export function myDashboardAnswer(
  projection: MyDashboardProjection,
  focus: MyDashboardFocus,
  question?: string | null,
  previousQuestion?: string | null,
): AssistantPublicAnswer {
  const source = publicFactSource('MY_DASHBOARD');
  const noun = (count: number, singular: string, plural: string) =>
    `${count} ${count === 1 ? singular : plural}`;
  if (focus === 'attention' || COMPANION_FOCUS.includes(focus as CompanionFocus)) {
    return companionAnswer(
      projection,
      focus === 'attention' ? 'briefing' : focus as CompanionFocus,
      question,
      previousQuestion,
    );
  }
  const reached = cheekyTargetReached(projection.progressPercent);
  const nextActionLine = cheekyManyWithoutNextAction(projection.casesWithoutNextAction);
  const progressLine = reached
    ? reached
    : `You're at ${projection.progressPercent}% of this month's target.`;
  const body = [
    progressLine,
    `You have ${noun(projection.openCases, 'open case', 'open cases')}, ${noun(projection.overdueActivities, 'overdue activity', 'overdue activities')} and ${noun(projection.followUpsToday, 'follow-up', 'follow-ups')} today.`,
    nextActionLine ?? (projection.casesWithoutNextAction > 0
      ? `${noun(projection.casesWithoutNextAction, 'case', 'cases')} still has no next action.`
      : null),
  ].filter(Boolean).join(' ');
  return {
    answerId: 'live:MY_DASHBOARD',
    intent: 'live.MY_DASHBOARD',
    confidence: 1,
    mode: 'allowed',
    headline: reached ? 'Target reached' : 'How you are tracking',
    body,
    facts: [
      { label: 'Target progress', value: `${projection.progressPercent}%`, source },
      { label: 'Open cases', value: String(projection.openCases), source },
      { label: 'Overdue', value: String(projection.overdueActivities), source },
      { label: 'Follow-ups today', value: String(projection.followUpsToday), source },
    ],
    sources: [{ cardId: 'MY_DASHBOARD', title: 'My dashboard' }],
    caveats: ['Target progress uses the Home issued definition. This is not a performance rating or financial advice.'],
  };
}

export function mergeLiveAnswers(answers: AssistantPublicAnswer[]): AssistantPublicAnswer {
  const usable = answers.filter(Boolean);
  if (usable.length === 1) return usable[0];
  return {
    answerId: `live:multi:${usable.map((item) => item.answerId).join('+')}`,
    intent: usable.map((item) => item.intent).join('+'),
    confidence: 1,
    mode: 'allowed',
    headline: usable[0]?.headline ?? 'Your AdvisorTrack summary',
    body: usable.map((item) => item.body).filter(Boolean).join(' '),
    facts: usable.flatMap((item) => item.facts ?? []).slice(0, 12),
    sources: usable
      .flatMap((item) => item.sources)
      .filter((source, index, list) => list.findIndex((item) => item.cardId === source.cardId) === index),
    caveats: usable.flatMap((item) => item.caveats ?? []).filter((caveat, index, list) => list.indexOf(caveat) === index).slice(0, 3),
  };
}

export function myCaseSummaryAnswer(projection: MyCaseSummaryProjection): AssistantPublicAnswer {
  const source = publicFactSource('MY_CASE_SUMMARY');
  return {
    answerId: 'live:MY_CASE_SUMMARY',
    intent: 'live.MY_CASE_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: projection.stageLabel,
    body: myCaseNextStepBody(projection),
    facts: [
      { label: 'Stage', value: projection.stageLabel, source },
      { label: 'Status', value: projection.status, source },
      { label: 'FICA complete', value: projection.ficaComplete ? 'Yes' : 'No', source },
      { label: 'Quotes', value: String(projection.quoteCount), source },
      { label: 'Insurer selected', value: projection.insurerSelected ? 'Yes' : 'No', source },
      { label: 'Next action', value: projection.hasNextAction ? 'Set' : 'Not set', source },
      { label: 'Submitted to Production', value: projection.submittedToProduction ? 'Yes' : 'No', source },
    ],
    sources: [{ cardId: 'MY_CASE_SUMMARY', title: 'My case' }],
    caveats: [
      'This describes AdvisorTrack workflow state only. It is not financial advice and does not recommend a product or insurer.',
    ],
  };
}

export function licenceSummaryAnswer(projection: LicenceSummaryProjection): AssistantPublicAnswer {
  const availableText = projection.available == null
    ? 'You currently have unlimited licences available.'
    : `You currently have ${projection.available} licences available.`;
  return {
    answerId: 'live:LICENCE_SUMMARY',
    intent: 'live.LICENCE_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: 'Licence pool',
    body: availableText,
    facts: [
      { label: 'Purchased', value: formatPoolCount(projection.purchased), source: publicFactSource('LICENCE_SUMMARY') },
      { label: 'Assigned', value: String(projection.assigned), source: publicFactSource('LICENCE_SUMMARY') },
      { label: 'Available', value: formatPoolCount(projection.available), source: publicFactSource('LICENCE_SUMMARY') },
    ],
    sources: [{ cardId: 'LICENCE_SUMMARY', title: 'Licence pool summary' }],
  };
}

export function notFoundInScopeAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'live:not_found_in_scope',
    intent: 'live.not_found_in_scope',
    confidence: 1,
    mode: 'unknown',
    headline: "I couldn't find that",
    body: NOT_FOUND_COPY,
    sources: [],
  };
}

export function personAmbiguityAnswer(candidates: ResolvedPersonCandidate[]): AssistantPublicAnswer {
  return {
    answerId: `live:disambiguate:${candidates.map((item) => item.ref).join(',')}`,
    intent: 'live.disambiguate',
    confidence: 0.5,
    mode: 'disambiguate',
    headline: 'Which of these did you mean?',
    body: 'A few people in your AdvisorTrack scope could match that name. Choose one — I will not guess.',
    clarifyingQuestion: 'Which of these did you mean?',
    disambiguation: candidates.map((item) => ({
      cardId: item.ref,
      label: [item.displayName, item.reportingRoleLabel, item.regionName || item.teamName].filter(Boolean).join(' · '),
      title: item.displayName,
    })),
    sources: [],
  };
}

export function toolUnavailableAnswer(toolTitle: string): AssistantPublicAnswer {
  return {
    answerId: 'live:unavailable',
    intent: 'live.unavailable',
    confidence: 1,
    mode: 'unknown',
    headline: 'That information is not available right now',
    body: `${toolTitle} could not be loaded. That information is temporarily unavailable.`,
    sources: [],
  };
}

export function largeScopeAnswer(input: {
  count: number | null;
  noun: string;
  actions: NonNullable<AssistantPublicAnswer['actions']>;
}): AssistantPublicAnswer {
  const countText = input.count == null
    ? `I can summarise this group or help you open the matching AdvisorTrack page.`
    : `There are ${input.count} ${input.noun} in your current scope. I can summarise the group or help you open the matching page.`;
  return {
    answerId: 'live:scope_summary',
    intent: 'live.scope_summary',
    confidence: 1,
    mode: 'allowed',
    headline: input.count == null ? 'That list is too large to show here' : `${input.count} ${input.noun}`,
    body: `${countText} I won't list every record in chat.`,
    actions: input.actions.length ? input.actions : undefined,
    sources: [],
  };
}

function productionLines(periodLabel: string, production: ProductionTotals, source: string): {
  lines: string[];
  facts: Array<{ label: string; value: string; source: string }>;
} {
  const lines = [
    periodLabel,
    `Issued production: ${formatLiveRand(production.issuedAmount)}`,
    `Issued cases: ${production.issuedCount}`,
    `Not yet issued: ${formatLiveRand(production.nonIssuedAmount)}`,
  ];
  if (production.nonIssuedCount > 0 || production.issuedCount > 0) {
    lines.push(`Not yet issued cases: ${production.nonIssuedCount}`);
  }
  return {
    lines,
    facts: [
      { label: 'Period', value: periodLabel, source },
      { label: 'Issued production', value: formatLiveRand(production.issuedAmount), source },
      { label: 'Issued cases', value: String(production.issuedCount), source },
      { label: 'Not yet issued', value: formatLiveRand(production.nonIssuedAmount), source },
      { label: 'Not yet issued cases', value: String(production.nonIssuedCount), source },
    ],
  };
}

function roleLine(role: string, regionName: string | null, teamName: string | null): string {
  if (regionName && !teamName) return `${role} — ${regionName}`;
  if (teamName && regionName) return `${role} — ${teamName}, ${regionName}`;
  if (teamName) return `${role} — ${teamName}`;
  return role;
}

export function advisorSummaryAnswer(
  projection: AdvisorSummaryProjection,
  extra?: { unavailable?: Array<'production' | 'pipeline'> },
): AssistantPublicAnswer {
  const person = projection.person;
  const lines = [person.displayName, roleLine(person.reportingRoleLabel, person.regionName, person.teamName)];
  const facts: Array<{ label: string; value: string; source: string }> = [
    { label: 'Role', value: person.reportingRoleLabel, source: publicFactSource('ADVISOR_SUMMARY') },
  ];
  if (person.accountStatus) {
    lines.push(`Account: ${person.accountStatus}`);
    facts.push({ label: 'Account', value: person.accountStatus, source: publicFactSource('ADVISOR_SUMMARY') });
  }
  if (person.licenceStatus) {
    lines.push(`Licence: ${person.licenceStatus}`);
    facts.push({ label: 'Licence', value: person.licenceStatus, source: publicFactSource('ADVISOR_SUMMARY') });
  }
  if (projection.production) {
    const produced = productionLines(
      projection.periodLabel,
      projection.production,
      publicFactSource('PRODUCTION_SUMMARY', projection.periodLabel),
    );
    lines.push('', ...produced.lines);
    facts.push(...produced.facts);
  }
  if (projection.openPipelineCases != null) {
    lines.push(`Open pipeline cases: ${projection.openPipelineCases}`);
    facts.push({
      label: 'Open pipeline cases',
      value: String(projection.openPipelineCases),
      source: publicFactSource('PIPELINE_SUMMARY'),
    });
  }
  if (projection.pipelineValue != null) {
    lines.push(`Pipeline value: ${formatLiveRand(projection.pipelineValue)}`);
    facts.push({
      label: 'Pipeline value',
      value: formatLiveRand(projection.pipelineValue),
      source: publicFactSource('PIPELINE_SUMMARY'),
    });
  }
  if (person.lastMobileActivity) {
    lines.push(`Last mobile activity: ${person.lastMobileActivity}`);
    facts.push({
      label: 'Last mobile activity',
      value: person.lastMobileActivity,
      source: publicFactSource('ADVISOR_SUMMARY'),
    });
  }
  const caveats: string[] = [];
  if (person.lastMobileActivity) {
    caveats.push('Last Mobile Activity is Android resource telemetry. It is not productivity, attendance, or performance.');
  }
  if (extra?.unavailable?.includes('pipeline')) {
    lines.push('Pipeline information is temporarily unavailable.');
    caveats.push('Pipeline information is temporarily unavailable.');
  }
  if (extra?.unavailable?.includes('production')) {
    lines.push('Production information is temporarily unavailable.');
    caveats.push('Production information is temporarily unavailable.');
  }
  return {
    answerId: 'live:ADVISOR_SUMMARY',
    intent: 'live.ADVISOR_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: person.displayName,
    body: lines.filter((line, index) => line !== '' || lines[index + 1]).join('\n').trim(),
    facts,
    caveats: caveats.length ? caveats : undefined,
    sources: [
      { cardId: 'ADVISOR_SUMMARY', title: 'Advisor summary' },
      ...(projection.production ? [{ cardId: 'PRODUCTION_SUMMARY', title: 'Production summary' }] : []),
      ...(projection.openPipelineCases != null ? [{ cardId: 'PIPELINE_SUMMARY', title: 'Pipeline summary' }] : []),
    ],
  };
}

export function productionSummaryAnswer(projection: ProductionSummaryProjection): AssistantPublicAnswer {
  const produced = productionLines(
    projection.periodLabel,
    projection.production,
    publicFactSource('PRODUCTION_SUMMARY', projection.periodLabel),
  );
  return {
    answerId: 'live:PRODUCTION_SUMMARY',
    intent: 'live.PRODUCTION_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: projection.subjectName,
    body: [projection.subjectName, ...produced.lines].join('\n'),
    facts: produced.facts,
    sources: [{ cardId: 'PRODUCTION_SUMMARY', title: 'Production summary' }],
  };
}

export function pipelineSummaryAnswer(projection: PipelineSummaryProjection): AssistantPublicAnswer {
  const lines = [
    projection.subjectName,
    `Total cases: ${projection.totalCases}`,
    `Open pipeline cases: ${projection.openCases}`,
  ];
  const facts = [
    { label: 'Total cases', value: String(projection.totalCases), source: publicFactSource('PIPELINE_SUMMARY') },
    { label: 'Open pipeline cases', value: String(projection.openCases), source: publicFactSource('PIPELINE_SUMMARY') },
  ];
  for (const stage of projection.stageCounts) {
    lines.push(`${stage.label}: ${stage.count}`);
    facts.push({ label: stage.label, value: String(stage.count), source: publicFactSource('PIPELINE_SUMMARY') });
  }
  if (projection.pipelineValue != null) {
    lines.push(`Pipeline value: ${formatLiveRand(projection.pipelineValue)}`);
    facts.push({
      label: 'Pipeline value',
      value: formatLiveRand(projection.pipelineValue),
      source: publicFactSource('PIPELINE_SUMMARY'),
    });
  }
  return {
    answerId: 'live:PIPELINE_SUMMARY',
    intent: 'live.PIPELINE_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: projection.subjectName,
    body: lines.join('\n'),
    facts,
    sources: [{ cardId: 'PIPELINE_SUMMARY', title: 'Pipeline summary' }],
  };
}

export function teamSummaryAnswer(projection: TeamSummaryProjection): AssistantPublicAnswer {
  const lines = [projection.name];
  const facts: Array<{ label: string; value: string; source: string }> = [];
  if (projection.leaderName) {
    lines.push(`Team Leader: ${projection.leaderName}`);
    facts.push({ label: 'Team Leader', value: projection.leaderName, source: publicFactSource('TEAM_SUMMARY') });
  }
  if (projection.regionName) {
    lines.push(`Region: ${projection.regionName}`);
    facts.push({ label: 'Region', value: projection.regionName, source: publicFactSource('TEAM_SUMMARY') });
  }
  lines.push(`Advisors: ${projection.advisorCount}`);
  facts.push({ label: 'Advisors', value: String(projection.advisorCount), source: publicFactSource('TEAM_SUMMARY') });
  if (projection.production) {
    const produced = productionLines(
      projection.periodLabel,
      projection.production,
      publicFactSource('PRODUCTION_SUMMARY', projection.periodLabel),
    );
    lines.push('', ...produced.lines);
    facts.push(...produced.facts);
  }
  if (projection.openPipelineCases != null) {
    lines.push(`Open pipeline cases: ${projection.openPipelineCases}`);
    facts.push({
      label: 'Open pipeline cases',
      value: String(projection.openPipelineCases),
      source: publicFactSource('PIPELINE_SUMMARY'),
    });
  }
  if (projection.pipelineValue != null) {
    lines.push(`Pipeline value: ${formatLiveRand(projection.pipelineValue)}`);
    facts.push({
      label: 'Pipeline value',
      value: formatLiveRand(projection.pipelineValue),
      source: publicFactSource('PIPELINE_SUMMARY'),
    });
  }
  return {
    answerId: 'live:TEAM_SUMMARY',
    intent: 'live.TEAM_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: projection.name,
    body: lines.join('\n').replace(/\n\n+/g, '\n\n').trim(),
    facts,
    sources: [{ cardId: 'TEAM_SUMMARY', title: 'Team summary' }],
  };
}

export function regionSummaryAnswer(projection: RegionSummaryProjection): AssistantPublicAnswer {
  const lines = [projection.name];
  const facts: Array<{ label: string; value: string; source: string }> = [];
  if (projection.managerName) {
    lines.push(`Regional Manager: ${projection.managerName}`);
    facts.push({ label: 'Regional Manager', value: projection.managerName, source: publicFactSource('REGION_SUMMARY') });
  }
  lines.push(`Teams: ${projection.teamCount}`);
  lines.push(`Advisors: ${projection.advisorCount}`);
  facts.push({ label: 'Teams', value: String(projection.teamCount), source: publicFactSource('REGION_SUMMARY') });
  facts.push({ label: 'Advisors', value: String(projection.advisorCount), source: publicFactSource('REGION_SUMMARY') });
  if (projection.production) {
    const produced = productionLines(
      projection.periodLabel,
      projection.production,
      publicFactSource('PRODUCTION_SUMMARY', projection.periodLabel),
    );
    lines.push('', ...produced.lines);
    facts.push(...produced.facts);
  }
  if (projection.openPipelineCases != null) {
    lines.push(`Open pipeline cases: ${projection.openPipelineCases}`);
    facts.push({
      label: 'Open pipeline cases',
      value: String(projection.openPipelineCases),
      source: publicFactSource('PIPELINE_SUMMARY'),
    });
  }
  if (projection.pipelineValue != null) {
    lines.push(`Pipeline value: ${formatLiveRand(projection.pipelineValue)}`);
    facts.push({
      label: 'Pipeline value',
      value: formatLiveRand(projection.pipelineValue),
      source: publicFactSource('PIPELINE_SUMMARY'),
    });
  }
  return {
    answerId: 'live:REGION_SUMMARY',
    intent: 'live.REGION_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: projection.name,
    body: lines.join('\n').replace(/\n\n+/g, '\n\n').trim(),
    facts,
    sources: [{ cardId: 'REGION_SUMMARY', title: 'Region summary' }],
  };
}

export function unitAmbiguityAnswer(candidates: ResolvedUnitCandidate[]): AssistantPublicAnswer {
  return {
    answerId: `live:disambiguate:${candidates.map((item) => item.ref).join(',')}`,
    intent: 'live.disambiguate',
    confidence: 0.5,
    mode: 'disambiguate',
    headline: 'Which of these did you mean?',
    body: 'A few teams or regions in your AdvisorTrack scope could match that name. Choose one — I will not guess.',
    clarifyingQuestion: 'Which of these did you mean?',
    disambiguation: candidates.map((item) => ({
      cardId: item.ref,
      label: [item.displayName, item.detail].filter(Boolean).join(' · '),
      title: item.displayName,
    })),
    sources: [],
  };
}

export function liveNavigateActions(context: AssistantContext, routeIds: string[]): NonNullable<AssistantPublicAnswer['actions']> {
  return routeIds
    .map((routeId) => navigateActionForRoute(ASSISTANT_ROUTES, routeId, context))
    .filter((action): action is NonNullable<typeof action> => Boolean(action));
}

function formatMetricValue(metric: ComparisonMetric, value: number): string {
  if (metric === 'issued_amount' || metric === 'not_issued_amount' || metric === 'pipeline_value') {
    return formatLiveRand(value);
  }
  return String(value);
}

export function mixedComparisonClarifyAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'live:compare_clarify',
    intent: 'live.compare_clarify',
    confidence: 0.5,
    mode: 'clarify',
    headline: 'Which comparison should I make?',
    body: 'I can compare people with people, teams with teams, or regions with regions. I will not mix those.',
    clarifyingQuestion: 'Should I compare people, teams, or regions?',
    sources: [],
  };
}

export function compareNeedSecondAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'live:compare_clarify',
    intent: 'live.compare_clarify',
    confidence: 0.5,
    mode: 'clarify',
    headline: 'Who should I compare?',
    body: 'I can compare two to four people, teams, or regions in your AdvisorTrack scope. Name the subjects to compare.',
    clarifyingQuestion: 'Which two people, teams, or regions should I compare?',
    sources: [],
  };
}

export function compareTooManyAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'live:compare_clarify',
    intent: 'live.compare_clarify',
    confidence: 0.5,
    mode: 'clarify',
    headline: 'Too many names to compare',
    body: 'I can compare up to 4 names at a time.',
    clarifyingQuestion: 'Which up to four people, teams, or regions should I compare?',
    sources: [],
  };
}

export function rankingHierarchyAnswer(input: {
  askedLabel: string;
  comparisonLabel: string;
}): AssistantPublicAnswer {
  return {
    answerId: 'live:RANKING_SUMMARY',
    intent: 'live.RANKING_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: 'That ranking is not used for your role',
    body: `AdvisorTrack compares ${input.comparisonLabel}s in your reporting scope. I don't rank ${input.askedLabel}s for your role.`,
    sources: [{ cardId: 'RANKING_SUMMARY', title: 'Ranking summary' }],
  };
}

export function rankingEmptyAnswer(message: string): AssistantPublicAnswer {
  return {
    answerId: 'live:RANKING_SUMMARY',
    intent: 'live.RANKING_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: 'No ranking for this period',
    body: message,
    sources: [{ cardId: 'RANKING_SUMMARY', title: 'Ranking summary' }],
  };
}

export function periodComparisonAnswer(input: {
  subjectName: string;
  metric: ComparisonMetric;
  currentLabel: string;
  baselineLabel: string;
  currentValue: number;
  baselineValue: number;
  absoluteChange: number;
  percentChange: number | null;
  zeroDenominator: boolean;
  partial: boolean;
  actions?: AssistantPublicAnswer['actions'];
}): AssistantPublicAnswer {
  const metricLabel = COMPARISON_METRIC_LABELS[input.metric];
  const currentText = formatMetricValue(input.metric, input.currentValue);
  const baselineText = formatMetricValue(input.metric, input.baselineValue);
  const difference = formatMetricValue(input.metric, Math.abs(input.absoluteChange));
  const direction = changeDirectionWord(input.absoluteChange);
  const source = publicFactSource('COMPARISON_SUMMARY', input.currentLabel);
  const lines = [
    `${input.subjectName} — ${metricLabel}`,
    `${input.currentLabel}: ${currentText}`,
    `${input.baselineLabel}: ${baselineText}`,
  ];
  if (direction === 'unchanged') {
    lines.push('Difference: unchanged');
  } else {
    lines.push(`Difference: ${input.absoluteChange > 0 ? '+' : '−'}${difference}`);
  }
  if (input.zeroDenominator) {
    lines.push('No percentage change is shown because the earlier period was zero');
  } else if (input.percentChange != null) {
    const signed = input.percentChange > 0 ? `+${input.percentChange}` : String(input.percentChange);
    lines.push(`Change: ${signed}%`);
  }
  if (input.partial) {
    const inProgress = input.currentLabel.includes('Month')
      ? 'the current month is still in progress'
      : input.currentLabel.includes('Week')
        ? 'the current week is still in progress'
        : 'the current period is still in progress';
    if (direction === 'unchanged') {
      lines.push(`${input.currentLabel} currently matches ${input.baselineLabel}, but ${inProgress}.`);
    } else {
      lines.push(
        `${input.currentLabel} is currently ${difference} ${direction} than ${input.baselineLabel}, but ${inProgress}.`,
      );
    }
  } else if (direction !== 'unchanged') {
    lines.push(`${input.subjectName}'s ${metricLabel} is ${direction} than ${input.baselineLabel}.`);
  }
  return {
    answerId: 'live:COMPARISON_SUMMARY',
    intent: 'live.COMPARISON_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: input.subjectName,
    body: lines.join('\n'),
    facts: [
      { label: input.currentLabel, value: currentText, source },
      { label: input.baselineLabel, value: baselineText, source },
      { label: 'Difference', value: direction === 'unchanged' ? 'unchanged' : difference, source },
    ],
    caveats: input.partial ? [`${input.currentLabel} is incomplete.`] : undefined,
    actions: input.actions,
    sources: [{ cardId: 'COMPARISON_SUMMARY', title: 'Comparison summary' }],
  };
}

export function entityComparisonAnswer(input: {
  metric: ComparisonMetric;
  periodLabel: string;
  subjects: Array<{ name: string; value: number }>;
  absoluteChange: number;
  percentChange: number | null;
  zeroDenominator: boolean;
  actions?: AssistantPublicAnswer['actions'];
}): AssistantPublicAnswer {
  const metricLabel = COMPARISON_METRIC_LABELS[input.metric];
  const source = publicFactSource('COMPARISON_SUMMARY', input.periodLabel);
  const lines = [`${metricLabel} — ${input.periodLabel}`];
  const facts: Array<{ label: string; value: string; source: string }> = [];
  for (const subject of input.subjects) {
    const value = formatMetricValue(input.metric, subject.value);
    lines.push(`${subject.name}: ${value}`);
    facts.push({ label: subject.name, value, source });
  }
  const first = input.subjects[0];
  const second = input.subjects[1];
  if (first && second) {
    const direction = changeDirectionWord(input.absoluteChange);
    const difference = formatMetricValue(input.metric, Math.abs(input.absoluteChange));
    if (direction === 'unchanged') {
      lines.push(`${first.name} and ${second.name} currently match on ${metricLabel}.`);
    } else {
      lines.push(`${first.name}'s ${metricLabel} is ${difference} ${direction} than ${second.name}.`);
    }
    if (input.zeroDenominator) {
      lines.push(`No percentage change is shown because ${second.name} was zero`);
    } else if (input.percentChange != null) {
      const signed = input.percentChange > 0 ? `+${input.percentChange}` : String(input.percentChange);
      lines.push(`Change: ${signed}%`);
    }
  }
  return {
    answerId: 'live:COMPARISON_SUMMARY',
    intent: 'live.COMPARISON_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: input.subjects.map((item) => item.name).join(' and '),
    body: lines.join('\n'),
    facts,
    actions: input.actions,
    sources: [{ cardId: 'COMPARISON_SUMMARY', title: 'Comparison summary' }],
  };
}

export function rankingListAnswer(input: {
  headline: string;
  metric: ComparisonMetric;
  periodLabel: string;
  rows: Array<{ name: string; value: number }>;
  productLabel?: string | null;
  emptyMessage?: string | null;
  actions?: AssistantPublicAnswer['actions'];
}): AssistantPublicAnswer {
  const metricLabel = COMPARISON_METRIC_LABELS[input.metric];
  const source = publicFactSource('RANKING_SUMMARY', input.periodLabel);
  if (!input.rows.length) {
    return rankingEmptyAnswer(input.emptyMessage || 'No issued cases for selected period');
  }
  const lines = [
    `${input.headline} — ${metricLabel} — ${input.periodLabel}`,
    ...(input.productLabel ? [`AdvisorTrack ${input.productLabel}: ${input.rows[0].name}`] : []),
  ];
  const facts: Array<{ label: string; value: string; source: string }> = [];
  input.rows.forEach((row, index) => {
    const value = formatMetricValue(input.metric, row.value);
    lines.push(`${index + 1}. ${row.name} — ${value}`);
    facts.push({ label: row.name, value, source });
  });
  lines.push('I can show up to 5 names.');
  return {
    answerId: 'live:RANKING_SUMMARY',
    intent: 'live.RANKING_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: input.productLabel ? `Top Performer — ${input.rows[0].name}` : input.headline,
    body: lines.join('\n'),
    facts,
    actions: input.actions,
    sources: [{ cardId: 'RANKING_SUMMARY', title: 'Ranking summary' }],
  };
}

export function attentionAnswer(input: {
  subjects: Array<{ name: string; reasons: string[] }>;
  mobileTelemetry: boolean;
  actions?: AssistantPublicAnswer['actions'];
}): AssistantPublicAnswer {
  const source = publicFactSource('ATTENTION_SUMMARY');
  const lines: string[] = [];
  const facts: Array<{ label: string; value: string; source: string }> = [];
  if (!input.subjects.length) {
    return {
      answerId: 'live:ATTENTION_SUMMARY',
      intent: 'live.ATTENTION_SUMMARY',
      confidence: 1,
      mode: 'allowed',
      headline: 'Needs Attention',
      body: 'No one in your AdvisorTrack scope is currently flagged Needs Attention.',
      actions: input.actions,
      sources: [{ cardId: 'ATTENTION_SUMMARY', title: 'Needs Attention summary' }],
    };
  }
  for (const subject of input.subjects) {
    lines.push(`AdvisorTrack currently flags ${subject.name} as Needs Attention because:`);
    for (const reason of subject.reasons) {
      lines.push(`- ${reason}`);
    }
    facts.push({ label: subject.name, value: subject.reasons.join('; '), source });
    lines.push('');
  }
  return {
    answerId: 'live:ATTENTION_SUMMARY',
    intent: 'live.ATTENTION_SUMMARY',
    confidence: 1,
    mode: 'allowed',
    headline: 'Needs Attention',
    body: lines.join('\n').trim(),
    facts,
    caveats: input.mobileTelemetry
      ? ['Last Mobile Activity is Android resource telemetry. It is not productivity, attendance, or performance.']
      : undefined,
    actions: input.actions,
    sources: [{ cardId: 'ATTENTION_SUMMARY', title: 'Needs Attention summary' }],
  };
}

