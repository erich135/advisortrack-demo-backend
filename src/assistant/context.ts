/**
 * AdvisorTrack Assistant A4 context — canonical, read-only, no persistence.
 * Identity/role/permissions come from a trusted session snapshot.
 * Navigation may supply pathname/search only.
 */
import { CAPABILITY_KEYS } from './capabilities';
import { ASSISTANT_ROUTES, capabilityForRoute, labelForRoute } from './routes';
import type { AssistantRoute, CardEnvironment } from './types';

export type AssistantEnvironment = 'production' | 'demo';
export type ReportingRole = 'executive' | 'regional_manager' | 'team_leader' | 'financial_advisor';
export type AssistantScopeKind = 'company' | 'region' | 'team' | 'self' | 'platform';

/** Client-provided navigation. Security-sensitive fields here are ignored. */
export type AssistantNavigation = {
  pathname: string;
  search?: string;
  companyId?: unknown;
  role?: unknown;
  isOrganisationAdmin?: unknown;
  isPlatformStaff?: unknown;
  permissions?: unknown;
};

/**
 * Trusted identity snapshot. Callers must populate this from authenticated
 * session/backend helpers — never from URL, email domain, or request body.
 */
export type TrustedAssistantIdentity = {
  userId: string;
  companyId: string | null;
  companyName: string | null;
  reportingRank: ReportingRole | 'platform_admin' | null;
  isOrganisationAdmin: boolean;
  isPlatformStaff: boolean;
  /** Existing hierarchy.portalAccess — leadership portal, not “any portal screen”. */
  portalAccess: boolean;
  hierarchyScopeKind: 'organisation' | 'region' | 'team' | null;
  canViewRegions: boolean;
  canViewTeams: boolean;
  permissions: string[];
  canAccessEngineeringChangelog: boolean;
};

export type AssistantLicencePool = {
  purchased: number | null;
  assigned: number;
  available: number | null;
};

export type AssistantContext = {
  environment: AssistantEnvironment;
  identity: {
    userId: string;
    companyId: string | null;
    companyName: string | null;
  };
  role: {
    reportingRole: ReportingRole | null;
    isOrganisationAdmin: boolean;
    isPlatformStaff: boolean;
    advisorUsesMobileApp: boolean;
    hasAnyPortalAccess: boolean;
    hasLeadershipPortalAccess: boolean;
    scopeKind: AssistantScopeKind | null;
  };
  capabilities: Record<string, boolean>;
  route: {
    routeId: string | null;
    path: string;
    tab: string | null;
    query: Record<string, string>;
  };
  facts?: {
    licencePool?: AssistantLicencePool;
  };
};

export type AssistantRouteRef = Pick<AssistantRoute, 'routeId' | 'path' | 'environment'>;

function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function parseQuery(search?: string): Record<string, string> {
  const raw = (search ?? '').startsWith('?') ? search!.slice(1) : (search ?? '');
  const params = new URLSearchParams(raw);
  const query: Record<string, string> = {};
  params.forEach((value, key) => {
    query[key] = value;
  });
  return query;
}

function pathMatches(patternPath: string, pathname: string): boolean {
  if (patternPath === pathname) return true;
  const patternParts = patternPath.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

function routeScore(routePath: string): number {
  const [pathname, queryString] = routePath.split('?');
  const staticParts = (pathname || '/').split('/').filter((part) => part && !part.startsWith(':')).length;
  const queryKeys = queryString ? queryString.split('&').length : 0;
  return staticParts * 10 + queryKeys * 5;
}

export function resolveAssistantRoute(
  routes: AssistantRouteRef[],
  navigation: Pick<AssistantNavigation, 'pathname' | 'search'>,
  environment: AssistantEnvironment,
): AssistantContext['route'] {
  const pathname = normalizePathname(navigation.pathname || '/');
  const query = parseQuery(navigation.search);
  const tab = query.tab ?? null;

  const ranked = [...routes]
    .filter((route) => route.environment === 'both' || route.environment === environment)
    .sort((left, right) => routeScore(right.path) - routeScore(left.path));

  for (const route of ranked) {
    const [patternPath, patternQuery] = route.path.split('?');
    if (!pathMatches(patternPath || '/', pathname)) continue;
    if (patternQuery) {
      const required = new URLSearchParams(patternQuery);
      let matches = true;
      required.forEach((value, key) => {
        if (query[key] !== value) matches = false;
      });
      if (!matches) continue;
    } else if (route.routeId === 'users' && (tab === 'regions' || tab === 'teams')) {
      continue;
    }
    return { routeId: route.routeId, path: pathname, tab, query };
  }

  return { routeId: null, path: pathname, tab, query };
}

function emptyCapabilities(): Record<string, boolean> {
  return Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, false]));
}

/**
 * Mirrors existing portalAccess helpers. Does not invent a second permission model.
 */
export function capabilitiesFromIdentity(
  identity: TrustedAssistantIdentity,
  environment: AssistantEnvironment,
): Record<string, boolean> {
  const capabilities = emptyCapabilities();
  const rank = identity.reportingRank;
  const isStaff = environment === 'production' && identity.isPlatformStaff;
  const demoLeadership =
    rank === 'executive' || rank === 'regional_manager' || rank === 'team_leader';
  const leadership =
    environment === 'demo' ? demoLeadership : !isStaff && identity.portalAccess;
  const orgAdminAccess =
    isStaff || identity.isOrganisationAdmin || identity.permissions.includes('manage_members') || leadership;
  const manageMembers =
    isStaff || identity.isOrganisationAdmin || identity.permissions.includes('manage_members');
  const regionsTeams =
    identity.canViewRegions || (identity.canViewTeams && rank !== 'team_leader');

  capabilities.canViewDashboard = isStaff || identity.portalAccess || identity.isOrganisationAdmin;
  capabilities.canViewUsers = orgAdminAccess;
  capabilities.canManageMembers = manageMembers;
  capabilities.canBulkImport = manageMembers;
  capabilities.canViewRegionsTeams = regionsTeams;
  capabilities.canViewLicences = orgAdminAccess;
  capabilities.canViewPipeline = leadership;
  capabilities.canViewAdvisors = leadership;
  capabilities.canViewProduction = leadership;
  capabilities.canViewPerformance = leadership;
  capabilities.canViewAudit =
    environment === 'demo' ? rank === 'executive' || rank === 'regional_manager' : isStaff;
  capabilities.canViewSubscription =
    isStaff || identity.isOrganisationAdmin || (environment === 'demo' && rank === 'executive');
  capabilities.canViewInvoices =
    isStaff || identity.isOrganisationAdmin || (environment === 'demo' && rank === 'executive');
  capabilities.canViewSettings = rank === 'executive' || (environment === 'production' && isStaff);
  capabilities.isOrganisationAdmin = identity.isOrganisationAdmin;
  capabilities.isPlatformStaff = isStaff;
  capabilities.canAccessEngineeringChangelog =
    environment === 'production' && identity.canAccessEngineeringChangelog;

  return capabilities;
}

export function reportingRoleOf(
  rank: TrustedAssistantIdentity['reportingRank'],
): ReportingRole | null {
  if (rank === 'executive' || rank === 'regional_manager' || rank === 'team_leader' || rank === 'financial_advisor') {
    return rank;
  }
  return null;
}

/** Advisor operational work happens in Android. Organisation Admin does not change this. */
export function advisorUsesMobileAppOf(identity: TrustedAssistantIdentity): boolean {
  return reportingRoleOf(identity.reportingRank) === 'financial_advisor';
}

/** Existing hasLeadershipPortalAccess: customer reporting ranks with hierarchy.portalAccess. Production staff never inherit this. */
export function hasLeadershipPortalAccessOf(
  identity: TrustedAssistantIdentity,
  environment: AssistantEnvironment,
): boolean {
  if (environment === 'production' && identity.isPlatformStaff) return false;
  if (environment === 'demo') {
    const rank = reportingRoleOf(identity.reportingRank);
    return rank === 'executive' || rank === 'regional_manager' || rank === 'team_leader';
  }
  return identity.portalAccess;
}

/**
 * May use any Management Portal administration surface already granted
 * (leadership, Organisation Admin, manage_members, or staff).
 */
export function hasAnyPortalAccessOf(
  identity: TrustedAssistantIdentity,
  environment: AssistantEnvironment,
): boolean {
  if (environment === 'production' && identity.isPlatformStaff) return true;
  if (identity.isOrganisationAdmin) return true;
  if (identity.permissions.includes('manage_members')) return true;
  return hasLeadershipPortalAccessOf(identity, environment);
}

export function scopeKindOf(identity: TrustedAssistantIdentity): AssistantScopeKind | null {
  if (identity.isPlatformStaff && !identity.companyId) return 'platform';
  if (identity.reportingRank === 'financial_advisor') return 'self';
  if (identity.hierarchyScopeKind === 'organisation') return 'company';
  if (identity.hierarchyScopeKind === 'region') return 'region';
  if (identity.hierarchyScopeKind === 'team') return 'team';
  if (identity.isPlatformStaff) return 'platform';
  return null;
}

export function buildAssistantContext(input: {
  environment: AssistantEnvironment;
  identity: TrustedAssistantIdentity;
  navigation: AssistantNavigation;
  routes?: AssistantRouteRef[];
}): AssistantContext {
  const { environment, identity, navigation } = input;
  const routes = input.routes ?? ASSISTANT_ROUTES;
  return {
    environment,
    identity: {
      userId: identity.userId,
      companyId: identity.companyId,
      companyName: identity.companyName,
    },
    role: {
      reportingRole: reportingRoleOf(identity.reportingRank),
      isOrganisationAdmin: identity.isOrganisationAdmin,
      isPlatformStaff: environment === 'production' && identity.isPlatformStaff,
      advisorUsesMobileApp: advisorUsesMobileAppOf(identity),
      hasAnyPortalAccess: hasAnyPortalAccessOf(identity, environment),
      hasLeadershipPortalAccess: hasLeadershipPortalAccessOf(identity, environment),
      scopeKind: scopeKindOf({
        ...identity,
        isPlatformStaff: environment === 'production' && identity.isPlatformStaff,
      }),
    },
    capabilities: capabilitiesFromIdentity(identity, environment),
    route: resolveAssistantRoute(routes, navigation, environment),
  };
}

export function withLicenceFacts(
  context: AssistantContext,
  pool: AssistantLicencePool | null | undefined,
): AssistantContext {
  if (!context.capabilities.canViewLicences || !pool) {
    if (!context.facts) return context;
    const next = { ...context };
    delete next.facts;
    return next;
  }
  return {
    ...context,
    facts: {
      licencePool: {
        purchased: pool.purchased,
        assigned: pool.assigned,
        available: pool.available,
      },
    },
  };
}

export function alreadyOnRouteMessage(route: AssistantRoute, environment: AssistantEnvironment): string {
  return `You're already on the ${labelForRoute(route, environment)} page.`;
}

export function contextAudience(context: AssistantContext): 'customer' | 'staff' {
  return context.role.isPlatformStaff ? 'staff' : 'customer';
}

export function cardMatchesCapabilities(
  requiredCapabilities: string[],
  capabilities: Record<string, boolean>,
): boolean {
  return requiredCapabilities.every((key) => capabilities[key] === true);
}

export function routeReachable(route: AssistantRoute, context: AssistantContext): boolean {
  if (route.environment !== 'both' && route.environment !== context.environment) return false;
  const capability = capabilityForRoute(route, context.environment);
  if (!capability) return context.role.hasAnyPortalAccess;
  return context.capabilities[capability] === true;
}

export type { CardEnvironment };
