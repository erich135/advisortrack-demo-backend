import { invalidateLiveSummaryCache } from './cache';

export type AssistantCacheInvalidation =
  | 'licence'
  | 'user'
  | 'hierarchy'
  | 'production'
  | 'pipeline'
  | 'activities'
  | 'contacts'
  | 'planning'
  | 'demo_reset';

/**
 * Optional invalidation after existing write paths. TTL remains the safety net.
 * Pass userId to drop only that advisor's live cache keys.
 */
export function invalidateAssistantLiveCache(
  reason: AssistantCacheInvalidation,
  companyId?: string | null,
  userId?: string | null,
): void {
  if (userId) {
    invalidateLiveSummaryCache(userId);
    return;
  }
  if (companyId) {
    invalidateLiveSummaryCache(`|${companyId}|`);
    return;
  }
  invalidateLiveSummaryCache();
  void reason;
}

export function invalidateAssistantLiveForUser(userId: string, reason: AssistantCacheInvalidation): void {
  invalidateAssistantLiveCache(reason, null, userId);
}

export const ASSISTANT_CACHE_INVALIDATION_POINTS = [
  'licence assignment/reclaim → licence + people TTLs (30–60s) until hooked',
  'user deactivation → people/teams/regions TTLs until hooked',
  'hierarchy change → teams/regions (120s) until hooked',
  'production write → current-period production (30s); completed Last Week/Last Month (180s)',
  'pipeline/case update → pipeline/attention (30s) until hooked',
  'activity write → self activities cache (user-scoped invalidation)',
  'contact write → self contacts cache (user-scoped invalidation)',
  'planning/profile financial write → self target progress cache (user-scoped invalidation)',
  'demo reset → full live cache + breaker reset',
] as const;
