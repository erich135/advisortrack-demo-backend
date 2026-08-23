import { HierarchyRank, RANK_LABELS, resolveHierarchyRank } from './customerHierarchy';

export type ReportingMember = {
  id: string;
  firstName: string;
  lastName: string;
  reportsToUserId: string | null;
  isPlatformAdmin: boolean;
  roleName: string | null;
  permissions: string[];
};

export type ReportingUnit = {
  userId: string;
  name: string;
};

const memberName = (member: ReportingMember): string =>
  `${member.firstName} ${member.lastName}`.trim() || 'Unnamed';

const rankOf = (member: ReportingMember): HierarchyRank =>
  resolveHierarchyRank({
    isPlatformAdmin: member.isPlatformAdmin,
    roleName: member.roleName,
    permissions: member.permissions,
  });

/**
 * Walks reports-to ancestors, including the member, to find the first match of `rank`.
 */
export const findReportingUnit = (
  memberId: string,
  rank: HierarchyRank,
  membersById: Map<string, ReportingMember>
): ReportingUnit | null => {
  let current = membersById.get(memberId) ?? null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    if (rankOf(current) === rank) {
      return { userId: current.id, name: memberName(current) };
    }
    current = current.reportsToUserId ? membersById.get(current.reportsToUserId) ?? null : null;
  }
  return null;
};

/**
 * Team = Team Leader in the reporting line. Region = Regional Manager in the reporting line.
 */
export const deriveTeamAndRegion = (
  memberId: string,
  membersById: Map<string, ReportingMember>
): { team: ReportingUnit | null; region: ReportingUnit | null } => ({
  team: findReportingUnit(memberId, 'team_leader', membersById),
  region: findReportingUnit(memberId, 'regional_manager', membersById),
});

export const reportingUnitLabel = (unit: ReportingUnit | null): string => unit?.name ?? '';

export const rankLabelForMember = (member: ReportingMember): string => RANK_LABELS[rankOf(member)];
