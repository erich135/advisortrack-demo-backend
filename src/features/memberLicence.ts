export const LICENSED_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

export type LicenceStatusLabel = 'Licensed' | 'Unlicensed';

/**
 * An assigned licence is an active/trialing paid (non-free) user_subscriptions row.
 * Free rows do not consume the company seat pool. Purchased = companies.seat_limit.
 */
export const isLicensedSubscription = (
  packageSlug: string | null | undefined,
  status: string | null | undefined
): boolean =>
  Boolean(
    packageSlug &&
      packageSlug !== 'free' &&
      status &&
      LICENSED_SUBSCRIPTION_STATUSES.has(status)
  );

export const licenceStatusLabel = (
  packageSlug: string | null | undefined,
  status: string | null | undefined
): LicenceStatusLabel => (isLicensedSubscription(packageSlug, status) ? 'Licensed' : 'Unlicensed');
