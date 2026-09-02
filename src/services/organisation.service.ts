import { AppError } from '../middleware/errorHandler';
import {
  allowedManagerRanksFor,
  canManageRank,
  hasPortalAccess,
  HierarchyRank,
  isInternalRoleName,
  ManagementScopeKind,
  RANK_LABELS,
  ranksAssignableBy,
  resolveHierarchyRank,
  toHierarchyDto,
} from '../features/customerHierarchy';
import { licenceStatusLabel } from '../features/memberLicence';
import { NO_LICENCES_MESSAGE, toLicencePool } from '../features/licencePool';
import {
  isOrganisationPermissionKey,
  ORGANISATION_PERMISSIONS,
} from '../features/organisationPermissions';
import {
  CompanyRow,
  MemberRow,
  organisationRepository,
} from '../repositories/organisation.repository';
import { isDatabaseActive } from '../config/database';
import { env } from '../config/env';
import { userRepository } from '../repositories/user.repository';
import {
  organisationStructureRepository,
  RegionRow,
  TeamRow,
} from '../repositories/organisationStructure.repository';
import {
  assignRegionManager,
  assignTeamLeader,
  placementForMember,
  structureConflictFrom,
  throwStructureConflict,
} from '../features/organisationPlacement';
import { subscriptionRepository } from '../repositories/subscription.repository';
import { subscriptionService } from './subscription.service';
import { sendMemberInvitationEmail } from './invitationMail';
import { platformSubscriptionsService } from './platformSubscriptions.service';
import { clearGracePeriod, reactivateAllRealContacts } from './sandbox.service';
import { hashPassword } from '../utils/auth';
import { generateSecureToken } from '../utils/emailTokens';
import { demoWorkspaceRepository } from '../repositories/demoWorkspace.repository';
import { demoOutboxService, demoSimulatedInvitationResult, demoSimulatedUserCreatedResult } from './demoOutbox.service';
import { toNorthstarCloneSafeEmail, visitorKeyFromCompanySlug } from '../features/demoNorthstar';
import { assertDemoAccountDeleteAllowed } from '../middleware/demoGuard';

/**
 * Slugifies a company name for unique URLs / keys.
 */
const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'company';

/**
 * Maps a company row to the public API shape.
 */
const toCompanyDto = (row: CompanyRow) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  seatLimit: row.seat_limit,
  isPlatform: row.is_platform,
  isActive: row.is_active,
  memberCount: row.member_count != null ? Number(row.member_count) : undefined,
  createdAt: row.created_at.toISOString(),
});

const rankForMemberRow = (row: MemberRow, permissions: string[]): HierarchyRank =>
  resolveHierarchyRank({
    isPlatformAdmin: row.is_platform_admin,
    roleName: row.role_name,
    permissions,
  });

const subscriptionDto = (row: MemberRow) =>
  row.package_slug
    ? {
        slug: row.package_slug,
        name: row.package_name,
        status: row.subscription_status,
      }
    : null;

/**
 * Compact member shape for platform company overviews (unscoped).
 */
const toMemberDto = (row: MemberRow) => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  phone: row.phone,
  role: row.role_name ? { id: row.company_role_id, name: row.role_name } : null,
  reportsToUserId: row.reports_to_user_id,
  isPlatformAdmin: row.is_platform_admin,
  isActive: row.is_active,
  lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
  lastMobileActivityAt: row.last_mobile_activity_at
    ? row.last_mobile_activity_at.toISOString()
    : null,
  subscription: subscriptionDto(row),
  licenceStatus: licenceStatusLabel(row.package_slug, row.subscription_status),
  accountStatus: row.is_active ? 'Active' : 'Inactive',
  createdAt: row.created_at.toISOString(),
});

const permittedActionsFor = (input: {
  actorUserId: string;
  actorRank: HierarchyRank;
  memberId: string;
  memberRank: HierarchyRank;
  isPlatformAdmin: boolean;
  isActive: boolean;
  licensed: boolean;
}) => {
  const canManage =
    input.memberId !== input.actorUserId &&
    !input.isPlatformAdmin &&
    canManageRank(input.actorRank, input.memberRank);
  return {
    view: true,
    edit: canManage,
    changeRole: canManage,
    assignTeam: canManage && input.memberRank === 'financial_advisor',
    assignRegion: canManage && (input.memberRank === 'financial_advisor' || input.memberRank === 'team_leader'),
    assignLicence: canManage && !input.licensed,
    removeLicence: canManage && input.licensed,
    activateAccount: canManage && !input.isActive,
    deactivateAccount: canManage && input.isActive,
    resendInvitation: canManage,
  };
};

const toManagedMemberDto = (
  row: MemberRow,
  extras: {
    rank: HierarchyRank;
    team: { id: string; name: string } | null;
    region: { id: string; name: string } | null;
    actions: ReturnType<typeof permittedActionsFor>;
    company?: {
      id: string;
      name: string;
      slug: string;
      seatLimit: number | null;
      isPlatform: boolean;
    };
  }
) => ({
  ...toMemberDto(row),
  rank: extras.rank,
  rankLabel: RANK_LABELS[extras.rank],
  team: extras.team,
  region: extras.region,
  actions: extras.actions,
  ...(extras.company ? { company: extras.company } : {}),
});

export type ScopedMemberRecord = {
  id: string;
  firstName: string;
  lastName: string;
  roleName: string | null;
  roleId: string | null;
  reportsToUserId: string | null;
  isPlatformAdmin: boolean;
  permissions: string[];
};

export type ManagementScope = {
  /** The membership company resolved from the authenticated caller only. */
  company: {
    id: string;
    name: string;
    slug: string;
    seatLimit: number | null;
    isPlatform: boolean;
  };
  /** Organisation = whole company; region/team = reporting-line downline. */
  kind: ManagementScopeKind;
  rank: HierarchyRank;
  /**
   * Server-resolved IDs permitted for future user-owned data queries, e.g.
   * `WHERE user_id = ANY($n::uuid[])`. Never accept this set from a client.
   */
  userIds: string[];
};

type MemberContext = {
  actorUserId: string;
  scope: ManagementScope;
  companyMembers: MemberRow[];
  scopedMembers: MemberRow[];
  permissionsByRole: Map<string, string[]>;
  regions: RegionRow[];
  teams: TeamRow[];
};

const rankFor = (input: {
  isPlatformAdmin: boolean;
  roleName: string | null | undefined;
  permissions: string[];
}): HierarchyRank => resolveHierarchyRank(input);

const wouldCreateReportingCycle = (
  memberId: string,
  newManagerId: string,
  members: MemberRow[]
): boolean => {
  let current: string | null = newManagerId;
  const seen = new Set<string>();
  const byId = new Map(members.map((row) => [row.id, row]));
  while (current) {
    if (current === memberId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.reports_to_user_id ?? null;
  }
  return false;
};

/**
 * Company membership, custom roles, and AdvisorTrack platform admin APIs.
 */
export const organisationService = {
  /**
   * Returns the permission catalogue (same keys for every company).
   */
  listPermissionCatalogue() {
    return ORGANISATION_PERMISSIONS.map((item) => ({ ...item }));
  },

  /**
   * Loads the signed-in user's company, role, and permission keys.
   */
  async getMyOrganisation(userId: string) {
    if (!isDatabaseActive()) {
      throw new AppError(503, 'Database unavailable', 'DB_UNAVAILABLE');
    }

    const membership = await organisationRepository.findMembership(userId);
    if (!membership?.company_id) {
      throw new AppError(404, 'User is not in a company yet', 'NO_COMPANY');
    }

    await organisationRepository.ensureCustomerHierarchyRoles(membership.company_id);

    const permissions = membership.company_role_id
      ? await organisationRepository.listRolePermissionKeys(membership.company_role_id)
      : [];
    const rank = rankFor({
      isPlatformAdmin: env.isDemoMode ? false : membership.is_platform_admin,
      roleName: membership.role_name,
      permissions,
    });

    return {
      company: {
        id: membership.company_id,
        name: membership.company_name,
        slug: membership.company_slug,
        seatLimit: membership.seat_limit,
        isPlatform: membership.is_platform_company,
      },
      role: membership.company_role_id
        ? { id: membership.company_role_id, name: membership.role_name }
        : null,
      permissions,
      reportsToUserId: membership.reports_to_user_id,
      isPlatformAdmin: env.isDemoMode ? false : membership.is_platform_admin,
      hierarchy: toHierarchyDto(rank),
    };
  },

  /**
   * True when the user is AdvisorTrack staff.
   */
  async isPlatformAdmin(userId: string): Promise<boolean> {
    if (env.isDemoMode) {
      return false;
    }
    const membership = await organisationRepository.findMembership(userId);
    return Boolean(membership?.is_platform_admin);
  },

  /**
   * True when the user's role includes the permission (platform admins pass all).
   */
  async hasPermission(userId: string, key: string): Promise<boolean> {
    const org = await this.getMyOrganisation(userId);
    return org.isPlatformAdmin || org.permissions.includes(key);
  },

  /**
   * Lists roles and their permissions for the caller's company.
   */
  async listMyRoles(userId: string) {
    const org = await this.getMyOrganisation(userId);
    const roles = await organisationRepository.listRoles(org.company.id);
    return Promise.all(
      roles.map(async (role) => ({
        id: role.id,
        name: role.name,
        isDefault: role.is_default,
        isSystem: role.is_system,
        permissions: await organisationRepository.listRolePermissionKeys(role.id),
        createdAt: role.created_at.toISOString(),
      }))
    );
  },

  /**
   * Creates a custom-named role on the caller's company.
   */
  async createMyRole(
    userId: string,
    input: { name: string; permissions?: string[]; isDefault?: boolean }
  ) {
    await this.assertPermission(userId, 'manage_roles');
    const org = await this.getMyOrganisation(userId);
    const actorRank = rankFor({
      isPlatformAdmin: org.isPlatformAdmin,
      roleName: org.role?.name,
      permissions: org.permissions,
    });
    this.assertRoleDefinitionAllowed(actorRank, input.name.trim(), input.permissions ?? []);
    const permissions = this.sanitizePermissions(input.permissions ?? []);

    try {
      const role = await organisationRepository.createRole({
        companyId: org.company.id,
        name: input.name.trim(),
        isDefault: input.isDefault,
      });
      if (permissions.length > 0) {
        await organisationRepository.updateRole(role.id, org.company.id, { permissions });
      }
      return this.getRoleDto(org.company.id, role.id);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(409, 'A role with that name already exists', 'ROLE_EXISTS');
      }
      throw error;
    }
  },

  /**
   * Updates a role name, default flag, and/or permissions.
   */
  async updateMyRole(
    userId: string,
    roleId: string,
    input: { name?: string; permissions?: string[]; isDefault?: boolean }
  ) {
    await this.assertPermission(userId, 'manage_roles');
    const org = await this.getMyOrganisation(userId);
    const existing = await organisationRepository.findRole(org.company.id, roleId);
    if (!existing) {
      throw new AppError(404, 'Role not found', 'NOT_FOUND');
    }
    const actorRank = rankFor({
      isPlatformAdmin: org.isPlatformAdmin,
      roleName: org.role?.name,
      permissions: org.permissions,
    });
    if (existing.is_system && actorRank !== 'platform_admin') {
      throw new AppError(400, 'System roles cannot be changed', 'SYSTEM_ROLE');
    }
    this.assertRoleDefinitionAllowed(
      actorRank,
      input.name?.trim() ?? existing.name,
      input.permissions ?? (await organisationRepository.listRolePermissionKeys(roleId))
    );

    try {
      await organisationRepository.updateRole(roleId, org.company.id, {
        name: input.name?.trim(),
        isDefault: input.isDefault,
        permissions: input.permissions ? this.sanitizePermissions(input.permissions) : undefined,
      });
      return this.getRoleDto(org.company.id, roleId);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(409, 'A role with that name already exists', 'ROLE_EXISTS');
      }
      throw error;
    }
  },

  /**
   * Deletes a custom role. System roles (Advisor, Company admin) cannot be removed.
   */
  async deleteMyRole(userId: string, roleId: string) {
    await this.assertPermission(userId, 'manage_roles');
    assertDemoAccountDeleteAllowed();
    const org = await this.getMyOrganisation(userId);
    const existing = await organisationRepository.findRole(org.company.id, roleId);
    if (!existing) {
      throw new AppError(404, 'Role not found', 'NOT_FOUND');
    }
    if (existing.is_system) {
      throw new AppError(400, 'System roles cannot be deleted (you can rename them)', 'SYSTEM_ROLE');
    }
    await organisationRepository.deleteRole(roleId, org.company.id);
    return { deleted: true };
  },

  /**
   * Lists members visible in the caller's management scope.
   */
  async listMyMembers(userId: string) {
    const ctx = await this.loadMemberContext(userId);
    return ctx.scopedMembers.map((row) => this.toScopedMemberDto(row, ctx, false));
  },

  /**
   * Returns one member only when that member is visible through the same scope
   * as listMyMembers. A missing or out-of-scope member deliberately returns 404.
   */
  async getMyMember(userId: string, memberId: string) {
    const ctx = await this.loadMemberContext(userId);
    const member = ctx.scopedMembers.find((row) => row.id === memberId);
    if (!member) {
      throw new AppError(404, 'Member not found', 'NOT_FOUND');
    }
    return this.toScopedMemberDto(member, ctx, true);
  },

  /**
   * Roles the caller may assign — never internal AdvisorTrack roles, never peer/higher ranks.
   */
  async listAssignableRoles(userId: string, companyId?: string) {
    const scope = companyId
      ? (await this.memberContextFor(userId, companyId)).scope
      : await this.resolveManagementScope(userId);
    const roles = await organisationRepository.listRoles(scope.company.id);
    const allowedRanks = new Set(ranksAssignableBy(scope.rank));
    const result: Array<{
      id: string;
      name: string;
      rank: HierarchyRank;
      rankLabel: string;
    }> = [];

    for (const role of roles) {
      if (isInternalRoleName(role.name)) continue;
      const permissions = await organisationRepository.listRolePermissionKeys(role.id);
      const rank = rankFor({
        isPlatformAdmin: false,
        roleName: role.name,
        permissions,
      });
      if (rank === 'platform_admin' || !allowedRanks.has(rank)) continue;
      result.push({
        id: role.id,
        name: role.name,
        rank,
        rankLabel: RANK_LABELS[rank],
      });
    }

    return result;
  },

  /**
   * Invites a member into the caller's company using the existing user/auth model.
   */
  async createMyMember(
    userId: string,
    input: {
      firstName: string;
      lastName: string;
      email: string;
      phone?: string | null;
      roleId: string;
      reportsToUserId?: string | null;
      regionId?: string | null;
      teamId?: string | null;
    },
    options?: { companyId?: string }
  ) {
    await this.assertPermission(userId, 'manage_members');
    const ctx = await this.memberContextFor(userId, options?.companyId);
    if (env.isDemoMode) {
      await demoWorkspaceRepository.assertNotTemplateCompany(ctx.scope.company.id);
    }
    const nextRank = await this.assertAssignableRole(ctx, input.roleId);
    const reportsToUserId = await this.resolvePlacementReportsTo(ctx, nextRank, {
      teamId: input.teamId,
      regionId: input.regionId,
      reportsToUserId: input.reportsToUserId,
    });
    await this.assertReportsToAllowed(ctx, {
      memberId: null,
      nextRank,
      reportsToUserId,
    });

    let storedEmail = input.email.trim().toLowerCase();
    if (env.isDemoMode) {
      const visitorKey = visitorKeyFromCompanySlug(ctx.scope.company.slug);
      if (visitorKey) {
        storedEmail = toNorthstarCloneSafeEmail(storedEmail, visitorKey);
      }
    }

    const existing = await userRepository.findByEmail(storedEmail);
    if (existing) {
      throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
    }

    const passwordHash = await hashPassword(generateSecureToken());
    try {
      const created = await organisationRepository.createMember({
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        email: storedEmail,
        phone: input.phone?.trim() || null,
        passwordHash,
        profileRole: RANK_LABELS[nextRank],
        companyId: ctx.scope.company.id,
        companyRoleId: input.roleId,
        reportsToUserId,
      });
      await subscriptionService.assignDefaultSubscription(created.id);
      let invited = false;
      let demoSimulated = false;
      if (env.isDemoMode) {
        await demoOutboxService.record({
          companyId: ctx.scope.company.id,
          actorUserId: userId,
          action: 'member_invitation',
          recipient: created.email,
          payload: { memberId: created.id, kind: 'create' },
        });
        invited = true;
        demoSimulated = true;
      } else {
        invited = await sendMemberInvitationEmail({
          id: created.id,
          email: created.email,
          firstName: created.first_name,
        });
      }
      await this.applyStructureAssignment(ctx, created.id, nextRank, {
        regionId: input.regionId,
        teamId: input.teamId,
      });
      await organisationRepository.recordAuditEvent(userId, 'user_created', 'user', {
        companyId: ctx.scope.company.id,
        targetUserId: created.id,
        newValue: {
          email: created.email,
          roleId: input.roleId,
          roleName: RANK_LABELS[nextRank],
        },
      });
      const reloaded = await this.reloadMemberRow(ctx.scope.company.id, created.id);
      return {
        ...this.toScopedMemberDto(
          reloaded,
          await this.memberContextFor(userId, options?.companyId),
          true
        ),
        invitationSent: invited,
        ...(demoSimulated ? demoSimulatedUserCreatedResult(created.email) : {}),
      };
    } catch (error) {
      const structureConflict = structureConflictFrom(error);
      if (structureConflict) throw structureConflict;
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
      }
      throw error;
    }
  },

  /**
   * Assigns a role, manager, profile fields, or account status for a scoped member.
   */
  async updateMyMember(
    userId: string,
    memberId: string,
    input: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string | null;
      roleId?: string;
      reportsToUserId?: string | null;
      regionId?: string | null;
      teamId?: string | null;
      isActive?: boolean;
    },
    options?: { companyId?: string }
  ) {
    await this.assertPermission(userId, 'manage_members');
    const ctx = await this.memberContextFor(userId, options?.companyId);
    if (env.isDemoMode) {
      await demoWorkspaceRepository.assertNotTemplateCompany(ctx.scope.company.id);
    }
    const target = this.requireMutableMember(ctx, userId, memberId);

    const emailInput = env.isDemoMode ? undefined : input.email;

    if (emailInput && emailInput.toLowerCase() !== target.email.toLowerCase()) {
      const existing = await userRepository.findByEmail(emailInput);
      if (existing && existing.id !== memberId) {
        throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
      }
    }

    const targetPermissions = ctx.permissionsByRole.get(target.company_role_id ?? '') ?? [];
    const currentRank = rankForMemberRow(target, targetPermissions);
    const nextRank = input.roleId
      ? await this.assertAssignableRole(ctx, input.roleId)
      : currentRank;

    const reportsToUserId = await this.resolvePlacementReportsTo(ctx, nextRank, {
      teamId: input.teamId,
      regionId: input.regionId,
      reportsToUserId:
        input.reportsToUserId !== undefined ? input.reportsToUserId : target.reports_to_user_id,
      keepExistingReportsTo: input.teamId === undefined && input.regionId === undefined && input.reportsToUserId === undefined,
    });
    if (
      input.roleId !== undefined ||
      input.reportsToUserId !== undefined ||
      input.teamId !== undefined ||
      input.regionId !== undefined
    ) {
      await this.assertReportsToAllowed(ctx, {
        memberId,
        nextRank,
        reportsToUserId,
      });
    }

    const previousPlacement = placementForMember(
      { id: target.id, reportsToUserId: target.reports_to_user_id },
      currentRank,
      ctx.regions,
      ctx.teams
    );

    try {
      const updated = await organisationRepository.updateMember(ctx.scope.company.id, memberId, {
        firstName: input.firstName?.trim(),
        lastName: input.lastName?.trim(),
        email: emailInput,
        phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
        companyRoleId: input.roleId,
        reportsToUserId:
          input.teamId !== undefined || input.regionId !== undefined || input.reportsToUserId !== undefined
            ? reportsToUserId
            : input.reportsToUserId,
        isActive: input.isActive,
      });
      if (!updated) {
        throw new AppError(404, 'Member not found', 'NOT_FOUND');
      }
      await this.applyStructureAssignment(ctx, memberId, nextRank, {
        regionId: input.regionId,
        teamId: input.teamId,
      });
      const reloaded = await this.reloadMemberRow(ctx.scope.company.id, memberId);
      const nextCtx = await this.memberContextFor(userId, options?.companyId);
      const nextPlacement = placementForMember(
        { id: reloaded.id, reportsToUserId: reloaded.reports_to_user_id },
        nextRank,
        nextCtx.regions,
        nextCtx.teams
      );
      const auditBase = {
        companyId: ctx.scope.company.id,
        targetUserId: memberId,
      };
      if (input.isActive === false && target.is_active) {
        await organisationRepository.recordAuditEvent(userId, 'user_deactivated', 'user', {
          ...auditBase,
          previousValue: 'Active',
          newValue: 'Inactive',
        });
      }
      if (
        (input.firstName !== undefined && input.firstName.trim() !== target.first_name) ||
        (input.lastName !== undefined && input.lastName.trim() !== target.last_name) ||
        (input.phone !== undefined && (input.phone?.trim() || null) !== target.phone)
      ) {
        await organisationRepository.recordAuditEvent(userId, 'user_updated', 'user', {
          ...auditBase,
          previousValue: `${target.first_name} ${target.last_name}`.trim(),
          newValue: `${reloaded.first_name} ${reloaded.last_name}`.trim(),
        });
      }
      if (input.roleId && input.roleId !== target.company_role_id) {
        await organisationRepository.recordAuditEvent(userId, 'role_changed', 'user', {
          ...auditBase,
          previousValue: target.role_name,
          newValue: reloaded.role_name,
        });
      }
      if (input.teamId !== undefined && (previousPlacement.team?.id ?? null) !== (nextPlacement.team?.id ?? null)) {
        await organisationRepository.recordAuditEvent(userId, 'team_changed', 'user', {
          ...auditBase,
          previousValue: previousPlacement.team?.name ?? null,
          newValue: nextPlacement.team?.name ?? null,
        });
      }
      if (input.regionId !== undefined && (previousPlacement.region?.id ?? null) !== (nextPlacement.region?.id ?? null)) {
        await organisationRepository.recordAuditEvent(userId, 'region_changed', 'user', {
          ...auditBase,
          previousValue: previousPlacement.region?.name ?? null,
          newValue: nextPlacement.region?.name ?? null,
        });
      }
      return this.toScopedMemberDto(reloaded, nextCtx, true);
    } catch (error) {
      const structureConflict = structureConflictFrom(error);
      if (structureConflict) throw structureConflict;
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
      }
      throw error;
    }
  },

  /**
   * Company-wide purchased / assigned / available licence pool.
   */
  async getLicencePool(userId: string, companyId?: string) {
    const ctx = await this.memberContextFor(userId, companyId);
    const assigned = await organisationRepository.countLicensedSeats(ctx.scope.company.id);
    return toLicencePool(ctx.scope.company.seatLimit, assigned);
  },

  /**
   * Assigns a paid licence from the company pool. Does not change purchased quantity.
   */
  async assignMemberLicence(userId: string, memberId: string, companyId?: string) {
    await this.assertPermission(userId, 'manage_members');
    const ctx = await this.memberContextFor(userId, companyId);
    if (env.isDemoMode) {
      await demoWorkspaceRepository.assertNotTemplateCompany(ctx.scope.company.id);
    }
    const target = this.requireMutableMember(ctx, userId, memberId);
    if (licenceStatusLabel(target.package_slug, target.subscription_status) === 'Licensed') {
      throw new AppError(400, 'This user already has a licence', 'ALREADY_LICENSED');
    }

    const packageSlug = await this.resolveLicensedPackageSlug();
    const pkg = await subscriptionRepository.findPackageBySlug(packageSlug);
    if (!pkg) {
      throw new AppError(500, 'No licence package is configured', 'SUBSCRIPTION_ERROR');
    }

    const periodEnd = new Date();
    if (pkg.billing_interval === 'month') {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else if (pkg.billing_interval === 'year') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const result = await organisationRepository.tryAssignLicensedSeat({
      companyId: ctx.scope.company.id,
      memberId,
      actorUserId: userId,
      packageId: pkg.id,
      status: 'active',
      trialEndsAt: null,
      currentPeriodEnd: pkg.price_cents > 0 ? periodEnd : null,
    });
    if (!result.assigned) {
      throw new AppError(400, NO_LICENCES_MESSAGE, 'NO_LICENCES');
    }

    await clearGracePeriod(memberId);
    await reactivateAllRealContacts(memberId);
    const reloaded = await this.reloadMemberRow(ctx.scope.company.id, memberId);
    return this.toScopedMemberDto(reloaded, await this.memberContextFor(userId, companyId), true);
  },

  /**
   * Removes a paid licence by returning the user to the default free subscription.
   * Does not deactivate the account or delete advisor history.
   */
  async removeMemberLicence(userId: string, memberId: string, companyId?: string) {
    await this.assertPermission(userId, 'manage_members');
    const ctx = await this.memberContextFor(userId, companyId);
    if (env.isDemoMode) {
      await demoWorkspaceRepository.assertNotTemplateCompany(ctx.scope.company.id);
    }
    const target = this.requireMutableMember(ctx, userId, memberId);
    if (licenceStatusLabel(target.package_slug, target.subscription_status) !== 'Licensed') {
      throw new AppError(400, 'This user does not have a licence to remove', 'NOT_LICENSED');
    }
    await subscriptionService.assignDefaultSubscription(memberId);
    await organisationRepository.recordLicenceEvent(userId, 'licence_removed', {
      companyId: ctx.scope.company.id,
      targetUserId: memberId,
      previousValue: 'Licensed',
      newValue: 'Unlicensed',
    });
    const reloaded = await this.reloadMemberRow(ctx.scope.company.id, memberId);
    return this.toScopedMemberDto(reloaded, await this.memberContextFor(userId, companyId), true);
  },

  /**
   * Resends the existing password-reset invitation PIN.
   */
  async resendMemberInvitation(userId: string, memberId: string, companyId?: string) {
    await this.assertPermission(userId, 'manage_members');
    const ctx = await this.memberContextFor(userId, companyId);
    if (env.isDemoMode) {
      await demoWorkspaceRepository.assertNotTemplateCompany(ctx.scope.company.id);
    }
    const target = this.requireMutableMember(ctx, userId, memberId);
    if (env.isDemoMode) {
      await demoOutboxService.record({
        companyId: ctx.scope.company.id,
        actorUserId: userId,
        action: 'member_invitation_resend',
        recipient: target.email,
        payload: { memberId: target.id },
      });
      return demoSimulatedInvitationResult(target.email);
    }
    const sent = await sendMemberInvitationEmail({
      id: target.id,
      email: target.email,
      firstName: target.first_name,
    });
    return { sent, email: target.email };
  },

  /**
   * Platform: lists every company.
   */
  async listAllCompanies() {
    const rows = await organisationRepository.listCompanies();
    return rows.map((row) => toCompanyDto(row));
  },

  /**
   * Platform: creates a company with default Advisor + Company admin roles.
   */
  async createCompany(input: { name: string; slug?: string; seatLimit?: number | null }) {
    const slug = input.slug?.trim() || slugify(input.name);
    try {
      const company = await organisationRepository.createCompany({
        name: input.name.trim(),
        slug,
        seatLimit: input.seatLimit,
      });
      await organisationRepository.seedDefaultRoles(company.id);
      return toCompanyDto(company);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new AppError(409, 'A company with that slug already exists', 'COMPANY_EXISTS');
      }
      throw error;
    }
  },

  /**
   * Platform: company detail plus roles and members.
   */
  async getCompanyOverview(companyId: string) {
    const company = await organisationRepository.findCompanyById(companyId);
    if (!company) {
      throw new AppError(404, 'Company not found', 'NOT_FOUND');
    }
    await organisationRepository.ensureCustomerHierarchyRoles(companyId);
    const roles = await organisationRepository.listRoles(companyId);
    const roleDtos = await Promise.all(
      roles.map(async (role) => ({
        id: role.id,
        name: role.name,
        isDefault: role.is_default,
        isSystem: role.is_system,
        permissions: await organisationRepository.listRolePermissionKeys(role.id),
      }))
    );
    const permissionsByRole = new Map(roleDtos.map((role) => [role.id, role.permissions]));
    const members = await organisationRepository.listMembers(companyId);
    return {
      company: toCompanyDto(company),
      roles: roleDtos,
      members: members.map((row) => {
        const permissions = row.company_role_id ? permissionsByRole.get(row.company_role_id) ?? [] : [];
        const rank = rankForMemberRow(row, permissions);
        return {
          ...toMemberDto(row),
          rank,
          rankLabel: RANK_LABELS[rank],
        };
      }),
    };
  },

  /**
   * Platform: patch company name, purchased licences, or account active flag.
   * Seat changes use the Phase 6 purchased-licence rules and audit trail.
   */
  async updateCompany(
    actorUserId: string,
    companyId: string,
    input: { name?: string; seatLimit?: number | null; isActive?: boolean; reason?: string }
  ) {
    if (input.seatLimit !== undefined) {
      await platformSubscriptionsService.setPurchasedLicences(actorUserId, companyId, {
        purchased: input.seatLimit,
        reason: input.reason,
      });
    }

    if (input.name === undefined && input.isActive === undefined) {
      const company = await organisationRepository.findCompanyById(companyId);
      if (!company) {
        throw new AppError(404, 'Company not found', 'NOT_FOUND');
      }
      return toCompanyDto(company);
    }

    const updated = await organisationRepository.updateCompany(companyId, {
      name: input.name?.trim(),
      isActive: input.isActive,
    });
    if (!updated) {
      throw new AppError(404, 'Company not found', 'NOT_FOUND');
    }
    return toCompanyDto(updated);
  },

  /**
   * Throws FORBIDDEN when the user lacks the permission.
   */
  async assertPermission(userId: string, key: string): Promise<void> {
    const allowed = await this.hasPermission(userId, key);
    if (!allowed) {
      throw new AppError(403, 'You do not have permission to do that', 'FORBIDDEN');
    }
  },

  /**
   * Resolves the exact management visibility scope used by company members APIs.
   * Organisation = authorised company. Region/team = reporting-line downline.
   */
  async resolveManagementScope(userId: string): Promise<ManagementScope> {
    const org = await this.getMyOrganisation(userId);
    const rank = rankFor({
      isPlatformAdmin: org.isPlatformAdmin,
      roleName: org.role?.name,
      permissions: org.permissions,
    });

    if (!hasPortalAccess(rank)) {
      throw new AppError(403, 'This portal is for leadership roles', 'FORBIDDEN');
    }

    const kind =
      rank === 'regional_manager' ? 'region' : rank === 'team_leader' ? 'team' : 'organisation';

    const userIds =
      kind === 'organisation'
        ? await organisationRepository.listMemberIds(org.company.id)
        : await organisationRepository.listDownlineMemberIds(org.company.id, userId);

    return { company: org.company, kind, rank, userIds };
  },

  /**
   * Members visible in the caller's management scope, with role permissions for rank checks.
   */
  async listScopedMemberRecords(
    userId: string,
    scope?: ManagementScope
  ): Promise<ScopedMemberRecord[]> {
    const resolved = scope ?? (await this.resolveManagementScope(userId));
    const members = await organisationRepository.listMembers(resolved.company.id, resolved.userIds);
    const roles = await organisationRepository.listRoles(resolved.company.id);
    const permissionsByRole = new Map<string, string[]>();
    await Promise.all(
      roles.map(async (role) => {
        permissionsByRole.set(role.id, await organisationRepository.listRolePermissionKeys(role.id));
      })
    );

    return members.map((member) => ({
      id: member.id,
      firstName: member.first_name,
      lastName: member.last_name,
      roleName: member.role_name,
      roleId: member.company_role_id,
      reportsToUserId: member.reports_to_user_id,
      isPlatformAdmin: member.is_platform_admin,
      permissions: member.company_role_id
        ? permissionsByRole.get(member.company_role_id) ?? []
        : [],
    }));
  },

  /**
   * Loads company-wide members for reporting-line labels, then scoped rows for the table.
   */
  async loadMemberContext(userId: string): Promise<MemberContext> {
    const scope = await this.resolveManagementScope(userId);
    const companyMembers = await organisationRepository.listMembers(scope.company.id);
    const roles = await organisationRepository.listRoles(scope.company.id);
    const permissionsByRole = new Map<string, string[]>();
    await Promise.all(
      roles.map(async (role) => {
        permissionsByRole.set(role.id, await organisationRepository.listRolePermissionKeys(role.id));
      })
    );
    const scopedMembers = companyMembers.filter((row) => scope.userIds.includes(row.id));
    const [regions, teams] = await Promise.all([
      organisationStructureRepository.listRegions(scope.company.id),
      organisationStructureRepository.listTeams(scope.company.id),
    ]);
    return { actorUserId: userId, scope, companyMembers, scopedMembers, permissionsByRole, regions, teams };
  },

  /**
   * Platform-admin context for a customer company (not the actor's own organisation).
   */
  async loadCustomerAdminContext(actorUserId: string, companyId: string): Promise<MemberContext> {
    if (!(await this.isPlatformAdmin(actorUserId))) {
      throw new AppError(403, 'Platform admin access required', 'FORBIDDEN');
    }
    const company = await organisationRepository.findCompanyById(companyId);
    if (!company) {
      throw new AppError(404, 'Company not found', 'NOT_FOUND');
    }
    if (company.is_platform) {
      throw new AppError(400, 'The AdvisorTrack platform company is not a customer account', 'NOT_A_CUSTOMER');
    }
    await organisationRepository.ensureCustomerHierarchyRoles(companyId);
    const companyMembers = await organisationRepository.listMembers(companyId);
    const roles = await organisationRepository.listRoles(companyId);
    const permissionsByRole = new Map<string, string[]>();
    await Promise.all(
      roles.map(async (role) => {
        permissionsByRole.set(role.id, await organisationRepository.listRolePermissionKeys(role.id));
      })
    );
    const [regions, teams] = await Promise.all([
      organisationStructureRepository.listRegions(companyId),
      organisationStructureRepository.listTeams(companyId),
    ]);
    const userIds = companyMembers.map((row) => row.id);
    return {
      actorUserId,
      scope: {
        company: {
          id: company.id,
          name: company.name,
          slug: company.slug,
          seatLimit: company.seat_limit,
          isPlatform: company.is_platform,
        },
        kind: 'organisation',
        rank: 'platform_admin',
        userIds,
      },
      companyMembers,
      scopedMembers: companyMembers,
      permissionsByRole,
      regions,
      teams,
    };
  },

  async memberContextFor(userId: string, companyId?: string): Promise<MemberContext> {
    if (!companyId) return this.loadMemberContext(userId);
    return this.loadCustomerAdminContext(userId, companyId);
  },

  async listCustomerMembers(actorUserId: string, companyId: string) {
    const ctx = await this.memberContextFor(actorUserId, companyId);
    return ctx.scopedMembers.map((row) => this.toScopedMemberDto(row, ctx, true));
  },

  toScopedMemberDto(row: MemberRow, ctx: MemberContext, includeCompany: boolean) {
    const permissions = row.company_role_id ? ctx.permissionsByRole.get(row.company_role_id) ?? [] : [];
    const rank = rankForMemberRow(row, permissions);
    const { team, region } = placementForMember(
      { id: row.id, reportsToUserId: row.reports_to_user_id },
      rank,
      ctx.regions,
      ctx.teams
    );
    const licensed = licenceStatusLabel(row.package_slug, row.subscription_status) === 'Licensed';
    return toManagedMemberDto(row, {
      rank,
      team,
      region,
      actions: permittedActionsFor({
        actorUserId: ctx.actorUserId,
        actorRank: ctx.scope.rank,
        memberId: row.id,
        memberRank: rank,
        isPlatformAdmin: row.is_platform_admin,
        isActive: row.is_active,
        licensed,
      }),
      company: includeCompany ? ctx.scope.company : undefined,
    });
  },

  async resolvePlacementReportsTo(
    ctx: MemberContext,
    nextRank: HierarchyRank,
    input: {
      teamId?: string | null;
      regionId?: string | null;
      reportsToUserId?: string | null;
      keepExistingReportsTo?: boolean;
    }
  ): Promise<string | null> {
    if (input.teamId) {
      const team = await this.requireScopedTeam(ctx, input.teamId);
      if (nextRank === 'financial_advisor') {
        if (input.regionId && team.region_id !== input.regionId) {
          throw new AppError(400, 'Team does not belong to the selected region', 'INVALID_TEAM');
        }
        if (!team.is_active) {
          throw new AppError(400, 'Cannot assign a user to an archived team', 'TEAM_ARCHIVED');
        }
        if (!team.leader_user_id) {
          throw new AppError(400, 'Assign a Team Leader to this team before adding advisors', 'TEAM_HAS_NO_LEADER');
        }
        return team.leader_user_id;
      }
      if (nextRank === 'team_leader') {
        const regionId = input.regionId || team.region_id;
        const region =
          ctx.regions.find((row) => row.id === regionId) ??
          (await organisationStructureRepository.findRegion(ctx.scope.company.id, regionId));
        if (!region?.manager_user_id) {
          throw new AppError(
            400,
            'Assign a Regional Manager to this region before assigning a Team Leader',
            'REGION_HAS_NO_MANAGER'
          );
        }
        return region.manager_user_id;
      }
    }

    if (input.regionId) {
      const region = await this.requireScopedRegion(ctx, input.regionId);
      if (nextRank === 'financial_advisor' && !input.teamId) {
        if (!region.manager_user_id) {
          throw new AppError(400, 'Assign a Regional Manager to this region first', 'REGION_HAS_NO_MANAGER');
        }
        return region.manager_user_id;
      }
      if (nextRank === 'team_leader' && !input.teamId) {
        if (!region.manager_user_id) {
          throw new AppError(400, 'Assign a Regional Manager to this region first', 'REGION_HAS_NO_MANAGER');
        }
        return region.manager_user_id;
      }
      if (nextRank === 'regional_manager') {
        const executive = ctx.companyMembers.find((member) => {
          const permissions = member.company_role_id
            ? ctx.permissionsByRole.get(member.company_role_id) ?? []
            : [];
          return rankForMemberRow(member, permissions) === 'executive';
        });
        return executive?.id ?? (ctx.scope.rank === 'executive' ? ctx.actorUserId : null);
      }
    }

    if (input.keepExistingReportsTo) {
      return input.reportsToUserId ?? null;
    }
    if (input.reportsToUserId !== undefined && input.teamId === undefined && input.regionId === undefined) {
      return input.reportsToUserId;
    }
    return this.defaultReportsTo(ctx.actorUserId, nextRank, ctx);
  },

  async applyStructureAssignment(
    ctx: MemberContext,
    memberId: string,
    nextRank: HierarchyRank,
    input: { regionId?: string | null; teamId?: string | null }
  ): Promise<void> {
    try {
      if (nextRank === 'regional_manager' && input.regionId) {
        const region = await this.requireScopedRegion(ctx, input.regionId);
        const executive = ctx.companyMembers.find((member) => {
          const permissions = member.company_role_id
            ? ctx.permissionsByRole.get(member.company_role_id) ?? []
            : [];
          return rankForMemberRow(member, permissions) === 'executive';
        });
        await organisationStructureRepository.updateRegion(ctx.scope.company.id, region.id, {
          managerUserId: memberId,
        });
        await assignRegionManager({
          companyId: ctx.scope.company.id,
          regionId: region.id,
          managerUserId: memberId,
          executiveUserId: executive?.id ?? (ctx.scope.rank === 'executive' ? ctx.actorUserId : null),
          previousManagerUserId: region.manager_user_id,
        });
      }

      if (nextRank === 'team_leader' && input.teamId) {
        const team = await this.requireScopedTeam(ctx, input.teamId);
        let region = ctx.regions.find((row) => row.id === team.region_id) ?? null;
        const patch: { leaderUserId: string; regionId?: string } = { leaderUserId: memberId };
        if (input.regionId && input.regionId !== team.region_id) {
          const nextRegion = await this.requireScopedRegion(ctx, input.regionId);
          if (!nextRegion.is_active) {
            throw new AppError(400, 'Cannot move a team into an archived region', 'REGION_ARCHIVED');
          }
          patch.regionId = nextRegion.id;
          region = nextRegion;
        }
        await organisationStructureRepository.updateTeam(ctx.scope.company.id, team.id, patch);
        await assignTeamLeader({
          companyId: ctx.scope.company.id,
          teamId: team.id,
          leaderUserId: memberId,
          regionManagerUserId: region?.manager_user_id ?? null,
          previousLeaderUserId: team.leader_user_id,
        });
      }
    } catch (error) {
      throwStructureConflict(error);
    }
  },

  async requireScopedTeam(ctx: MemberContext, teamId: string) {
    const team = await organisationStructureRepository.findTeam(ctx.scope.company.id, teamId);
    if (!team) {
      throw new AppError(400, 'Team does not belong to this company', 'INVALID_TEAM');
    }
    if (ctx.scope.rank === 'regional_manager') {
      const assigned = await organisationStructureRepository.findActiveRegionByManager(
        ctx.scope.company.id,
        ctx.actorUserId
      );
      if (!assigned || team.region_id !== assigned.id) {
        throw new AppError(403, 'Team is outside your authorised scope', 'FORBIDDEN');
      }
    }
    if (ctx.scope.rank === 'team_leader' && team.leader_user_id !== ctx.actorUserId) {
      throw new AppError(403, 'Team is outside your authorised scope', 'FORBIDDEN');
    }
    return team;
  },

  async requireScopedRegion(ctx: MemberContext, regionId: string) {
    const region = await organisationStructureRepository.findRegion(ctx.scope.company.id, regionId);
    if (!region) {
      throw new AppError(400, 'Region does not belong to this company', 'INVALID_REGION');
    }
    if (ctx.scope.rank === 'regional_manager') {
      const assigned = await organisationStructureRepository.findActiveRegionByManager(
        ctx.scope.company.id,
        ctx.actorUserId
      );
      if (!assigned || region.id !== assigned.id) {
        throw new AppError(403, 'Region is outside your authorised scope', 'FORBIDDEN');
      }
    }
    if (ctx.scope.rank === 'team_leader') {
      throw new AppError(403, 'You cannot assign organisation regions', 'FORBIDDEN');
    }
    return region;
  },

  requireMutableMember(ctx: MemberContext, actorUserId: string, memberId: string): MemberRow {
    if (memberId === actorUserId) {
      throw new AppError(403, 'You cannot change your own role or manager here', 'FORBIDDEN');
    }
    if (!ctx.scope.userIds.includes(memberId)) {
      throw new AppError(404, 'Member not found', 'NOT_FOUND');
    }
    const target = ctx.companyMembers.find((row) => row.id === memberId);
    if (!target) {
      throw new AppError(404, 'Member not found', 'NOT_FOUND');
    }
    const permissions = target.company_role_id
      ? ctx.permissionsByRole.get(target.company_role_id) ?? []
      : [];
    const targetRank = rankForMemberRow(target, permissions);
    if (target.is_platform_admin || !canManageRank(ctx.scope.rank, targetRank)) {
      throw new AppError(403, 'You cannot manage this user', 'FORBIDDEN');
    }
    return target;
  },

  async assertAssignableRole(ctx: MemberContext, roleId: string): Promise<HierarchyRank> {
    const role = await organisationRepository.findRole(ctx.scope.company.id, roleId);
    if (!role) {
      throw new AppError(400, 'Role does not belong to this company', 'INVALID_ROLE');
    }
    if (isInternalRoleName(role.name)) {
      throw new AppError(403, 'Internal AdvisorTrack roles cannot be assigned', 'FORBIDDEN');
    }
    const permissions = ctx.permissionsByRole.get(role.id) ??
      (await organisationRepository.listRolePermissionKeys(role.id));
    const nextRank = rankFor({
      isPlatformAdmin: false,
      roleName: role.name,
      permissions,
    });
    if (nextRank === 'platform_admin' || !canManageRank(ctx.scope.rank, nextRank)) {
      throw new AppError(403, 'You cannot assign a role at or above your own', 'FORBIDDEN');
    }
    return nextRank;
  },

  async assertReportsToAllowed(
    ctx: MemberContext,
    input: { memberId: string | null; nextRank: HierarchyRank; reportsToUserId: string | null }
  ): Promise<void> {
    if (input.reportsToUserId == null) {
      if (input.nextRank === 'executive') return;
      throw new AppError(400, 'A reporting-line manager is required for this role', 'INVALID_MANAGER');
    }
    if (input.memberId && input.reportsToUserId === input.memberId) {
      throw new AppError(400, 'A user cannot report to themselves', 'INVALID_MANAGER');
    }
    if (
      input.reportsToUserId !== ctx.actorUserId &&
      !ctx.scope.userIds.includes(input.reportsToUserId)
    ) {
      throw new AppError(403, 'Manager is outside your authorised scope', 'FORBIDDEN');
    }
    const manager = ctx.companyMembers.find((row) => row.id === input.reportsToUserId);
    if (!manager) {
      throw new AppError(400, 'Manager must be in the same company', 'INVALID_MANAGER');
    }
    const managerPermissions = manager.company_role_id
      ? ctx.permissionsByRole.get(manager.company_role_id) ?? []
      : [];
    const managerRank = rankForMemberRow(manager, managerPermissions);
    if (!allowedManagerRanksFor(input.nextRank).includes(managerRank)) {
      throw new AppError(400, 'That reporting line is not valid for this role', 'INVALID_MANAGER');
    }
    if (input.memberId && wouldCreateReportingCycle(input.memberId, input.reportsToUserId, ctx.companyMembers)) {
      throw new AppError(400, 'That reporting line would create a cycle', 'INVALID_MANAGER');
    }
  },

  defaultReportsTo(actorUserId: string, nextRank: HierarchyRank, ctx: MemberContext): string | null {
    if (nextRank === 'executive') {
      return null;
    }
    if (allowedManagerRanksFor(nextRank).includes(ctx.scope.rank)) {
      return actorUserId;
    }
    throw new AppError(400, 'A reporting-line manager is required for this role', 'INVALID_MANAGER');
  },

  async reloadMemberRow(companyId: string, memberId: string): Promise<MemberRow> {
    const members = await organisationRepository.listMembers(companyId);
    const row = members.find((item) => item.id === memberId);
    if (!row) {
      throw new AppError(404, 'Member not found', 'NOT_FOUND');
    }
    return row;
  },

  async resolveLicensedPackageSlug(): Promise<string> {
    const pro = await subscriptionRepository.findPackageBySlug('pro');
    if (pro) return pro.slug;
    const packages = await subscriptionRepository.listActivePackages();
    const paid = packages.find((item) => item.slug !== 'free');
    if (!paid) {
      throw new AppError(500, 'No licence package is configured', 'SUBSCRIPTION_ERROR');
    }
    return paid.slug;
  },

  /**
   * Customer roles cannot use internal names or a rank at/above the actor.
   */
  assertRoleDefinitionAllowed(actorRank: HierarchyRank, name: string, permissions: string[]): void {
    if (isInternalRoleName(name)) {
      throw new AppError(403, 'Internal AdvisorTrack roles cannot be assigned', 'FORBIDDEN');
    }
    const sanitized = this.sanitizePermissions(permissions);
    const implied = rankFor({
      isPlatformAdmin: false,
      roleName: name,
      permissions: sanitized,
    });
    if (!canManageRank(actorRank, implied)) {
      throw new AppError(403, 'You cannot define a role at or above your own', 'FORBIDDEN');
    }
  },

  /**
   * Drops unknown permission keys so companies cannot invent new ones.
   */
  sanitizePermissions(keys: string[]): string[] {
    const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
    const invalid = unique.filter((key) => !isOrganisationPermissionKey(key));
    if (invalid.length > 0) {
      throw new AppError(400, `Unknown permission: ${invalid.join(', ')}`, 'INVALID_PERMISSION');
    }
    return unique;
  },

  /**
   * Loads one role DTO for responses.
   */
  async getRoleDto(companyId: string, roleId: string) {
    const role = await organisationRepository.findRole(companyId, roleId);
    if (!role) {
      throw new AppError(404, 'Role not found', 'NOT_FOUND');
    }
    return {
      id: role.id,
      name: role.name,
      isDefault: role.is_default,
      isSystem: role.is_system,
      permissions: await organisationRepository.listRolePermissionKeys(role.id),
      createdAt: role.created_at.toISOString(),
    };
  },
};
