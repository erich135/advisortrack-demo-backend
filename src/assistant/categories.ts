import type { AssistantCategory, AssistantHomeTopic } from './types';

export const ASSISTANT_CATEGORIES: AssistantCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    environment: 'both',
    description: 'Portal versus Android, who signs in where, and account activation.',
  },
  {
    id: 'advisor-workspace',
    label: 'Advisor Workspace',
    environment: 'both',
    description: 'Advisor Home, Contacts, Activities, monthly progress, weekly activity, pipeline snapshot, and upcoming activities.',
  },
  {
    id: 'people-access',
    label: 'People & Access',
    environment: 'both',
    description: 'Users, roles, Organisation Admin, invitations, offboarding, and Bulk Import.',
  },
  {
    id: 'licences-capacity',
    label: 'Licences & Capacity',
    environment: 'both',
    description: 'Purchased, Assigned, and Available licences, assignment, and additional licences.',
  },
  {
    id: 'organisation-structure',
    label: 'Organisation Structure',
    environment: 'both',
    description: 'Regions, Teams, and reporting-line relationships.',
  },
  {
    id: 'reporting-performance',
    label: 'Reporting & Performance',
    environment: 'both',
    description: 'Dashboard, Team Pipeline, Advisors, Production, and Performance visibility.',
  },
  {
    id: 'commercial',
    label: 'Commercial',
    environment: 'both',
    description: 'Subscription, invoices, and AdvisorTrack VAT treatment.',
  },
  {
    id: 'troubleshooting',
    label: 'Troubleshooting',
    environment: 'both',
    description: 'Why a page or action is unavailable, and who can help.',
  },
  {
    id: 'glossary',
    label: 'Glossary',
    environment: 'both',
    description: 'Meanings of licences, roles, and portal terms.',
  },
  {
    id: 'demo-tips',
    label: 'Demo Tips',
    environment: 'demo',
    description: 'Public-demo chrome: Reset Demo, Viewing as, simulated side effects, Demo badge.',
  },
];

export const CATEGORY_IDS = ASSISTANT_CATEGORIES.map((category) => category.id);

export const ASSISTANT_HOME_TOPICS: AssistantHomeTopic[] = [
  { id: 'people-access', label: 'People & Access', categoryId: 'people-access', environment: 'both' },
  { id: 'licences-capacity', label: 'Licences & Capacity', categoryId: 'licences-capacity', environment: 'both' },
  {
    id: 'bulk-import',
    label: 'Bulk Import',
    categoryId: 'people-access',
    environment: 'both',
    routeIds: ['bulk-import'],
  },
  {
    id: 'organisation-structure',
    label: 'Organisation Structure',
    categoryId: 'organisation-structure',
    environment: 'both',
  },
  {
    id: 'reporting-performance',
    label: 'Reporting & Performance',
    categoryId: 'reporting-performance',
    environment: 'both',
  },
  { id: 'commercial', label: 'Commercial', categoryId: 'commercial', environment: 'both' },
  { id: 'troubleshooting', label: 'Troubleshooting', categoryId: 'troubleshooting', environment: 'both' },
  { id: 'getting-started', label: 'Getting Started', categoryId: 'getting-started', environment: 'both' },
  {
    id: 'advisor-workspace',
    label: 'Advisor Workspace',
    categoryId: 'advisor-workspace',
    environment: 'both',
    routeIds: ['advisor-home', 'advisor-contacts', 'advisor-contact-detail', 'advisor-activities', 'advisor-activity-detail', 'advisor-pipeline', 'advisor-case-detail', 'advisor-production'],
  },
  { id: 'demo-tips', label: 'Demo Tips', categoryId: 'demo-tips', environment: 'demo' },
];
