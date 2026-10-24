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
  hasProductSubstance,
  isChatRemainder,
  isDeterministicSocialIntent,
} from './conversation';
import { looksCrisisQuestion, crisisSupportAnswer } from './crisisAsk';
import {
  lastUserQuestion,
  readAssistantConversation,
  rememberAssistantTurn,
  resolveConversationHistory,
  type ConversationTurn,
} from './conversationMemory';
import { previousWasCompanionTurn } from './live/companion';
import { gatherLiveGrounding, type LiveGrounding } from './live/answer';
import { normalizeQuestion } from './normalise';
import { extraNumbersFromGrounding } from './live/derive';
import { logAssistantAudit } from './live/log';
import { LIVE_LIMITS } from './live/limits';
import { countToolProjectionFields, minimiseLiveToolsForModel } from './live/minimise';
import { containsEndClientPii } from './live/privacy';
import type { LiveDirectorySource } from './live/types';
import { filterCards } from './filter';
import { buildFactPack } from './factPack';
import { classifyHighLevelIntent, shouldPreferDirectAnswer } from './intent';
import {
  answerFromCards,
  answerFromGrounding,
  clarifyAnswer,
  disambiguationAnswer,
  conversationModelAnswer,
  unknownHelpAnswer,
  privacyRefuseAnswer,
  financialAdviceRefuseAnswer,
  leadershipScopeRefuseAnswer,
  synthesizeFromCards,
  frustrationHelpAnswer,
  productOverviewAnswer,
  navigateAreaAnswer,
  submitStillBlockedAnswer,
  troubleshootAnswer,
} from './model/compose';
import { createDisabledProvider, AssistantProviderError, remainingTurnMs, shouldRetryProviderError, staticRetryReason, MIN_MODEL_ATTEMPT_MS } from './model/provider';
import { assistantModelCooldownRemaining } from './model/rateLimit';
import { assistantModelDecisionSchema } from './model/types';
import { candidateFromCard, looksCompositeQuestion, buildModelPrompt, type AssistantConversationMode } from './model/prompt';
import { redactQuestion } from './model/redact';
import { validateModelDecision } from './model/validate';
import type { AssistantAskResult, AssistantModelDecision, AssistantModelProvider, AssistantModelUsage } from './model/types';
import { rankCards, retrieveCards } from './retrieve';
import { expandConversationFollowUp } from './phrases';
import { looksClientPiiAsk, looksFinancialAdviceQuestion, looksLeadershipScopeAsk } from './privacyAsk';
import { nodeById, nodeForRoute } from './productMap';
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
  previousQuestion?: string | null,
): AssistantAskResult {
  const intent = classifyHighLevelIntent(question, context, previousQuestion);
  if (intent.kind === 'FRUSTRATION_HELP') {
    return { answer: frustrationHelpAnswer(context, intent.subject), origin: 'deterministic', modelAttempted: false };
  }
  if (intent.kind === 'PRODUCT_OVERVIEW') {
    return { answer: productOverviewAnswer(context), origin: 'deterministic', modelAttempted: false };
  }
  if (intent.kind === 'CURRENT_STATE') {
    return { answer: navigateAreaAnswer(context, intent.subject), origin: 'deterministic', modelAttempted: false };
  }
  if (intent.kind === 'NAVIGATE') {
    const mapped = (intent.subject ? nodeById(context.workspace, intent.subject) : null)
      ?? nodeForRoute(context.workspace, context.route.routeId);
    if (mapped && intent.subject && mapped.id === intent.subject) {
      return { answer: navigateAreaAnswer(context, intent.subject), origin: 'deterministic', modelAttempted: false };
    }
  }
  if (intent.kind === 'WHAT_NEXT' || intent.kind === 'LIVE_STATUS') {
    return { answer: synthesizeFromCards([], context, routes, intent), origin: 'deterministic', modelAttempted: false };
  }
  if (intent.kind === 'TROUBLESHOOT' && intent.subject === 'pipeline' && /\b(missing|fica|done the fica|cant get|cannot get|case through)\b/i.test(question)) {
    if (/\b(missing|fica|done the fica)\b/i.test(question)) {
      return { answer: submitStillBlockedAnswer(), origin: 'deterministic', modelAttempted: false };
    }
    return { answer: troubleshootAnswer(context, 'pipeline'), origin: 'deterministic', modelAttempted: false };
  }
  if (
    intent.kind === 'TROUBLESHOOT'
    && /\b(this (thing|page|screen|app) isn'?t working|isn'?t working)\b/i.test(question)
    && !/\b(import|submit|fica|licence|license)\b/i.test(question)
  ) {
    return { answer: troubleshootAnswer(context, intent.subject), origin: 'deterministic', modelAttempted: false };
  }
  if (intent.kind === 'TROUBLESHOOT') {
    const retrievedFirst = retrieveCards(allowed, question, context.route.routeId);
    if (retrievedFirst.kind === 'match') {
      return {
        answer: answerFromCards([retrievedFirst.card], context, routes),
        origin: 'deterministic',
        modelAttempted: false,
      };
    }
    if (retrievedFirst.kind === 'compose') {
      return {
        answer: synthesizeFromCards(retrievedFirst.cards.map((hit) => hit.card), context, routes, intent),
        origin: 'deterministic',
        modelAttempted: false,
      };
    }
    return { answer: synthesizeFromCards([], context, routes, intent), origin: 'deterministic', modelAttempted: false };
  }
  const retrieved = retrieveCards(allowed, question, context.route.routeId);
  if (retrieved.kind === 'match') {
    return {
      answer: answerFromCards([retrieved.card], context, routes),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }
  if (retrieved.kind === 'compose') {
    return {
      answer: synthesizeFromCards(retrieved.cards.map((hit) => hit.card), context, routes, intent),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }
  if (retrieved.kind === 'disambiguate' && !shouldPreferDirectAnswer(intent)) {
    return {
      answer: disambiguationAnswer(retrieved.cards.map((hit) => hit.card)),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }
  if (retrieved.kind === 'disambiguate') {
    return {
      answer: synthesizeFromCards(retrieved.cards.map((hit) => hit.card), context, routes, intent),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }
  if (shouldPreferDirectAnswer(intent)) {
    return { answer: synthesizeFromCards([], context, routes, intent), origin: 'deterministic', modelAttempted: false };
  }
  return { answer: unknownHelpAnswer(context), origin: 'deterministic', modelAttempted: false };
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
  const intent = classifyHighLevelIntent(question, context);
  if (shouldPreferDirectAnswer(intent) && intent.kind !== 'LIVE_STATUS') {
    return false;
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

const OVERVIEW_ROUTE_SEEDS = [
  'advisor-home',
  'advisor-contacts',
  'advisor-activities',
  'advisor-pipeline',
  'advisor-production',
  'advisor-planning',
];

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
  if (retrieved.kind === 'compose' || retrieved.kind === 'disambiguate') {
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
  const intent = classifyHighLevelIntent(question, context);
  if (intent.kind === 'PRODUCT_OVERVIEW') {
    for (const routeId of OVERVIEW_ROUTE_SEEDS) {
      const card = allowed.find((item) => item.routes.includes(routeId));
      if (card) add(card);
    }
  } else if (intent.subject) {
    const node = nodeById(context.workspace, intent.subject);
    for (const routeId of node?.routeIds ?? []) {
      const card = allowed.find((item) => item.routes.includes(routeId));
      if (card) add(card);
    }
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
  previousQuestion?: string | null;
  history?: ConversationTurn[] | null;
  resetConversation?: boolean;
}): Promise<AssistantAskResult> {
  const started = Date.now();
  const history = resolveConversationHistory({
    environment: input.environment,
    identity: input.identity,
    clientHistory: input.history,
    previousQuestion: input.previousQuestion,
    resetConversation: input.resetConversation === true,
  });
  const result = await askAssistantInner({ ...input, history });
  const crisis = looksCrisisQuestion(input.question);
  const storedPrior = input.resetConversation
    ? []
    : readAssistantConversation({
      environment: input.environment,
      identity: input.identity,
    });
  rememberAssistantTurn({
    environment: input.environment,
    identity: input.identity,
    history: storedPrior.length ? storedPrior : history,
    userText: input.question,
    assistantText: result.answer.body,
    skipUserText: crisis,
  });
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
  previousQuestion?: string | null;
  history?: ConversationTurn[];
}): Promise<AssistantAskResult> {
  const history = input.history ?? [];
  const previousQuestion = lastUserQuestion(history, input.previousQuestion);
  const rawQuestion = redactQuestion(
    expandConversationFollowUp(input.question, previousQuestion),
  ).slice(0, ASSISTANT_MODEL_LIMITS.maxQuestionChars);
  if (!rawQuestion.trim()) {
    return { answer: unknownHelpAnswer(), origin: 'deterministic', modelAttempted: false };
  }
  if (looksCrisisQuestion(rawQuestion) || looksCrisisQuestion(input.question)) {
    return { answer: crisisSupportAnswer(), origin: 'deterministic', modelAttempted: false };
  }
  if (looksClientPiiAsk(rawQuestion)) {
    return { answer: privacyRefuseAnswer(), origin: 'deterministic', modelAttempted: false };
  }

  const routes = asRoutes(input.bundle);
  const context = withLicenceFacts(
    buildAssistantContext({
      environment: input.environment,
      identity: input.identity,
      navigation: {
        pathname: input.navigation.pathname,
        search: input.navigation.search,
        viewport: input.navigation.viewport,
      },
      routes,
    }),
    input.licencePool,
  );

  const conversation = detectConversationIntent(rawQuestion, input.bundle.categories);
  if (conversation.kind === 'conversation' && isDeterministicSocialIntent(conversation.intent)) {
    return {
      answer: buildConversationResponse(
        conversation.intent,
        input.bundle.categories,
        input.environment,
        context,
        rawQuestion,
        previousQuestion,
      ),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }

  const question = conversation.kind === 'continue' ? conversation.remainder : rawQuestion;
  const allowed = filterCards(input.bundle.cards, {
    environment: context.environment,
    audience: contextAudience(context),
    capabilities: context.capabilities,
  }, (routeId) => routeById(routeId) ?? routes.find((route) => route.routeId === routeId));

  if (looksFinancialAdviceQuestion(question)) {
    return { answer: financialAdviceRefuseAnswer(), origin: 'deterministic', modelAttempted: false };
  }
  if (looksLeadershipScopeAsk(question) && context.workspace === 'advisor') {
    return { answer: leadershipScopeRefuseAnswer(), origin: 'deterministic', modelAttempted: false };
  }

  const highLevel = classifyHighLevelIntent(question, context, previousQuestion);
  const provider = input.provider ?? createDisabledProvider();
  const providerUsable = provider.id !== 'disabled';
  const productFrustration = highLevel.kind === 'FRUSTRATION_HELP'
    && hasProductSubstance(question, input.bundle.categories);
  if (productFrustration) {
    return {
      answer: frustrationHelpAnswer(context, highLevel.subject),
      origin: 'deterministic',
      modelAttempted: false,
    };
  }

  const remainderChat = isChatRemainder(conversation)
    && !hasProductSubstance(question, input.bundle.categories);
  const shortChatFollowUp = /^(why|and then|what happened|tell me more|go on|and)$/.test(
    normalizeQuestion(question),
  );
  const skipLive = remainderChat
    && (
      (
        conversation.kind === 'conversation'
        && (conversation.intent === 'greeting'
          || conversation.intent === 'capabilities'
          || conversation.intent === 'frustration')
      )
      || (shortChatFollowUp && !previousWasCompanionTurn(previousQuestion))
    );

  const turnTimeoutMs = input.timeoutMs ?? ASSISTANT_MODEL_LIMITS.timeoutMs;
  const deadlineAt = Date.now() + turnTimeoutMs;
  const remaining = () => remainingTurnMs(deadlineAt);

  const chatFallback: AssistantAskResult = {
    answer: conversation.kind === 'conversation'
      ? buildConversationResponse(
        conversation.intent,
        input.bundle.categories,
        input.environment,
        context,
        rawQuestion,
        previousQuestion,
      )
      : {
        answerId: 'conversation:chat',
        intent: 'conversation.chat',
        confidence: 0.6,
        mode: 'allowed',
        headline: "I'm here",
        body: "I'm here. Tell me what's going on — work, or not.",
        sources: [],
      },
    origin: 'deterministic',
    modelAttempted: false,
  };

  const grounding = !skipLive && input.liveSource
    ? await gatherLiveGrounding({
      question,
      identity: input.identity,
      context,
      source: input.liveSource,
      timeoutMs: remaining() || 1,
      previousQuestion,
      askedQuestion: rawQuestion,
    })
    : null;

  const chatPath = remainderChat && !grounding;
  const conversationMode: AssistantConversationMode = chatPath ? 'chat' : 'product';

  if (chatPath && !providerUsable) {
    return chatFallback;
  }

  if (grounding && !grounding.compositionWorthy) {
    if (looksCompositeQuestion(question)) {
      const retrieved = retrieveCards(allowed, question, context.route.routeId);
      if (retrieved.kind === 'match') {
        const kb = answerFromCards([retrieved.card], context, routes);
        return {
          answer: {
            ...grounding.result.answer,
            body: [grounding.result.answer.body, kb.body].filter(Boolean).join(' '),
            sources: [...grounding.result.answer.sources, ...kb.sources].filter(
              (source, index, list) => list.findIndex((item) => item.cardId === source.cardId) === index,
            ),
          },
          origin: 'deterministic',
          modelAttempted: false,
          provenance: grounding.result.provenance,
        };
      }
    }
    return grounding.result;
  }

  const liveFallback = grounding
    ? compositionFallback(grounding, allowed, question, context, routes)
    : null;

  if (grounding?.compositionWorthy && !providerUsable) {
    return liveFallback ?? grounding.result;
  }

  if (!chatPath && !grounding && (!providerUsable || shouldBypassModel(allowed, question, context))) {
    return deterministicFromRetrieval(allowed, question, context, routes, previousQuestion);
  }

  const candidates = chatPath ? [] : candidateCards(allowed, question, context, grounding?.seedCardIds ?? []);
  if (!chatPath && !candidates.length && !(grounding?.tools.length)) {
    return liveFallback ?? deterministicFromRetrieval(allowed, question, context, routes, previousQuestion);
  }

  const timeoutMs = remaining();
  const fallback = chatPath
    ? chatFallback
    : (liveFallback ?? deterministicFromRetrieval(allowed, question, context, routes, previousQuestion));
  const modelTools = chatPath
    ? undefined
    : grounding
      ? minimiseLiveToolsForModel(question, grounding.tools, context)
      : undefined;

  if (timeoutMs < MIN_MODEL_ATTEMPT_MS) {
    return fallback;
  }
  if (provider.id === 'groq' && assistantModelCooldownRemaining() > 0) {
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
      conversationMode,
      history,
      factPack: buildFactPack({
        context,
        intent: highLevel,
        cards: candidates,
        live: modelTools,
        derivations: grounding?.derivations,
        viewport: context.viewport,
      }),
    });
    if (grounding?.result.provenance) {
      grounding.result.provenance.promptChars = prompt.user.length;
      grounding.result.provenance.candidateCount = candidates.length;
      grounding.result.provenance.toolProjectionCount = countToolProjectionFields(modelTools ?? []);
    }
    if (prompt.user.length > ASSISTANT_MODEL_LIMITS.maxPromptChars) {
      return fallback;
    }
    if (
      (provider.id === 'groq' || context.environment === 'production')
      && containsEndClientPii(prompt.user)
    ) {
      const error = new AssistantProviderError('Model input contained end-client PII', 'schema');
      error.validation = { code: 'client_pii', message: 'Model input contained end-client PII' };
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
      previousQuestion,
      extraToolNumbers: extraNumbersFromGrounding({
        tools: modelTools,
        derivations: grounding?.derivations,
      }),
      tools: modelTools,
      derivations: grounding?.derivations,
      conversationMode,
      history,
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
    if (conversationMode === 'chat' && decision.outcome === 'answer' && decision.body?.trim()) {
      return applyModelUsage({
        answer: conversationModelAnswer(decision),
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
