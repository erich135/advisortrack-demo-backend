/**
 * Customer management hierarchy for the web portal.
 * Internal staff are identified only by users.is_platform_admin, never by a
 * customer-assignable role name.
 */
export const HIERARCHY_RANKS = {
  platform_admin: 0,
  executive: 1,
  regional_manager: 2,
  team_leader: 3,
  financial_advisor: 4,
} as const;

export type HierarchyRank = keyof typeof HIERARCHY_RANKS;

export type ManagementScopeKind = 'organisation' | 'region' | 'team';

export const RANK_LABELS: Record<HierarchyRank, string> = {
  platform_admin: 'App Admin',
  executive: 'Executive',
  regional_manager: 'Regional Manager',
  team_leader: 'Team Leader',
  financial_advisor: 'Financial Advisor',
};

const ROLE_NAME_ALIASES: Record<string, HierarchyRank> = {
  executive: 'executive',
  'company admin': 'executive',
  'senior management': 'executive',
  'regional manager': 'regional_manager',
  'region manager': 'regional_manager',
  'team leader': 'team_leader',
  'team manager': 'team_leader',
  supervisor: 'team_leader',
  advisor: 'financial_advisor',
  'financial advisor': 'financial_advisor',
};

const INTERNAL_ROLE_NAMES = new Set([
  'app admin',
  'app manager',
  'founder/admin',
  'founder admin',
  'founder',
  'platform admin',
  'advisortrack admin',
]);

const HIERARCHY_ROLE_SEED = [
  {
    name: 'Executive',
    permissions: ['view_company', 'view_team', 'manage_roles', 'manage_members', 'manage_company'],
  },
  {
    name: 'Regional Manager',
    permissions: ['view_team', 'manage_members'],
  },
  {
    name: 'Team Leader',
    permissions: ['view_team', 'manage_members'],
  },
  {
    name: 'Financial Advisor',
    permissions: [] as string[],
  },
] as const;

/**
 * Canonical customer hierarchy roles seeded onto each company (data, not a migration).
 */
export const CUSTOMER_HIERARCHY_ROLE_SEED = HIERARCHY_ROLE_SEED;

const normalizeName = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * True when the name is reserved for AdvisorTrack internal staff.
 */
export const isInternalRoleName = (name: string): boolean =>
  INTERNAL_ROLE_NAMES.has(normalizeName(name));

/**
 * Maps a company role name to a hierarchy rank, or null when unknown.
 */
export const rankFromRoleName = (roleName: string | null | undefined): HierarchyRank | null => {
  if (!roleName?.trim()) return null;
  if (isInternalRoleName(roleName)) return null;
  return ROLE_NAME_ALIASES[normalizeName(roleName)] ?? null;
};

/**
 * Resolves the caller's hierarchy rank from the platform-admin flag, role name, then permissions.
 */
export const resolveHierarchyRank = (input: {
  isPlatformAdmin: boolean;
  roleName: string | null | undefined;
  permissions: string[];
}): HierarchyRank => {
  if (input.isPlatformAdmin) return 'platform_admin';
  const named = rankFromRoleName(input.roleName);
  if (named) return named;
  if (input.permissions.includes('view_company') || input.permissions.includes('manage_company')) {
    return 'executive';
  }
  if (input.permissions.includes('view_team') || input.permissions.includes('manage_members')) {
    return 'team_leader';
  }
  return 'financial_advisor';
};

/**
 * Rank whose issued totals this leadership role compares on Top/Worst Performer.
 */
export const comparisonRankFor = (rank: HierarchyRank): HierarchyRank | null => {
  switch (rank) {
    case 'platform_admin':
    case 'executive':
      return 'regional_manager';
    case 'regional_manager':
      return 'team_leader';
    case 'team_leader':
      return 'financial_advisor';
    default:
      return null;
  }
};

/**
 * Visibility kind for management APIs. Advisors have no management scope.
 */
export const scopeKindFor = (rank: HierarchyRank): ManagementScopeKind | null => {
  switch (rank) {
    case 'platform_admin':
    case 'executive':
      return 'organisation';
    case 'regional_manager':
      return 'region';
    case 'team_leader':
      return 'team';
    default:
      return null;
  }
};

/**
 * True when the actor may assign or manage the target rank.
 * Platform admins may manage every customer rank, never grant platform admin.
 */
export const canManageRank = (actor: HierarchyRank, target: HierarchyRank): boolean => {
  if (actor === 'platform_admin') {
    return target !== 'platform_admin';
  }
  return HIERARCHY_RANKS[actor] < HIERARCHY_RANKS[target];
};

/**
 * True when the rank may use the management portal (not an individual Advisor dashboard).
 */
export const hasPortalAccess = (rank: HierarchyRank): boolean => rank !== 'financial_advisor';

/**
 * Customer ranks the actor may assign or manage.
 */
export const ranksAssignableBy = (actor: HierarchyRank): HierarchyRank[] =>
  (Object.keys(HIERARCHY_RANKS) as HierarchyRank[]).filter((rank) => canManageRank(actor, rank));

/**
 * Ranks allowed to be a reporting-line manager for the target rank.
 */
export const allowedManagerRanksFor = (target: HierarchyRank): HierarchyRank[] => {
  switch (target) {
    case 'financial_advisor':
      return ['team_leader', 'regional_manager', 'executive', 'platform_admin'];
    case 'team_leader':
      return ['regional_manager', 'executive', 'platform_admin'];
    case 'regional_manager':
      return ['executive', 'platform_admin'];
    default:
      return [];
  }
};

/**
 * Public hierarchy snapshot attached to /company/me.
 */
export const toHierarchyDto = (rank: HierarchyRank) => {
  const comparison = comparisonRankFor(rank);
  return {
    rank,
    label: RANK_LABELS[rank],
    comparisonRank: comparison,
    comparisonRoleLabel: comparison ? RANK_LABELS[comparison] : null,
    portalAccess: hasPortalAccess(rank),
    scopeKind: scopeKindFor(rank),
    structureAccess: structureAccessFor(rank),
  };
};

/**
 * Who may view or edit organisation structure (regions / teams).
 */
export const structureAccessFor = (rank: HierarchyRank) => ({
  canViewRegions:
    rank === 'platform_admin' || rank === 'executive' || rank === 'regional_manager',
  canManageRegions: rank === 'platform_admin' || rank === 'executive',
  canViewTeams: hasPortalAccess(rank),
  canManageTeams:
    rank === 'platform_admin' || rank === 'executive' || rank === 'regional_manager',
});
