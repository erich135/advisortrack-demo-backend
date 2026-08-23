import { AppError } from '../middleware/errorHandler';
import { organisationRepository } from '../repositories/organisation.repository';
import {
  organisationStructureRepository,
  RegionRow,
  TeamRow,
} from '../repositories/organisationStructure.repository';

const uniqueConstraintCode = (error: unknown): string | null => {
  if (!(error instanceof Error) || !('code' in error) || error.code !== '23505') return null;
  const constraint = 'constraint' in error ? String(error.constraint) : '';
  const haystack = `${constraint} ${error.message}`;
  if (haystack.includes('regions_company_id_name_key')) return 'REGION_NAME_EXISTS';
  if (haystack.includes('teams_region_id_name_key')) return 'TEAM_NAME_EXISTS';
  if (haystack.includes('regions_one_active_manager')) return 'ONE_ACTIVE_REGION';
  if (haystack.includes('teams_one_active_leader')) return 'ONE_ACTIVE_TEAM';
  return null;
};

export const structureConflictFrom = (error: unknown): AppError | null => {
  const code = uniqueConstraintCode(error);
  if (!code) return null;
  const messages: Record<string, string> = {
    REGION_NAME_EXISTS: 'A region with that name already exists in this company',
    TEAM_NAME_EXISTS: 'A team with that name already exists in this region',
    ONE_ACTIVE_REGION: 'A Regional Manager may manage only one active region',
    ONE_ACTIVE_TEAM: 'A Team Leader may lead only one active team',
  };
  return new AppError(409, messages[code], code);
};

export const throwStructureConflict = (error: unknown): never => {
  const mapped = structureConflictFrom(error);
  if (mapped) throw mapped;
  throw error;
};

export type OrgUnitRef = {
  id: string;
  name: string;
};

/**
 * Resolves the real Region/Team entities for a member without using person-name labels.
 */
export const placementForMember = (
  member: { id: string; reportsToUserId: string | null },
  rank: string,
  regions: RegionRow[],
  teams: TeamRow[]
): { region: OrgUnitRef | null; team: OrgUnitRef | null } => {
  const toRegion = (row: RegionRow | undefined): OrgUnitRef | null =>
    row ? { id: row.id, name: row.name } : null;
  const toTeam = (row: TeamRow | undefined): OrgUnitRef | null =>
    row ? { id: row.id, name: row.name } : null;

  const activeRegions = regions.filter((row) => row.is_active);
  const activeTeams = teams.filter((row) => row.is_active);

  if (rank === 'regional_manager') {
    const region =
      activeRegions.find((row) => row.manager_user_id === member.id) ??
      regions.find((row) => row.manager_user_id === member.id);
    return { region: toRegion(region), team: null };
  }

  if (rank === 'team_leader') {
    const team =
      activeTeams.find((row) => row.leader_user_id === member.id) ??
      teams.find((row) => row.leader_user_id === member.id);
    const region = team ? regions.find((row) => row.id === team.region_id) : undefined;
    return { region: toRegion(region), team: toTeam(team) };
  }

  const team =
    activeTeams.find((row) => row.leader_user_id === member.reportsToUserId) ??
    teams.find((row) => row.leader_user_id === member.reportsToUserId);
  if (team) {
    return {
      team: toTeam(team),
      region: toRegion(regions.find((row) => row.id === team.region_id)),
    };
  }

  const region =
    activeRegions.find((row) => row.manager_user_id === member.reportsToUserId) ??
    regions.find((row) => row.manager_user_id === member.reportsToUserId);
  return { region: toRegion(region), team: null };
};

export const managerName = (row: RegionRow): string | null => {
  const name = `${row.manager_first_name ?? ''} ${row.manager_last_name ?? ''}`.trim();
  return name || null;
};

export const leaderName = (row: TeamRow): string | null => {
  const name = `${row.leader_first_name ?? ''} ${row.leader_last_name ?? ''}`.trim();
  return name || null;
};

/**
 * Points a user at a manager inside the same company.
 */
export const setReportsTo = async (
  companyId: string,
  userId: string,
  reportsToUserId: string | null
): Promise<void> => {
  await organisationRepository.updateMember(companyId, userId, { reportsToUserId });
};

/**
 * Assigns a Regional Manager to a region and aligns their reporting line to the company executive.
 */
export const assignRegionManager = async (input: {
  companyId: string;
  regionId: string;
  managerUserId: string | null;
  executiveUserId: string | null;
  previousManagerUserId: string | null;
}): Promise<void> => {
  if (input.managerUserId) {
    await setReportsTo(input.companyId, input.managerUserId, input.executiveUserId);
  }
  if (
    input.previousManagerUserId &&
    input.managerUserId &&
    input.previousManagerUserId !== input.managerUserId
  ) {
    await organisationStructureRepository.realignReportsTo(
      input.companyId,
      input.previousManagerUserId,
      input.managerUserId
    );
  }
};

/**
 * Assigns a Team Leader to a team and aligns reporting lines to the region's Regional Manager.
 */
export const assignTeamLeader = async (input: {
  companyId: string;
  teamId: string;
  leaderUserId: string | null;
  regionManagerUserId: string | null;
  previousLeaderUserId: string | null;
}): Promise<void> => {
  if (input.leaderUserId) {
    if (!input.regionManagerUserId) {
      throw new AppError(
        400,
        'Assign a Regional Manager to this region before assigning a Team Leader',
        'REGION_HAS_NO_MANAGER'
      );
    }
    await setReportsTo(input.companyId, input.leaderUserId, input.regionManagerUserId);
  }
  if (
    input.previousLeaderUserId &&
    input.leaderUserId &&
    input.previousLeaderUserId !== input.leaderUserId
  ) {
    await organisationStructureRepository.realignReportsTo(
      input.companyId,
      input.previousLeaderUserId,
      input.leaderUserId
    );
  }
};
