/**
 * Trusted AdvisorTrack product map — how existing product areas relate.
 * Versioned, workspace-aware, customer-safe. Does not duplicate business rules.
 */
import type { AssistantViewport, AssistantWorkspace } from './context';

export const PRODUCT_MAP_VERSION = 'a881.1';

export type { AssistantViewport };

export type ProductMapNode = {
  id: string;
  label: string;
  routeIds: string[];
  summary: string;
  children: string[];
  related: string[];
};

export type ProductMap = {
  version: string;
  workspace: AssistantWorkspace;
  overview: string[];
  nodes: ProductMapNode[];
};

const ADVISOR_NODES: ProductMapNode[] = [
  {
    id: 'home',
    label: 'Home',
    routeIds: ['advisor-home'],
    summary:
      'Home shows monthly progress against your nett goal, weekly activity, a pipeline snapshot, and upcoming work.',
    children: ['planning', 'pipeline', 'activities'],
    related: ['production', 'contacts'],
  },
  {
    id: 'contacts',
    label: 'Contacts',
    routeIds: ['advisor-contacts', 'advisor-contact-detail'],
    summary:
      'Contacts is the people in your own book. Add or edit a person, then schedule an activity or open a case. A Lost outcome can make a contact inactive, which is why someone may disappear from the active list.',
    children: ['activities', 'pipeline'],
    related: ['home', 'subscription'],
  },
  {
    id: 'activities',
    label: 'Activities',
    routeIds: ['advisor-activities', 'advisor-activity-detail'],
    summary:
      'Activities covers calls, meetings, emails and follow-ups. Record an outcome with Proceed, Lost or Complete.',
    children: ['pipeline'],
    related: ['contacts', 'home'],
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    routeIds: ['advisor-pipeline', 'advisor-case-detail'],
    summary:
      'Pipeline is your own cases across six advice stages: Initial contact, Fact-finding, Analysis & quotes, Recommendation, Implementation, and Review & servicing. Open a case for FICA, documents, quotes, next action and production status.',
    children: ['production'],
    related: ['contacts', 'activities', 'home'],
  },
  {
    id: 'production',
    label: 'Production',
    routeIds: ['advisor-production'],
    summary:
      'Production tracks submitted and issued business, including underwriting statuses such as Pending underwriting and Accepted / Issued.',
    children: [],
    related: ['pipeline', 'home', 'planning'],
  },
  {
    id: 'planning',
    label: 'Planning',
    routeIds: ['advisor-planning'],
    summary:
      'Planning holds your monthly nett goal, weekly activity targets, conversion assumptions and target progress.',
    children: [],
    related: ['home', 'settings', 'profile'],
  },
  {
    id: 'profile',
    label: 'Profile',
    routeIds: ['advisor-profile'],
    summary: 'Profile is your own advisor details and financial settings, not a client fact-find.',
    children: [],
    related: ['settings', 'planning'],
  },
  {
    id: 'settings',
    label: 'Settings',
    routeIds: ['advisor-settings'],
    summary: 'General Settings holds conversion ratios and how planning is calculated.',
    children: [],
    related: ['planning', 'profile'],
  },
  {
    id: 'subscription',
    label: 'Subscription',
    routeIds: ['advisor-subscription'],
    summary:
      'Subscription is your personal AdvisorTrack plan and Live Preview. It is not organisation licence seats.',
    children: [],
    related: ['contacts', 'profile'],
  },
  {
    id: 'setup',
    label: 'Setup',
    routeIds: ['advisor-setup'],
    summary: 'Setup asks for monthly nett goal and planning inputs before Advisor Workspace is ready.',
    children: ['planning'],
    related: ['home'],
  },
];

export const ADVISOR_PRODUCT_MAP: ProductMap = {
  version: PRODUCT_MAP_VERSION,
  workspace: 'advisor',
  overview: [
    'Add the person you are working with under Contacts.',
    'Schedule calls, meetings and follow-ups under Activities.',
    'Work the case through the six Pipeline stages.',
    'Submit implemented business to Production and track it through underwriting.',
    'Use Home and Planning to monitor upcoming work and your monthly target.',
  ],
  nodes: ADVISOR_NODES,
};

const MANAGEMENT_NODES: ProductMapNode[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    routeIds: ['dashboard'],
    summary: 'Dashboard is leadership reporting for issued production in your authorised scope.',
    children: ['team-pipeline', 'advisors', 'production'],
    related: [],
  },
  {
    id: 'team-pipeline',
    label: 'Team Pipeline',
    routeIds: ['team-pipeline'],
    summary: 'Team Pipeline is management-scoped cases, not an advisor’s own book.',
    children: [],
    related: ['advisors', 'production'],
  },
  {
    id: 'advisors',
    label: 'Advisors',
    routeIds: ['advisors', 'advisor-detail'],
    summary: 'Advisors lists people in your reporting scope with drilldown into their work.',
    children: [],
    related: ['team-pipeline', 'production'],
  },
  {
    id: 'management-production',
    label: 'Production',
    routeIds: ['production'],
    summary: 'Management Production is company or downline production, not My Production.',
    children: [],
    related: ['dashboard', 'advisors'],
  },
];

export const MANAGEMENT_PRODUCT_MAP: ProductMap = {
  version: PRODUCT_MAP_VERSION,
  workspace: 'management',
  overview: [
    'Use Dashboard for issued production in your authorised scope.',
    'Open Team Pipeline for management-scoped cases.',
    'Open Advisors to drill into a person in your reporting line.',
    'Open Production for downline submitted and issued work.',
  ],
  nodes: MANAGEMENT_NODES,
};

const ORGANISATION_NODES: ProductMapNode[] = [
  {
    id: 'users',
    label: 'Users & Access',
    routeIds: ['users'],
    summary: 'Users & Access is where Organisation Admins add, invite and manage members.',
    children: ['licences', 'bulk-import'],
    related: [],
  },
  {
    id: 'licences',
    label: 'Licences',
    routeIds: ['licences'],
    summary: 'Licences is the organisation seat pool: purchased, assigned and available.',
    children: [],
    related: ['users'],
  },
  {
    id: 'bulk-import',
    label: 'Bulk Import',
    routeIds: ['bulk-import'],
    summary: 'Bulk Import uploads members from an XLSX template.',
    children: [],
    related: ['users'],
  },
  {
    id: 'company-subscription',
    label: 'Subscription',
    routeIds: ['subscription'],
    summary: 'Organisation Subscription is company commercial terms, not a personal advisor plan.',
    children: [],
    related: ['invoices'],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    routeIds: ['invoices'],
    summary: 'Invoices lists company invoices. Numbering starts at INV100000 and is never reused.',
    children: [],
    related: ['company-subscription'],
  },
];

export const ORGANISATION_PRODUCT_MAP: ProductMap = {
  version: PRODUCT_MAP_VERSION,
  workspace: 'organisation',
  overview: [
    'Use Users & Access to invite and manage people.',
    'Assign seats from Licences.',
    'Use Bulk Import for XLSX member uploads.',
    'Read company Subscription and Invoices where you have access.',
  ],
  nodes: ORGANISATION_NODES,
};

export const PLATFORM_PRODUCT_MAP: ProductMap = {
  version: PRODUCT_MAP_VERSION,
  workspace: 'platform',
  overview: ['Platform tools are for AdvisorTrack staff. Customer assistants do not mix this map in.'],
  nodes: [
    {
      id: 'engineering',
      label: 'Engineering Change Log',
      routeIds: ['engineering-changelog'],
      summary: 'Engineering Change Log is an internal staff tool.',
      children: [],
      related: [],
    },
  ],
};

export function productMapFor(workspace: AssistantWorkspace): ProductMap {
  switch (workspace) {
    case 'advisor':
      return ADVISOR_PRODUCT_MAP;
    case 'organisation':
      return ORGANISATION_PRODUCT_MAP;
    case 'platform':
      return PLATFORM_PRODUCT_MAP;
    default:
      return MANAGEMENT_PRODUCT_MAP;
  }
}

export function nodeForRoute(workspace: AssistantWorkspace, routeId: string | null): ProductMapNode | null {
  if (!routeId) return null;
  return productMapFor(workspace).nodes.find((node) => node.routeIds.includes(routeId)) ?? null;
}

export function nodeById(workspace: AssistantWorkspace, id: string): ProductMapNode | null {
  return productMapFor(workspace).nodes.find((node) => node.id === id) ?? null;
}

export function cardFamily(cardId: string): string {
  const dot = cardId.indexOf('.');
  return (dot === -1 ? cardId : cardId.slice(0, dot)).toUpperCase();
}

export function nodeForSubject(workspace: AssistantWorkspace, subject: string | null): ProductMapNode | null {
  if (!subject) return null;
  const key = subject.replace(/[^a-z]/g, '');
  return (
    productMapFor(workspace).nodes.find((node) => node.id.replace(/[^a-z]/g, '') === key)
    ?? productMapFor(workspace).nodes.find((node) => node.label.toLowerCase().replace(/[^a-z]/g, '') === key)
    ?? null
  );
}

export function navigationPhrase(label: string, viewport: AssistantViewport | undefined, alreadyOn: boolean): string {
  if (alreadyOn) return `You are already on ${label}.`;
  if (viewport === 'desktop') return `Open ${label} from the left-hand navigation.`;
  if (viewport === 'phone') return `Open ${label} from the bottom navigation.`;
  return `Open ${label} from the navigation.`;
}

export function workflowInvariants(
  workspace: AssistantWorkspace,
  capabilities: Record<string, boolean>,
): string[] {
  const facts: string[] = [];
  if (workspace === 'advisor' && capabilities.canViewAdvisorWorkspace === true) {
    facts.push(
      'Financial Advisers in Advisor Workspace have My Production at /advisor/production. That is their own submitted and issued book.',
      'The capability canViewProduction means Management Production at /production (downline). It does not mean this adviser lacks My Production.',
      'Issued numbers for this adviser are on My Production and Home. Do not deny Advisor Production access.',
    );
  }
  if (workspace === 'advisor') {
    facts.push(
      'Canonical pipeline stages: Initial contact, Fact-finding, Analysis & quotes, Recommendation, Implementation, and Review & servicing.',
      'Incomplete FICA is a warning/soft gate. It does not hard-block stage changes or submit to Production.',
      'Submit to Production requires estimated commission greater than 0 on a case the adviser owns. FICA is not the submit check.',
      'Activity outcomes are Proceed, Lost, or Complete.',
      'Quotes live on the case in Analysis & quotes, as up to three typed quote lines.',
      'Do not invent current-case field values that were not supplied in live tools.',
      'Do not mention HTTP methods or API paths in the answer.',
    );
  }
  return facts;
}

export function trustedMapFacts(workspace: AssistantWorkspace, routeId: string | null): string[] {
  const map = productMapFor(workspace);
  const current = nodeForRoute(workspace, routeId);
  const facts = [
    `Workspace: ${workspace}.`,
    `Product map ${map.version}.`,
    ...map.overview.map((step, index) => `${index + 1}. ${step}`),
  ];
  if (current) {
    facts.push(`Current area: ${current.label}. ${current.summary}`);
  }
  for (const node of map.nodes) {
    facts.push(`${node.label}: ${node.summary}`);
  }
  return facts;
}
