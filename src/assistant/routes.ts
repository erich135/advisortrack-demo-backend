import type { AssistantRoute } from './types';

/**
 * Route registry derived from production and demo frontend App.tsx, main.tsx,
 * portalNavigation.ts, and Layout titles. Query tabs reuse /users — no invented paths.
 */
export const ASSISTANT_ROUTES: AssistantRoute[] = [
  {
    routeId: 'activate',
    path: '/activate',
    label: 'Set up your AdvisorTrack portal account',
    environment: 'both',
    classification: 'customer',
    productionCapability: null,
  },
  {
    routeId: 'dashboard',
    path: '/',
    label: 'Dashboard',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewDashboard',
  },
  {
    routeId: 'team-pipeline',
    path: '/team-pipeline',
    label: 'Team Pipeline',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewPipeline',
  },
  {
    routeId: 'advisors',
    path: '/advisors',
    label: 'Advisors',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewAdvisors',
  },
  {
    routeId: 'advisor-detail',
    path: '/advisors/:id',
    label: 'Advisor details',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewAdvisors',
  },
  {
    routeId: 'production',
    path: '/production',
    label: 'Production',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewProduction',
  },
  {
    routeId: 'users',
    path: '/users',
    label: 'Users & Access',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewUsers',
  },
  {
    routeId: 'users-regions',
    path: '/users?tab=regions',
    label: 'Regions & Teams',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewRegionsTeams',
  },
  {
    routeId: 'users-teams',
    path: '/users?tab=teams',
    label: 'Teams',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewRegionsTeams',
  },
  {
    routeId: 'licences',
    path: '/licences',
    label: 'Licences',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewLicences',
  },
  {
    routeId: 'bulk-import',
    path: '/bulk-import',
    label: 'Bulk Import',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canBulkImport',
  },
  {
    routeId: 'settings',
    path: '/settings',
    label: 'Settings & Roles',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewSettings',
  },
  {
    routeId: 'subscription',
    path: '/subscription',
    label: 'Subscription',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewSubscription',
  },
  {
    routeId: 'invoices',
    path: '/invoices',
    label: 'Invoices',
    environment: 'both',
    classification: 'customer',
    productionCapability: 'canViewInvoices',
  },
  {
    routeId: 'performance',
    path: '/performance',
    label: 'Performance',
    environment: 'both',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
    demoCapability: 'canViewPerformance',
    demoLabel: 'Performance',
  },
  {
    routeId: 'audit',
    path: '/audit',
    label: 'Audit',
    environment: 'both',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
    demoCapability: 'canViewAudit',
    demoLabel: 'Audit',
  },
  {
    routeId: 'companies',
    path: '/companies',
    label: 'Companies',
    environment: 'both',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
    demoCapability: 'canViewSettings',
    demoLabel: 'Company Details',
  },
  {
    routeId: 'company-account',
    path: '/companies/:companyId',
    label: 'Customer account',
    environment: 'both',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
  },
  {
    routeId: 'subscriptions-platform',
    path: '/subscriptions',
    label: 'Subscriptions',
    environment: 'both',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
    demoCapability: 'canViewSettings',
  },
  {
    routeId: 'support',
    path: '/support',
    label: 'Support',
    environment: 'both',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
  },
  {
    routeId: 'enterprise-customers',
    path: '/enterprise-customers',
    label: 'Enterprise Customers',
    environment: 'production',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
  },
  {
    routeId: 'enterprise-customer-onboarding',
    path: '/enterprise-customers/:onboardingId',
    label: 'Enterprise customer onboarding',
    environment: 'production',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
  },
  {
    routeId: 'licence-requests',
    path: '/licence-requests',
    label: 'Licence Requests',
    environment: 'production',
    classification: 'internal',
    productionCapability: 'isPlatformStaff',
  },
  {
    routeId: 'engineering-changelog',
    path: '/engineering/changelog',
    label: 'Change Log',
    environment: 'production',
    classification: 'internal',
    productionCapability: 'canAccessEngineeringChangelog',
  },
  {
    routeId: 'team-pipeline-demo',
    path: '/team-pipeline-demo',
    label: 'Team Pipeline',
    environment: 'production',
    classification: 'internal',
    productionCapability: null,
  },
];

export const ROUTE_IDS = ASSISTANT_ROUTES.map((route) => route.routeId);

export function routeById(routeId: string): AssistantRoute | undefined {
  return ASSISTANT_ROUTES.find((route) => route.routeId === routeId);
}

export function capabilityForRoute(route: AssistantRoute, environment: 'production' | 'demo'): string | null {
  if (environment === 'demo' && route.demoCapability !== undefined) {
    return route.demoCapability;
  }
  return route.productionCapability;
}

export function classificationForRoute(
  route: AssistantRoute,
  environment: 'production' | 'demo',
): 'customer' | 'internal' | 'demo' {
  if (environment === 'demo' && (route.routeId === 'performance' || route.routeId === 'audit')) {
    return 'customer';
  }
  if (environment === 'demo' && route.routeId === 'companies') {
    return 'customer';
  }
  return route.classification;
}

export function labelForRoute(route: AssistantRoute, environment: 'production' | 'demo'): string {
  if (environment === 'demo' && route.demoLabel) return route.demoLabel;
  return route.label;
}
