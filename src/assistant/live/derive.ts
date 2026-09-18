import type { AssistantLicencePool } from '../context';
import type { LiveToolFactGroup, RegisteredDerivationOutput } from './types';

/**
 * Registered A7 derivations. The model may not invent arithmetic.
 * LICENCE_SHORTFALL = max(0, requested − available) when the question states a hire/licence quantity.
 * SUBJECT_LEADERSHIP_ACCESS maps a stored reporting rank onto existing portal leadership access.
 */
export function numbersInText(text: string): number[] {
  const values = new Set<number>();
  const groupedRe = /\b\d{1,3}(?:[ ,\u00a0]\d{3})+(?:\.\d+)?\b/g;
  const groupedSpans: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(groupedRe)) {
    const start = match.index ?? 0;
    groupedSpans.push({ start, end: start + match[0].length });
    values.add(Number(match[0].replace(/[ ,\u00a0]/g, '')));
  }
  for (const match of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    const start = match.index ?? 0;
    const insideGrouped = groupedSpans.some((span) => start >= span.start && start < span.end);
    if (insideGrouped) continue;
    values.add(Number(match[0]));
  }
  return [...values];
}

export function numbersFromUnknown(value: unknown): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) return [value];
  if (Array.isArray(value)) return value.flatMap((item) => numbersFromUnknown(item));
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap((item) => numbersFromUnknown(item));
  }
  return [];
}

export function extraNumbersFromGrounding(input: {
  tools?: LiveToolFactGroup[];
  derivations?: RegisteredDerivationOutput[];
}): number[] {
  const values = new Set<number>();
  for (const tool of input.tools ?? []) {
    for (const value of numbersFromUnknown(tool.facts)) values.add(value);
  }
  for (const derivation of input.derivations ?? []) {
    for (const value of numbersFromUnknown(derivation.facts)) values.add(value);
  }
  return [...values];
}

export function deriveLicenceShortfall(input: {
  question: string;
  pool?: AssistantLicencePool | null;
}): RegisteredDerivationOutput | null {
  const pool = input.pool;
  if (pool?.available == null) return null;
  const licenceHire = /\b(licen[cs]e|seats?|advis[eo]rs?|hired|hire|users?)\b/i.test(input.question);
  if (!licenceHire) return null;
  const poolNumbers = [pool.purchased, pool.assigned, pool.available].filter(
    (value): value is number => value != null,
  );
  const requested = numbersInText(input.question).filter((value) => !poolNumbers.includes(value));
  if (requested.length !== 1) return null;
  return {
    derivationId: 'LICENCE_SHORTFALL',
    facts: {
      requested: requested[0],
      available: pool.available,
      shortfall: Math.max(0, requested[0] - pool.available),
    },
  };
}

export { deriveAbsoluteChange, derivePercentChange } from './compare';

export function deriveSubjectLeadershipAccess(input: {
  storedRank?: string | null;
  reportingRoleLabel: string;
}): RegisteredDerivationOutput {
  const storedRank = input.storedRank ?? null;
  const hasLeadershipPortalAccess =
    storedRank === 'executive' || storedRank === 'regional_manager' || storedRank === 'team_leader';
  return {
    derivationId: 'SUBJECT_LEADERSHIP_ACCESS',
    facts: {
      storedReportingRole: input.reportingRoleLabel,
      storedRank,
      advisorUsesMobileApp: storedRank === 'financial_advisor',
      hasLeadershipPortalAccess,
      source: 'stored_reporting_rank',
    },
  };
}

export function deriveRegisteredNumbers(input: {
  question: string;
  pool?: AssistantLicencePool | null;
  extraToolNumbers?: number[];
}): number[] {
  const derived: number[] = [];
  const shortfall = deriveLicenceShortfall(input);
  if (shortfall) {
    for (const key of ['shortfall', 'requested', 'available'] as const) {
      const value = shortfall.facts[key];
      if (typeof value === 'number' && Number.isFinite(value)) derived.push(value);
    }
  }
  return [...new Set([...derived, ...(input.extraToolNumbers ?? [])])];
}
