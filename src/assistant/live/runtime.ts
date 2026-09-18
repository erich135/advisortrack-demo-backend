import {
  liveBreakerFailure,
  liveBreakerOpen,
  liveBreakerSuccess,
} from './breaker';
import { cachedTtlLoad, liveCacheHas, liveCacheKey, liveScopeFingerprint, remember } from './cache';
import { LiveUnavailableError, isLiveScopeMiss } from './errors';
import { LIVE_LIMITS, ttlMsFor, type LiveService } from './limits';
import { withLiveTimeout } from './timeout';
import type { AssistantPeriod } from './period';
import type { LiveDirectorySource, ToolExecutionContext } from './types';

export { LiveUnavailableError, isLiveUnavailable, LiveScopeMissError, isLiveScopeMiss } from './errors';

export async function runLiveFetch<T>(
  ctx: ToolExecutionContext,
  input: {
    service: LiveService;
    keyParts: Array<string | number | null | undefined>;
    period?: AssistantPeriod | null;
    ttlMs?: number;
    timeoutMs?: number;
    load: () => Promise<T>;
  },
): Promise<T> {
  const key = liveCacheKey([liveScopeFingerprint(ctx), input.service, ...input.keyParts]);
  return remember(ctx, key, () => executeFetch(ctx, key, input));
}

async function executeFetch<T>(
  ctx: ToolExecutionContext,
  key: string,
  input: {
    service: LiveService;
    period?: AssistantPeriod | null;
    ttlMs?: number;
    timeoutMs?: number;
    load: () => Promise<T>;
  },
): Promise<T> {
  if (liveBreakerOpen(input.service, ctx.environment, ctx.identity.companyId)) {
    ctx.stats.circuitOpen += 1;
    throw new LiveUnavailableError('circuit_open', input.service);
  }
  if (ctx.stats.fetches >= ctx.maxFetches) {
    throw new LiveUnavailableError('budget', input.service);
  }
  const remaining = ctx.deadlineAt - Date.now();
  if (remaining <= 0) {
    ctx.stats.timeouts += 1;
    throw new LiveUnavailableError('timeout', input.service);
  }
  const timeoutMs = Math.min(input.timeoutMs ?? LIVE_LIMITS.perToolTimeoutMs, Math.max(1, remaining));
  const ttlMs = input.ttlMs ?? ttlMsFor(input.service, input.period);
  if (liveCacheHas(key)) {
    ctx.stats.cacheHits += 1;
    return cachedTtlLoad(key, ttlMs, () => input.load());
  }
  const started = Date.now();
  try {
    const value = await cachedTtlLoad(key, ttlMs, async () => {
      ctx.stats.fetches += 1;
      ctx.stats.cacheMisses += 1;
      return withLiveTimeout(input.load(), timeoutMs, input.service);
    });
    liveBreakerSuccess(input.service, ctx.environment, ctx.identity.companyId);
    ctx.stats.toolMs += Date.now() - started;
    return value;
  } catch (error) {
    ctx.stats.toolMs += Date.now() - started;
    if (isLiveScopeMiss(error)) throw error;
    if (error instanceof LiveUnavailableError && error.reason === 'timeout') {
      ctx.stats.timeouts += 1;
    }
    liveBreakerFailure(input.service, ctx.environment, ctx.identity.companyId);
    throw error;
  }
}

export function wrapLiveSource(source: LiveDirectorySource, ctx: ToolExecutionContext): LiveDirectorySource {
  return {
    listPeople: (_ignored, options) => runLiveFetch(ctx, {
      service: 'people',
      keyParts: ['list', options?.purpose ?? 'directory'],
      load: () => source.listPeople(ctx, options),
    }),
    getLicencePool: () => runLiveFetch(ctx, {
      service: 'licences',
      keyParts: ['pool'],
      load: () => source.getLicencePool(ctx),
    }),
    listTeams: source.listTeams
      ? () => runLiveFetch(ctx, {
        service: 'teams',
        keyParts: ['list'],
        load: () => source.listTeams!(ctx),
      })
      : undefined,
    listRegions: source.listRegions
      ? () => runLiveFetch(ctx, {
        service: 'regions',
        keyParts: ['list'],
        load: () => source.listRegions!(ctx),
      })
      : undefined,
    getProductionTotals: source.getProductionTotals
      ? (_ignored, request) => runLiveFetch(ctx, {
        service: 'production',
        period: request.period,
        keyParts: ['totals', request.period, (request.memberIds ?? []).slice().sort().join(',')],
        load: () => source.getProductionTotals!(ctx, request),
      })
      : undefined,
    getPipelineAggregate: source.getPipelineAggregate
      ? (_ignored, request) => runLiveFetch(ctx, {
        service: 'pipeline',
        keyParts: ['aggregate', (request.memberIds ?? []).slice().sort().join(',')],
        load: () => source.getPipelineAggregate!(ctx, request),
      })
      : undefined,
    listAttentionInputs: source.listAttentionInputs
      ? () => runLiveFetch(ctx, {
        service: 'attention',
        keyParts: ['list'],
        load: () => source.listAttentionInputs!(ctx),
      })
      : undefined,
  };
}
