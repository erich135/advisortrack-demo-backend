import type { TrustedAssistantIdentity } from './context';

export type OrganisationSnapshot = {
  company?: { id: string; name: string } | null;
  permissions?: string[];
  isPlatformAdmin?: boolean;
  isOrganisationAdmin?: boolean;
  canAccessEngineeringChangelog?: boolean;
  hierarchy?: {
    rank?: string | null;
    portalAccess?: boolean;
    scopeKind?: 'organisation' | 'region' | 'team' | null;
    structureAccess?: {
      canViewRegions?: boolean;
      canViewTeams?: boolean;
    };
  } | null;
} | null;

function reportingRankOf(
  rank: string | null | undefined,
): TrustedAssistantIdentity['reportingRank'] {
  if (
    rank === 'executive' ||
    rank === 'regional_manager' ||
    rank === 'team_leader' ||
    rank === 'financial_advisor' ||
    rank === 'platform_admin'
  ) {
    return rank;
  }
  return null;
}

/** Trusted identity from server organisation membership — never from the request body. */
export function trustedIdentityFromOrganisation(
  userId: string,
  organisation: OrganisationSnapshot,
): TrustedAssistantIdentity {
  if (!organisation) {
    return {
      userId,
      companyId: null,
      companyName: null,
      reportingRank: null,
      isOrganisationAdmin: false,
      isPlatformStaff: false,
      portalAccess: false,
      hierarchyScopeKind: null,
      canViewRegions: false,
      canViewTeams: false,
      permissions: [],
      canAccessEngineeringChangelog: false,
    };
  }

  const rank = reportingRankOf(organisation.hierarchy?.rank);
  const isStaff = Boolean(organisation.isPlatformAdmin);
  return {
    userId,
    companyId: organisation.company?.id ?? null,
    companyName: organisation.company?.name ?? null,
    reportingRank: rank,
    isOrganisationAdmin: Boolean(organisation.isOrganisationAdmin) && !isStaff,
    isPlatformStaff: isStaff,
    portalAccess: organisation.hierarchy
      ? Boolean(organisation.hierarchy.portalAccess)
      : isStaff,
    hierarchyScopeKind: organisation.hierarchy?.scopeKind ?? null,
    canViewRegions: Boolean(organisation.hierarchy?.structureAccess?.canViewRegions),
    canViewTeams: Boolean(organisation.hierarchy?.structureAccess?.canViewTeams),
    permissions: organisation.permissions ?? [],
    canAccessEngineeringChangelog: Boolean(organisation.canAccessEngineeringChangelog),
  };
}
