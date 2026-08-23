import { AppError } from '../middleware/errorHandler';

export type LicencePool = {
  purchased: number | null;
  assigned: number;
  available: number | null;
};

/**
 * Customer licence pool: purchased seats minus currently assigned eligible licences.
 * purchased = companies.seat_limit (null means unlimited).
 * assigned = users with an active/trialing non-free subscription.
 */
export const toLicencePool = (purchased: number | null, assigned: number): LicencePool => ({
  purchased,
  assigned,
  available: purchased == null ? null : Math.max(0, purchased - assigned),
});

export const NO_LICENCES_MESSAGE =
  'No licences available. Contact AdvisorTrack to add additional licences.';

export const assertLicenceAvailable = (pool: LicencePool): void => {
  if (pool.purchased != null && pool.assigned >= pool.purchased) {
    throw new AppError(400, NO_LICENCES_MESSAGE, 'NO_LICENCES');
  }
};

export const PURCHASED_BELOW_ASSIGNED_CODE = 'PURCHASED_BELOW_ASSIGNED';

export const purchasedBelowAssignedMessage = (assigned: number): string =>
  `Cannot reduce purchased licences below the number currently assigned (${assigned}). Remove user licences first.`;

/**
 * Reducing Purchased must never result in Purchased < Assigned.
 * Unlimited (null) is always allowed and is not converted to a number.
 */
export const assertPurchasedNotBelowAssigned = (
  purchased: number | null,
  assigned: number
): void => {
  if (purchased != null && purchased < assigned) {
    throw new AppError(400, purchasedBelowAssignedMessage(assigned), PURCHASED_BELOW_ASSIGNED_CODE);
  }
};
