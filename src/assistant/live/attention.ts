import {
  buildAttentionReasons,
  type AttentionReason,
} from '../../features/advisorAttention';
import { displayNameOf } from './names';
import { MAX_ATTENTION_ROWS } from './compare';
import type { DirectoryPerson } from './types';

export type AttentionCounts = {
  memberId: string;
  stalledCount: number;
  missingDocumentsCount: number;
  noNextActionCount: number;
};

export type AttentionSubject = {
  person: DirectoryPerson;
  reasons: AttentionReason[];
};

export function attentionReasonsFor(
  person: DirectoryPerson,
  counts: AttentionCounts | undefined,
  now: Date,
): AttentionReason[] {
  return buildAttentionReasons({
    lastMobileActivityAt: person.lastMobileActivityAt,
    stalledCount: counts?.stalledCount ?? 0,
    missingDocumentsCount: counts?.missingDocumentsCount ?? 0,
    noNextActionCount: counts?.noNextActionCount ?? 0,
    now,
  });
}

export function flaggedAttentionSubjects(
  people: DirectoryPerson[],
  countsByMember: Map<string, AttentionCounts>,
  now: Date,
): AttentionSubject[] {
  const flagged: AttentionSubject[] = [];
  for (const person of people) {
    const reasons = attentionReasonsFor(person, countsByMember.get(person.id), now);
    if (!reasons.length) continue;
    flagged.push({ person, reasons });
  }
  flagged.sort((left, right) => {
    if (right.reasons.length !== left.reasons.length) return right.reasons.length - left.reasons.length;
    return displayNameOf(left.person).localeCompare(displayNameOf(right.person), 'en', { sensitivity: 'base' });
  });
  return flagged.slice(0, MAX_ATTENTION_ROWS);
}

export function hasMobileInactivity(reasons: AttentionReason[]): boolean {
  return reasons.some((reason) => reason.code === 'mobile_inactive');
}
