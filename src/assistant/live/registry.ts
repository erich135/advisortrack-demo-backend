import { ASSISTANT_TOOLS } from './tools';
import {
  DATA_CLASSES,
  FORBIDDEN_COMMERCIAL_LIVE_FIELDS,
  TOOL_FIELD_CATALOG,
  type FieldCatalog,
  type ProjectionAudience,
} from './classify';
import { classPermitted } from './policy';
import type { AssistantToolDefinition, ToolAuditClass } from './types';

export type ToolRegistryIssue = {
  code: string;
  message: string;
};

const LIVE_AUDIT: ToolAuditClass[] = ['read_summary', 'read_person', 'sensitive_read'];
const CLASS_SET = new Set<string>(DATA_CLASSES);
const PRODUCTION_AUDIENCES: ProjectionAudience[] = ['leadership', 'org_admin', 'platform_staff'];
const PURPOSES = ['answer', 'model'] as const;

function productionPermits(dataClass: (typeof DATA_CLASSES)[number]): boolean {
  return PRODUCTION_AUDIENCES.some((audience) =>
    PURPOSES.some((purpose) => classPermitted({
      dataClass,
      audience,
      synthetic: false,
      purpose,
    })),
  );
}

export function validateAssistantToolRegistry(
  tools: AssistantToolDefinition[] = ASSISTANT_TOOLS,
  catalogs: Record<string, FieldCatalog> = TOOL_FIELD_CATALOG,
): ToolRegistryIssue[] {
  const issues: ToolRegistryIssue[] = [];
  if (productionPermits('client_pii')) {
    issues.push({
      code: 'production_client_pii_permitted',
      message: 'Production policy must not permit client_pii',
    });
  }
  if (!classPermitted({
    dataClass: 'client_pii',
    audience: 'leadership',
    synthetic: true,
    purpose: 'answer',
  })) {
    issues.push({
      code: 'demo_synthetic_client_pii_blocked',
      message: 'Demo synthetic policy must not suppress client_pii by classification',
    });
  }
  for (const tool of tools) {
    if (!tool.auditClass) {
      issues.push({ code: 'audit_class_missing', message: `${tool.id} has no audit class` });
    } else if (tool.auditClass === 'none') {
      issues.push({ code: 'audit_class_none', message: `${tool.id} must not default to none` });
    } else if (!LIVE_AUDIT.includes(tool.auditClass)) {
      issues.push({ code: 'audit_class_invalid', message: `${tool.id} has unknown audit class ${tool.auditClass}` });
    }

    const catalog = catalogs[tool.id];
    if (!catalog || !Object.keys(catalog).length) {
      issues.push({ code: 'field_catalog_missing', message: `${tool.id} has no privacy field catalog` });
      continue;
    }
    for (const [field, dataClass] of Object.entries(catalog)) {
      if (!CLASS_SET.has(dataClass)) {
        issues.push({ code: 'data_class_invalid', message: `${tool.id}.${field} has unknown class ${dataClass}` });
      }
      if ((dataClass === 'client_pii' || dataClass === 'financial_document') && productionPermits(dataClass)) {
        issues.push({
          code: 'production_forbidden_class',
          message: `${tool.id}.${field} would expose ${dataClass} in a production projection`,
        });
      }
    }

    if (tool.id === 'PERSON_SUMMARY' && tool.auditClass !== 'read_person') {
      issues.push({ code: 'audit_class_mismatch', message: 'PERSON_SUMMARY must be read_person' });
    }
    if (tool.id === 'ADVISOR_SUMMARY' && tool.auditClass !== 'read_person') {
      issues.push({ code: 'audit_class_mismatch', message: 'ADVISOR_SUMMARY must be read_person' });
    }
  }

  for (const [field, dataClass] of Object.entries(FORBIDDEN_COMMERCIAL_LIVE_FIELDS)) {
    for (const tool of tools) {
      const catalog = catalogs[tool.id];
      if (!catalog?.[field]) continue;
      if (productionPermits(dataClass)) {
        issues.push({ code: 'forbidden_commercial', message: `${tool.id} must not expose ${field} in production` });
      }
    }
  }

  return issues;
}

export function assertAssistantToolRegistry(tools?: AssistantToolDefinition[]): void {
  const issues = validateAssistantToolRegistry(tools);
  if (issues.length) {
    throw new Error(issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
  }
}
