import type { AssistantContext } from '../context';
import type { DataClass, ProjectionAudience } from './classify';
import { dataClassOf } from './classify';
import type { ToolExecutionContext } from './types';

export function dataIsSynthetic(ctx: Pick<ToolExecutionContext, 'environment'> | Pick<AssistantContext, 'environment'>): boolean {
  return ctx.environment === 'demo';
}

export function projectionAudience(ctx: ToolExecutionContext | AssistantContext): ProjectionAudience {
  const role = 'assistant' in ctx ? ctx.assistant.role : ctx.role;
  if (role.isPlatformStaff) return 'platform_staff';
  if (role.hasLeadershipPortalAccess) return 'leadership';
  return 'org_admin';
}

/**
 * Production privacy matrix. Seeded demo data is synthetic: skip privacy-class
 * redaction entirely. Product capabilities and reporting scope still apply.
 * client_pii never leaves Assistant v1 in production.
 */
export function classPermitted(input: {
  dataClass: DataClass;
  audience: ProjectionAudience;
  synthetic: boolean;
  purpose: 'answer' | 'model';
}): boolean {
  const { dataClass, audience, synthetic } = input;
  if (synthetic) return true;
  if (dataClass === 'client_pii') return false;
  if (dataClass === 'financial_document') return false;
  if (dataClass === 'account_contact') return false;
  if (audience === 'platform_staff') {
    if (dataClass === 'telemetry') return false;
    return dataClass === 'operational' || dataClass === 'identity_directory' || dataClass === 'diagnostic';
  }
  if (dataClass === 'telemetry') {
    return audience === 'leadership';
  }
  return true;
}

export function fieldPermitted(input: {
  toolId: string;
  field: string;
  ctx: ToolExecutionContext | AssistantContext;
  purpose: 'answer' | 'model';
}): boolean {
  const synthetic = dataIsSynthetic(input.ctx);
  const audience = projectionAudience(input.ctx);
  const dataClass = dataClassOf(input.toolId, input.field);
  if (!dataClass) {
    // Production is fail-closed. Demo must not hide synthetic fields solely for lack of a catalog tag.
    return synthetic;
  }
  if (!classPermitted({ dataClass, audience, synthetic, purpose: input.purpose })) return false;

  const capabilities = 'assistant' in input.ctx ? input.ctx.assistant.capabilities : input.ctx.capabilities;
  if (input.field === 'licenceStatus') return capabilities.canViewLicences === true;
  if (input.field === 'invitationStatus') return capabilities.canManageMembers === true;
  if (input.field === 'lastMobileActivity') {
    if (capabilities.canViewAdvisors !== true) return false;
    return synthetic || audience === 'leadership';
  }
  return true;
}

export function pickPermittedFacts(
  toolId: string,
  facts: Record<string, string | number | boolean | null>,
  ctx: ToolExecutionContext | AssistantContext,
  purpose: 'answer' | 'model',
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(facts).filter(([field, value]) => value !== undefined && fieldPermitted({
      toolId,
      field,
      ctx,
      purpose,
    })),
  );
}
