import { normalizeQuestion } from '../retrieve';
import {
  detectAssistantPeriod,
  type AssistantPeriod,
} from './period';
import {
  extractLiveMention,
  extractPersonMention,
  looksLikeBarePersonLookup,
  looksLikeRegionLookup,
  looksLikeTeamLookup,
} from './names';
import {
  comparisonUnitKind,
  detectAssistantPeriodPair,
  extractAttentionMention,
  extractCompareMentions,
  looksAttentionQuestion,
  looksEntityComparisonQuestion,
  looksPeriodComparisonQuestion,
  looksRankingQuestion,
  metricFromQuestion,
  rankingDirectionFromQuestion,
  rankingPeriodFromQuestion,
  rankingUniverseFromQuestion,
  type ComparisonMetric,
  type ComparisonUnitKind,
  type RankingDirection,
  type RankingUniverse,
} from './compare';
import { askedComparisonRank } from './rank';
import type { HierarchyRank } from '../../features/customerHierarchy';

export type LiveIntent = 'person' | 'advisor' | 'production' | 'pipeline' | 'team' | 'region' | 'licence' | 'access' | 'followups' | 'mypipeline' | 'case_summary' | 'myproduction' | 'mytarget';

export type LiveRoute =
  | { kind: 'none' }
  | { kind: 'followups' }
  | { kind: 'mypipeline' }
  | { kind: 'myproduction' }
  | { kind: 'mytarget' }
  | { kind: 'case_summary'; caseId: string }
  | { kind: 'licence' }
  | { kind: 'person'; mention: string }
  | { kind: 'access'; mention: string; topic: string }
  | {
      kind: 'advisor' | 'production' | 'pipeline' | 'team' | 'region';
      mention: string;
      period: AssistantPeriod;
    }
  | {
      kind: 'compare_period';
      mention: string;
      unit: ComparisonUnitKind;
      current: AssistantPeriod;
      baseline: AssistantPeriod;
      metric: ComparisonMetric;
    }
  | {
      kind: 'compare_entities';
      mentions: string[];
      unit: ComparisonUnitKind | 'mixed';
      period: AssistantPeriod;
      metric: ComparisonMetric;
    }
  | {
      kind: 'rank';
      universe: RankingUniverse;
      askedRank: HierarchyRank | null;
      metric: ComparisonMetric;
      period: AssistantPeriod;
      direction: RankingDirection;
      productLabel: 'top_performer' | null;
    }
  | {
      kind: 'attention';
      mention: string | null;
    }
  | { kind: 'dump'; subject: 'advisors' | 'cases' };

function looksDumpQuestion(normalized: string): { subject: 'advisors' | 'cases' } | null {
  if (/\b(every|all|entire|whole|each)\b/.test(normalized) && /\b(cases?|clients?|policies)\b/.test(normalized)) {
    return { subject: 'cases' };
  }
  if (/\b(list|show)\b.+\b(all|every)\b/.test(normalized) && /\b(cases?|clients?)\b/.test(normalized)) {
    return { subject: 'cases' };
  }
  if (/\b(how many|count)\b/.test(normalized) && /\b(advisors?|financial advisors?)\b/.test(normalized) && !/\blicen/.test(normalized)) {
    return { subject: 'advisors' };
  }
  if (/\b(every|all|entire|whole|each)\b/.test(normalized) && /\b(advisors?|people|members)\b/.test(normalized)) {
    return { subject: 'advisors' };
  }
  if (/\b(list|show)\b.+\b(all|every)\b/.test(normalized) && /\b(advisors?|people|members)\b/.test(normalized)) {
    return { subject: 'advisors' };
  }
  return null;
}

function looksHelpQuestion(normalized: string): boolean {
  if (/\b(how do i|how can i|how do we|how to|where (do|can|are) i)\b/.test(normalized)) return true;
  if (/\bwhy (cant|cannot|can't)\b/.test(normalized)) return true;
  if (/\bwhat does\b.+\bmean\b/.test(normalized)) return true;
  if (/^what (is|are) (the )?(production|pipeline|licence|license)\b/.test(normalized)) return true;
  return false;
}

function looksLicenceHelp(normalized: string): boolean {
  return /\b(how do i|how can i|how do we|where (can|do|are|is)|why (cant|cannot)|assign a licen|request (more )?licen|remove a licen)\b/.test(
    normalized,
  );
}

function looksLicenceSummary(normalized: string): boolean {
  if (looksLicenceHelp(normalized)) return false;
  const licence = /\b(licen[cs]es?|seats?|licence pool|license pool)\b/.test(normalized);
  if (!licence) return false;
  return /\b(how many|available|purchased|assigned|do we have|have we got|pool)\b/.test(normalized);
}

function looksProduction(normalized: string): boolean {
  return /\b(production|issued production|not yet issued)\b/.test(normalized);
}

function looksPipeline(normalized: string): boolean {
  return /\b(pipeline|how many cases|open cases|case count)\b/.test(normalized);
}

function looksDoing(normalized: string): boolean {
  return /\b(how is|hows|doing)\b/.test(normalized);
}

function looksNamedOtherPerson(normalized: string): boolean {
  return /\b(does|has) (?!i\b)[a-z]+(?: [a-z]+)? (have|got|scheduled)\b/.test(normalized);
}

export function looksMyProductionQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (looksHelpQuestion(normalized)) return false;
  if (/\b(what does|what happens|why (did|was|does|is)|how do i|how can i)\b/.test(normalized)) {
    return false;
  }
  if (looksNamedOtherPerson(normalized)) return false;
  if (/\b(management production|company production|team production|downline|my team|the team|region|leadership)\b/.test(normalized)) {
    return false;
  }
  if (looksLikeTeamLookup(question) || looksLikeRegionLookup(question)) return false;
  const liveAsk = /\b(how many|how much|count|do i have|have i got)\b/.test(normalized);
  const productionBook = /\b(my production|production entries|issued this month|not yet issued|not issued)\b/.test(normalized);
  const status = /\b(pending underwriting|awaiting medicals|pma pending|\bpma\b|awaiting advisor information|awaiting advisor info|accepted \/ issued|accepted issued|declined|withdrawn)\b/.test(normalized);
  if (/\b(how far am i from my target|toward(s)? my (target|goal)|percent of my (target|goal)|remaining (to|on|against) my (target|goal))\b/.test(normalized)) {
    return false;
  }
  const issuedAmount = /\bhow much\b/.test(normalized) && /\b(issued|production|commission|business|placed)\b/.test(normalized);
  if (issuedAmount) return true;
  if (liveAsk && (productionBook || status || /\bproduction\b/.test(normalized))) return true;
  if (productionBook) return true;
  if (liveAsk && status && /\b(applications?|entries)\b/.test(normalized)) return true;
  return false;
}

export function looksMyPipelineQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (looksMyProductionQuestion(question)) return false;
  if (looksHelpQuestion(normalized)) return false;
  if (/\b(what does|what happens|why (did|was|does|is)|how do i|how can i)\b/.test(normalized)) {
    return false;
  }
  if (looksNamedOtherPerson(normalized)) return false;
  if (/\b(team pipeline|downline|my team|the team|region|leadership)\b/.test(normalized)) return false;
  if (looksLikeTeamLookup(question) || looksLikeRegionLookup(question)) return false;
  if (/\b(pending underwriting|awaiting medicals|pma pending|awaiting advisor information|accepted \/ issued|not yet issued)\b/.test(normalized)) {
    return false;
  }
  const counts = /\b(how many|count|do i have|have i got|which stage|most cases|estimated commission|pipeline value|reviews? due|need fica|incomplete)\b/.test(normalized);
  const subject = /\b(pipeline|cases?|applications?|deals?|opportunit(?:y|ies)|fica|documents?|quotes?|reviews?|commission)\b/.test(normalized);
  if (counts && subject) return true;
  if (/\b(my pipeline|my cases|open cases)\b/.test(normalized)) return true;
  return false;
}

export function looksMyCaseSummaryQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (/\b(how do i|how can i|what are the six|what is fica|what happens after)\b/.test(normalized)) {
    if (!/\bwhat do i do next\b/.test(normalized)) return false;
  }
  if (/\bwhat do i do next\b/.test(normalized)) return true;
  if (/\b(this case|on this case)\b/.test(normalized) && /\b(fica|next action|submit|review|status|stage)\b/.test(normalized)) {
    return true;
  }
  if (/\b(is fica complete|does this case have|has this case been submitted)\b/.test(normalized)) return true;
  return false;
}

export function looksMyTargetProgressQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (looksHelpQuestion(normalized)) return false;
  if (/\b(what does|what happens|why (did|was|does|is)|how do i|how can i)\b/.test(normalized)) {
    return false;
  }
  if (looksNamedOtherPerson(normalized)) return false;
  if (/\b(management|downline|my team|the team|region|leadership)\b/.test(normalized)) return false;
  if (looksLikeTeamLookup(question) || looksLikeRegionLookup(question)) return false;
  if (/\bhow far am i from my target\b/.test(normalized)) return true;
  if (/\bwhat is my monthly (nett )?(goal|target)\b/.test(normalized)) return true;
  if (/\b(issued|earned) (toward|towards|against) my (target|goal)\b/.test(normalized)) return true;
  const progress = /\b(how far|remaining|left to go|progress|percent|percentage|tracking)\b/.test(normalized);
  const target = /\b(target|goal|monthly nett|nett goal)\b/.test(normalized);
  if (progress && target) return true;
  const weekly = /\b(weekly (target|activity|points)|initial contacts?|fact-?finds?|cold calls? per week|quotes per week|recommendations? per week)\b/.test(normalized);
  if (weekly && /\b(how many|what are|do i need|should i)\b/.test(normalized)) return true;
  return false;
}

export function looksMyFollowupsQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (looksHelpQuestion(normalized)) return false;
  if (/\b(what does|what happens|why (did|was|does|is)|how do i|how can i|when is the next)\b/.test(normalized)) {
    return false;
  }
  if (looksNamedOtherPerson(normalized)) return false;
  const overdue = /\b(overdue|anything overdue|past due)\b/.test(normalized);
  const today = /\b(today|due today|need to do|scheduled today)\b/.test(normalized);
  const week = /\bthis week\b/.test(normalized);
  const howMany = /\b(how many|count|do i have|have i got)\b/.test(normalized);
  const subject = /\b(follow[- ]?ups?|activit(?:y|ies)|calls?|meetings?|appointments?|reminders?|tasks?)\b/.test(normalized);
  if (overdue && (subject || /\banything\b/.test(normalized) || howMany || /^(is there|do i have)\b/.test(normalized))) {
    return true;
  }
  if ((today || week || howMany) && subject) return true;
  if (/\bwhat do i need to do today\b/.test(normalized)) return true;
  if (/\bdo i have (any )?(follow[- ]?ups?|activit(?:y|ies)|calls?)\b/.test(normalized)) return true;
  return false;
}

export function looksDoingQuestion(question: string): boolean {
  return looksDoing(normalizeQuestion(question));
}

export function looksLicencePlanningQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  const hasQuantity = /\b\d+\b/.test(normalized);
  const hire = /\b(hire|hired|import|bulk)\b/.test(normalized);
  const licence = /\b(license|seat|available|assign)\b/.test(normalized);
  return hasQuantity && hire && licence;
}

function matchNamedAccess(normalized: string): { mention: string; topic: string } | null {
  const match = normalized.match(/\bwhy (?:cant|cannot) (.+?) (?:see|access|open|use|view) (.+)$/);
  if (!match) return null;
  const who = match[1].trim();
  if (!who || /^(i|we|they|me|us)$/.test(who)) return null;
  return { mention: who, topic: match[2].trim() };
}

function unitFromQuestion(question: string): ComparisonUnitKind {
  const kind = comparisonUnitKind(question);
  return kind === 'mixed' ? 'person' : kind;
}

export function routeLiveQuestion(question: string, navigationPath?: string): LiveRoute {
  const normalized = normalizeQuestion(question);
  const namedAccess = matchNamedAccess(normalized);
  if (namedAccess) return { kind: 'access', mention: namedAccess.mention, topic: namedAccess.topic };
  if (looksHelpQuestion(normalized) && !looksMyCaseSummaryQuestion(question)) return { kind: 'none' };
  const caseIdMatch = (navigationPath ?? '').match(
    /^\/advisor\/cases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  );
  if (looksMyCaseSummaryQuestion(question) && caseIdMatch) {
    return { kind: 'case_summary', caseId: caseIdMatch[1] };
  }
  if (looksMyFollowupsQuestion(question)) return { kind: 'followups' };
  if (looksMyProductionQuestion(question)) return { kind: 'myproduction' };
  if (looksMyTargetProgressQuestion(question)) return { kind: 'mytarget' };
  if (looksMyPipelineQuestion(question)) return { kind: 'mypipeline' };
  if (looksHelpQuestion(normalized)) return { kind: 'none' };
  if (looksLicenceSummary(normalized)) return { kind: 'licence' };
  const dump = looksDumpQuestion(normalized);
  if (dump) return { kind: 'dump', subject: dump.subject };

  if (looksAttentionQuestion(question)) {
    return { kind: 'attention', mention: extractAttentionMention(question) };
  }

  if (looksRankingQuestion(question)) {
    return {
      kind: 'rank',
      universe: rankingUniverseFromQuestion(question),
      askedRank: askedComparisonRank(question),
      metric: metricFromQuestion(question),
      period: rankingPeriodFromQuestion(question),
      direction: rankingDirectionFromQuestion(question),
      productLabel: /\btop performer\b/i.test(question) ? 'top_performer' : null,
    };
  }

  if (looksPeriodComparisonQuestion(question)) {
    const pair = detectAssistantPeriodPair(normalized);
    const mention = extractCompareMentions(question)[0]
      || extractLiveMention(question)
      || extractPersonMention(question);
    if (pair && mention) {
      return {
        kind: 'compare_period',
        mention,
        unit: unitFromQuestion(question),
        current: pair.current,
        baseline: pair.baseline,
        metric: metricFromQuestion(question),
      };
    }
  }

  if (looksEntityComparisonQuestion(question)) {
    const mentions = extractCompareMentions(question);
    return {
      kind: 'compare_entities',
      mentions,
      unit: comparisonUnitKind(question),
      period: detectAssistantPeriod(normalized) ?? 'this_month',
      metric: metricFromQuestion(question),
    };
  }

  const period = detectAssistantPeriod(normalized) ?? 'this_month';
  const mention = extractLiveMention(question) || extractPersonMention(question);

  if (looksProduction(normalized) && mention) {
    if (looksLikeRegionLookup(question)) return { kind: 'region', mention, period };
    if (looksLikeTeamLookup(question)) return { kind: 'team', mention, period };
    return { kind: 'production', mention, period };
  }

  if (looksPipeline(normalized) && mention) {
    if (looksLikeRegionLookup(question)) return { kind: 'region', mention, period };
    if (looksLikeTeamLookup(question)) return { kind: 'team', mention, period };
    return { kind: 'pipeline', mention, period };
  }

  if (looksDoing(normalized) && mention) {
    if (looksLikeRegionLookup(question)) return { kind: 'region', mention, period };
    if (looksLikeTeamLookup(question)) return { kind: 'team', mention, period };
    return { kind: 'advisor', mention, period };
  }

  if (looksLikeBarePersonLookup(question)) {
    const person = extractPersonMention(question);
    if (person) return { kind: 'person', mention: person };
  }

  if (mention && looksLikeRegionLookup(question)) return { kind: 'region', mention, period };
  if (mention && looksLikeTeamLookup(question)) return { kind: 'team', mention, period };

  return { kind: 'none' };
}
