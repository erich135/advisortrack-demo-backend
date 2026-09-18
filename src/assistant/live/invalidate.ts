import { invalidateLiveSummaryCache } from './cache';

export type AssistantCacheInvalidation =
  | 'licence'
  | 'user'
  | 'hierarchy'
  | 'production'
  | 'pipeline';

/**
 * Optional invalidation after existing write paths. Do not rewrite those
 * services for A7.6. Callers may pass a company id to drop only that tenant.
 *
 * Future hook points (not wired in A7.6):
 * - licence assignment / reclaim
 * - member deactivation / offboarding
 * - region/team hierarchy edits
 * - production writes (Android)
 * - pipeline/case updates (Android)
 */
export function invalidateAssistantLiveCache(
  reason: AssistantCacheInvalidation,
  companyId?: string | null,
): void {
  if (companyId) {
    invalidateLiveSummaryCache(`|${companyId}|`);
    return;
  }
  invalidateLiveSummaryCache();
  void reason;
}

export const ASSISTANT_CACHE_INVALIDATION_POINTS = [
  'licence assignment/reclaim → licence + people TTLs (30–60s) until hooked',
  'user deactivation → people/teams/regions TTLs until hooked',
  'hierarchy change → teams/regions (120s) until hooked',
  'production write → current-period production (30s); completed Last Week/Last Month (180s)',
  'pipeline/case update → pipeline/attention (30s) until hooked',
] as const;
