import type { AssistantContext, TrustedAssistantIdentity } from '../context';
import type { AssistantAskResult } from '../model/types';
import { dataClassOf } from './classify';
import {
  advisorSummaryAnswer,
  largeScopeAnswer,
  licenceSummaryAnswer,
  liveNavigateActions,
  notFoundInScopeAnswer,
  personAmbiguityAnswer,
  personSummaryAnswer,
  pipelineSummaryAnswer,
  productionSummaryAnswer,
  regionSummaryAnswer,
  teamSummaryAnswer,
  toolUnavailableAnswer,
  unitAmbiguityAnswer,
} from './compose';
import {
  answerAttention,
  answerCompareEntities,
  answerComparePeriod,
  answerRank,
  type FlowHelpers,
} from './compareFlow';
import { createToolExecutionContext } from './context';
import { isLiveScopeMiss } from './errors';
import { wrapLiveSource } from './runtime';
import {
  deriveLicenceShortfall,
  deriveSubjectLeadershipAccess,
} from './derive';
import { ASSISTANT_PERIOD_LABELS, type AssistantPeriod } from './period';
import {
  licenceToolFacts,
  personToolFacts,
  pipelineToolFacts,
  productionToolFacts,
  regionToolFacts,
  teamToolFacts,
} from './project';
import { projectPersonSummary, projectPipelineSummary } from './privacy';
import { pickPermittedFacts } from './policy';
import { resolvePersonInScope, resolveRegionInScope, resolveTeamInScope } from './resolve';
import {
  looksDoingQuestion,
  looksLicencePlanningQuestion,
  routeLiveQuestion,
} from './router';
import {
  ADVISOR_SUMMARY_TOOL,
  LICENCE_SUMMARY_TOOL,
  PERSON_SUMMARY_TOOL,
  PIPELINE_SUMMARY_TOOL,
  PRODUCTION_SUMMARY_TOOL,
  REGION_SUMMARY_TOOL,
  TEAM_SUMMARY_TOOL,
  canUseAdvisorSummary,
  canUseLeadershipReporting,
  canUseLicenceSummary,
  canUsePersonSummary,
  canUsePipelineSummary,
  canUseProductionSummary,
  canUseRegionSummary,
  canUseTeamSummary,
  executeLicenceSummary,
  executePersonSummary,
} from './tools';
import type {
  AnswerProvenance,
  DirectoryPerson,
  DirectoryRegion,
  DirectoryTeam,
  LiveDirectorySource,
  LivePeoplePurpose,
  LiveToolFactGroup,
  RegisteredDerivationOutput,
  ToolExecutionContext,
} from './types';

export type LiveGrounding = {
  compositionWorthy: boolean;
  fallbackKind: 'live' | 'retrieval';
  result: AssistantAskResult;
  tools: LiveToolFactGroup[];
  derivations: RegisteredDerivationOutput[];
  period: { id: AssistantPeriod; label: string } | null;
  seedCardIds: string[];
};

type BuildState = {
  ctx: ToolExecutionContext;
  provenance: AnswerProvenance;
  tools: LiveToolFactGroup[];
  derivations: RegisteredDerivationOutput[];
  period: { id: AssistantPeriod; label: string } | null;
};

const ACCESS_SEED_CARDS = [
  'PEOPLE.REPORTING_ROLE_DIFFERENCES',
  'START.WHO_USES_MOBILE',
  'REPORT.PRODUCTION',
  'BLOCK.ADVISOR_USES_MOBILE',
  'REPORT.ADVISOR_DETAILS',
  'GLOSS.LAST_MOBILE_ACTIVITY',
];

const ADVISOR_SEED_CARDS = [
  'REPORT.PRODUCTION',
  'REPORT.ADVISOR_DETAILS',
  'START.WHO_USES_MOBILE',
  'GLOSS.LAST_MOBILE_ACTIVITY',
];

const LICENCE_SEED_CARDS = [
  'LIC.POOL_MEANING',
  'LIC.REQUEST_MORE',
  'PEOPLE.BULK_IMPORT_UPLOAD',
  'LIC.ASSIGN',
  'START.WHO_USES_MOBILE',
  'START.ACCOUNT_ACTIVATION',
];

function withProvenance(
  answer: AssistantAskResult['answer'],
  provenance: AnswerProvenance,
): AssistantAskResult {
  return {
    answer,
    origin: 'deterministic',
    modelAttempted: false,
    provenance,
  };
}

function emptyProvenance(ctx: ToolExecutionContext, tools: string[]): AnswerProvenance {
  return {
    turnId: ctx.turnId,
    origin: 'deterministic',
    items: [],
    factTraces: [],
    knowledgeCards: [],
    businessRules: [],
    modelCalled: false,
    toolsAttempted: tools,
    toolsUsed: [],
    toolsUnavailable: [],
    cacheHits: ctx.stats.cacheHits,
    cacheMisses: ctx.stats.cacheMisses,
    toolTimeouts: ctx.stats.timeouts,
    circuitOpen: ctx.stats.circuitOpen,
  };
}

const TELEMETRY_RULE = 'RULE.TELEMETRY.LAST_MOBILE_ACTIVITY_IS_NOT_PERFORMANCE';

function markTool(
  provenance: AnswerProvenance,
  toolId: string,
  version: number,
  extra?: { entityRef?: string; period?: AssistantPeriod },
): void {
  provenance.toolsUsed.push(toolId);
  provenance.items.push({
    kind: 'tool',
    toolId,
    version,
    entityRef: extra?.entityRef,
    period: extra?.period,
  });
}

function addTool(state: BuildState, group: LiveToolFactGroup): void {
  const facts = pickPermittedFacts(group.tool, group.facts, state.ctx, 'answer');
  const projected = { ...group, facts };
  state.tools.push(projected);
  markTool(state.provenance, projected.tool, projected.version, {
    entityRef: projected.entity,
    period: projected.period,
  });
  for (const field of Object.keys(facts)) {
    state.provenance.factTraces.push({
      field,
      toolId: projected.tool,
      version: projected.version,
      entityRef: projected.entity,
      period: projected.period,
      dataClass: dataClassOf(projected.tool, field) ?? 'operational',
    });
    if (field === 'lastMobileActivity' && !state.provenance.businessRules.includes(TELEMETRY_RULE)) {
      state.provenance.businessRules.push(TELEMETRY_RULE);
      state.provenance.items.push({ kind: 'rule', ruleId: TELEMETRY_RULE });
    }
  }
}

function addDerivation(state: BuildState, derivation: RegisteredDerivationOutput): void {
  state.derivations.push(derivation);
  state.provenance.items.push({ kind: 'derivation', derivationId: derivation.derivationId });
  for (const field of Object.keys(derivation.facts)) {
    state.provenance.factTraces.push({
      field,
      toolId: derivation.derivationId,
      version: 1,
      dataClass: 'operational',
      derivationId: derivation.derivationId,
    });
  }
}

function isFailedLive(result: AssistantAskResult): boolean {
  const intent = result.answer.intent;
  return intent === 'live.not_found_in_scope'
    || intent === 'live.disambiguate'
    || intent === 'live.unavailable'
    || result.answer.mode === 'disambiguate'
    || result.answer.mode === 'unknown';
}

function pack(
  state: BuildState,
  result: AssistantAskResult,
  extra: {
    compositionWorthy: boolean;
    fallbackKind: 'live' | 'retrieval';
    seedCardIds?: string[];
  },
): LiveGrounding {
  const provenance = result.provenance;
  if (provenance) {
    provenance.cacheHits = state.ctx.stats.cacheHits;
    provenance.cacheMisses = state.ctx.stats.cacheMisses;
    provenance.toolTimeouts = state.ctx.stats.timeouts;
    provenance.circuitOpen = state.ctx.stats.circuitOpen;
  }
  return {
    compositionWorthy: extra.compositionWorthy && !isFailedLive(result),
    fallbackKind: extra.fallbackKind,
    result,
    tools: state.tools,
    derivations: state.derivations,
    period: state.period,
    seedCardIds: extra.seedCardIds ?? [],
  };
}

const compareHelpers: FlowHelpers = {
  pack,
  addTool,
  addDerivation,
  emptyProvenance,
  withProvenance,
  loadPeople: (ctx, source) => loadPeople(ctx, source, 'reporting'),
  loadTeams,
  loadRegions,
};

async function loadPeople(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  purpose: LivePeoplePurpose = 'directory',
): Promise<DirectoryPerson[]> {
  return source.listPeople(ctx, { purpose });
}

async function loadTeams(ctx: ToolExecutionContext, source: LiveDirectorySource): Promise<DirectoryTeam[]> {
  if (!source.listTeams) return [];
  return source.listTeams(ctx);
}

async function loadRegions(ctx: ToolExecutionContext, source: LiveDirectorySource): Promise<DirectoryRegion[]> {
  if (!source.listRegions) return [];
  return source.listRegions(ctx);
}

export async function gatherLiveGrounding(input: {
  question: string;
  identity: TrustedAssistantIdentity;
  context: AssistantContext;
  source: LiveDirectorySource;
  timeoutMs: number;
}): Promise<LiveGrounding | null> {
  const route = routeLiveQuestion(input.question);
  if (route.kind === 'none') return null;

  const ctx = createToolExecutionContext({
    identity: input.identity,
    assistant: input.context,
    timeoutMs: input.timeoutMs,
  });
  const source = wrapLiveSource(input.source, ctx);

  if (route.kind === 'dump') {
    return answerDump(ctx, source, route.subject);
  }

  if (route.kind === 'access') {
    return answerAccess(ctx, source, input.question, route.mention, route.topic);
  }

  if (route.kind === 'licence') {
    return answerLicence(ctx, source, input.question);
  }

  if (route.kind === 'person') {
    return answerPerson(ctx, source, route.mention);
  }

  if (route.kind === 'compare_period') {
    return answerComparePeriod(compareHelpers, ctx, source, route);
  }
  if (route.kind === 'compare_entities') {
    return answerCompareEntities(compareHelpers, ctx, source, route);
  }
  if (route.kind === 'rank') {
    return answerRank(compareHelpers, ctx, source, route);
  }
  if (route.kind === 'attention') {
    return answerAttention(compareHelpers, ctx, source, route.mention);
  }

  if (route.kind === 'advisor' || route.kind === 'production' || route.kind === 'pipeline') {
    return answerNamedPerson(ctx, source, route.kind, route.mention, route.period, input.question);
  }

  if (route.kind === 'team') {
    return answerTeam(ctx, source, route.mention, route.period, input.question);
  }

  if (route.kind === 'region') {
    return answerRegion(ctx, source, route.mention, route.period, input.question);
  }

  return null;
}

export async function tryLiveAssistantAnswer(input: {
  question: string;
  identity: TrustedAssistantIdentity;
  context: AssistantContext;
  source: LiveDirectorySource;
  timeoutMs: number;
}): Promise<AssistantAskResult | null> {
  const grounding = await gatherLiveGrounding(input);
  return grounding?.result ?? null;
}

async function answerDump(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  subject: 'advisors' | 'cases',
): Promise<LiveGrounding> {
  const state: BuildState = {
    ctx,
    provenance: emptyProvenance(ctx, subject === 'cases' ? [PIPELINE_SUMMARY_TOOL.id] : [PERSON_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: null,
  };
  if (!canUseLeadershipReporting(ctx)) {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (subject === 'advisors') {
    if (!canUsePersonSummary(ctx) && !canUseAdvisorSummary(ctx)) {
      return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
    try {
      const people = await loadPeople(ctx, source, 'reporting');
      const advisors = people.filter((person) => person.rank === 'financial_advisor' || person.reportingRoleLabel === 'Financial Advisor');
      const count = advisors.length || people.length;
      return pack(state, withProvenance(largeScopeAnswer({
        count,
        noun: count === 1 ? 'advisor' : 'advisors',
        actions: liveNavigateActions(ctx.assistant, ['advisors']),
      }), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    } catch {
      state.provenance.toolsUnavailable.push(PERSON_SUMMARY_TOOL.id);
      return pack(state, withProvenance(toolUnavailableAnswer('Advisor list'), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
  }
  if (!canUsePipelineSummary(ctx) || !source.getPipelineAggregate) {
    return pack(state, withProvenance(largeScopeAnswer({
      count: null,
      noun: 'cases',
      actions: liveNavigateActions(ctx.assistant, ['team-pipeline']),
    }), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  try {
    const pipeline = await source.getPipelineAggregate(ctx, {});
    const count = pipeline?.openCases ?? pipeline?.totalCases ?? null;
    return pack(state, withProvenance(largeScopeAnswer({
      count,
      noun: 'open pipeline cases',
      actions: liveNavigateActions(ctx.assistant, ['team-pipeline']),
    }), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  } catch {
    state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
    return pack(state, withProvenance(toolUnavailableAnswer(PIPELINE_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}

async function answerLicence(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  question: string,
): Promise<LiveGrounding> {
  const state: BuildState = {
    ctx,
    provenance: emptyProvenance(ctx, [LICENCE_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: null,
  };
  if (!canUseLicenceSummary(ctx)) {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  try {
    const pool = await source.getLicencePool(ctx);
    if (!pool) {
      state.provenance.toolsUnavailable.push(LICENCE_SUMMARY_TOOL.id);
      return pack(state, withProvenance(toolUnavailableAnswer(LICENCE_SUMMARY_TOOL.title), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
    const projection = executeLicenceSummary(pool);
    addTool(state, licenceToolFacts(projection));
    const shortfall = deriveLicenceShortfall({ question, pool });
    if (shortfall) addDerivation(state, shortfall);
    const planning = looksLicencePlanningQuestion(question);
    return pack(state, withProvenance(licenceSummaryAnswer(projection), state.provenance), {
      compositionWorthy: planning,
      fallbackKind: planning ? 'retrieval' : 'live',
      seedCardIds: planning ? LICENCE_SEED_CARDS : [],
    });
  } catch {
    state.provenance.toolsUnavailable.push(LICENCE_SUMMARY_TOOL.id);
    return pack(state, withProvenance(toolUnavailableAnswer(LICENCE_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}

async function answerPerson(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  mention: string,
): Promise<LiveGrounding> {
  const state: BuildState = {
    ctx,
    provenance: emptyProvenance(ctx, [PERSON_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: null,
  };
  if (!canUsePersonSummary(ctx)) {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  let people: DirectoryPerson[];
  try {
    people = await loadPeople(ctx, source);
  } catch {
    state.provenance.toolsUnavailable.push(PERSON_SUMMARY_TOOL.id);
    return pack(state, withProvenance(toolUnavailableAnswer(PERSON_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  const resolved = resolvePersonInScope(mention, people, ctx.refs);
  if (resolved.kind === 'not_found_in_scope') {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (resolved.kind === 'ambiguous') {
    return pack(state, withProvenance(personAmbiguityAnswer(resolved.candidates), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  try {
    const projection = executePersonSummary(ctx, resolved.candidate.ref, people);
    addTool(state, personToolFacts(projection, {
      entity: resolved.candidate.ref,
      includeDirectoryContact: ctx.environment === 'demo',
    }));
    return pack(state, withProvenance(personSummaryAnswer(projection), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  } catch {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}

async function answerAccess(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  _question: string,
  mention: string,
  topic: string,
): Promise<LiveGrounding> {
  const state: BuildState = {
    ctx,
    provenance: emptyProvenance(ctx, [PERSON_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: null,
  };
  if (!canUsePersonSummary(ctx)) {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  let people: DirectoryPerson[];
  try {
    people = await loadPeople(ctx, source);
  } catch {
    state.provenance.toolsUnavailable.push(PERSON_SUMMARY_TOOL.id);
    return pack(state, withProvenance(toolUnavailableAnswer(PERSON_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  const resolved = resolvePersonInScope(mention, people, ctx.refs);
  if (resolved.kind === 'not_found_in_scope') {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (resolved.kind === 'ambiguous') {
    return pack(state, withProvenance(personAmbiguityAnswer(resolved.candidates), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  try {
    const person = resolved.candidate.person;
    const projection = executePersonSummary(ctx, resolved.candidate.ref, people);
    addTool(state, personToolFacts(projection, {
      entity: resolved.candidate.ref,
      includeDirectoryContact: ctx.environment === 'demo',
    }));
    addDerivation(state, deriveSubjectLeadershipAccess({
      storedRank: person.rank,
      reportingRoleLabel: person.reportingRoleLabel,
    }));
    const seedCardIds = ACCESS_SEED_CARDS.filter((id) => {
      if (topic.includes('production')) return true;
      if (topic.includes('pipeline') && id !== 'REPORT.PRODUCTION') return true;
      return id !== 'REPORT.PRODUCTION';
    });
    return pack(state, withProvenance(personSummaryAnswer(projection), state.provenance), {
      compositionWorthy: true,
      fallbackKind: 'retrieval',
      seedCardIds: topic.includes('production') ? ACCESS_SEED_CARDS : seedCardIds,
    });
  } catch {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
}

async function answerNamedPerson(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  intent: 'advisor' | 'production' | 'pipeline',
  mention: string,
  period: AssistantPeriod,
  question: string,
): Promise<LiveGrounding | null> {
  if (intent === 'advisor' && !canUseAdvisorSummary(ctx)) return null;
  if (intent === 'production' && !canUseProductionSummary(ctx)) return null;
  if (intent === 'pipeline' && !canUsePipelineSummary(ctx)) return null;

  const tools = intent === 'advisor'
    ? [ADVISOR_SUMMARY_TOOL.id, PRODUCTION_SUMMARY_TOOL.id, PIPELINE_SUMMARY_TOOL.id]
    : intent === 'production'
      ? [PRODUCTION_SUMMARY_TOOL.id]
      : [PIPELINE_SUMMARY_TOOL.id];
  const state: BuildState = {
    ctx,
    provenance: emptyProvenance(ctx, tools),
    tools: [],
    derivations: [],
    period: { id: period, label: ASSISTANT_PERIOD_LABELS[period] },
  };

  let people: DirectoryPerson[];
  try {
    people = await loadPeople(ctx, source, 'reporting');
  } catch {
    state.provenance.toolsUnavailable.push(...tools);
    return pack(state, withProvenance(toolUnavailableAnswer('Advisor summary'), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }

  const resolved = resolvePersonInScope(mention, people, ctx.refs);
  if (resolved.kind === 'not_found_in_scope') {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (resolved.kind === 'ambiguous') {
    return pack(state, withProvenance(personAmbiguityAnswer(resolved.candidates), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }

  const person = resolved.candidate.person;
  const label = ASSISTANT_PERIOD_LABELS[period];
  const includeContact = ctx.environment === 'demo';

  if (intent === 'production') {
    if (!source.getProductionTotals) {
      state.provenance.toolsUnavailable.push(PRODUCTION_SUMMARY_TOOL.id);
      return pack(state, withProvenance(toolUnavailableAnswer(PRODUCTION_SUMMARY_TOOL.title), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
    try {
      const production = await source.getProductionTotals(ctx, { period, memberIds: [person.id] });
      if (!production) {
        state.provenance.toolsUnavailable.push(PRODUCTION_SUMMARY_TOOL.id);
        return pack(state, withProvenance(toolUnavailableAnswer(PRODUCTION_SUMMARY_TOOL.title), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      addTool(state, productionToolFacts({
        entity: resolved.candidate.ref,
        period,
        production,
      }));
      return pack(state, withProvenance(productionSummaryAnswer({
        subjectName: resolved.candidate.displayName,
        periodLabel: label,
        production,
      }), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    } catch (error) {
      if (isLiveScopeMiss(error)) {
        return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      state.provenance.toolsUnavailable.push(PRODUCTION_SUMMARY_TOOL.id);
      return pack(state, withProvenance(toolUnavailableAnswer(PRODUCTION_SUMMARY_TOOL.title), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
  }

  if (intent === 'pipeline') {
    if (!source.getPipelineAggregate) {
      state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
      return pack(state, withProvenance(toolUnavailableAnswer(PIPELINE_SUMMARY_TOOL.title), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
    try {
      const pipeline = await source.getPipelineAggregate(ctx, { memberIds: [person.id] });
      if (!pipeline) {
        state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
        return pack(state, withProvenance(toolUnavailableAnswer(PIPELINE_SUMMARY_TOOL.title), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      const projection = projectPipelineSummary(resolved.candidate.displayName, pipeline);
      addTool(state, pipelineToolFacts({ entity: resolved.candidate.ref, projection }));
      return pack(state, withProvenance(pipelineSummaryAnswer(projection), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    } catch (error) {
      if (isLiveScopeMiss(error)) {
        return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
      return pack(state, withProvenance(toolUnavailableAnswer(PIPELINE_SUMMARY_TOOL.title), state.provenance), {
        compositionWorthy: false,
        fallbackKind: 'live',
      });
    }
  }

  const personProjection = projectPersonSummary(person, ctx);
  addTool(state, personToolFacts(personProjection, {
    entity: resolved.candidate.ref,
    includeDirectoryContact: includeContact,
  }));
  let production = null;
  let pipeline = null;
  if (canUseProductionSummary(ctx) && source.getProductionTotals) {
    try {
      production = await source.getProductionTotals(ctx, { period, memberIds: [person.id] });
      if (production) {
        addTool(state, productionToolFacts({
          entity: resolved.candidate.ref,
          period,
          production,
        }));
      } else {
        state.provenance.toolsUnavailable.push(PRODUCTION_SUMMARY_TOOL.id);
      }
    } catch (error) {
      if (isLiveScopeMiss(error)) {
        return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      state.provenance.toolsUnavailable.push(PRODUCTION_SUMMARY_TOOL.id);
    }
  }
  if (canUsePipelineSummary(ctx) && source.getPipelineAggregate) {
    try {
      pipeline = await source.getPipelineAggregate(ctx, { memberIds: [person.id] });
      if (pipeline) {
        const projection = projectPipelineSummary(resolved.candidate.displayName, pipeline);
        addTool(state, pipelineToolFacts({ entity: resolved.candidate.ref, projection }));
      } else {
        state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
      }
    } catch (error) {
      if (isLiveScopeMiss(error)) {
        return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
    }
  }
  markTool(state.provenance, ADVISOR_SUMMARY_TOOL.id, ADVISOR_SUMMARY_TOOL.version, {
    entityRef: resolved.candidate.ref,
    period,
  });
  return pack(state, withProvenance(advisorSummaryAnswer({
    person: personProjection,
    periodLabel: label,
    production,
    openPipelineCases: pipeline?.openCases ?? null,
    pipelineValue: pipeline?.pipelineValue ?? null,
  }, {
    unavailable: [
      ...(state.provenance.toolsUnavailable.includes(PRODUCTION_SUMMARY_TOOL.id) ? ['production' as const] : []),
      ...(state.provenance.toolsUnavailable.includes(PIPELINE_SUMMARY_TOOL.id) ? ['pipeline' as const] : []),
    ],
  }), state.provenance), {
    compositionWorthy: looksDoingQuestion(question),
    fallbackKind: 'live',
    seedCardIds: ADVISOR_SEED_CARDS,
  });
}

async function answerTeam(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  mention: string,
  period: AssistantPeriod,
  question: string,
): Promise<LiveGrounding | null> {
  if (!canUseTeamSummary(ctx)) return null;
  const state: BuildState = {
    ctx,
    provenance: emptyProvenance(ctx, [TEAM_SUMMARY_TOOL.id, PRODUCTION_SUMMARY_TOOL.id, PIPELINE_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: { id: period, label: ASSISTANT_PERIOD_LABELS[period] },
  };
  let teams: DirectoryTeam[];
  try {
    teams = await loadTeams(ctx, source);
  } catch {
    state.provenance.toolsUnavailable.push(TEAM_SUMMARY_TOOL.id);
    return pack(state, withProvenance(toolUnavailableAnswer(TEAM_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  const resolved = resolveTeamInScope(mention, teams, ctx.refs);
  if (resolved.kind === 'not_found_in_scope') {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (resolved.kind === 'ambiguous') {
    return pack(state, withProvenance(unitAmbiguityAnswer(resolved.candidates), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  const team = resolved.candidate.team;
  if (!team) {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }

  addTool(state, teamToolFacts({ entity: resolved.candidate.ref, period, team }));
  let production = null;
  let pipeline = null;
  if (canUseProductionSummary(ctx) && source.getProductionTotals) {
    try {
      production = await source.getProductionTotals(ctx, { period, memberIds: team.memberIds });
      if (production) {
        addTool(state, productionToolFacts({
          entity: resolved.candidate.ref,
          period,
          production,
        }));
      }
    } catch {
      state.provenance.toolsUnavailable.push(PRODUCTION_SUMMARY_TOOL.id);
    }
  }
  if (canUsePipelineSummary(ctx) && source.getPipelineAggregate) {
    try {
      pipeline = await source.getPipelineAggregate(ctx, { memberIds: team.memberIds });
      if (pipeline) {
        const projection = projectPipelineSummary(team.name, pipeline);
        addTool(state, pipelineToolFacts({ entity: resolved.candidate.ref, projection }));
      }
    } catch (error) {
      if (isLiveScopeMiss(error)) {
        return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
    }
  }
  return pack(state, withProvenance(teamSummaryAnswer({
    name: team.name,
    leaderName: team.leaderName,
    regionName: team.regionName,
    advisorCount: team.advisorCount,
    periodLabel: ASSISTANT_PERIOD_LABELS[period],
    production,
    openPipelineCases: pipeline?.openCases ?? null,
    pipelineValue: pipeline?.pipelineValue ?? null,
  }), state.provenance), {
    compositionWorthy: looksDoingQuestion(question),
    fallbackKind: 'live',
    seedCardIds: ADVISOR_SEED_CARDS,
  });
}

async function answerRegion(
  ctx: ToolExecutionContext,
  source: LiveDirectorySource,
  mention: string,
  period: AssistantPeriod,
  question: string,
): Promise<LiveGrounding | null> {
  if (!canUseRegionSummary(ctx)) return null;
  const state: BuildState = {
    ctx,
    provenance: emptyProvenance(ctx, [REGION_SUMMARY_TOOL.id, PRODUCTION_SUMMARY_TOOL.id, PIPELINE_SUMMARY_TOOL.id]),
    tools: [],
    derivations: [],
    period: { id: period, label: ASSISTANT_PERIOD_LABELS[period] },
  };
  let regions: DirectoryRegion[];
  try {
    regions = await loadRegions(ctx, source);
  } catch {
    state.provenance.toolsUnavailable.push(REGION_SUMMARY_TOOL.id);
    return pack(state, withProvenance(toolUnavailableAnswer(REGION_SUMMARY_TOOL.title), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  const resolved = resolveRegionInScope(mention, regions, ctx.refs);
  if (resolved.kind === 'not_found_in_scope') {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  if (resolved.kind === 'ambiguous') {
    return pack(state, withProvenance(unitAmbiguityAnswer(resolved.candidates), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }
  const region = resolved.candidate.region;
  if (!region) {
    return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
      compositionWorthy: false,
      fallbackKind: 'live',
    });
  }

  addTool(state, regionToolFacts({ entity: resolved.candidate.ref, period, region }));
  let production = null;
  let pipeline = null;
  if (canUseProductionSummary(ctx) && source.getProductionTotals) {
    try {
      production = await source.getProductionTotals(ctx, { period, memberIds: region.memberIds });
      if (production) {
        addTool(state, productionToolFacts({
          entity: resolved.candidate.ref,
          period,
          production,
        }));
      }
    } catch {
      state.provenance.toolsUnavailable.push(PRODUCTION_SUMMARY_TOOL.id);
    }
  }
  if (canUsePipelineSummary(ctx) && source.getPipelineAggregate) {
    try {
      pipeline = await source.getPipelineAggregate(ctx, { memberIds: region.memberIds });
      if (pipeline) {
        const projection = projectPipelineSummary(region.name, pipeline);
        addTool(state, pipelineToolFacts({ entity: resolved.candidate.ref, projection }));
      }
    } catch (error) {
      if (isLiveScopeMiss(error)) {
        return pack(state, withProvenance(notFoundInScopeAnswer(), state.provenance), {
          compositionWorthy: false,
          fallbackKind: 'live',
        });
      }
      state.provenance.toolsUnavailable.push(PIPELINE_SUMMARY_TOOL.id);
    }
  }
  return pack(state, withProvenance(regionSummaryAnswer({
    name: region.name,
    managerName: region.managerName,
    teamCount: region.teamCount,
    advisorCount: region.advisorCount,
    periodLabel: ASSISTANT_PERIOD_LABELS[period],
    production,
    openPipelineCases: pipeline?.openCases ?? null,
    pipelineValue: pipeline?.pipelineValue ?? null,
  }), state.provenance), {
    compositionWorthy: looksDoingQuestion(question),
    fallbackKind: 'live',
    seedCardIds: ADVISOR_SEED_CARDS,
  });
}
