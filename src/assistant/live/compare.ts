import { normalizeQuestion } from '../retrieve';
import {
  ASSISTANT_PERIOD_COMPLETE,
  ASSISTANT_PERIOD_LABELS,
  detectAssistantPeriod,
  type AssistantPeriod,
} from './period';
import { extractLiveMention, extractPersonMention } from './names';
import type { PipelineAggregate, ProductionTotals, RegisteredDerivationOutput } from './types';

export const COMPARISON_METRICS = [
  'issued_amount',
  'issued_count',
  'not_issued_amount',
  'not_issued_count',
  'active_cases',
  'pipeline_value',
] as const;

export type ComparisonMetric = (typeof COMPARISON_METRICS)[number];
export type ComparisonUnitKind = 'person' | 'team' | 'region';
export type RankingDirection = 'highest' | 'lowest';
export type RankingUniverse = 'people' | 'team' | 'region';

export const COMPARISON_METRIC_LABELS: Record<ComparisonMetric, string> = {
  issued_amount: 'issued production',
  issued_count: 'issued cases',
  not_issued_amount: 'not-yet-issued business',
  not_issued_count: 'not-yet-issued cases',
  active_cases: 'open pipeline cases',
  pipeline_value: 'pipeline value',
};

export const MAX_COMPARISON_SUBJECTS = 4;
export const MAX_RANKING_ROWS = 5;
export const MAX_RANKING_CANDIDATES = 40;
export const MAX_ATTENTION_ROWS = 5;

const PIPELINE_METRICS: ComparisonMetric[] = ['active_cases', 'pipeline_value'];

export function isPipelineMetric(metric: ComparisonMetric): boolean {
  return PIPELINE_METRICS.includes(metric);
}

export function metricFromQuestion(question: string): ComparisonMetric {
  const normalized = normalizeQuestion(question);
  if (/\bpipeline value\b/.test(normalized)) return 'pipeline_value';
  if (/\b(open cases|active cases|pipeline cases)\b/.test(normalized)) return 'active_cases';
  if (/\b(not[ -]?yet[ -]?issued|not issued|non issued|non-issued)\b/.test(normalized)) {
    return /\b(cases|count)\b/.test(normalized) ? 'not_issued_count' : 'not_issued_amount';
  }
  if (/\b(issued cases|issued count)\b/.test(normalized)) return 'issued_count';
  return 'issued_amount';
}

export function metricValue(
  metric: ComparisonMetric,
  production: ProductionTotals | null | undefined,
  pipeline: PipelineAggregate | null | undefined,
): number | null {
  switch (metric) {
    case 'issued_amount':
      return production ? production.issuedAmount : null;
    case 'issued_count':
      return production ? production.issuedCount : null;
    case 'not_issued_amount':
      return production ? production.nonIssuedAmount : null;
    case 'not_issued_count':
      return production ? production.nonIssuedCount : null;
    case 'active_cases':
      return pipeline ? pipeline.openCases : null;
    case 'pipeline_value':
      return pipeline?.pipelineValue ?? null;
    default:
      return null;
  }
}

export function detectAssistantPeriodPair(normalized: string): {
  current: AssistantPeriod;
  baseline: AssistantPeriod;
} | null {
  const found: AssistantPeriod[] = [];
  const checks: Array<[RegExp, AssistantPeriod]> = [
    [/\blast week\b/, 'last_week'],
    [/\blast month\b/, 'last_month'],
    [/\b(year to date|ytd|this year)\b/, 'year_to_date'],
    [/\bthis week\b/, 'this_week'],
    [/\b(this month|current month)\b/, 'this_month'],
  ];
  for (const [pattern, period] of checks) {
    if (pattern.test(normalized) && !found.includes(period)) found.push(period);
  }
  if (found.length >= 2) {
    const current = found.find((period) => !ASSISTANT_PERIOD_COMPLETE[period]) ?? found[0];
    const baseline = found.find((period) => period !== current) ?? found[1];
    return { current, baseline };
  }
  if (found.length === 1 && ASSISTANT_PERIOD_COMPLETE[found[0]]) {
    if (found[0] === 'last_week') return { current: 'this_week', baseline: 'last_week' };
    if (found[0] === 'last_month') return { current: 'this_month', baseline: 'last_month' };
  }
  return null;
}

export function looksAttentionQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return /\bneed(?:s)? attention\b/.test(normalized) && !/\btop performer\b/.test(normalized);
}

export function looksRankingQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (looksAttentionQuestion(normalized)) return false;
  if (/\btop performer\b/.test(normalized)) return true;
  if (/\bworst performer\b/.test(normalized)) return true;
  if (/\b(which|who|what)\b/.test(normalized) && /\b(highest|most|lowest|least)\b/.test(normalized)) {
    return true;
  }
  return false;
}

export function looksPeriodComparisonQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (looksAttentionQuestion(normalized) || looksRankingQuestion(normalized)) return false;
  const pair = detectAssistantPeriodPair(normalized);
  if (!pair) return false;
  return /\b(compared?|versus|\bvs\b|up or down|higher or lower|compare)\b/.test(normalized);
}

export function looksEntityComparisonQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (looksAttentionQuestion(normalized) || looksRankingQuestion(normalized)) return false;
  if (looksPeriodComparisonQuestion(normalized)) return false;
  return /\bcompare\b/.test(normalized);
}

export function extractCompareMentions(question: string): string[] {
  const stripped = question
    .trim()
    .replace(/[?!.]+$/g, '')
    .replace(/^(?:compare|how is|how's|is)\s+/i, '')
    .replace(/\b(this month so far|this week so far|year to date|this month|this week|last month|last week|current month|ytd)\b/gi, ' ')
    .replace(/\b(compared(?:\s+with|\s+to)?|doing|up or down from|issued production|not[ -]?yet[ -]?issued|pipeline value|production)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = stripped
    .split(/\s*(?:,|\band\b|\bversus\b|\bvs\.?\b|\bwith\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const mentions: string[] = [];
  for (const part of parts) {
    const mention = extractLiveMention(part) || extractPersonMention(part);
    if (mention && !mentions.includes(mention)) mentions.push(mention);
  }
  return mentions;
}

export function extractAttentionMention(question: string): string | null {
  const match = question.match(/\b(?:why does|does)\s+(.+?)\s+need attention\b/i);
  if (match?.[1]) {
    return extractPersonMention(match[1]) || extractLiveMention(match[1]);
  }
  if (/\bwho needs attention\b/i.test(question)) return null;
  return extractPersonMention(question) || extractLiveMention(question);
}

export function comparisonUnitKind(question: string): ComparisonUnitKind | 'mixed' {
  const hasTeam = /\bteams?\b/i.test(question);
  const hasRegion = /\bregions?\b/i.test(question);
  const mentions = extractCompareMentions(question);
  const attachedTo = (mention: string, label: 'team' | 'region'): boolean => {
    const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b\\s+${label}s?\\b|\\b${label}s?\\s+${escaped}\\b`, 'i').test(question);
  };
  const teamMentions = mentions.filter((mention) => attachedTo(mention, 'team'));
  const regionMentions = mentions.filter((mention) => attachedTo(mention, 'region'));
  const otherMentions = mentions.filter((mention) => !attachedTo(mention, 'team') && !attachedTo(mention, 'region'));
  if ((teamMentions.length && regionMentions.length) || (otherMentions.length && (teamMentions.length || regionMentions.length))) {
    return 'mixed';
  }
  if (hasTeam && !hasRegion) return 'team';
  if (hasRegion && !hasTeam) return 'region';
  return 'person';
}

export function rankingUniverseFromQuestion(question: string): RankingUniverse {
  const normalized = normalizeQuestion(question);
  if (/\bregional managers?\b/.test(normalized) || /\bteam leaders?\b/.test(normalized)) return 'people';
  if (/\bfinancial advisors?\b/.test(normalized)) return 'people';
  if (/\bregions?\b/.test(normalized)) return 'region';
  if (/\bteams?\b/.test(normalized)) return 'team';
  if (/\badvisors?\b/.test(normalized) || /\btop performer\b/.test(normalized)) return 'people';
  return 'people';
}

export function rankingDirectionFromQuestion(question: string): RankingDirection {
  const normalized = normalizeQuestion(question);
  if (/\b(lowest|least|worst)\b/.test(normalized)) return 'lowest';
  return 'highest';
}

export function rankingPeriodFromQuestion(question: string): AssistantPeriod {
  if (/\btop performer\b/i.test(question) && !detectAssistantPeriod(normalizeQuestion(question))) {
    return 'last_month';
  }
  return detectAssistantPeriod(normalizeQuestion(question)) ?? 'this_month';
}

export function deriveAbsoluteChange(
  currentValue: number,
  baselineValue: number,
): RegisteredDerivationOutput {
  const absoluteChange = currentValue - baselineValue;
  return {
    derivationId: 'ABSOLUTE_CHANGE',
    facts: {
      currentValue,
      baselineValue,
      absoluteChange,
      absoluteDifference: Math.abs(absoluteChange),
      direction: absoluteChange > 0 ? 'higher' : absoluteChange < 0 ? 'lower' : 'unchanged',
    },
  };
}

export function derivePercentChange(
  currentValue: number,
  baselineValue: number,
): RegisteredDerivationOutput {
  if (baselineValue === 0) {
    return {
      derivationId: 'PERCENT_CHANGE',
      facts: {
        currentValue,
        baselineValue,
        percentChange: null,
        zeroDenominator: true,
      },
    };
  }
  return {
    derivationId: 'PERCENT_CHANGE',
    facts: {
      currentValue,
      baselineValue,
      percentChange: Math.round(((currentValue - baselineValue) / baselineValue) * 100),
      zeroDenominator: false,
    },
  };
}

export function changeDirectionWord(absoluteChange: number): 'higher' | 'lower' | 'unchanged' {
  if (absoluteChange > 0) return 'higher';
  if (absoluteChange < 0) return 'lower';
  return 'unchanged';
}

export function periodPairLabels(current: AssistantPeriod, baseline: AssistantPeriod): {
  currentLabel: string;
  baselineLabel: string;
  currentComplete: boolean;
  baselineComplete: boolean;
  partial: boolean;
} {
  return {
    currentLabel: ASSISTANT_PERIOD_LABELS[current],
    baselineLabel: ASSISTANT_PERIOD_LABELS[baseline],
    currentComplete: ASSISTANT_PERIOD_COMPLETE[current],
    baselineComplete: ASSISTANT_PERIOD_COMPLETE[baseline],
    partial: !ASSISTANT_PERIOD_COMPLETE[current] && ASSISTANT_PERIOD_COMPLETE[baseline],
  };
}
