import {
  addBillingPeriod,
  billingIntervalLabel,
  FREE_PLAN_NOT_ALLOWED_MESSAGE,
  PLAN_REQUIRED_MESSAGE,
  planFamilyFromSlug,
  UNLIMITED_POOL_MESSAGE,
  vatTreatmentLabel,
} from '../features/companySubscription';
import { assertPurchasedNotBelowAssigned, toLicencePool } from '../features/licencePool';
import { AppError } from '../middleware/errorHandler';
import {
  CompanySubscriptionRow,
  organisationRepository,
  SubscriptionAuditRow,
} from '../repositories/organisation.repository';
import { subscriptionRepository, SubscriptionPackageRow } from '../repositories/subscription.repository';
import { platformInvoicesService } from './platformInvoices.service';

type LicenceChange = {
  purchased?: number | null;
  quantity?: number;
  reason?: string;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const numberOrNull = (value: string | number | null | undefined): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const requireInternalAdmin = async (actorUserId: string): Promise<void> => {
  const membership = await organisationRepository.findMembership(actorUserId);
  if (!membership?.is_platform_admin) {
    throw new AppError(403, 'Platform admin access required', 'FORBIDDEN');
  }
};

const requireCompany = async (companyId: string): Promise<CompanySubscriptionRow> => {
  const row = await organisationRepository.findCompanySubscription(companyId);
  if (!row) {
    throw new AppError(404, 'Company not found', 'NOT_FOUND');
  }
  return row;
};

const billingContactDto = (row: CompanySubscriptionRow) => {
  const linkedName = [row.billing_user_first_name, row.billing_user_last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  const name = linkedName || row.billing_contact_name || null;
  const email = row.billing_user_email || row.billing_contact_email || null;
  if (!row.billing_contact_user_id && !name && !email) return null;
  return {
    userId: row.billing_contact_user_id ?? null,
    name,
    email,
  };
};

const packageDto = (row: SubscriptionPackageRow) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  priceCents: row.price_cents,
  currency: row.currency,
  billingInterval: row.billing_interval,
  billingCycle: billingIntervalLabel(row.billing_interval),
});

const auditMetadata = (row: SubscriptionAuditRow): Record<string, unknown> => {
  const raw = row.metadata as unknown;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
};

const allocationHistoryDto = (row: SubscriptionAuditRow) => {
  const metadata = auditMetadata(row);
  const actorName = [row.actor_first_name, row.actor_last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    createdAt: row.created_at.toISOString(),
    actor: {
      email: row.actor_email,
      name: actorName || row.actor_email,
    },
    previousQuantity:
      metadata.previousQuantity === undefined ? null : (metadata.previousQuantity as number | null),
    newQuantity: metadata.newQuantity === undefined ? null : (metadata.newQuantity as number | null),
    difference: metadata.difference === undefined ? null : (metadata.difference as number | null),
    reason: typeof metadata.reason === 'string' ? metadata.reason : null,
    targetUserId: typeof metadata.targetUserId === 'string' ? metadata.targetUserId : null,
    metadata,
  };
};

const toSubscriptionDto = (row: CompanySubscriptionRow) => {
  const assigned = Number(row.assigned_count ?? 0);
  const purchased = row.seat_limit;
  const vatRegistered = Boolean(row.vat_registered);
  const vatRatePercent = numberOrNull(row.vat_rate_percent);
  return {
    company: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      isPlatform: row.is_platform,
    },
    subscriptionStatus: row.subscription_status ?? 'active',
    accountStatus: row.is_active ? 'Active' : 'Inactive',
    plan: row.package_slug
      ? {
          slug: row.package_slug,
          name: row.package_name,
          priceCents: row.price_cents,
          currency: row.currency ?? 'ZAR',
        }
      : null,
    licencePriceCents: row.price_cents,
    currency: row.currency ?? 'ZAR',
    billingCycle: billingIntervalLabel(row.billing_interval),
    billingInterval: row.billing_interval,
    subscriptionStartedAt: toIso(row.subscription_started_at),
    nextBillingAt: toIso(row.next_billing_at),
    vatTreatment: {
      registered: vatRegistered,
      ratePercent: vatRatePercent,
      label: vatTreatmentLabel(vatRegistered, vatRatePercent),
    },
    billingContact: billingContactDto(row),
    licencePool: toLicencePool(purchased, assigned),
    createdAt: row.created_at.toISOString(),
  };
};

const findCyclePackage = (
  packages: SubscriptionPackageRow[],
  currentSlug: string,
  interval: 'month' | 'year'
): SubscriptionPackageRow | null => {
  const family = planFamilyFromSlug(currentSlug);
  return (
    packages.find(
      (pkg) => planFamilyFromSlug(pkg.slug) === family && pkg.billing_interval === interval
    ) ?? null
  );
};

const requirePaidPackage = async (packageSlug: string): Promise<SubscriptionPackageRow> => {
  const pkg = await subscriptionRepository.findPackageBySlug(packageSlug);
  if (!pkg) {
    throw new AppError(404, 'Package not found', 'NOT_FOUND');
  }
  if (pkg.slug === 'free' || pkg.price_cents <= 0) {
    throw new AppError(400, FREE_PLAN_NOT_ALLOWED_MESSAGE, 'PAID_PLAN_REQUIRED');
  }
  return pkg;
};

const applyPackageDates = (
  row: CompanySubscriptionRow,
  pkg: SubscriptionPackageRow,
  now = new Date()
) => ({
  packageId: pkg.id,
  subscriptionStartedAt: row.subscription_started_at ?? now,
  nextBillingAt: addBillingPeriod(now, pkg.billing_interval),
});

/**
 * AdvisorTrack internal administration of customer (company) subscriptions.
 * Customer Executives / RMs / TLs / FAs cannot call these methods.
 */
export const platformSubscriptionsService = {
  async list(actorUserId: string) {
    await requireInternalAdmin(actorUserId);
    const [rows, packages] = await Promise.all([
      organisationRepository.listCustomerSubscriptions(),
      subscriptionRepository.listCommercialPackages(),
    ]);
    return {
      companies: rows.map(toSubscriptionDto),
      packages: packages.map(packageDto),
    };
  },

  async publicView(companyId: string) {
    const row = await requireCompany(companyId);
    return toSubscriptionDto(row);
  },


  async get(actorUserId: string, companyId: string) {
    await requireInternalAdmin(actorUserId);
    const row = await requireCompany(companyId);
    const [history, packages, invoices] = await Promise.all([
      organisationRepository.listSubscriptionAudit(companyId),
      subscriptionRepository.listCommercialPackages(),
      platformInvoicesService.listForCompany(companyId),
    ]);
    return {
      ...toSubscriptionDto(row),
      allocationHistory: history.map(allocationHistoryDto),
      invoices,
      invoicing: platformInvoicesService.invoicingMeta(),
      packages: packages.map(packageDto),
    };
  },

  async setPurchasedLicences(actorUserId: string, companyId: string, input: LicenceChange) {
    await requireInternalAdmin(actorUserId);
    await requireCompany(companyId);
    if (input.purchased === undefined) {
      throw new AppError(400, 'purchased is required', 'VALIDATION_ERROR');
    }
    await organisationRepository.setPurchasedSeats({
      companyId,
      actorUserId,
      purchased: input.purchased,
      reason: input.reason ?? null,
    });
    return this.get(actorUserId, companyId);
  },

  async addLicences(actorUserId: string, companyId: string, input: { quantity: number; reason?: string }) {
    await requireInternalAdmin(actorUserId);
    const row = await requireCompany(companyId);
    if (row.seat_limit == null) {
      throw new AppError(400, UNLIMITED_POOL_MESSAGE, 'UNLIMITED_POOL');
    }
    return this.setPurchasedLicences(actorUserId, companyId, {
      purchased: row.seat_limit + input.quantity,
      reason: input.reason,
    });
  },

  async reduceLicences(
    actorUserId: string,
    companyId: string,
    input: { quantity: number; reason?: string }
  ) {
    await requireInternalAdmin(actorUserId);
    const row = await requireCompany(companyId);
    if (row.seat_limit == null) {
      throw new AppError(400, UNLIMITED_POOL_MESSAGE, 'UNLIMITED_POOL');
    }
    const next = row.seat_limit - input.quantity;
    assertPurchasedNotBelowAssigned(next < 0 ? 0 : next, Number(row.assigned_count ?? 0));
    if (next < 0) {
      throw new AppError(400, 'Cannot reduce purchased licences below zero', 'VALIDATION_ERROR');
    }
    return this.setPurchasedLicences(actorUserId, companyId, {
      purchased: next,
      reason: input.reason,
    });
  },

  async updateSubscription(
    actorUserId: string,
    companyId: string,
    input: {
      packageSlug?: string;
      billingInterval?: 'month' | 'year';
      vatRegistered?: boolean;
      vatRatePercent?: number | null;
      billingContactUserId?: string | null;
      billingContactName?: string | null;
      billingContactEmail?: string | null | '';
      reason?: string;
    }
  ) {
    await requireInternalAdmin(actorUserId);
    const row = await requireCompany(companyId);
    const packages = await subscriptionRepository.listCommercialPackages();
    let nextPackage: SubscriptionPackageRow | null = null;

    if (input.packageSlug) {
      nextPackage = await requirePaidPackage(input.packageSlug);
    }

    if (input.billingInterval) {
      const currentSlug = nextPackage?.slug ?? row.package_slug;
      if (!currentSlug) {
        throw new AppError(400, PLAN_REQUIRED_MESSAGE, 'PLAN_REQUIRED');
      }
      const matched = findCyclePackage(packages, currentSlug, input.billingInterval);
      if (!matched) {
        throw new AppError(
          400,
          `No ${input.billingInterval === 'year' ? 'yearly' : 'monthly'} plan is available for this subscription.`,
          'BILLING_INTERVAL_UNAVAILABLE'
        );
      }
      nextPackage = matched;
    }

    let billingContactUserId = input.billingContactUserId;
    let billingContactName = input.billingContactName;
    let billingContactEmail =
      input.billingContactEmail === '' ? null : input.billingContactEmail;

    if (input.billingContactUserId) {
      const member = await organisationRepository.findMembership(input.billingContactUserId);
      if (!member || member.company_id !== companyId) {
        throw new AppError(400, 'Billing contact must belong to this company', 'INVALID_BILLING_CONTACT');
      }
      billingContactUserId = member.user_id;
      const named = await organisationRepository.listMembers(companyId);
      const person = named.find((item) => item.id === member.user_id);
      billingContactName =
        billingContactName ??
        [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim() ??
        null;
      billingContactEmail = billingContactEmail ?? person?.email ?? null;
    }

    const patch: Parameters<typeof organisationRepository.updateSubscriptionFields>[1] = {};
    const auditNotes: Record<string, unknown> = {
      companyId,
      reason: input.reason ?? null,
    };

    if (nextPackage) {
      const dates = applyPackageDates(row, nextPackage);
      patch.packageId = dates.packageId;
      patch.subscriptionStartedAt = dates.subscriptionStartedAt;
      patch.nextBillingAt = dates.nextBillingAt;
      auditNotes.previousPackageSlug = row.package_slug;
      auditNotes.newPackageSlug = nextPackage.slug;
      auditNotes.previousBillingInterval = row.billing_interval;
      auditNotes.newBillingInterval = nextPackage.billing_interval;
    }
    if (input.vatRegistered !== undefined) patch.vatRegistered = input.vatRegistered;
    if (input.vatRatePercent !== undefined) patch.vatRatePercent = input.vatRatePercent;
    if (input.billingContactUserId !== undefined) patch.billingContactUserId = billingContactUserId ?? null;
    if (billingContactName !== undefined) patch.billingContactName = billingContactName ?? null;
    if (billingContactEmail !== undefined) patch.billingContactEmail = billingContactEmail ?? null;

    const updated = await organisationRepository.updateSubscriptionFields(companyId, patch);
    if (!updated) {
      throw new AppError(404, 'Company not found', 'NOT_FOUND');
    }

    let action = 'subscription_updated';
    if (input.packageSlug && input.billingInterval) action = 'subscription_plan_changed';
    else if (input.packageSlug) action = 'subscription_plan_changed';
    else if (input.billingInterval) action = 'subscription_billing_cycle_changed';

    await organisationRepository.recordAuditEvent(actorUserId, action, 'subscription', {
      ...auditNotes,
      previousValue: auditNotes.previousPackageSlug ?? auditNotes.previousBillingInterval ?? null,
      newValue: auditNotes.newPackageSlug ?? auditNotes.newBillingInterval ?? null,
    });
    return this.get(actorUserId, companyId);
  },

  async activate(actorUserId: string, companyId: string, reason?: string) {
    return this.setStatus(actorUserId, companyId, 'active', 'subscription_activated', reason);
  },

  async suspend(actorUserId: string, companyId: string, reason?: string) {
    return this.setStatus(actorUserId, companyId, 'suspended', 'subscription_suspended', reason);
  },

  async cancel(actorUserId: string, companyId: string, reason?: string) {
    return this.setStatus(actorUserId, companyId, 'cancelled', 'subscription_cancelled', reason);
  },

  async setStatus(
    actorUserId: string,
    companyId: string,
    status: 'active' | 'suspended' | 'cancelled',
    action: string,
    reason?: string
  ) {
    await requireInternalAdmin(actorUserId);
    const row = await requireCompany(companyId);
    const now = new Date();
    const patch: Parameters<typeof organisationRepository.updateSubscriptionFields>[1] = {
      subscriptionStatus: status,
    };
    if (status === 'active') {
      patch.subscriptionStartedAt = row.subscription_started_at ?? now;
      if (!row.next_billing_at && row.billing_interval) {
        patch.nextBillingAt = addBillingPeriod(now, row.billing_interval);
      }
    }
    const updated = await organisationRepository.updateSubscriptionFields(companyId, patch);
    if (!updated) {
      throw new AppError(404, 'Company not found', 'NOT_FOUND');
    }
    await organisationRepository.recordAuditEvent(actorUserId, action, 'subscription', {
      companyId,
      previousStatus: row.subscription_status,
      newStatus: status,
      previousValue: row.subscription_status,
      newValue: status,
      reason: reason ?? null,
    });
    return this.get(actorUserId, companyId);
  },
};
