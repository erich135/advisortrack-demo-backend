import { assistantModelDecisionSchema, type AssistantModelProvider, type AssistantModelUsage } from './types';
import { AssistantProviderError, parseProviderJson, withTimeout } from './provider';
import {
  getCachedModelCompletion,
  noteAssistantModelRateLimit,
  promptCacheKey,
  setCachedModelCompletion,
  assistantModelCooldownRemaining,
} from './rateLimit';
import {
  assistantModelDecisionJsonSchema,
  parseXaiUsage,
  type AssistantModelReasoning,
} from './xaiProvider';

export const DEFAULT_GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
export const DEFAULT_GROQ_REASONING = 'medium' as const;
export const DEFAULT_GROQ_MAX_OUTPUT_TOKENS = 2048;

export type GroqProviderConfig = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  reasoning?: AssistantModelReasoning;
  timeoutMs: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
};

export function normalizeGroqBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '') || DEFAULT_GROQ_BASE_URL;
}

export function groqChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeGroqBaseUrl(baseUrl);
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

export function groqReasoningEffort(reasoning?: AssistantModelReasoning): 'low' | 'medium' | 'high' {
  if (reasoning === 'low') return 'low';
  if (reasoning === 'high' || reasoning === 'xhigh') return 'high';
  return 'medium';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function messageContent(payload: unknown): string {
  const root = asRecord(payload);
  const choice = Array.isArray(root?.choices) ? asRecord(root.choices[0]) : null;
  const message = asRecord(choice?.message);
  if (message?.parsed && typeof message.parsed === 'object') {
    return JSON.stringify(message.parsed);
  }
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
  hint?: string,
): AssistantProviderError {
  const error = new AssistantProviderError(message, code);
  if (usage) error.usage = usage;
  if (usage?.providerHttpStatus) error.httpStatus = usage.providerHttpStatus;
  if (hint) error.validation = { code: hint, message: hint };
  return error;
}

function groqErrorHint(status: number, parsed: unknown): string {
  const root = asRecord(parsed);
  const err = asRecord(root?.error);
  const type = typeof err?.type === 'string' ? err.type.toLowerCase() : '';
  const code = typeof err?.code === 'string' ? err.code.toLowerCase() : '';
  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  if (status === 429 || code.includes('rate') || type.includes('tokens')) return 'rate_limit';
  if (
    message.includes('json_schema')
    || message.includes('json schema')
    || message.includes('failed_generation')
    || code.includes('json')
  ) {
    return 'json_schema';
  }
  if (message.includes('reasoning') || message.includes('include_reasoning') || message.includes('reasoning_format')) {
    return 'reasoning';
  }
  if (message.includes('max_token') || message.includes('context length') || message.includes('too large')) {
    return 'tokens';
  }
  return 'http';
}

function retryAfterMs(response: Response, parsed: unknown): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  }
  const root = asRecord(parsed);
  const err = asRecord(root?.error);
  const message = typeof err?.message === 'string' ? err.message : '';
  const match = message.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000);
  return 20_000;
}

/**
 * Thin GroqCloud Chat Completions adapter. Routing, live tools, and validators stay vendor-free.
 * gpt-oss-120b supports json_schema; optional AssistantModelDecision fields require strict:false.
 * reasoning_format is not supported on gpt-oss — use include_reasoning:false so JSON stays in content.
 */
export function createGroqProvider(config: GroqProviderConfig): AssistantModelProvider {
  const apiKey = config.apiKey.trim();
  const baseUrl = normalizeGroqBaseUrl(config.baseUrl || DEFAULT_GROQ_BASE_URL);
  const model = (config.model || DEFAULT_GROQ_MODEL).trim() || DEFAULT_GROQ_MODEL;
  const reasoning = groqReasoningEffort(config.reasoning);
  const maxOutputTokens = config.maxOutputTokens || DEFAULT_GROQ_MAX_OUTPUT_TOKENS;
  const fetchImpl = config.fetchImpl || fetch;
  const url = groqChatCompletionsUrl(baseUrl);

  return {
    id: 'groq',
    async complete(input) {
      if (!apiKey) {
        throw new AssistantProviderError('Assistant model provider is not configured', 'disabled');
      }
      if (assistantModelCooldownRemaining() > 0) {
        throw providerError('Assistant model rate limited', 'rate_limit', {
          modelName: model,
          latencyMs: 0,
          providerHttpStatus: 429,
        }, 'rate_limit');
      }
      const cacheKey = promptCacheKey(input.system, input.user, input.schemaName, model);
      const cached = getCachedModelCompletion(cacheKey);
      if (cached) {
        return {
          rawText: cached.rawText,
          decision: cached.decision,
          usage: cached.usage ? { ...cached.usage, latencyMs: 0 } : { modelName: model, latencyMs: 0 },
        };
      }
      const controller = new AbortController();
      const started = Date.now();
      const requestBody = (format: 'json_schema' | 'json_object') => ({
        model,
        reasoning_effort: reasoning,
        include_reasoning: false,
        max_completion_tokens: maxOutputTokens,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        response_format:
          format === 'json_object'
            ? { type: 'json_object' }
            : {
              type: 'json_schema',
              json_schema: {
                name: input.schemaName,
                schema: assistantModelDecisionJsonSchema,
                strict: false,
              },
            },
      });
      const work = (async () => {
        const post = async (format: 'json_schema' | 'json_object') => {
          let response: Response;
          try {
            response = await fetchImpl(url, {
              method: 'POST',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(requestBody(format)),
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
          const parsedBody = (() => {
            try {
              return rawText.trim() ? JSON.parse(rawText) : null;
            } catch {
              return null;
            }
          })();
          return { response, parsedBody, rawText };
        };

        let { response, parsedBody, rawText } = await post('json_schema');
        if (response.status === 400) {
          const hint = groqErrorHint(response.status, parsedBody);
          if (hint === 'json_schema' || hint === 'http' || hint === 'reasoning') {
            ({ response, parsedBody, rawText } = await post('json_object'));
          } else {
            const usage = parseXaiUsage(parsedBody, {
              modelName: model,
              latencyMs: Date.now() - started,
              providerHttpStatus: 400,
            });
            throw providerError('Assistant model HTTP 400', 'http', usage, hint);
          }
        }

        const latencyMs = Date.now() - started;
        const usage = parseXaiUsage(parsedBody, {
          modelName: model,
          latencyMs,
          providerHttpStatus: response.status,
        });

        if (response.status === 429) {
          noteAssistantModelRateLimit(retryAfterMs(response, parsedBody));
          throw providerError('Assistant model rate limited', 'rate_limit', usage, 'rate_limit');
        }
        if (response.status === 401 || response.status === 403) {
          throw providerError(`Assistant model HTTP ${response.status}`, 'http', usage);
        }
        if (response.status >= 500) {
          throw providerError(`Assistant model HTTP ${response.status}`, 'unavailable', usage);
        }
        if (!response.ok) {
          throw providerError(
            `Assistant model HTTP ${response.status}`,
            'http',
            usage,
            groqErrorHint(response.status, parsedBody),
          );
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
        setCachedModelCompletion(cacheKey, {
          rawText: content,
          decision: decision.data,
          usage,
        });
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
