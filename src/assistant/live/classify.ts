export const DATA_CLASSES = [
  'operational',
  'identity_directory',
  'account_contact',
  'client_pii',
  'financial_document',
  'telemetry',
  'diagnostic',
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

export type ProjectionAudience = 'leadership' | 'org_admin' | 'platform_staff';

export type FieldCatalog = Record<string, DataClass>;

export const PERSON_SUMMARY_FIELDS: FieldCatalog = {
  displayName: 'identity_directory',
  reportingRoleLabel: 'operational',
  teamName: 'operational',
  regionName: 'operational',
  accountStatus: 'operational',
  licenceStatus: 'operational',
  invitationStatus: 'operational',
  lastMobileActivity: 'telemetry',
  email: 'account_contact',
  phone: 'account_contact',
};

export const LICENCE_SUMMARY_FIELDS: FieldCatalog = {
  purchased: 'operational',
  assigned: 'operational',
  available: 'operational',
};

export const PRODUCTION_SUMMARY_FIELDS: FieldCatalog = {
  issuedAmount: 'operational',
  issuedCount: 'operational',
  notIssuedAmount: 'operational',
  notIssuedCount: 'operational',
};

export const PIPELINE_SUMMARY_FIELDS: FieldCatalog = {
  totalCases: 'operational',
  openCases: 'operational',
  pipelineValue: 'operational',
  topStageLabel: 'operational',
  topStageCount: 'operational',
};

export const TEAM_SUMMARY_FIELDS: FieldCatalog = {
  name: 'identity_directory',
  leaderName: 'identity_directory',
  regionName: 'operational',
  advisorCount: 'operational',
};

export const REGION_SUMMARY_FIELDS: FieldCatalog = {
  name: 'identity_directory',
  managerName: 'identity_directory',
  teamCount: 'operational',
  advisorCount: 'operational',
};

export const ADVISOR_SUMMARY_FIELDS: FieldCatalog = {
  ...PERSON_SUMMARY_FIELDS,
  openPipelineCases: 'operational',
  pipelineValue: 'operational',
};

export const COMPARISON_SUMMARY_FIELDS: FieldCatalog = {
  subjectName: 'identity_directory',
  metric: 'operational',
  currentPeriod: 'operational',
  baselinePeriod: 'operational',
  currentValue: 'operational',
  baselineValue: 'operational',
  currentComplete: 'operational',
  baselineComplete: 'operational',
};

export const RANKING_SUMMARY_FIELDS: FieldCatalog = {
  metric: 'operational',
  periodLabel: 'operational',
  universe: 'operational',
  comparisonRole: 'operational',
  ordering: 'operational',
  scopeKind: 'operational',
  sourceTool: 'operational',
  rowCount: 'operational',
  name1: 'identity_directory',
  value1: 'operational',
  name2: 'identity_directory',
  value2: 'operational',
  name3: 'identity_directory',
  value3: 'operational',
  name4: 'identity_directory',
  value4: 'operational',
  name5: 'identity_directory',
  value5: 'operational',
};

export const ATTENTION_SUMMARY_FIELDS: FieldCatalog = {
  subjectName: 'identity_directory',
  flagged: 'operational',
  reasonCount: 'operational',
  reason1: 'operational',
  reason2: 'operational',
  reason3: 'operational',
  reason4: 'operational',
};

/** Invoice/commercial metadata if a live commercial tool is added later. Not registered today. */
export const COMMERCIAL_METADATA_FIELDS: FieldCatalog = {
  invoiceNumber: 'operational',
  status: 'operational',
  issueDate: 'operational',
  dueDate: 'operational',
  total: 'operational',
  packageName: 'operational',
  subscriptionStatus: 'operational',
};

export const FORBIDDEN_COMMERCIAL_LIVE_FIELDS: FieldCatalog = {
  bankingDetails: 'client_pii',
  paymentMethod: 'financial_document',
  invoicePdf: 'financial_document',
  billingContactEmail: 'account_contact',
  billingContactPhone: 'account_contact',
};

export const TOOL_FIELD_CATALOG: Record<string, FieldCatalog> = {
  PERSON_SUMMARY: PERSON_SUMMARY_FIELDS,
  LICENCE_SUMMARY: LICENCE_SUMMARY_FIELDS,
  PRODUCTION_SUMMARY: PRODUCTION_SUMMARY_FIELDS,
  PIPELINE_SUMMARY: PIPELINE_SUMMARY_FIELDS,
  TEAM_SUMMARY: TEAM_SUMMARY_FIELDS,
  REGION_SUMMARY: REGION_SUMMARY_FIELDS,
  ADVISOR_SUMMARY: ADVISOR_SUMMARY_FIELDS,
  COMPARISON_SUMMARY: COMPARISON_SUMMARY_FIELDS,
  RANKING_SUMMARY: RANKING_SUMMARY_FIELDS,
  ATTENTION_SUMMARY: ATTENTION_SUMMARY_FIELDS,
};

export const PUBLIC_FACT_SOURCES: Record<string, string> = {
  PERSON_SUMMARY: 'Advisor profile',
  ADVISOR_SUMMARY: 'Advisor profile',
  LICENCE_SUMMARY: 'Company licence pool',
  PRODUCTION_SUMMARY: 'Production',
  PIPELINE_SUMMARY: 'Team Pipeline',
  TEAM_SUMMARY: 'Team summary',
  REGION_SUMMARY: 'Region summary',
  COMPARISON_SUMMARY: 'Comparison',
  RANKING_SUMMARY: 'Ranking',
  ATTENTION_SUMMARY: 'Needs Attention',
};

export function publicFactSource(toolId: string, periodLabel?: string | null): string {
  if (toolId === 'PRODUCTION_SUMMARY' && periodLabel) return `Production — ${periodLabel}`;
  if (toolId === 'COMPARISON_SUMMARY' && periodLabel) return `Comparison — ${periodLabel}`;
  if (toolId === 'RANKING_SUMMARY' && periodLabel) return `Ranking — ${periodLabel}`;
  return PUBLIC_FACT_SOURCES[toolId] ?? 'AdvisorTrack';
}

export function dataClassOf(toolId: string, field: string): DataClass | null {
  return TOOL_FIELD_CATALOG[toolId]?.[field] ?? null;
}
