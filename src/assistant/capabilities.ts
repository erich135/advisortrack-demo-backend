import type { AssistantCapability } from './types';

/**
 * Assistant capability keys are aliases for existing portal/backend helpers.
 * They do not create a second permission model.
 */
export const ASSISTANT_CAPABILITIES: AssistantCapability[] = [
  {
    key: 'canViewLicences',
    helper: 'hasOrganisationAdminAccess',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Licences page. Production and demo: platform admin, Organisation Admin, manage_members, or leadership portal access.',
  },
  {
    key: 'canManageMembers',
    helper: "permissions includes 'manage_members' (or platform / Organisation Admin)",
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend', 'advisor_track_backend'],
    description: 'Create, edit, deactivate members and assign licences when the API also allows it.',
  },
  {
    key: 'canBulkImport',
    helper: 'canBulkImportMembers',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Bulk Import. Platform admin, Organisation Admin, or explicit manage_members. Leadership portal access alone is not enough.',
  },
  {
    key: 'canViewSubscription',
    helper: 'canViewCompanySubscription',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Customer Subscription page. Production: Organisation Admin or platform admin. Demo also allows Executive for showcase.',
  },
  {
    key: 'canViewInvoices',
    helper: 'canViewCompanyInvoices',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Customer Invoices page. Production: Organisation Admin or platform admin. Demo also allows Executive for showcase.',
  },
  {
    key: 'canViewRegionsTeams',
    helper: 'canViewRegionsAndTeams',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Regions & Teams. Driven by hierarchy.structureAccess, not reporting rank alone. Team Leaders do not get the Teams tab.',
  },
  {
    key: 'canViewPerformance',
    helper: 'production: session.isPlatformAdmin; demo: hasLeadershipPortalAccess',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Performance page. Production Management Portal is staff-only. Public demo exposes it to leadership.',
  },
  {
    key: 'canViewAudit',
    helper: 'production: session.isPlatformAdmin; demo: isCustomerAuditViewer',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Audit. Production is staff-only. Demo allows Executive and Regional Manager.',
  },
  {
    key: 'canViewPipeline',
    helper: 'hasLeadershipPortalAccess',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description: 'Team Pipeline. Leadership ranks with hierarchy portalAccess, or platform admin.',
  },
  {
    key: 'canViewAdvisors',
    helper: 'hasLeadershipPortalAccess',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description: 'Advisors list and advisor details. Same leadership portal guard as Team Pipeline and Production.',
  },
  {
    key: 'canViewProduction',
    helper: 'hasLeadershipPortalAccess',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description: 'Production page. Leadership portal access — not a separate permission flag.',
  },
  {
    key: 'canViewUsers',
    helper: 'hasOrganisationAdminAccess',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description: 'Users & Access. Organisation Admin, manage_members, leadership, or platform admin.',
  },
  {
    key: 'canViewSettings',
    helper: 'isCustomerExecutive (production also allows platform admin)',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description: 'Settings & Roles. Customer Executive, and in production also platform admin.',
  },
  {
    key: 'canViewDashboard',
    helper: 'authenticated Management Portal session (route is ungated once signed in)',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend'],
    description:
      'Dashboard is reachable to anyone who can sign into the portal. Ordinary Financial Advisors do not; Organisation Admin is a separate portal grant.',
  },
  {
    key: 'isOrganisationAdmin',
    helper: 'isOrganisationAdmin / session.isOrganisationAdmin',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend', 'advisor_track_backend'],
    description:
      'Company-scoped Organisation Admin grant. Not a reporting rank and not users.role.',
  },
  {
    key: 'isPlatformStaff',
    helper: 'session.isPlatformAdmin',
    repositories: ['Advisor-Track-Dashboard', 'advisortrack-demo-frontend', 'advisor_track_backend'],
    description: 'AdvisorTrack internal staff. Never a customer-assignable role name.',
  },
  {
    key: 'canAccessEngineeringChangelog',
    helper: 'session.canAccessEngineeringChangelog',
    repositories: ['Advisor-Track-Dashboard', 'advisor_track_backend'],
    description: 'Engineering Change Log. Production staff tool. Never exposed on the public demo.',
  },
];

export const CAPABILITY_KEYS = ASSISTANT_CAPABILITIES.map((capability) => capability.key);
