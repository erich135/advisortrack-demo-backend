import type { AssistantPeriod } from './period';

export const LIVE_LIMITS = {
  maxToolExecutions: 6,
  maxLiveFetches: 24,
  maxCandidateEntities: 5,
  maxComparisonSubjects: 4,
  maxRankingRows: 5,
  maxRankingCandidates: 40,
  maxAttentionRows: 5,
  maxToolProjectionFields: 40,
  maxPromptChars: 20_000,
  perToolTimeoutMs: 4_000,
  turnTimeoutMs: 8_000,
  breakerFailures: 3,
  breakerCooldownMs: 15_000,
  maxCacheEntries: 500,
};

export type LiveService =
  | 'people'
  | 'licences'
  | 'teams'
  | 'regions'
  | 'production'
  | 'pipeline'
  | 'attention';

/**
 * Conservative TTLs. Live/incomplete figures stay short so a licence assign
 * or in-month production write cannot linger. Completed Last Week / Last Month
 * may sit a few minutes because those windows no longer move. Invalidation
 * hooks are optional; TTL is the safety net.
 */
export function ttlMsFor(service: LiveService, period?: AssistantPeriod | null): number {
  if (service === 'licences' || service === 'pipeline' || service === 'attention') return 30_000;
  if (service === 'people') return 60_000;
  if (service === 'teams' || service === 'regions') return 120_000;
  if (service === 'production') {
    if (period === 'last_week' || period === 'last_month') return 180_000;
    return 30_000;
  }
  return 30_000;
}
