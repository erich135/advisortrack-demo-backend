import type { AssistantAskResult } from '../model/types';
import { RANK_LABELS, type HierarchyRank } from '../../features/customerHierarchy';
import { buildDownlineIndex } from '../../features/performanceRanking';
import { mintPersonRef, mintRegionRef, mintTeamRef } from './refs';
import {
  attentionAnswer,
  compareNeedSecondAnswer,
  compareTooManyAnswer,
  entityComparisonAnswer,
  liveNavigateActions,
  largeScopeAnswer,
  mixedComparisonClarifyAnswer,
  notFoundInScopeAnswer,
  periodComparisonAnswer,
  personAmbiguityAnswer,
  rankingEmptyAnswer,
  rankingHierarchyAnswer,
  rankingListAnswer,
  toolUnavailableAnswer,
  unitAmbiguityAnswer,
} from './compose';
import {
  deriveAbsoluteChange,
  derivePercentChange,
  isPipelineMetric,
  MAX_COMPARISON_SUBJECTS,
  MAX_RANKING_CANDIDATES,
  metricValue,
  periodPairLabels,
  type ComparisonMetric,
  type ComparisonUnitKind,
  type RankingDirection,
  type RankingUniverse,
} from './compare';
import {
  attentionReasonsFor,
  flaggedAttentionSubjects,
  hasMobileInactivity,
  type AttentionCounts,
} from './attention';
import {
  personDisplay,
  productComparisonRank,
  productTopPerformer,
  rankingHeadline,
  rankingOrderingRule,
  rankingPeople,
  sortRankingRows,
  type RankingRow,
} from './rank';
import { ASSISTANT_PERIOD_COMPLETE, ASSISTANT_PERIOD_LABELS, type AssistantPeriod } from './period';
import { displayNameOf } from './names';
import { isLiveScopeMiss } from './errors';
import {
  attentionToolFacts,
  comparisonToolFacts,
  productionToolFacts,
  rankingToolFacts,
} from './project';
import { resolvePersonInScope, resolveRegionInScope, resolveTeamInScope } from './resolve';
import {
  ATTENTION_SUMMARY_TOOL,
  canUseAttentionSummary,
  canUseComparisonSummary,
  canUsePipelineSummary,
  canUseProductionSummary,
  canUseRankingSummary,
  COMPARISON_SUMMARY_TOOL,
  PIPELINE_SUMMARY_TOOL,
  PRODUCTION_SUMMARY_TOOL,
  RANKING_SUMMARY_TOOL,
} from './tools';
import type {
  AnswerProvenance,
  DirectoryPerson,
  DirectoryRegion,
  DirectoryTeam,
  LiveDirectorySource,
  LiveToolFactGroup,
  PipelineAggregate,
  ProductionTotals,
  RegisteredDerivationOutput,
  ToolExecutionContext,
} from './types';

export type CompareBuildState = {
  ctx: ToolExecutionContext;
  provenance: AnswerProvenance;
  tools: LiveToolFactGroup[];
  derivations: RegisteredDerivationOutput[];
  period: { id: AssistantPeriod; label: string } | null;
};

export type CompareGrounding = {
  compositionWorthy: boolean;
  fallbackKind: 'live' | 'retrieval';
  result: AssistantAskResult;
  tools: LiveToolFactGroup[];
  derivations: RegisteredDerivationOutput[];
  period: { id: AssistantPeriod; label: string } | null;
  seedCardIds: string[];
};

export type FlowHelpers = {
  pack: (
    state: CompareBuildState,
    result: AssistantAskResult,
    extra: { compositionWorthy: boolean; fallbackKind: 'live' | 'retrieval'; seedCardIds?: string[] },
  ) => CompareGrounding;
  addTool: (state: CompareBuildState, group: LiveToolFactGroup) => void;
  addDerivation: (state: CompareBuildState, derivation: RegisteredDerivationOutput) => void;
  emptyProvenance: (ctx: ToolExecutionContext, tools: string[]) => AnswerProvenance;
  withProvenance: (answer: AssistantAskResult['answer'], provenance: AnswerProvenance) => AssistantAskResult;
  loadPeople: (ctx: ToolExecutionContext, source: LiveDirectorySource) => Promise<DirectoryPerson[]>;
  loadTeams: (ctx: ToolExecutionContext, source: LiveDirectorySource) => Promise<DirectoryTeam[]>;
  loadRegions: (ctx: ToolExecutionContext, source: LiveDirectorySource) => Promise<DirectoryRegion[]>;
};

const COMPARE_SEED = ['REPORT.DASHBOARD', 'REPORT.PRODUCTION', 'REPORT.TEAM_PIPELINE', 'REPORT.ADVISOR_DETAILS'];
const TELEMETRY_RULE = 'RULE.TELEMETRY.LAST_MOBILE_ACTIVITY_IS_NOT_PERFORMANCE';

function downlineIds(people: DirectoryPerson[], rootId: string): string[] {
  const index = buildDownlineIndex(people.map((person) => ({
    id: person.id,
    reportsToUserId: person.reportsToUserId ?? null,
  })));
  return index.get(rootId) ?? [rootId];
}

async function loadMetric(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  metric: ComparisonMetric,
  period: AssistantPeriod,
  memberIds: string[],
): Promise<{ value: number | null; production: ProductionTotals | null; pipeline: PipelineAggregate | null; unavailable: boolean }> {
  if (isPipelineMetric(metric)) {
    if (!canUsePipelineSummary(ctx) || !source.getPipelineAggregate) {
      return { value: null, production: null, pipeline: null, unavailable: true };
    }
    try {
      const pipeline = await source.getPipelineAggregate(ctx, { memberIds });
      return { value: metricValue(metric, null, pipeline), production: null, pipeline, unavailable: !pipeline };
    } catch (error) {
      if (isLiveScopeMiss(error)) throw error;
      return { value: null, production: null, pipeline: null, unavailable: true };
    }
  }
  if (!canUseProductionSummary(ctx) || !source.getProductionTotals) {
    return { value: null, production: null, pipeline: null, unavailable: true };
  }
  try {
    const production = await source.getProductionTotals(ctx, { period, memberIds });
    return { value: metricValue(metric, production, null), production, pipeline: null, unavailable: !production };
  } catch (error) {
    if (isLiveScopeMiss(error)) throw error;
    return { value: null, production: null, pipeline: null, unavailable: true };
  }
}

function reportingActions(ctx: ToolExecutionContext, metric: ComparisonMetric) {
  const routes = isPipelineMetric(metric)
    ? ['team-pipeline', 'advisors']
    : ['production', 'dashboard', 'performance', 'advisors'];
  return liveNavigateActions(ctx.assistant, routes);
}

function failClosed(helpers: FlowHelpers, state: CompareBuildState): CompareGrounding {
  return helpers.pack(state, helpers.withProvenance(notFoundInScopeAnswer(), state.provenance), {
    compositionWorthy: false,
    fallbackKind: 'live',
  });
}

export async function answerComparePeriod(
  helpers: FlowHelpers,
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  route: {
    mention: string;
    unit: ComparisonUnitKind;
    current: AssistantPeriod;
    baseline: AssistantPeriod;
    metric: ComparisonMetric;
  },
): Promise<CompareGrounding> {
  const state: CompareBuildState = {
    ctx,
    provenance: helpers.emptyProvenance(ctx, [COMPARISON_SUMMARY_TOOL.id, PRODUCTION_SUMMARY_TOOL.id, PIPELINE_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: { id: route.current, label: ASSISTANT_PERIOD_LABELS[route.current] },
  };
  if (!canUseComparisonSummary(ctx)) return failClosed(helpers, state);

  try {
    if (route.unit === 'team') {
      const teams = await helpers.loadTeams(ctx, source);
      const resolved = resolveTeamInScope(route.mention, teams, ctx.refs);
      if (resolved.kind === 'not_found_in_scope') return failClosed(helpers, state);
      if (resolved.kind === 'ambiguous') {
        return helpers.pack(state, helpers.withProvenance(unitAmbiguityAnswer(resolved.candidates), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      const team = resolved.candidate.team;
      if (!team) return failClosed(helpers, state);
      return finishPeriodCompare(helpers, state, ctx, source, {
        name: team.name,
        ref: resolved.candidate.ref,
        memberIds: team.memberIds,
        metric: route.metric,
        current: route.current,
        baseline: route.baseline,
      });
    }
    if (route.unit === 'region') {
      const regions = await helpers.loadRegions(ctx, source);
      const resolved = resolveRegionInScope(route.mention, regions, ctx.refs);
      if (resolved.kind === 'not_found_in_scope') return failClosed(helpers, state);
      if (resolved.kind === 'ambiguous') {
        return helpers.pack(state, helpers.withProvenance(unitAmbiguityAnswer(resolved.candidates), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      const region = resolved.candidate.region;
      if (!region) return failClosed(helpers, state);
      return finishPeriodCompare(helpers, state, ctx, source, {
        name: region.name,
        ref: resolved.candidate.ref,
        memberIds: region.memberIds,
        metric: route.metric,
        current: route.current,
        baseline: route.baseline,
      });
    }
    const people = await helpers.loadPeople(ctx, source);
    const resolved = resolvePersonInScope(route.mention, people, ctx.refs);
    if (resolved.kind === 'not_found_in_scope') return failClosed(helpers, state);
    if (resolved.kind === 'ambiguous') {
      return helpers.pack(state, helpers.withProvenance(personAmbiguityAnswer(resolved.candidates), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
    const person = resolved.candidate.person;
    return finishPeriodCompare(helpers, state, ctx, source, {
      name: displayNameOf(person),
      ref: resolved.candidate.ref,
      memberIds: [person.id],
      metric: route.metric,
      current: route.current,
      baseline: route.baseline,
    });
  } catch (error) {
    if (isLiveScopeMiss(error)) return failClosed(helpers, state);
    state.provenance.toolsUnavailable.push(COMPARISON_SUMMARY_TOOL.id);
    return helpers.pack(state, helpers.withProvenance(toolUnavailableAnswer(COMPARISON_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}

async function finishPeriodCompare(
  helpers: FlowHelpers,
  state: CompareBuildState,
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  input: {
    name: string;
    ref: string;
    memberIds: string[];
    metric: ComparisonMetric;
    current: AssistantPeriod;
    baseline: AssistantPeriod;
  },
): Promise<CompareGrounding> {
  const current = await loadMetric(ctx, source, input.metric, input.current, input.memberIds);
  const baseline = await loadMetric(ctx, source, input.metric, input.baseline, input.memberIds);
  if (current.unavailable || baseline.unavailable || current.value == null || baseline.value == null) {
    state.provenance.toolsUnavailable.push(COMPARISON_SUMMARY_TOOL.id);
    return helpers.pack(state, helpers.withProvenance(toolUnavailableAnswer(COMPARISON_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (current.production) {
    helpers.addTool(state, productionToolFacts({
      entity: input.ref,
      period: input.current,
      production: current.production,
    }));
  }
  if (baseline.production) {
    helpers.addTool(state, productionToolFacts({
      entity: input.ref,
      period: input.baseline,
      production: baseline.production,
    }));
  }
  const labels = periodPairLabels(input.current, input.baseline);
  helpers.addTool(state, comparisonToolFacts({
    entity: input.ref,
    subjectName: input.name,
    metric: input.metric,
    currentPeriod: input.current,
    baselinePeriod: input.baseline,
    currentValue: current.value,
    baselineValue: baseline.value,
    currentComplete: labels.currentComplete,
    baselineComplete: labels.baselineComplete,
  }));
  const absolute = deriveAbsoluteChange(current.value, baseline.value);
  const percent = derivePercentChange(current.value, baseline.value);
  helpers.addDerivation(state, absolute);
  helpers.addDerivation(state, percent);
  const answer = periodComparisonAnswer({
    subjectName: input.name,
    metric: input.metric,
    currentLabel: labels.currentLabel,
    baselineLabel: labels.baselineLabel,
    currentValue: current.value,
    baselineValue: baseline.value,
    absoluteChange: Number(absolute.facts.absoluteChange) || 0,
    percentChange: typeof percent.facts.percentChange === 'number' ? percent.facts.percentChange : null,
    zeroDenominator: percent.facts.zeroDenominator === true,
    partial: labels.partial,
    actions: reportingActions(ctx, input.metric),
  });
  return helpers.pack(state, helpers.withProvenance(answer, state.provenance), {
    compositionWorthy: false,
    fallbackKind: 'live',
    seedCardIds: COMPARE_SEED,
  });
}

export async function answerCompareEntities(
  helpers: FlowHelpers,
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  route: {
    mentions: string[];
    unit: ComparisonUnitKind | 'mixed';
    period: AssistantPeriod;
    metric: ComparisonMetric;
  },
): Promise<CompareGrounding> {
  const state: CompareBuildState = {
    ctx,
    provenance: helpers.emptyProvenance(ctx, [COMPARISON_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: { id: route.period, label: ASSISTANT_PERIOD_LABELS[route.period] },
  };
  if (!canUseComparisonSummary(ctx)) return failClosed(helpers, state);
  if (route.unit === 'mixed') {
    return helpers.pack(state, helpers.withProvenance(mixedComparisonClarifyAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (route.mentions.length < 2) {
    return helpers.pack(state, helpers.withProvenance(compareNeedSecondAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (route.mentions.length > MAX_COMPARISON_SUBJECTS) {
    return helpers.pack(state, helpers.withProvenance(compareTooManyAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }

  try {
    const subjects: Array<{ name: string; ref: string; memberIds: string[] }> = [];
    if (route.unit === 'team') {
      const teams = await helpers.loadTeams(ctx, source);
      for (const mention of route.mentions) {
        const resolved = resolveTeamInScope(mention, teams, ctx.refs);
        if (resolved.kind === 'ambiguous') {
          return helpers.pack(state, helpers.withProvenance(unitAmbiguityAnswer(resolved.candidates), state.provenance), {
            compositionWorthy: false,
            fallbackKind: 'live',
          });
        }
        if (resolved.kind !== 'resolved' || !resolved.candidate.team) return failClosed(helpers, state);
        subjects.push({
          name: resolved.candidate.team.name,
          ref: resolved.candidate.ref,
          memberIds: resolved.candidate.team.memberIds,
        });
      }
    } else if (route.unit === 'region') {
      const regions = await helpers.loadRegions(ctx, source);
      for (const mention of route.mentions) {
        const resolved = resolveRegionInScope(mention, regions, ctx.refs);
        if (resolved.kind === 'ambiguous') {
          return helpers.pack(state, helpers.withProvenance(unitAmbiguityAnswer(resolved.candidates), state.provenance), {
            compositionWorthy: false,
            fallbackKind: 'live',
          });
        }
        if (resolved.kind !== 'resolved' || !resolved.candidate.region) return failClosed(helpers, state);
        subjects.push({
          name: resolved.candidate.region.name,
          ref: resolved.candidate.ref,
          memberIds: resolved.candidate.region.memberIds,
        });
      }
    } else {
      const people = await helpers.loadPeople(ctx, source);
      for (const mention of route.mentions) {
        const resolved = resolvePersonInScope(mention, people, ctx.refs);
        if (resolved.kind === 'ambiguous') {
          return helpers.pack(state, helpers.withProvenance(personAmbiguityAnswer(resolved.candidates), state.provenance), {
            compositionWorthy: false,
            fallbackKind: 'live',
          });
        }
        if (resolved.kind !== 'resolved') return failClosed(helpers, state);
        subjects.push({
          name: displayNameOf(resolved.candidate.person),
          ref: resolved.candidate.ref,
          memberIds: [resolved.candidate.person.id],
        });
      }
    }

    const loaded: Array<{ name: string; ref: string; value: number }> = [];
    for (const subject of subjects) {
      const metric = await loadMetric(ctx, source, route.metric, route.period, subject.memberIds);
      if (metric.unavailable || metric.value == null) {
        state.provenance.toolsUnavailable.push(COMPARISON_SUMMARY_TOOL.id);
        return helpers.pack(state, helpers.withProvenance(toolUnavailableAnswer(COMPARISON_SUMMARY_TOOL.title), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      if (metric.production) {
        helpers.addTool(state, productionToolFacts({
          entity: subject.ref,
          period: route.period,
          production: metric.production,
        }));
      }
      helpers.addTool(state, comparisonToolFacts({
        entity: subject.ref,
        subjectName: subject.name,
        metric: route.metric,
        currentPeriod: route.period,
        currentValue: metric.value,
        baselineValue: null,
        currentComplete: ASSISTANT_PERIOD_COMPLETE[route.period],
        baselineComplete: null,
      }));
      loaded.push({ name: subject.name, ref: subject.ref, value: metric.value });
    }

    const first = loaded[0];
    const second = loaded[1];
    const absolute = deriveAbsoluteChange(first.value, second.value);
    const percent = derivePercentChange(first.value, second.value);
    helpers.addDerivation(state, absolute);
    helpers.addDerivation(state, percent);
    const answer = entityComparisonAnswer({
      metric: route.metric,
      periodLabel: ASSISTANT_PERIOD_LABELS[route.period],
      subjects: loaded,
      absoluteChange: Number(absolute.facts.absoluteChange) || 0,
      percentChange: typeof percent.facts.percentChange === 'number' ? percent.facts.percentChange : null,
      zeroDenominator: percent.facts.zeroDenominator === true,
      actions: reportingActions(ctx, route.metric),
    });
    return helpers.pack(state, helpers.withProvenance(answer, state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
      seedCardIds: COMPARE_SEED,
    });
  } catch (error) {
    if (isLiveScopeMiss(error)) return failClosed(helpers, state);
    state.provenance.toolsUnavailable.push(COMPARISON_SUMMARY_TOOL.id);
    return helpers.pack(state, helpers.withProvenance(toolUnavailableAnswer(COMPARISON_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}

export async function answerRank(
  helpers: FlowHelpers,
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  route: {
    universe: RankingUniverse;
    askedRank: HierarchyRank | null;
    metric: ComparisonMetric;
    period: AssistantPeriod;
    direction: RankingDirection;
    productLabel: 'top_performer' | null;
  },
): Promise<CompareGrounding> {
  const state: CompareBuildState = {
    ctx,
    provenance: helpers.emptyProvenance(ctx, [RANKING_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: { id: route.period, label: ASSISTANT_PERIOD_LABELS[route.period] },
  };
  if (!canUseRankingSummary(ctx)) return failClosed(helpers, state);
  if (isPipelineMetric(route.metric) && ASSISTANT_PERIOD_COMPLETE[route.period]) {
    return helpers.pack(state, helpers.withProvenance(toolUnavailableAnswer('That pipeline metric'), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }

  const comparison = productComparisonRank(ctx);
  if (!comparison) return failClosed(helpers, state);
  if (route.universe === 'people' && route.askedRank && route.askedRank !== comparison) {
    return helpers.pack(state, helpers.withProvenance(rankingHierarchyAnswer({
      askedLabel: RANK_LABELS[route.askedRank],
      comparisonLabel: RANK_LABELS[comparison],
    }), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
      seedCardIds: COMPARE_SEED,
    });
  }

  try {
    const rows: RankingRow[] = [];
    const sourceTool = isPipelineMetric(route.metric) ? PIPELINE_SUMMARY_TOOL.id : PRODUCTION_SUMMARY_TOOL.id;
    if (route.universe === 'team') {
      const teams = await helpers.loadTeams(ctx, source);
      if (teams.length > MAX_RANKING_CANDIDATES) {
        return helpers.pack(state, helpers.withProvenance(largeScopeAnswer({
          count: teams.length,
          noun: 'teams',
          actions: reportingActions(ctx, route.metric),
        }), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      for (const team of teams) {
        const loaded = await loadMetric(ctx, source, route.metric, route.period, team.memberIds);
        if (loaded.value == null) continue;
        rows.push({
          name: team.name,
          roleLabel: 'Team',
          value: loaded.value,
          memberId: team.id,
        });
        mintTeamRef(ctx.refs, team);
      }
    } else if (route.universe === 'region') {
      const regions = await helpers.loadRegions(ctx, source);
      if (regions.length > MAX_RANKING_CANDIDATES) {
        return helpers.pack(state, helpers.withProvenance(largeScopeAnswer({
          count: regions.length,
          noun: 'regions',
          actions: reportingActions(ctx, route.metric),
        }), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      for (const region of regions) {
        const loaded = await loadMetric(ctx, source, route.metric, route.period, region.memberIds);
        if (loaded.value == null) continue;
        rows.push({
          name: region.name,
          roleLabel: 'Region',
          value: loaded.value,
          memberId: region.id,
        });
        mintRegionRef(ctx.refs, region);
      }
    } else {
      const people = await helpers.loadPeople(ctx, source);
      const units = rankingPeople(people, ctx);
      if (units.length > MAX_RANKING_CANDIDATES) {
        return helpers.pack(state, helpers.withProvenance(largeScopeAnswer({
          count: units.length,
          noun: 'people',
          actions: reportingActions(ctx, route.metric),
        }), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      for (const person of units) {
        const loaded = await loadMetric(ctx, source, route.metric, route.period, downlineIds(people, person.id));
        if (loaded.value == null) continue;
        rows.push({
          name: personDisplay(person),
          roleLabel: person.reportingRoleLabel,
          value: loaded.value,
          memberId: person.id,
        });
        mintPersonRef(ctx.refs, person);
      }
    }

    const ranked = sortRankingRows(rows, route.direction);
    let displayRows = ranked;
    let emptyMessage: string | null = null;
    let productLabel: string | null = null;
    if (route.productLabel && route.universe === 'people' && route.metric === 'issued_amount') {
      const picked = productTopPerformer(rows);
      if (picked.emptyReason === 'no_subordinates') emptyMessage = `No ${RANK_LABELS[comparison]}s to compare`;
      else if (picked.emptyReason === 'no_issued_cases') emptyMessage = 'No issued cases for selected period';
      else if (picked.emptyReason === 'single_subordinate') emptyMessage = 'Not enough people to compare';
      else if (picked.emptyReason === 'tied') emptyMessage = 'Issued totals are tied for the selected period';
      if (picked.top && !picked.emptyReason) {
        displayRows = [picked.top, ...ranked.filter((row) => row.memberId !== picked.top?.memberId)].slice(0, 5);
        productLabel = 'Top Performer';
      } else if (!picked.top) {
        displayRows = [];
      }
    }

    helpers.addTool(state, rankingToolFacts({
      period: route.period,
      metric: route.metric,
      universe: route.universe,
      comparisonRole: RANK_LABELS[comparison],
      ordering: rankingOrderingRule(route.metric, route.direction),
      scopeKind: ctx.assistant.role.scopeKind,
      sourceTool,
      rows: displayRows,
    }));

    const answer = displayRows.length
      ? rankingListAnswer({
        headline: rankingHeadline({ universe: route.universe, comparisonRank: comparison, metric: route.metric }),
        metric: route.metric,
        periodLabel: ASSISTANT_PERIOD_LABELS[route.period],
        rows: displayRows,
        productLabel,
        emptyMessage,
        actions: reportingActions(ctx, route.metric),
      })
      : rankingEmptyAnswer(emptyMessage || 'No issued cases for selected period');

    return helpers.pack(state, helpers.withProvenance(answer, state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
      seedCardIds: COMPARE_SEED,
    });
  } catch (error) {
    if (isLiveScopeMiss(error)) return failClosed(helpers, state);
    state.provenance.toolsUnavailable.push(RANKING_SUMMARY_TOOL.id);
    return helpers.pack(state, helpers.withProvenance(toolUnavailableAnswer(RANKING_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}

export async function answerAttention(
  helpers: FlowHelpers,
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  mention: string | null,
): Promise<CompareGrounding> {
  const state: CompareBuildState = {
    ctx,
    provenance: helpers.emptyProvenance(ctx, [ATTENTION_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: null,
  };
  if (!canUseAttentionSummary(ctx)) return failClosed(helpers, state);
  try {
    const people = await helpers.loadPeople(ctx, source);
    const counts = new Map<string, AttentionCounts>();
    if (source.listAttentionInputs) {
      const rows = await source.listAttentionInputs(ctx);
      for (const row of rows) counts.set(row.memberId, row);
    }
    if (mention) {
      const resolved = resolvePersonInScope(mention, people, ctx.refs);
      if (resolved.kind === 'not_found_in_scope') return failClosed(helpers, state);
      if (resolved.kind === 'ambiguous') {
        return helpers.pack(state, helpers.withProvenance(personAmbiguityAnswer(resolved.candidates), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      const person = resolved.candidate.person;
      const reasons = attentionReasonsFor(person, counts.get(person.id), ctx.now);
      helpers.addTool(state, attentionToolFacts({
        entity: resolved.candidate.ref,
        subjectName: displayNameOf(person),
        flagged: reasons.length > 0,
        reasons: reasons.map((reason) => reason.label),
      }));
      if (hasMobileInactivity(reasons) && !state.provenance.businessRules.includes(TELEMETRY_RULE)) {
        state.provenance.businessRules.push(TELEMETRY_RULE);
        state.provenance.items.push({ kind: 'rule', ruleId: TELEMETRY_RULE });
      }
      const answer = attentionAnswer({
        subjects: reasons.length
          ? [{ name: displayNameOf(person), reasons: reasons.map((reason) => reason.label) }]
          : [],
        mobileTelemetry: hasMobileInactivity(reasons),
        actions: liveNavigateActions(ctx.assistant, ['advisors', 'team-pipeline']),
      });
      if (!reasons.length) {
        answer.body = `AdvisorTrack does not currently flag ${displayNameOf(person)} as Needs Attention.`;
        answer.headline = displayNameOf(person);
      }
      return helpers.pack(state, helpers.withProvenance(answer, state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
        seedCardIds: COMPARE_SEED,
      });
    }

    const flagged = flaggedAttentionSubjects(people, counts, ctx.now);
    for (const subject of flagged) {
      helpers.addTool(state, attentionToolFacts({
        entity: mintPersonRef(ctx.refs, subject.person),
        subjectName: displayNameOf(subject.person),
        flagged: true,
        reasons: subject.reasons.map((reason) => reason.label),
      }));
      if (hasMobileInactivity(subject.reasons) && !state.provenance.businessRules.includes(TELEMETRY_RULE)) {
        state.provenance.businessRules.push(TELEMETRY_RULE);
        state.provenance.items.push({ kind: 'rule', ruleId: TELEMETRY_RULE });
      }
    }
    const answer = attentionAnswer({
      subjects: flagged.map((subject) => ({
        name: displayNameOf(subject.person),
        reasons: subject.reasons.map((reason) => reason.label),
      })),
      mobileTelemetry: flagged.some((subject) => hasMobileInactivity(subject.reasons)),
      actions: liveNavigateActions(ctx.assistant, ['advisors', 'team-pipeline']),
    });
    return helpers.pack(state, helpers.withProvenance(answer, state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
      seedCardIds: COMPARE_SEED,
    });
  } catch (error) {
    if (isLiveScopeMiss(error)) return failClosed(helpers, state);
    state.provenance.toolsUnavailable.push(ATTENTION_SUMMARY_TOOL.id);
    return helpers.pack(state, helpers.withProvenance(toolUnavailableAnswer(ATTENTION_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}
