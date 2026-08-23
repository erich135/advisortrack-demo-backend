/**
 * Top / Worst Performer selection from issued Rand totals.
 * Ties use name then id for stable order only — never an extra performance metric.
 */
export type RankedUnit = {
  userId: string;
  name: string;
  role: string;
  issuedAmount: number;
};

export type PerformanceEmptyReason =
  | 'no_subordinates'
  | 'no_issued_cases'
  | 'single_subordinate'
  | 'tied';

export type PerformancePick = {
  top: RankedUnit | null;
  worst: RankedUnit | null;
  emptyReason: PerformanceEmptyReason | null;
};

const compareUnits = (left: RankedUnit, right: RankedUnit): number => {
  if (right.issuedAmount !== left.issuedAmount) {
    return right.issuedAmount - left.issuedAmount;
  }
  const byName = left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return left.userId.localeCompare(right.userId);
};

/**
 * Picks Top and Worst Performer from comparison units.
 */
export const pickTopAndWorst = (units: RankedUnit[]): PerformancePick => {
  if (units.length === 0) {
    return { top: null, worst: null, emptyReason: 'no_subordinates' };
  }

  if (!units.some((unit) => unit.issuedAmount > 0)) {
    return { top: null, worst: null, emptyReason: 'no_issued_cases' };
  }

  const sorted = [...units].sort(compareUnits);
  const top = sorted[0];

  if (sorted.length === 1) {
    return { top, worst: null, emptyReason: 'single_subordinate' };
  }

  const highest = sorted[0].issuedAmount;
  const lowest = sorted[sorted.length - 1].issuedAmount;
  if (highest === lowest) {
    return { top, worst: null, emptyReason: 'tied' };
  }

  return { top, worst: sorted[sorted.length - 1], emptyReason: null };
};

/**
 * Sums issued amounts for a root and every descendant in `downlineByRoot`.
 */
export const sumDownlineIssued = (
  rootId: string,
  issuedByUserId: Map<string, number>,
  downlineByRoot: Map<string, string[]>
): number => {
  const memberIds = downlineByRoot.get(rootId) ?? [rootId];
  let total = 0;
  for (const memberId of memberIds) {
    total += issuedByUserId.get(memberId) ?? 0;
  }
  return total;
};

/**
 * Builds root → [root, ...descendants] from reports-to links. Cycle-safe.
 */
export const buildDownlineIndex = (
  members: Array<{ id: string; reportsToUserId: string | null }>
): Map<string, string[]> => {
  const children = new Map<string, string[]>();
  for (const member of members) {
    if (!member.reportsToUserId) continue;
    const list = children.get(member.reportsToUserId) ?? [];
    list.push(member.id);
    children.set(member.reportsToUserId, list);
  }

  const downline = new Map<string, string[]>();
  for (const member of members) {
    const collected = new Set<string>([member.id]);
    const stack = [member.id];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const childId of children.get(current) ?? []) {
        if (collected.has(childId)) continue;
        collected.add(childId);
        stack.push(childId);
      }
    }
    downline.set(member.id, [...collected]);
  }
  return downline;
};
