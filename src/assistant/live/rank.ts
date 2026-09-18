import {
  comparisonRankFor,
  RANK_LABELS,
  type HierarchyRank,
} from '../../features/customerHierarchy';
import { pickTopAndWorst } from '../../features/performanceRanking';
import { displayNameOf } from './names';
import {
  MAX_RANKING_ROWS,
  type ComparisonMetric,
  type RankingDirection,
  type RankingUniverse,
} from './compare';
import type { AssistantPeriod } from './period';
import type { DirectoryPerson, ToolExecutionContext } from './types';

export function callerHierarchyRank(ctx: ToolExecutionContext): HierarchyRank | null {
  const rank = ctx.identity.reportingRank;
  if (
    rank === 'executive'
    || rank === 'regional_manager'
    || rank === 'team_leader'
    || rank === 'financial_advisor'
    || rank === 'platform_admin'
  ) {
    return rank;
  }
  return null;
}

export function productComparisonRank(ctx: ToolExecutionContext): HierarchyRank | null {
  const rank = callerHierarchyRank(ctx);
  if (!rank) return null;
  return comparisonRankFor(rank);
}

export function askedComparisonRank(question: string): HierarchyRank | null {
  const normalized = question.toLowerCase();
  if (/\bregional managers?\b/.test(normalized)) return 'regional_manager';
  if (/\bteam leaders?\b/.test(normalized)) return 'team_leader';
  if (/\bfinancial advisors?\b/.test(normalized)) return 'financial_advisor';
  if (/\badvisors?\b/.test(normalized) && !/\bregional\b/.test(normalized) && !/\bteam leaders?\b/.test(normalized)) {
    return 'financial_advisor';
  }
  return null;
}

export function rankingPeople(
  people: DirectoryPerson[],
  ctx: ToolExecutionContext,
): DirectoryPerson[] {
  const comparison = productComparisonRank(ctx);
  if (!comparison) return [];
  return people.filter((person) => person.rank === comparison && person.id !== ctx.identity.userId);
}

export type RankingRow = {
  name: string;
  roleLabel: string;
  value: number;
  memberId: string;
};

export function sortRankingRows(
  rows: RankingRow[],
  direction: RankingDirection,
): RankingRow[] {
  const sorted = [...rows].sort((left, right) => {
    if (left.value !== right.value) {
      return direction === 'highest' ? right.value - left.value : left.value - right.value;
    }
    const byName = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return left.memberId.localeCompare(right.memberId);
  });
  return sorted.slice(0, MAX_RANKING_ROWS);
}

export function productTopPerformer(rows: RankingRow[]): {
  top: RankingRow | null;
  worst: RankingRow | null;
  emptyReason: 'no_subordinates' | 'no_issued_cases' | 'single_subordinate' | 'tied' | null;
} {
  const picked = pickTopAndWorst(rows.map((row) => ({
    userId: row.memberId,
    name: row.name,
    role: row.roleLabel,
    issuedAmount: row.value,
  })));
  const top = picked.top
    ? rows.find((row) => row.memberId === picked.top?.userId) ?? null
    : null;
  const worst = picked.worst
    ? rows.find((row) => row.memberId === picked.worst?.userId) ?? null
    : null;
  return { top, worst, emptyReason: picked.emptyReason };
}

export function rankingHeadline(input: {
  universe: RankingUniverse;
  comparisonRank: HierarchyRank | null;
  metric: ComparisonMetric;
}): string {
  if (input.universe === 'team') return 'Teams in your scope';
  if (input.universe === 'region') return 'Regions in your scope';
  if (input.comparisonRank) return `${RANK_LABELS[input.comparisonRank]}s in your scope`;
  return 'People in your scope';
}

export function personDisplay(person: DirectoryPerson): string {
  return displayNameOf(person);
}

export type RankingProvenanceFacts = {
  metric: ComparisonMetric;
  universe: RankingUniverse;
  period: AssistantPeriod;
  sourceTool: string;
  ordering: string;
  comparisonRole: string | null;
  scopeKind: string | null;
  rowCount: number;
};

export function rankingOrderingRule(
  metric: ComparisonMetric,
  direction: RankingDirection,
): string {
  return `${direction}_${metric}`;
}
