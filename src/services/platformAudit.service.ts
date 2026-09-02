import { AppError } from '../middleware/errorHandler';
import { organisationRepository } from '../repositories/organisation.repository';

const requireInternalAdmin = async (actorUserId: string): Promise<void> => {
  const membership = await organisationRepository.findMembership(actorUserId);
  if (!membership?.is_platform_admin) {
    throw new AppError(403, 'Platform admin access required', 'FORBIDDEN');
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const displayValue = (value: unknown): string | number | boolean | null => {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const auditDto = (row: Awaited<ReturnType<typeof organisationRepository.listAdminAudit>>[number]) => {
  const actorName = [row.actor_first_name, row.actor_last_name].filter(Boolean).join(' ').trim();
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    createdAt: row.created_at.toISOString(),
    actor: {
      email: row.actor_email,
      name: actorName || row.actor_email,
    },
    companyId: typeof metadata.companyId === 'string' ? metadata.companyId : null,
    previousValue: displayValue(
      metadata.previousValue ?? metadata.previousQuantity ?? metadata.previousStatus ?? metadata.previousPackageSlug
    ),
    newValue: displayValue(
      metadata.newValue ?? metadata.newQuantity ?? metadata.newStatus ?? metadata.newPackageSlug
    ),
    difference: metadata.difference ?? null,
    reason: typeof metadata.reason === 'string' ? metadata.reason : null,
    targetUserId: typeof metadata.targetUserId === 'string' ? metadata.targetUserId : null,
    invoiceNumber: typeof metadata.invoiceNumber === 'string' ? metadata.invoiceNumber : null,
    metadata,
  };
};

/**
 * Lightweight internal administrative audit history from popia_audit_log.
 */
export const platformAuditService = {
  async list(actorUserId: string, filters?: { companyId?: string; resourceType?: string }) {
    await requireInternalAdmin(actorUserId);
    const rows = await organisationRepository.listAdminAudit(filters);
    return { events: rows.map(auditDto) };
  },

  async listForCompany(companyId: string, permittedUserIds?: string[]) {
    const rows = await organisationRepository.listAdminAudit({ companyId, permittedUserIds });
    return { events: rows.map(auditDto) };
  },
};
