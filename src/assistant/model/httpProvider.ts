import { assistantModelDecisionSchema } from './types';
import type { AssistantModelProvider } from './types';
import { AssistantProviderError, parseProviderJson, withTimeout } from './provider';

export type HttpProviderConfig = {
  url: string;
  apiKey: string;
  timeoutMs: number;
};

/**
 * Generic JSON HTTP complete(). Vendor is chosen later by configuring URL + key.
 * Does not assume OpenAI, Anthropic, or xAI request shapes beyond JSON in/out.
 */
export function createHttpProvider(config: HttpProviderConfig): AssistantModelProvider {
  return {
    id: 'http',
    async complete(input) {
      const controller = new AbortController();
      const work = (async () => {
        let response: Response;
        try {
          response = await fetch(config.url, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              system: input.system,
              user: input.user,
              schemaName: input.schemaName,
            }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof AssistantProviderError) throw error;
          throw new AssistantProviderError('Assistant model HTTP request failed', 'http');
        }

        if (response.status === 429) {
          const limited = new AssistantProviderError('Assistant model rate limited', 'rate_limit');
          limited.httpStatus = 429;
          throw limited;
        }
        if (!response.ok) {
          const failed = new AssistantProviderError(
            `Assistant model HTTP ${response.status}`,
            response.status >= 500 ? 'unavailable' : 'http',
          );
          failed.httpStatus = response.status;
          throw failed;
        }

        const rawText = await response.text();
        const parsed = parseProviderJson(rawText);
        const payload =
          parsed && typeof parsed === 'object' && 'decision' in parsed
            ? (parsed as { decision: unknown }).decision
            : parsed;
        const decision = assistantModelDecisionSchema.safeParse(payload);
        if (!decision.success) {
          throw new AssistantProviderError('Model JSON failed schema validation', 'schema');
        }
        return { rawText, decision: decision.data };
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
