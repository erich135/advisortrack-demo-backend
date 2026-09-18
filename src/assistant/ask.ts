import {
  buildAssistantContext,
  contextAudience,
  withLicenceFacts,
  type AssistantContext,
  type AssistantEnvironment,
  type AssistantLicencePool,
  type AssistantNavigation,
  type TrustedAssistantIdentity,
} from './context';
import {
  buildConversationResponse,
  detectConversationIntent,
} from './conversation';
import { gatherLiveGrounding, type LiveGrounding } from './live/answer';
import { extraNumbersFromGrounding } from './live/derive';
import { logAssistantAudit } from './live/log';
import { LIVE_LIMITS } from './live/limits';
import { countToolProjectionFields, minimiseLiveToolsForModel } from './live/minimise';
import { containsEndClientPii } from './live/privacy';
import type { LiveDirectorySource } from './live/types';
import { filterCards } from './filter';
import {
  answerFromCards,
  answerFromGrounding,
  clarifyAnswer,
  disambiguationAnswer,
  unknownHelpAnswer,
} from './model/compose';
import { createDisabledProvider, AssistantProviderError, remainingTurnMs, shouldRetryProviderError, staticRetryReason, MIN_MODEL_ATTEMPT_MS } from './model/provider';
import { assistantModelDecisionSchema } from './model/types';
import { candidateFromCard, looksCompositeQuestion, buildModelPrompt } from './model/prompt';
import { redactQuestion } from './model/redact';
import { validateModelDecision } from './model/validate';
import type { AssistantAskResult, AssistantModelDecision, AssistantModelProvider, AssistantModelUsage } from './model/types';
import { rankCards, retrieveCards } from './retrieve';
import { routeById } from './routes';
import type { ServerKnowledgeBundle, ServerKnowledgeCard } from './serverBundle';
import type { AssistantRoute } from './types';

export const ASSISTANT_MODEL_LIMITS = {
  timeoutMs: LIVE_LIMITS.turnTimeoutMs,
  maxCandidates: 8,
  maxSelectedCards: 5,
  candidateMinScore: 0.38,
  maxQuestionChars: 500,
  maxPromptChars: LIVE_LIMITS.maxPromptChars,
  maxToolProjectionFields: LIVE_LIMITS.maxToolProjectionFields,
  maxOutputTokens: 1536,
};

function asRoutes(bundle: ServerKnowledgeBundle): AssistantRoute[] {
  return bundle.routes.map((route) => ({
    routeId: route.routeId,
    path: route.path,
    label: route.label,
    environment: route.environment,
    classification: route.classification,
    demoLabel: route.demoLabel,
    productionCapability: route.productionCapability ?? null,
    demoCapability: route.demoCapability,
  }));
}

function deterministicFromRetrieval(
  allowed: ServerKnowledgeCard[],
  question: string,
  context: AssistantContext,
  routes: AssistantRoute[],
): AssistantAskResult {
  const retrieved = retrieveCards(allowed, question, context.route.routeId);
  if (retrieved.kind === 'match') {
    return {
      answer: answerFromCards([retrieved.card], context, routes),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }
  if (retrieved.kind === 'disambiguate') {
    return {
      answer: disambiguationAnswer(retrieved.cards.map((hit) => hit.card)),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }
  return { answer: unknownHelpAnswer(), origin: 'deterministic', modelAttempted: false };
}

function shouldBypassModel(
  allowed: ServerKnowledgeCard[],
  question: string,
  context: AssistantContext,
): boolean {
  const retrieved = retrieveCards(allowed, question, context.route.routeId);
  if (retrieved.kind === 'match' && retrieved.exactForm && !looksCompositeQuestion(question)) {
    return true;
  }
  if (retrieved.kind === 'unknown') {
    if (looksCompositeQuestion(question)) {
      return rankCards(allowed, question, context.route.routeId).length === 0;
    }
    const ranked = rankCards(allowed, question, context.route.routeId).filter(
      (hit) => hit.score >= ASSISTANT_MODEL_LIMITS.candidateMinScore,
    );
    return ranked.length === 0;
  }
  return false;
}

function candidateCards(
  allowed: ServerKnowledgeCard[],
  question: string,
  context: AssistantContext,
  seedIds: string[] = [],
): ServerKnowledgeCard[] {
  const ranked = rankCards(allowed, question, context.route.routeId);
  const retrieved = retrieveCards(allowed, question, context.route.routeId);
  const picked: ServerKnowledgeCard[] = [];
  const add = (card: ServerKnowledgeCard) => {
    if (picked.some((item) => item.id === card.id)) return;
    if (picked.length >= ASSISTANT_MODEL_LIMITS.maxCandidates) return;
    picked.push(card);
  };
  if (retrieved.kind === 'match') add(retrieved.card);
  if (retrieved.kind === 'disambiguate') {
    for (const hit of retrieved.cards) add(hit.card);
  }
  for (const id of seedIds) {
    const card = allowed.find((item) => item.id === id);
    if (card) add(card);
  }
  const minScore = looksCompositeQuestion(question) ? 0.12 : ASSISTANT_MODEL_LIMITS.candidateMinScore;
  for (const hit of ranked) {
    if (hit.score < minScore) continue;
    add(hit.card);
  }
  return picked;
}

function compositionFallback(
  grounding: LiveGrounding,
  allowed: ServerKnowledgeCard[],
  question: string,
  context: AssistantContext,
  routes: AssistantRoute[],
): AssistantAskResult {
  if (grounding.fallbackKind === 'retrieval') {
    const retrieved = deterministicFromRetrieval(allowed, question, context, routes);
    if (retrieved.answer.mode === 'unknown' || retrieved.answer.mode === 'disambiguate') {
      return grounding.result;
    }
    if (!grounding.tools.length) return retrieved;
    const body = [grounding.result.answer.body, retrieved.answer.body].filter(Boolean).join('\n\n');
    return {
      answer: {
        ...retrieved.answer,
        headline: grounding.result.answer.headline || retrieved.answer.headline,
        body,
        facts: grounding.result.answer.facts ?? retrieved.answer.facts,
        sources: [
          ...grounding.result.answer.sources,
          ...retrieved.answer.sources,
        ].filter((source, index, list) => list.findIndex((item) => item.cardId === source.cardId) === index),
      },
      origin: 'deterministic',
      modelAttempted: false,
      provenance: grounding.result.provenance,
    };
  }
  return grounding.result;
}

async function completeDecision(
  provider: AssistantModelProvider,
  prompt: { system: string; user: string },
  timeoutMs: number,
  affinity?: { environment: 'production' | 'demo'; companyId?: string | null },
) {
  const result = await provider.complete({
    system: prompt.system,
    user: prompt.user,
    schemaName: 'AssistantModelDecision',
    timeoutMs,
    affinity,
  });
  const parsed = assistantModelDecisionSchema.safeParse(result.decision);
  if (!parsed.success) {
    const error = new AssistantProviderError('Model JSON failed schema validation', 'schema');
    error.usage = result.usage;
    throw error;
  }
  return { ...result, decision: parsed.data };
}

function applyModelUsage<T extends { provenance?: AssistantAskResult['provenance'] }>(
  result: T,
  usage?: AssistantModelUsage,
): T {
  if (!result.provenance || !usage) return result;
  result.provenance.modelName = usage.modelName;
  result.provenance.modelLatencyMs = usage.latencyMs;
  result.provenance.inputUsage = usage.inputUsage;
  result.provenance.cachedInputUsage = usage.cachedInputUsage;
  result.provenance.outputUsage = usage.outputUsage;
  result.provenance.reasoningUsage = usage.reasoningUsage;
  result.provenance.requestCostUsd = usage.requestCostUsd;
  result.provenance.providerHttpStatus = usage.providerHttpStatus;
  return result;
}

function withModelProvenance(
  grounding: LiveGrounding | null,
  decision: AssistantModelDecision,
  origin: AssistantAskResult['origin'],
  cards: Array<{ id: string; businessRules?: string[] }> = [],
): AssistantAskResult['provenance'] {
  const provenance = grounding?.result.provenance
    ? {
      ...grounding.result.provenance,
      items: [...grounding.result.provenance.items],
      factTraces: [...(grounding.result.provenance.factTraces ?? [])],
      knowledgeCards: [...(grounding.result.provenance.knowledgeCards ?? [])],
      businessRules: [...(grounding.result.provenance.businessRules ?? [])],
      toolsAttempted: [...grounding.result.provenance.toolsAttempted],
      toolsUsed: [...grounding.result.provenance.toolsUsed],
      toolsUnavailable: [...grounding.result.provenance.toolsUnavailable],
    }
    : undefined;
  if (!provenance) return undefined;
  provenance.origin = origin === 'model' ? 'model' : origin === 'fallback' ? 'fallback' : 'deterministic';
  provenance.modelCalled = origin === 'model';
  for (const cardId of decision.selectedCardIds) {
    if (!provenance.knowledgeCards.includes(cardId)) provenance.knowledgeCards.push(cardId);
    if (!provenance.items.some((item) => item.kind === 'card' && item.cardId === cardId)) {
      provenance.items.push({ kind: 'card', cardId });
    }
  }
  for (const card of cards) {
    for (const ruleId of card.businessRules ?? []) {
      if (!provenance.businessRules.includes(ruleId)) provenance.businessRules.push(ruleId);
      if (!provenance.items.some((item) => item.kind === 'rule' && item.ruleId === ruleId)) {
        provenance.items.push({ kind: 'rule', ruleId });
      }
    }
  }
  return provenance;
}

export async function askAssistant(input: {
  question: string;
  identity: TrustedAssistantIdentity;
  navigation: AssistantNavigation;
  environment: AssistantEnvironment;
  bundle: ServerKnowledgeBundle;
  licencePool?: AssistantLicencePool | null;
  provider?: AssistantModelProvider | null;
  timeoutMs?: number;
  liveSource?: LiveDirectorySource | null;
}): Promise<AssistantAskResult> {
  const started = Date.now();
  const result = await askAssistantInner(input);
  const toolsUsed = result.provenance?.toolsUsed ?? [];
  logAssistantAudit({
    turnId: result.provenance?.turnId ?? 'none',
    environment: input.environment,
    caller: input.identity.isPlatformStaff && input.environment === 'production' ? 'staff' : 'customer',
    scopeKind: result.provenance ? (input.identity.hierarchyScopeKind ?? null) : null,
    hasCompany: Boolean(input.identity.companyId),
    toolId: toolsUsed[0],
    status: result.origin === 'fallback' ? 'fallback' : 'ok',
    elapsedMs: Date.now() - started,
    modelCalled: result.modelAttempted && result.origin === 'model',
    cacheHit: (result.provenance?.cacheHits ?? 0) > 0,
    cacheMiss: (result.provenance?.cacheMisses ?? 0) > 0,
    toolTimeout: (result.provenance?.toolTimeouts ?? 0) > 0,
    circuitOpen: (result.provenance?.circuitOpen ?? 0) > 0,
    promptChars: result.provenance?.promptChars,
    candidateCount: result.provenance?.candidateCount,
    toolProjectionCount: result.provenance?.toolProjectionCount,
    fallbackUsed: result.origin === 'fallback',
    validationCode: result.provenance?.validatorRejectionCode,
    validatorRejectionCode: result.provenance?.validatorRejectionCode,
    modelName: result.provenance?.modelName,
    modelLatencyMs: result.provenance?.modelLatencyMs,
    inputUsage: result.provenance?.inputUsage,
    cachedInputUsage: result.provenance?.cachedInputUsage,
    outputUsage: result.provenance?.outputUsage,
    reasoningUsage: result.provenance?.reasoningUsage,
    requestCostUsd: result.provenance?.requestCostUsd,
    providerHttpStatus: result.provenance?.providerHttpStatus,
  });
  return result;
}

async function askAssistantInner(input: {
  question: string;
  identity: TrustedAssistantIdentity;
  navigation: AssistantNavigation;
  environment: AssistantEnvironment;
  bundle: ServerKnowledgeBundle;
  licencePool?: AssistantLicencePool | null;
  provider?: AssistantModelProvider | null;
  timeoutMs?: number;
  liveSource?: LiveDirectorySource | null;
}): Promise<AssistantAskResult> {
  const rawQuestion = redactQuestion(input.question).slice(0, ASSISTANT_MODEL_LIMITS.maxQuestionChars);
  if (!rawQuestion.trim()) {
    return { answer: unknownHelpAnswer(), origin: 'deterministic', modelAttempted: false };
  }

  const conversation = detectConversationIntent(rawQuestion, input.bundle.categories);
  if (conversation.kind === 'conversation' && conversation.intent !== 'off_topic') {
    return {
      answer: buildConversationResponse(conversation.intent, input.bundle.categories, input.environment),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }

  const question = conversation.kind === 'continue' ? conversation.remainder : rawQuestion;
  const routes = asRoutes(input.bundle);
  const context = withLicenceFacts(
    buildAssistantContext({
      environment: input.environment,
      identity: input.identity,
      navigation: {
        pathname: input.navigation.pathname,
        search: input.navigation.search,
      },
      routes,
    }),
    input.licencePool,
  );
  const allowed = filterCards(input.bundle.cards, {
    environment: context.environment,
    audience: contextAudience(context),
    capabilities: context.capabilities,
  }, (routeId) => routeById(routeId) ?? routes.find((route) => route.routeId === routeId));

  const turnTimeoutMs = input.timeoutMs ?? ASSISTANT_MODEL_LIMITS.timeoutMs;
  const deadlineAt = Date.now() + turnTimeoutMs;
  const remaining = () => remainingTurnMs(deadlineAt);

  const grounding = input.liveSource
    ? await gatherLiveGrounding({
      question,
      identity: input.identity,
      context,
      source: input.liveSource,
      timeoutMs: remaining() || 1,
    })
    : null;

  if (grounding && !grounding.compositionWorthy) {
    return grounding.result;
  }

  if (conversation.kind === 'conversation' && conversation.intent === 'off_topic' && !grounding) {
    return {
      answer: buildConversationResponse(conversation.intent, input.bundle.categories, input.environment),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }

  const provider = input.provider ?? createDisabledProvider();
  const providerUsable = provider.id !== 'disabled';
  const liveFallback = grounding
    ? compositionFallback(grounding, allowed, question, context, routes)
    : null;

  if (grounding?.compositionWorthy && !providerUsable) {
    return liveFallback ?? grounding.result;
  }

  if (!grounding && (!providerUsable || shouldBypassModel(allowed, question, context))) {
    return deterministicFromRetrieval(allowed, question, context, routes);
  }

  const candidates = candidateCards(allowed, question, context, grounding?.seedCardIds ?? []);
  if (!candidates.length && !(grounding?.tools.length)) {
    return liveFallback ?? { answer: unknownHelpAnswer(), origin: 'deterministic', modelAttempted: false };
  }

  const timeoutMs = remaining();
  const fallback = liveFallback ?? deterministicFromRetrieval(allowed, question, context, routes);
  const modelTools = grounding
    ? minimiseLiveToolsForModel(question, grounding.tools, context)
    : undefined;

  if (timeoutMs < MIN_MODEL_ATTEMPT_MS) {
    return fallback;
  }

  let lastUsage: AssistantModelUsage | undefined;
  const run = async (retryReason?: string): Promise<AssistantAskResult> => {
    const attemptBudget = remaining();
    if (attemptBudget < MIN_MODEL_ATTEMPT_MS) {
      return fallback;
    }
    const prompt = buildModelPrompt({
      question,
      context,
      candidates: candidates.map((card) => candidateFromCard(card, input.bundle.rules)),
      retryReason,
      tools: modelTools,
      derivations: grounding?.derivations,
      period: grounding?.period,
    });
    if (grounding?.result.provenance) {
      grounding.result.provenance.promptChars = prompt.user.length;
      grounding.result.provenance.candidateCount = candidates.length;
      grounding.result.provenance.toolProjectionCount = countToolProjectionFields(modelTools ?? []);
    }
    if (prompt.user.length > ASSISTANT_MODEL_LIMITS.maxPromptChars) {
      return fallback;
    }
    if (context.environment === 'production' && containsEndClientPii(prompt.user)) {
      const error = new AssistantProviderError('Production model input contained end-client PII', 'schema');
      error.validation = { code: 'client_pii', message: 'Production model input contained end-client PII' };
      throw error;
    }
    const completion = await completeDecision(provider, prompt, attemptBudget, {
      environment: context.environment,
      companyId: context.identity.companyId,
    });
    lastUsage = completion.usage;
    const decision = completion.decision;
    const failure = validateModelDecision({
      decision,
      context,
      allowedCards: allowed,
      candidateIds: candidates.map((card) => card.id),
      routes,
      question,
      extraToolNumbers: extraNumbersFromGrounding({
        tools: modelTools,
        derivations: grounding?.derivations,
      }),
      tools: modelTools,
      derivations: grounding?.derivations,
    });
    if (failure) {
      const error = new AssistantProviderError(failure.message, 'schema');
      error.validation = failure;
      error.usage = lastUsage;
      throw error;
    }

    const selected = decision.selectedCardIds
      .map((id) => candidates.find((card) => card.id === id))
      .filter((card): card is ServerKnowledgeCard => Boolean(card))
      .slice(0, ASSISTANT_MODEL_LIMITS.maxSelectedCards);

    if (decision.outcome === 'clarify') {
      return applyModelUsage({
        answer: clarifyAnswer(decision.clarifyingQuestion || 'Which of these did you mean?', selected),
        origin: 'model' as const,
        modelAttempted: true,
        provenance: withModelProvenance(grounding, decision, 'model', selected),
      }, lastUsage);
    }
    if (decision.outcome === 'insufficient_context' || (!selected.length && !(decision.selectedToolIds ?? []).length)) {
      return applyModelUsage({ ...fallback, modelAttempted: true, origin: 'fallback' as const }, lastUsage);
    }

    const answer = grounding
      ? answerFromGrounding({
        cards: selected,
        tools: grounding.tools,
        context,
        routes,
        decision,
        liveFacts: grounding.result.answer.facts,
      })
      : answerFromCards(selected, context, routes, decision);

    return applyModelUsage({
      answer,
      origin: 'model' as const,
      modelAttempted: true,
        provenance: withModelProvenance(grounding, decision, 'model', selected),
    }, lastUsage);
  };

  try {
    return await run();
  } catch (error) {
    if (error instanceof AssistantProviderError && error.usage) lastUsage = error.usage;
    const retryable = error instanceof AssistantProviderError
      && shouldRetryProviderError(error)
      && remaining() >= MIN_MODEL_ATTEMPT_MS;
    if (!retryable) {
      const validationCode = error instanceof AssistantProviderError ? error.validation?.code : undefined;
      const failed = { ...fallback, origin: 'fallback' as const, modelAttempted: true };
      if (failed.provenance && validationCode) {
        failed.provenance.validatorRejectionCode = validationCode;
      }
      return applyModelUsage(failed, lastUsage);
    }
    const reason = error instanceof AssistantProviderError
      ? staticRetryReason(error)
      : 'SCHEMA:\nReturn JSON that matches AssistantModelDecision exactly.';
    try {
      return await run(reason);
    } catch (inner) {
      if (inner instanceof AssistantProviderError && inner.usage) lastUsage = inner.usage;
      const validationCode = (error as { validation?: { code?: string } }).validation?.code
        || (inner as { validation?: { code?: string } }).validation?.code;
      const failed = { ...fallback, origin: 'fallback' as const, modelAttempted: true };
      if (failed.provenance && validationCode) {
        failed.provenance.validatorRejectionCode = validationCode;
      }
      return applyModelUsage(failed, lastUsage);
    }
  }
}

export type { AssistantContext };
