import { createLogger } from '../../utils/logger';
import { containsEndClientPii } from './privacy';
import type { ToolAuditClass } from './types';

const log = createLogger('assistant');

export type AssistantAuditEvent = {
  turnId: string;
  environment: 'production' | 'demo';
  caller: 'staff' | 'customer';
  scopeKind: string | null;
  hasCompany: boolean;
  toolId?: string;
  version?: number;
  auditClass?: ToolAuditClass;
  status: 'ok' | 'unavailable' | 'not_found' | 'rejected' | 'fallback';
  validationCode?: string;
  elapsedMs?: number;
  modelCalled?: boolean;
  cacheHit?: boolean;
  cacheMiss?: boolean;
  toolTimeout?: boolean;
  circuitOpen?: boolean;
  promptChars?: number;
  candidateCount?: number;
  toolProjectionCount?: number;
  fallbackUsed?: boolean;
  validatorRejectionCode?: string;
  modelName?: string;
  modelLatencyMs?: number;
  inputUsage?: number;
  cachedInputUsage?: number;
  outputUsage?: number;
  reasoningUsage?: number;
  requestCostUsd?: number;
  providerHttpStatus?: number;
};

const SECRET_KEY = /prompt|token|secret|password/i;
const PRODUCTION_PRIVACY_KEY = /document|note|case/i;

export function scrubAssistantAuditMeta(
  meta: Record<string, unknown>,
  environment: 'production' | 'demo',
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    if (SECRET_KEY.test(key)) continue;
    if (environment === 'production') {
      if (typeof value === 'string' && containsEndClientPii(value)) continue;
      if (PRODUCTION_PRIVACY_KEY.test(key)) continue;
    }
    next[key] = value;
  }
  return next;
}

export function logAssistantAudit(event: AssistantAuditEvent): void {
  log.info('turn', scrubAssistantAuditMeta({
    turnId: event.turnId,
    environment: event.environment,
    caller: event.caller,
    scopeKind: event.scopeKind,
    hasCompany: event.hasCompany,
    toolId: event.toolId,
    version: event.version,
    auditClass: event.auditClass,
    status: event.status,
    validationCode: event.validationCode,
    elapsedMs: event.elapsedMs,
    modelCalled: event.modelCalled,
    cacheHit: event.cacheHit,
    cacheMiss: event.cacheMiss,
    toolTimeout: event.toolTimeout,
    circuitOpen: event.circuitOpen,
    promptChars: event.promptChars,
    candidateCount: event.candidateCount,
    toolProjectionCount: event.toolProjectionCount,
    fallbackUsed: event.fallbackUsed,
    validatorRejectionCode: event.validatorRejectionCode,
    modelName: event.modelName,
    modelLatencyMs: event.modelLatencyMs,
    inputUsage: event.inputUsage,
    cachedInputUsage: event.cachedInputUsage,
    outputUsage: event.outputUsage,
    reasoningUsage: event.reasoningUsage,
    requestCostUsd: event.requestCostUsd,
    providerHttpStatus: event.providerHttpStatus,
  }, event.environment));
}
