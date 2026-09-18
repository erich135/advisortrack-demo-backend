import { env } from '../../config/env';
import { createDisabledProvider } from './provider';
import { createHttpProvider } from './httpProvider';
import {
  DEFAULT_XAI_BASE_URL,
  DEFAULT_XAI_MAX_OUTPUT_TOKENS,
  DEFAULT_XAI_MODEL,
  DEFAULT_XAI_REASONING,
  createXaiProvider,
  type AssistantModelReasoning,
} from './xaiProvider';
import type { AssistantModelProvider } from './types';

export type AssistantProviderSettings = {
  provider: 'disabled' | 'http' | 'xai';
  httpUrl?: string;
  httpApiKey?: string;
  xaiApiKey?: string;
  xaiBaseUrl?: string;
  modelName?: string;
  reasoning?: AssistantModelReasoning;
  timeoutMs: number;
  maxOutputTokens?: number;
};

export function createAssistantProviderFromConfig(
  settings: AssistantProviderSettings,
): AssistantModelProvider {
  if (settings.provider === 'xai') {
    const apiKey = settings.xaiApiKey?.trim() || '';
    if (!apiKey) return createDisabledProvider();
    return createXaiProvider({
      apiKey,
      baseUrl: settings.xaiBaseUrl?.trim() || DEFAULT_XAI_BASE_URL,
      model: settings.modelName?.trim() || DEFAULT_XAI_MODEL,
      reasoning: settings.reasoning || DEFAULT_XAI_REASONING,
      timeoutMs: settings.timeoutMs,
      maxOutputTokens: settings.maxOutputTokens || DEFAULT_XAI_MAX_OUTPUT_TOKENS,
    });
  }
  if (settings.provider === 'http' && settings.httpUrl && settings.httpApiKey) {
    return createHttpProvider({
      url: settings.httpUrl,
      apiKey: settings.httpApiKey,
      timeoutMs: settings.timeoutMs,
    });
  }
  return createDisabledProvider();
}

export function createConfiguredAssistantProvider(): AssistantModelProvider {
  return createAssistantProviderFromConfig({
    provider: env.assistantModelProvider,
    httpUrl: env.assistantModelUrl,
    httpApiKey: env.assistantModelApiKey,
    xaiApiKey: env.xaiApiKey,
    xaiBaseUrl: env.assistantModelBaseUrl,
    modelName: env.assistantModelName,
    reasoning: env.assistantModelReasoning,
    timeoutMs: env.assistantModelTimeoutMs,
    maxOutputTokens: env.assistantModelMaxOutputTokens,
  });
}
