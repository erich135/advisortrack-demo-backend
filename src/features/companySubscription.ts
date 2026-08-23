export const COMPANY_SUBSCRIPTION_STATUSES = ['active', 'suspended', 'cancelled'] as const;

export type CompanySubscriptionStatus = (typeof COMPANY_SUBSCRIPTION_STATUSES)[number];

export type BillingInterval = 'month' | 'year';

export const INVOICING_DEFERRED_MESSAGE =
  'Associated invoices will be available when internal invoicing is released.';

export const INVOICING_AVAILABLE_MESSAGE =
  'Create and download invoices from the Invoices module.';

export const UNLIMITED_POOL_MESSAGE =
  'This account has unlimited licences. Set a purchased quantity to use a finite pool.';

export const PLAN_REQUIRED_MESSAGE = 'Select a subscription plan before changing the billing cycle.';

export const FREE_PLAN_NOT_ALLOWED_MESSAGE = 'Customer subscriptions must use a paid plan.';

export const isCompanySubscriptionStatus = (value: string): value is CompanySubscriptionStatus =>
  (COMPANY_SUBSCRIPTION_STATUSES as readonly string[]).includes(value);

export const billingIntervalLabel = (interval: string | null | undefined): string | null => {
  if (interval === 'month') return 'Monthly';
  if (interval === 'year') return 'Yearly';
  return interval?.trim() ? interval : null;
};

export const vatTreatmentLabel = (registered: boolean, ratePercent: number | null): string => {
  if (!registered) return 'Not VAT registered';
  if (ratePercent == null) return 'VAT registered';
  const rate = Number.isInteger(ratePercent) ? String(ratePercent) : ratePercent.toFixed(2);
  return `VAT registered (${rate}%)`;
};

export const planFamilyFromSlug = (slug: string): string => {
  if (slug === 'pro' || slug === 'pro_yearly') return 'pro';
  return slug.replace(/_yearly$/, '') || slug;
};

export const addBillingPeriod = (from: Date, interval: string | null | undefined): Date => {
  const next = new Date(from.getTime());
  if (interval === 'year') {
    next.setFullYear(next.getFullYear() + 1);
    return next;
  }
  next.setMonth(next.getMonth() + 1);
  return next;
};

export const quantityDifference = (
  previous: number | null,
  next: number | null
): number | null => {
  if (previous == null || next == null) return null;
  return next - previous;
};
