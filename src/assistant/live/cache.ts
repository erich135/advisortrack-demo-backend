import { LIVE_LIMITS } from './limits';
import { projectionAudience } from './policy';
import type { ToolExecutionContext } from './types';

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
let nowFn = (): number => Date.now();

export function liveCacheKey(parts: Array<string | number | null | undefined>): string {
  return parts.map((part) => (part == null ? '' : String(part))).join('|');
}

export function liveScopeFingerprint(ctx: ToolExecutionContext): string {
  return liveCacheKey([
    ctx.environment,
    ctx.identity.companyId ?? 'none',
    ctx.scope.scopeKind ?? 'none',
    ctx.scope.resolver,
    ctx.scope.reportingResolver,
    ctx.scope.directoryResolver,
    projectionAudience(ctx),
    ctx.identity.userId,
  ]);
}

export function remember<T>(
  ctx: ToolExecutionContext,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = ctx.memo.get(key);
  if (existing) {
    if (ctx.stats) ctx.stats.cacheHits += 1;
    return existing as Promise<T>;
  }
  const pending = load();
  ctx.memo.set(key, pending);
  return pending;
}

export function liveCacheHas(key: string): boolean {
  const hit = store.get(key);
  return Boolean(hit && hit.expiresAt > nowFn());
}

export function resetLiveSummaryCache(): void {
  store.clear();
  inflight.clear();
  nowFn = () => Date.now();
}

export function configureLiveCacheForTests(input: { now?: () => number }): void {
  if (input.now) nowFn = input.now;
}

export function invalidateLiveSummaryCache(match?: string): void {
  if (!match) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const key of [...store.keys()]) {
    if (key.includes(match)) store.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key.includes(match)) inflight.delete(key);
  }
}

function pruneExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > LIVE_LIMITS.maxCacheEntries) {
    const first = store.keys().next().value;
    if (first == null) break;
    store.delete(first);
  }
}

export function cachedTtlLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  if (ttlMs <= 0) return load();
  const now = nowFn();
  pruneExpired(now);
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return Promise.resolve(hit.value as T);
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const work = load().then((value) => {
    store.set(key, { expiresAt: nowFn() + ttlMs, value });
    inflight.delete(key);
    return value;
  }, (error) => {
    inflight.delete(key);
    throw error;
  });
  inflight.set(key, work);
  return work;
}
