import { z } from 'zod';
import { projectPersonSummary } from './privacy';
import { readEntityRef } from './refs';
import type {
  AssistantToolDefinition,
  DirectoryPerson,
  LicenceSummaryProjection,
  PersonSummaryProjection,
  ToolExecutionContext,
} from './types';

const reportingCache = { ttlSeconds: 30, keyBy: ['company', 'scope', 'entity', 'period'] as Array<'company' | 'scope' | 'entity' | 'period'> };

export const PERSON_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'PERSON_SUMMARY',
  version: 1,
  title: 'Person summary',
  domain: 'people',
  audiences: ['portal_management', 'portal_org_admin', 'platform_staff'],
  environments: ['both'],
  requiredCapabilities: [],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['person'],
  limits: { maxRows: 1, timeoutMs: 4000 },
  cache: { ttlSeconds: 60, keyBy: ['company', 'scope', 'entity'] },
  auditClass: 'read_person',
};

export const LICENCE_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'LICENCE_SUMMARY',
  version: 1,
  title: 'Licence pool summary',
  domain: 'licensing',
  audiences: ['portal_management', 'portal_org_admin', 'platform_staff'],
  environments: ['both'],
  requiredCapabilities: ['canViewLicences'],
  scopeResolver: 'administrative',
  acceptsEntityKinds: [],
  limits: { maxRows: 1, timeoutMs: 4000 },
  cache: { ttlSeconds: 30, keyBy: ['company'] },
  auditClass: 'read_summary',
};

export const ADVISOR_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'ADVISOR_SUMMARY',
  version: 1,
  title: 'Advisor summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: ['canViewAdvisors'],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['person'],
  limits: { maxRows: 1, timeoutMs: 4000 },
  cache: reportingCache,
  auditClass: 'read_person',
};

export const PRODUCTION_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'PRODUCTION_SUMMARY',
  version: 1,
  title: 'Production summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: ['canViewProduction'],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['person', 'team', 'region'],
  limits: { maxRows: 1, timeoutMs: 4000 },
  cache: reportingCache,
  auditClass: 'read_summary',
};

export const PIPELINE_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'PIPELINE_SUMMARY',
  version: 1,
  title: 'Pipeline summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: ['canViewPipeline'],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['person', 'team', 'region'],
  limits: { maxRows: 12, timeoutMs: 4000 },
  cache: { ttlSeconds: 30, keyBy: ['company', 'scope', 'entity'] },
  auditClass: 'read_summary',
};

export const TEAM_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'TEAM_SUMMARY',
  version: 1,
  title: 'Team summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: [],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['team'],
  limits: { maxRows: 1, timeoutMs: 4000 },
  cache: reportingCache,
  auditClass: 'read_summary',
};

export const REGION_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'REGION_SUMMARY',
  version: 1,
  title: 'Region summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: [],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['region'],
  limits: { maxRows: 1, timeoutMs: 4000 },
  cache: reportingCache,
  auditClass: 'read_summary',
};

export const COMPARISON_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'COMPARISON_SUMMARY',
  version: 1,
  title: 'Comparison summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: ['canViewProduction'],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['person', 'team', 'region'],
  limits: { maxRows: 4, timeoutMs: 4000 },
  cache: reportingCache,
  auditClass: 'read_summary',
};

export const RANKING_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'RANKING_SUMMARY',
  version: 1,
  title: 'Ranking summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: ['canViewProduction'],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['person', 'team', 'region'],
  limits: { maxRows: 5, timeoutMs: 4000 },
  cache: reportingCache,
  auditClass: 'read_summary',
};

export const ATTENTION_SUMMARY_TOOL: AssistantToolDefinition = {
  id: 'ATTENTION_SUMMARY',
  version: 1,
  title: 'Needs Attention summary',
  domain: 'reporting',
  audiences: ['portal_management'],
  environments: ['both'],
  requiredCapabilities: ['canViewAdvisors'],
  scopeResolver: 'management_reporting',
  acceptsEntityKinds: ['person'],
  limits: { maxRows: 5, timeoutMs: 4000 },
  cache: { ttlSeconds: 30, keyBy: ['company', 'scope', 'entity'] },
  auditClass: 'read_person',
};

export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  PERSON_SUMMARY_TOOL,
  LICENCE_SUMMARY_TOOL,
  ADVISOR_SUMMARY_TOOL,
  PRODUCTION_SUMMARY_TOOL,
  PIPELINE_SUMMARY_TOOL,
  TEAM_SUMMARY_TOOL,
  REGION_SUMMARY_TOOL,
  COMPARISON_SUMMARY_TOOL,
  RANKING_SUMMARY_TOOL,
  ATTENTION_SUMMARY_TOOL,
];

export const personSummaryInputSchema = z.object({
  personRef: z.string().regex(/^ent_[a-f0-9]{8}$/),
}).strict();

export const licenceSummaryInputSchema = z.object({}).strict();

export function toolById(id: string): AssistantToolDefinition | undefined {
  return ASSISTANT_TOOLS.find((tool) => tool.id === id);
}

export function canUsePersonSummary(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.capabilities.canViewAdvisors === true
    || ctx.assistant.capabilities.canViewUsers === true;
}

export function canUseLicenceSummary(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.capabilities.canViewLicences === true;
}

export function canUseAdvisorSummary(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.capabilities.canViewAdvisors === true;
}

export function canUseProductionSummary(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.capabilities.canViewProduction === true;
}

export function canUsePipelineSummary(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.capabilities.canViewPipeline === true;
}

export function canUseTeamSummary(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.role.hasLeadershipPortalAccess === true && ctx.identity.canViewTeams === true;
}

export function canUseRegionSummary(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.role.hasLeadershipPortalAccess === true && ctx.identity.canViewRegions === true;
}

export function canUseLeadershipReporting(ctx: ToolExecutionContext): boolean {
  return ctx.assistant.role.hasLeadershipPortalAccess === true
    && ctx.assistant.role.isPlatformStaff !== true;
}

export function canUseComparisonSummary(ctx: ToolExecutionContext): boolean {
  return canUseLeadershipReporting(ctx)
    && (ctx.assistant.capabilities.canViewProduction === true
      || ctx.assistant.capabilities.canViewPipeline === true);
}

export function canUseRankingSummary(ctx: ToolExecutionContext): boolean {
  return canUseComparisonSummary(ctx);
}

export function canUseAttentionSummary(ctx: ToolExecutionContext): boolean {
  return canUseLeadershipReporting(ctx) && ctx.assistant.capabilities.canViewAdvisors === true;
}

export function executePersonSummary(
  ctx: ToolExecutionContext,
  personRef: string,
  scopedPeople: DirectoryPerson[],
): PersonSummaryProjection {
  const stored = readEntityRef(ctx.refs, personRef, 'person');
  const person = scopedPeople.find((row) => row.id === stored.internalId && row.companyId === stored.companyId);
  if (!person) {
    throw new Error('not_found_in_scope');
  }
  return projectPersonSummary(person, ctx);
}

export function executeLicenceSummary(pool: {
  purchased: number | null;
  assigned: number;
  available: number | null;
}): LicenceSummaryProjection {
  return {
    purchased: pool.purchased,
    assigned: pool.assigned,
    available: pool.available,
  };
}
