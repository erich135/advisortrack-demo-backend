import type { AssistantModelProvider, AssistantModelResult, AssistantModelUsage } from './types';

export class AssistantProviderError extends Error {
  usage?: AssistantModelUsage;
  validation?: { code: string; message: string };
  httpStatus?: number;

  constructor(
    message: string,
    readonly code:
      | 'disabled'
      | 'timeout'
      | 'http'
      | 'malformed'
      | 'schema'
      | 'rate_limit'
      | 'unavailable',
  ) {
    super(message);
    this.name = 'AssistantProviderError';
  }
}

export const MIN_MODEL_ATTEMPT_MS = 400;

export function remainingTurnMs(deadlineAt: number, now = Date.now()): number {
  return Math.max(0, deadlineAt - now);
}

export function shouldRetryProviderError(error: AssistantProviderError): boolean {
  if (error.validation) return false;
  if (error.code === 'disabled' || error.code === 'rate_limit') return false;
  if (error.code === 'http') {
    const status = error.httpStatus ?? error.usage?.providerHttpStatus;
    if (status === 401 || status === 403 || status === 429) return false;
    return status != null && status >= 500;
  }
  return error.code === 'malformed' || error.code === 'schema' || error.code === 'timeout' || error.code === 'unavailable';
}

export function staticRetryReason(error: AssistantProviderError): string {
  const code = (error.validation?.code || error.code).toUpperCase();
  const instructions: Record<string, string> = {
    MALFORMED: 'Return valid AssistantModelDecision JSON only.',
    SCHEMA: 'Return JSON that matches AssistantModelDecision exactly.',
    TIMEOUT: 'Retry the same grounded answer more concisely.',
    UNAVAILABLE: 'Retry the same grounded answer more concisely.',
    UNGROUNDED_NUMBER: 'Use only numbers explicitly present in the supplied trusted facts/derivations.',
    UNTRUSTED_URL: 'Do not emit http, https, or mailto links unless they were supplied by trusted AdvisorTrack routes or cards.',
  };
  const text = instructions[code] ?? 'Use only facts from the supplied trusted cards, tools, and derivations.';
  return `${code}:\n${text}`;
}

export function createDisabledProvider(): AssistantModelProvider {
  return {
    id: 'disabled',
    async complete() {
      throw new AssistantProviderError('Assistant model provider is not configured', 'disabled');
    },
  };
}

export function parseProviderJson(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) throw new AssistantProviderError('Empty model response', 'malformed');
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        throw new AssistantProviderError('Model response was not valid JSON', 'malformed');
      }
    }
    throw new AssistantProviderError('Model response was not valid JSON', 'malformed');
  }
}

export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AssistantProviderError('Assistant model timed out', 'timeout'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function asModelResult(decision: AssistantModelResult['decision']): AssistantModelResult {
  return { rawText: JSON.stringify(decision), decision };
}
