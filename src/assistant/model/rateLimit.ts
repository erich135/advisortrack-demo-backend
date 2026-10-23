import { createHash } from 'node:crypto';
import type { AssistantModelDecision, AssistantModelUsage } from './types';

const CACHE_TTL_MS = 45_000;
const MAX_CACHE = 40;
const DEFAULT_COOLDOWN_MS = 20_000;
const MAX_COOLDOWN_MS = 60_000;

type CachedCompletion = {
  until: number;
  rawText: string;
  decision: AssistantModelDecision;
  usage?: AssistantModelUsage;
};

let cooldownUntil = 0;
const cache = new Map<string, CachedCompletion>();

export function resetAssistantModelGuards(): void {
  cooldownUntil = 0;
  cache.clear();
}

export function assistantModelCooldownRemaining(now = Date.now()): number {
  return Math.max(0, cooldownUntil - now);
}

export function noteAssistantModelRateLimit(retryAfterMs?: number, now = Date.now()): void {
  const wait = Math.min(MAX_COOLDOWN_MS, Math.max(1_000, retryAfterMs ?? DEFAULT_COOLDOWN_MS));
  cooldownUntil = Math.max(cooldownUntil, now + wait);
}

export function promptCacheKey(system: string, user: string, schemaName: string, model: string): string {
  return createHash('sha256').update(`${model}\n${schemaName}\n${system}\n${user}`).digest('hex');
}

export function getCachedModelCompletion(key: string, now = Date.now()): CachedCompletion | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.until <= now) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setCachedModelCompletion(
  key: string,
  value: Omit<CachedCompletion, 'until'>,
  now = Date.now(),
): void {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { ...value, until: now + CACHE_TTL_MS });
}
