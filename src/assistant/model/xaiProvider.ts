import { createHash } from 'node:crypto';
import { assistantModelDecisionSchema, type AssistantModelProvider, type AssistantModelUsage } from './types';
import { AssistantProviderError, parseProviderJson, withTimeout } from './provider';

export const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1';
export const DEFAULT_XAI_MODEL = 'grok-4.6';
export const DEFAULT_XAI_REASONING = 'medium' as const;
export const DEFAULT_XAI_MAX_OUTPUT_TOKENS = 1536;
/** Prefix only. Runtime affinity is namespaced by environment and opaque company key. */
export const ASSISTANT_XAI_CACHE_KEY = 'advisortrack-assistant-decision-v1';

export function opaqueCompanyKey(companyId?: string | null): string {
  const trimmed = companyId?.trim();
  if (!trimmed) return 'none';
  return createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
}

export function xaiAffinityId(input: {
  environment: 'production' | 'demo' | 'unknown';
  companyId?: string | null;
}): string {
  return `${ASSISTANT_XAI_CACHE_KEY}:${input.environment}:${opaqueCompanyKey(input.companyId)}`;
}

export const assistantModelReasoningLevels = ['low', 'medium', 'high', 'xhigh'] as const;
export type AssistantModelReasoning = (typeof assistantModelReasoningLevels)[number];

export type XaiProviderConfig = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  reasoning?: AssistantModelReasoning;
  timeoutMs: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
};

/**
 * JSON Schema for xAI structured outputs. Mirrors AssistantModelDecision.
 * additionalProperties defaults to false on xAI; set explicitly.
 */
export const assistantModelDecisionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'selectedCardIds'],
  properties: {
    outcome: { type: 'string', enum: ['answer', 'clarify', 'insufficient_context'] },
    selectedCardIds: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    selectedToolIds: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    selectedDerivationIds: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', minLength: 1, maxLength: 80 },
    },
    intent: { type: 'string', maxLength: 120 },
    extractedSlots: {
      type: 'object',
      additionalProperties: false,
      properties: {
        quantity: { type: 'integer', minimum: 0 },
        subjectRole: { type: 'string', maxLength: 80 },
        timeframe: { type: 'string', maxLength: 80 },
      },
    },
    headline: { type: 'string', maxLength: 180 },
    body: { type: 'string', maxLength: 4000 },
    clarifyingQuestion: { type: 'string', maxLength: 240 },
    steps: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: {
          label: { type: 'string', minLength: 1, maxLength: 200 },
          routeId: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
    },
  },
} as const;

export function normalizeXaiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '') || DEFAULT_XAI_BASE_URL;
}

export function xaiChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeXaiBaseUrl(baseUrl);
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function parseXaiUsage(
  payload: unknown,
  meta: { modelName: string; latencyMs: number; providerHttpStatus?: number },
): AssistantModelUsage {
  const root = asRecord(payload);
  const usage = asRecord(root?.usage);
  const promptDetails = asRecord(usage?.prompt_tokens_details);
  const completionDetails = asRecord(usage?.completion_tokens_details);
  const cost =
    asFiniteNumber(usage?.cost)
    ?? asFiniteNumber(root?.cost)
    ?? asFiniteNumber(asRecord(root?.usage)?.total_cost);
  return {
    modelName: meta.modelName,
    latencyMs: meta.latencyMs,
    providerHttpStatus: meta.providerHttpStatus,
    inputUsage: asFiniteNumber(usage?.prompt_tokens) ?? asFiniteNumber(usage?.input_tokens),
    cachedInputUsage:
      asFiniteNumber(promptDetails?.cached_tokens)
      ?? asFiniteNumber(usage?.cached_prompt_tokens)
      ?? asFiniteNumber(usage?.cached_tokens),
    outputUsage: asFiniteNumber(usage?.completion_tokens) ?? asFiniteNumber(usage?.output_tokens),
    reasoningUsage:
      asFiniteNumber(completionDetails?.reasoning_tokens)
      ?? asFiniteNumber(usage?.reasoning_tokens),
    requestCostUsd: cost,
  };
}

function messageContent(payload: unknown): string {
  const root = asRecord(payload);
  const choice = Array.isArray(root?.choices) ? asRecord(root.choices[0]) : null;
  const message = asRecord(choice?.message);
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const record = asRecord(part);
        return typeof record?.text === 'string' ? record.text : '';
      })
      .join('');
  }
  if (typeof root?.output_text === 'string') return root.output_text;
  return '';
}

function providerError(
  message: string,
  code: AssistantProviderError['code'],
  usage?: AssistantModelUsage,
): AssistantProviderError {
  const error = new AssistantProviderError(message, code);
  if (usage) error.usage = usage;
  if (usage?.providerHttpStatus) error.httpStatus = usage.providerHttpStatus;
  return error;
}

/**
 * Thin xAI Chat Completions adapter. AdvisorTrack routing/tools/validators stay vendor-free.
 */
export function createXaiProvider(config: XaiProviderConfig): AssistantModelProvider {
  const apiKey = config.apiKey.trim();
  const baseUrl = normalizeXaiBaseUrl(config.baseUrl || DEFAULT_XAI_BASE_URL);
  const model = (config.model || DEFAULT_XAI_MODEL).trim() || DEFAULT_XAI_MODEL;
  const reasoning = config.reasoning || DEFAULT_XAI_REASONING;
  const maxOutputTokens = config.maxOutputTokens || DEFAULT_XAI_MAX_OUTPUT_TOKENS;
  const fetchImpl = config.fetchImpl || fetch;
  const url = xaiChatCompletionsUrl(baseUrl);

  return {
    id: 'xai',
    async complete(input) {
      if (!apiKey) {
        throw new AssistantProviderError('Assistant model provider is not configured', 'disabled');
      }
      const controller = new AbortController();
      const started = Date.now();
      const work = (async () => {
        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'x-grok-conv-id': xaiAffinityId({
                environment: input.affinity?.environment ?? 'unknown',
                companyId: input.affinity?.companyId,
              }),
            },
            body: JSON.stringify({
              model,
              reasoning_effort: reasoning,
              max_tokens: maxOutputTokens,
              messages: [
                { role: 'system', content: input.system },
                { role: 'user', content: input.user },
              ],
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: input.schemaName,
                  schema: assistantModelDecisionJsonSchema,
                  strict: true,
                },
              },
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof AssistantProviderError) throw error;
          throw providerError('Assistant model HTTP request failed', 'http', {
            modelName: model,
            latencyMs: Date.now() - started,
          });
        }

        const rawText = await response.text();
        const latencyMs = Date.now() - started;
        const parsedBody = (() => {
          try {
            return rawText.trim() ? JSON.parse(rawText) : null;
          } catch {
            return null;
          }
        })();
        const usage = parseXaiUsage(parsedBody, {
          modelName: model,
          latencyMs,
          providerHttpStatus: response.status,
        });

        if (response.status === 429) {
          throw providerError('Assistant model rate limited', 'rate_limit', usage);
        }
        if (response.status === 401 || response.status === 403) {
          throw providerError(`Assistant model HTTP ${response.status}`, 'http', usage);
        }
        if (response.status >= 500) {
          throw providerError(`Assistant model HTTP ${response.status}`, 'unavailable', usage);
        }
        if (!response.ok) {
          throw providerError(`Assistant model HTTP ${response.status}`, 'http', usage);
        }

        const content = messageContent(parsedBody) || rawText;
        let parsed: unknown;
        try {
          parsed = parseProviderJson(content);
        } catch (error) {
          if (error instanceof AssistantProviderError) {
            error.usage = usage;
            throw error;
          }
          throw providerError('Model response was not valid JSON', 'malformed', usage);
        }
        const payload =
          parsed && typeof parsed === 'object' && 'decision' in parsed
            ? (parsed as { decision: unknown }).decision
            : parsed;
        const decision = assistantModelDecisionSchema.safeParse(payload);
        if (!decision.success) {
          throw providerError('Model JSON failed schema validation', 'schema', usage);
        }
        return { rawText: content, decision: decision.data, usage };
      })();

      try {
        return await withTimeout(work, Math.min(config.timeoutMs, input.timeoutMs));
      } catch (error) {
        controller.abort();
        throw error;
      }
    },
  };
}
