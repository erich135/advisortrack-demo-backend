import { containsEndClientPii } from './privacy';
import type { PipelineAggregate, ProductionTotals } from './types';

const CASE_ROW_KEYS = /^(contactName|clientName|caseId|case_id|policyNumber|idNumber|notes|documents?)$/i;

export function looksLikeCaseRow(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => CASE_ROW_KEYS.test(key));
}

export function assertNoClientRows(
  value: unknown,
  path = 'value',
  options?: { synthetic?: boolean },
): void {
  if (options?.synthetic) return;
  if (value == null) return;
  if (typeof value === 'string' && containsEndClientPii(value)) {
    throw new Error(`client_pii_escaped:${path}`);
  }
  if (Array.isArray(value)) {
    if (value.some((item) => looksLikeCaseRow(item))) {
      throw new Error(`client_row_escaped:${path}`);
    }
    value.forEach((item, index) => assertNoClientRows(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    if (looksLikeCaseRow(value)) {
      throw new Error(`client_row_escaped:${path}`);
    }
    for (const [key, nested] of Object.entries(value)) {
      assertNoClientRows(nested, `${path}.${key}`);
    }
  }
}

export function sanitizeProductionTotals(
  value: ProductionTotals,
  options?: { synthetic?: boolean },
): ProductionTotals {
  const next: ProductionTotals = {
    issuedAmount: Number(value.issuedAmount) || 0,
    issuedCount: Number(value.issuedCount) || 0,
    nonIssuedAmount: Number(value.nonIssuedAmount) || 0,
    nonIssuedCount: Number(value.nonIssuedCount) || 0,
  };
  if (!options?.synthetic) assertNoClientRows(next, 'production');
  return next;
}

export function sanitizePipelineAggregate(
  value: PipelineAggregate,
  options?: { synthetic?: boolean },
): PipelineAggregate {
  const stageCounts: Record<string, number> = {};
  for (const [stage, count] of Object.entries(value.stageCounts ?? {})) {
    if (!options?.synthetic && (CASE_ROW_KEYS.test(stage) || containsEndClientPii(stage))) continue;
    stageCounts[stage] = Number(count) || 0;
  }
  const next: PipelineAggregate = {
    totalCases: Number(value.totalCases) || 0,
    openCases: Number(value.openCases) || 0,
    stageCounts,
    pipelineValue: value.pipelineValue == null ? null : Number(value.pipelineValue),
    estimatedCommissionCaseCount: Number(value.estimatedCommissionCaseCount) || 0,
  };
  if (!options?.synthetic) assertNoClientRows(next, 'pipeline');
  return next;
}
