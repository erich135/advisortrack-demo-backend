import { AppError } from '../middleware/errorHandler';
import { HierarchyRank, resolveHierarchyRank } from '../features/customerHierarchy';
import {
  assignRegionManager,
  assignTeamLeader,
  leaderName,
  managerName,
  throwStructureConflict,
} from '../features/organisationPlacement';
import { organisationRepository } from '../repositories/organisation.repository';
import {
  organisationStructureRepository,
  RegionRow,
  TeamRow,
} from '../repositories/organisationStructure.repository';
import { isDatabaseActive } from '../config/database';
import { env } from '../config/env';
import { organisationService } from './organisation.service';
import { demoWorkspaceRepository } from '../repositories/demoWorkspace.repository';

type StructureActor = {
  userId: string;
  rank: HierarchyRank;
  companyId: string;
  assignedRegionId: string | null;
  assignedTeamId: string | null;
  canManageRegions: boolean;
  canManageTeams: boolean;
  canViewRegions: boolean;
  canViewTeams: boolean;
};

const rankOfMember = async (
  member: {
    is_platform_admin: boolean;
    role_name: string | null;
    company_role_id: string | null;
  }
): Promise<HierarchyRank> => {
  const permissions = member.company_role_id
    ? await organisationRepository.listRolePermissionKeys(member.company_role_id)
    : [];
  return resolveHierarchyRank({
    isPlatformAdmin: member.is_platform_admin,
    roleName: member.role_name,
    permissions,
  });
};

const toRegionDto = (row: RegionRow) => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  managerUserId: row.manager_user_id,
  managerName: managerName(row),
  isActive: row.is_active,
  status: row.is_active ? 'Active' : 'Archived',
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const toTeamDto = (row: TeamRow) => ({
  id: row.id,
  companyId: row.company_id,
  regionId: row.region_id,
  regionName: row.region_name,
  name: row.name,
  leaderUserId: row.leader_user_id,
  leaderName: leaderName(row),
  isActive: row.is_active,
  status: row.is_active ? 'Active' : 'Archived',
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/**
 * Regions and teams for a customer organisation. Reporting lines stay on users.reports_to_user_id.
 */
export const organisationStructureService = {
  async resolveActor(userId: string, requestedCompanyId?: string): Promise<StructureActor> {
    if (!isDatabaseActive()) {
      throw new AppError(503, 'Database unavailable', 'DB_UNAVAILABLE');
    }
    const org = await organisationService.getMyOrganisation(userId);
    const rank = resolveHierarchyRank({
      isPlatformAdmin: org.isPlatformAdmin,
      roleName: org.role?.name,
      permissions: org.permissions,
    });

    if (rank === 'financial_advisor') {
      throw new AppError(403, 'This portal is for leadership roles', 'FORBIDDEN');
    }

    let companyId = org.company.id;
    if (requestedCompanyId && requestedCompanyId !== org.company.id) {
      if (rank !== 'platform_admin') {
        throw new AppError(403, 'You cannot access another organisation', 'FORBIDDEN');
      }
      const company = await organisationRepository.findCompanyById(requestedCompanyId);
      if (!company) {
        throw new AppError(404, 'Company not found', 'NOT_FOUND');
      }
      companyId = company.id;
    }
    if (env.isDemoMode) {
      await demoWorkspaceRepository.assertNotTemplateCompany(companyId);
    }

    const assignedRegion =
      rank === 'regional_manager'
        ? await organisationStructureRepository.findActiveRegionByManager(companyId, userId)
        : null;
    const assignedTeam =
      rank === 'team_leader'
        ? await organisationStructureRepository.findActiveTeamByLeader(companyId, userId)
        : null;

    return {
      userId,
      rank,
      companyId,
      assignedRegionId: assignedRegion?.id ?? null,
      assignedTeamId: assignedTeam?.id ?? null,
      canManageRegions: rank === 'platform_admin' || rank === 'executive',
      canManageTeams: rank === 'platform_admin' || rank === 'executive' || rank === 'regional_manager',
      canViewRegions: rank === 'platform_admin' || rank === 'executive' || rank === 'regional_manager',
      canViewTeams: true,
    };
  },

  assertCanManageRegions(actor: StructureActor): void {
    if (!actor.canManageRegions) {
      throw new AppError(403, 'You cannot administer regions', 'FORBIDDEN');
    }
  },

  assertCanManageTeams(actor: StructureActor): void {
    if (!actor.canManageTeams) {
      throw new AppError(403, 'You cannot administer teams', 'FORBIDDEN');
    }
  },

  assertTeamRegionInScope(actor: StructureActor, regionId: string): void {
    if (actor.rank === 'regional_manager') {
      if (!actor.assignedRegionId || actor.assignedRegionId !== regionId) {
        throw new AppError(403, 'You can only manage teams in your assigned region', 'FORBIDDEN');
      }
    }
  },

  async assertUserInCompany(
    companyId: string,
    userId: string | null,
    expectedRank: HierarchyRank | null
  ): Promise<void> {
    if (!userId) return;
    const members = await organisationRepository.listMembers(companyId);
    const member = members.find((row) => row.id === userId);
    if (!member) {
      throw new AppError(400, 'Assigned user must belong to this company', 'INVALID_ASSIGNMENT');
    }
    if (expectedRank) {
      const rank = await rankOfMember(member);
      if (rank !== expectedRank) {
        throw new AppError(400, 'Assigned user does not have the required role', 'INVALID_ASSIGNMENT');
      }
    }
  },

  async findCompanyExecutiveId(companyId: string, preferredUserId: string | null): Promise<string | null> {
    const members = await organisationRepository.listMembers(companyId);
    if (preferredUserId && members.some((row) => row.id === preferredUserId)) {
      const preferred = members.find((row) => row.id === preferredUserId);
      if (preferred && (await rankOfMember(preferred)) === 'executive') {
        return preferredUserId;
      }
    }
    for (const member of members) {
      if ((await rankOfMember(member)) === 'executive') {
        return member.id;
      }
    }
    return null;
  },

  async listRegions(userId: string, requestedCompanyId?: string) {
    const actor = await this.resolveActor(userId, requestedCompanyId);
    if (!actor.canViewRegions) {
      throw new AppError(403, 'You cannot view regions', 'FORBIDDEN');
    }
    const regionIds =
      actor.rank === 'regional_manager'
        ? actor.assignedRegionId
          ? [actor.assignedRegionId]
          : []
        : undefined;
    if (actor.rank === 'regional_manager' && regionIds?.length === 0) {
      return [];
    }
    const rows = await organisationStructureRepository.listRegions(actor.companyId, regionIds);
    return rows.map(toRegionDto);
  },

  async createRegion(
    userId: string,
    input: { name: string; managerUserId?: string | null },
    requestedCompanyId?: string
  ) {
    const actor = await this.resolveActor(userId, requestedCompanyId);
    this.assertCanManageRegions(actor);
    const name = input.name.trim();
    if (!name) {
      throw new AppError(400, 'Region name is required', 'VALIDATION_ERROR');
    }
    await this.assertUserInCompany(actor.companyId, input.managerUserId ?? null, 'regional_manager');
    try {
      const created = await organisationStructureRepository.createRegion({
        companyId: actor.companyId,
        name,
        managerUserId: input.managerUserId ?? null,
      });
      if (created.manager_user_id) {
        await assignRegionManager({
          companyId: actor.companyId,
          regionId: created.id,
          managerUserId: created.manager_user_id,
          executiveUserId: await this.findCompanyExecutiveId(actor.companyId, actor.userId),
          previousManagerUserId: null,
        });
      }
      const reloaded = await organisationStructureRepository.findRegion(actor.companyId, created.id);
      return toRegionDto(reloaded ?? created);
    } catch (error) {
      throwStructureConflict(error);
    }
  },

  async updateRegion(
    userId: string,
    regionId: string,
    input: { name?: string; managerUserId?: string | null; isActive?: boolean },
    requestedCompanyId?: string
  ) {
    const actor = await this.resolveActor(userId, requestedCompanyId);
    this.assertCanManageRegions(actor);
    const existing = await organisationStructureRepository.findRegion(actor.companyId, regionId);
    if (!existing) {
      throw new AppError(404, 'Region not found', 'NOT_FOUND');
    }
    if (input.managerUserId !== undefined) {
      await this.assertUserInCompany(actor.companyId, input.managerUserId, 'regional_manager');
    }
    try {
      const updated = await organisationStructureRepository.updateRegion(actor.companyId, regionId, {
        name: input.name?.trim(),
        managerUserId: input.managerUserId,
        isActive: input.isActive,
      });
      if (!updated) {
        throw new AppError(404, 'Region not found', 'NOT_FOUND');
      }
      if (input.managerUserId !== undefined) {
        await assignRegionManager({
          companyId: actor.companyId,
          regionId,
          managerUserId: updated.manager_user_id,
          executiveUserId: await this.findCompanyExecutiveId(actor.companyId, actor.userId),
          previousManagerUserId: existing.manager_user_id,
        });
      }
      const reloaded = await organisationStructureRepository.findRegion(actor.companyId, regionId);
      return toRegionDto(reloaded ?? updated);
    } catch (error) {
      throwStructureConflict(error);
    }
  },

  async listTeams(userId: string, requestedCompanyId?: string) {
    const actor = await this.resolveActor(userId, requestedCompanyId);
    if (!actor.canViewTeams) {
      throw new AppError(403, 'You cannot view teams', 'FORBIDDEN');
    }
    if (actor.rank === 'team_leader') {
      if (!actor.assignedTeamId) return [];
      const rows = await organisationStructureRepository.listTeams(actor.companyId, {
        teamIds: [actor.assignedTeamId],
      });
      return rows.map(toTeamDto);
    }
    if (actor.rank === 'regional_manager') {
      if (!actor.assignedRegionId) return [];
      const rows = await organisationStructureRepository.listTeams(actor.companyId, {
        regionId: actor.assignedRegionId,
      });
      return rows.map(toTeamDto);
    }
    const rows = await organisationStructureRepository.listTeams(actor.companyId);
    return rows.map(toTeamDto);
  },

  async createTeam(
    userId: string,
    input: { name: string; regionId: string; leaderUserId?: string | null },
    requestedCompanyId?: string
  ) {
    const actor = await this.resolveActor(userId, requestedCompanyId);
    this.assertCanManageTeams(actor);
    this.assertTeamRegionInScope(actor, input.regionId);
    const name = input.name.trim();
    if (!name) {
      throw new AppError(400, 'Team name is required', 'VALIDATION_ERROR');
    }
    const region = await organisationStructureRepository.findRegion(actor.companyId, input.regionId);
    if (!region) {
      throw new AppError(400, 'Region does not belong to this company', 'INVALID_REGION');
    }
    if (!region.is_active) {
      throw new AppError(400, 'Cannot add a team to an archived region', 'REGION_ARCHIVED');
    }
    await this.assertUserInCompany(actor.companyId, input.leaderUserId ?? null, 'team_leader');
    try {
      const created = await organisationStructureRepository.createTeam({
        companyId: actor.companyId,
        regionId: input.regionId,
        name,
        leaderUserId: input.leaderUserId ?? null,
      });
      if (created.leader_user_id) {
        await assignTeamLeader({
          companyId: actor.companyId,
          teamId: created.id,
          leaderUserId: created.leader_user_id,
          regionManagerUserId: region.manager_user_id,
          previousLeaderUserId: null,
        });
      }
      const reloaded = await organisationStructureRepository.findTeam(actor.companyId, created.id);
      return toTeamDto(reloaded ?? created);
    } catch (error) {
      throwStructureConflict(error);
    }
  },

  async updateTeam(
    userId: string,
    teamId: string,
    input: { name?: string; regionId?: string; leaderUserId?: string | null; isActive?: boolean },
    requestedCompanyId?: string
  ) {
    const actor = await this.resolveActor(userId, requestedCompanyId);
    this.assertCanManageTeams(actor);
    const existing = await organisationStructureRepository.findTeam(actor.companyId, teamId);
    if (!existing) {
      throw new AppError(404, 'Team not found', 'NOT_FOUND');
    }
    this.assertTeamRegionInScope(actor, existing.region_id);
    const nextRegionId = input.regionId ?? existing.region_id;
    if (input.regionId) {
      this.assertTeamRegionInScope(actor, input.regionId);
    }
    const region = await organisationStructureRepository.findRegion(actor.companyId, nextRegionId);
    if (!region) {
      throw new AppError(400, 'Region does not belong to this company', 'INVALID_REGION');
    }
    if (input.regionId && !region.is_active) {
      throw new AppError(400, 'Cannot move a team into an archived region', 'REGION_ARCHIVED');
    }
    if (input.leaderUserId !== undefined) {
      await this.assertUserInCompany(actor.companyId, input.leaderUserId, 'team_leader');
    }
    try {
      const updated = await organisationStructureRepository.updateTeam(actor.companyId, teamId, {
        name: input.name?.trim(),
        regionId: input.regionId,
        leaderUserId: input.leaderUserId,
        isActive: input.isActive,
      });
      if (!updated) {
        throw new AppError(404, 'Team not found', 'NOT_FOUND');
      }
      if (input.leaderUserId !== undefined || input.regionId !== undefined) {
        await assignTeamLeader({
          companyId: actor.companyId,
          teamId,
          leaderUserId: updated.leader_user_id,
          regionManagerUserId: region.manager_user_id,
          previousLeaderUserId: existing.leader_user_id,
        });
      }
      const reloaded = await organisationStructureRepository.findTeam(actor.companyId, teamId);
      return toTeamDto(reloaded ?? updated);
    } catch (error) {
      throwStructureConflict(error);
    }
  },
};
