import type { AssistantContext, TrustedAssistantIdentity } from '../context';
import { LIVE_LIMITS } from './limits';
import { createTurnRefTable } from './refs';
import type { ResolvedLiveScope, ToolExecutionContext } from './types';

function resolveLiveScope(identity: TrustedAssistantIdentity, assistant: AssistantContext): ResolvedLiveScope {
  const directoryResolver = identity.isOrganisationAdmin || assistant.capabilities.canViewUsers
    ? 'administrative'
    : assistant.role.hasLeadershipPortalAccess
      ? 'management_reporting'
      : assistant.role.scopeKind === 'self'
        ? 'self'
        : 'none';
  if (assistant.role.isPlatformStaff) {
    return {
      resolver: 'platform_minimised',
      reportingResolver: 'none',
      directoryResolver: directoryResolver === 'administrative' ? 'administrative' : 'none',
      scopeKind: assistant.role.scopeKind,
      companyId: identity.companyId,
    };
  }
  if (assistant.role.hasLeadershipPortalAccess) {
    return {
      resolver: 'management_reporting',
      reportingResolver: 'management_reporting',
      directoryResolver,
      scopeKind: assistant.role.scopeKind,
      companyId: identity.companyId,
    };
  }
  if (identity.isOrganisationAdmin || assistant.capabilities.canViewUsers) {
    return {
      resolver: 'administrative',
      reportingResolver: assistant.role.scopeKind === 'self' ? 'self' : 'none',
      directoryResolver: 'administrative',
      scopeKind: assistant.role.scopeKind,
      companyId: identity.companyId,
    };
  }
  if (assistant.role.scopeKind === 'self') {
    return {
      resolver: 'self',
      reportingResolver: 'self',
      directoryResolver: 'self',
      scopeKind: 'self',
      companyId: identity.companyId,
    };
  }
  return {
    resolver: 'administrative',
    reportingResolver: 'none',
    directoryResolver: 'none',
    scopeKind: assistant.role.scopeKind,
    companyId: identity.companyId,
  };
}

export function createToolExecutionContext(input: {
  identity: TrustedAssistantIdentity;
  assistant: AssistantContext;
  now?: Date;
  timeoutMs: number;
  maxFetches?: number;
}): ToolExecutionContext {
  const now = input.now ?? new Date();
  const refs = createTurnRefTable();
  return {
    turnId: refs.turnId,
    environment: input.assistant.environment,
    dataIsSynthetic: input.assistant.environment === 'demo',
    identity: input.identity,
    assistant: input.assistant,
    scope: resolveLiveScope(input.identity, input.assistant),
    refs,
    now,
    deadlineAt: now.getTime() + input.timeoutMs,
    memo: new Map(),
    maxFetches: input.maxFetches ?? LIVE_LIMITS.maxLiveFetches,
    stats: {
      fetches: 0,
      cacheHits: 0,
      cacheMisses: 0,
      timeouts: 0,
      circuitOpen: 0,
      toolMs: 0,
    },
  };
}
