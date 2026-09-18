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

