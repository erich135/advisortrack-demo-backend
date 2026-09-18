/**
 * Demo Assistant pipeline. Canonical cards live in Abel Backend.
 * This module consumes src/assistant/knowledge-bundle.json.
 */
export { askAssistant, ASSISTANT_MODEL_LIMITS } from './ask';
export {
  buildConversationResponse,
  detectConversationIntent,
  visibleConversationAreas,
} from './conversation';
export type { ConversationDetection, ConversationIntent } from './conversation';
export {
  tryLiveAssistantAnswer,
  gatherLiveGrounding,
  createFixtureLiveSource,
  createOrganisationLiveSource,
  createToolExecutionContext,
  routeLiveQuestion,
  resolvePersonInScope,
  mintPersonRef,
  readEntityRef,
  createTurnRefTable,
  PERSON_SUMMARY_TOOL,
  LICENCE_SUMMARY_TOOL,
  ADVISOR_SUMMARY_TOOL,
  PRODUCTION_SUMMARY_TOOL,
  PIPELINE_SUMMARY_TOOL,
  TEAM_SUMMARY_TOOL,
  REGION_SUMMARY_TOOL,
  COMPARISON_SUMMARY_TOOL,
  RANKING_SUMMARY_TOOL,
  ATTENTION_SUMMARY_TOOL,
  executePersonSummary,
  ForgedEntityRefError,
  resolveAssistantPeriod,
  assertAssistantToolRegistry,
  assistantMayGrantSupportElevation,
  classPermitted,
  projectionAudience,
  publicFactSource,
  minimiseLiveToolsForModel,
  countToolProjectionFields,
  extraNumbersFromGrounding,
  sanitizeIdentityText,
  SUPPORT_ELEVATION_POLICY,
  looksLikeCaseRow,
  assertNoClientRows,
  LIVE_LIMITS,
  runLiveFetch,
  wrapLiveSource,
  LiveScopeMissError,
  resetAssistantLiveRuntime,
  liveCacheKey,
  liveScopeFingerprint,
  configureLiveBreakerForTests,
  resetLiveBreaker,
  liveBreakerFailure,
  liveBreakerOpen,
  liveBreakerSuccess,
  invalidateAssistantLiveCache,
} from './live';
export type { DirectoryPerson, LiveDirectorySource, ToolExecutionContext, DataClass, AnswerProvenance } from './live';
export { loadServerBundle } from './loadSnapshot';
export { buildAssistantContext } from './context';
export { trustedIdentityFromOrganisation } from './identity';
export type { OrganisationSnapshot } from './identity';
export { createDisabledProvider, AssistantProviderError, shouldRetryProviderError, staticRetryReason, remainingTurnMs, MIN_MODEL_ATTEMPT_MS } from './model/provider';
export { createFakeProvider } from './model/fakeProvider';
export { createConfiguredAssistantProvider, createAssistantProviderFromConfig } from './model/createProvider';
export {
  createXaiProvider,
  DEFAULT_XAI_BASE_URL,
  DEFAULT_XAI_MODEL,
  ASSISTANT_XAI_CACHE_KEY,
  xaiAffinityId,
  opaqueCompanyKey,
} from './model/xaiProvider';
export { resetAssistantAskThrottle, allowAssistantAsk, ASSISTANT_ASK_LIMITS } from './model/throttle';
export type {
  AssistantAskResult,
  AssistantModelDecision,
  AssistantModelProvider,
  AssistantModelUsage,
} from './model/types';
export type { TrustedAssistantIdentity } from './context';
export type { ServerKnowledgeBundle } from './serverBundle';
