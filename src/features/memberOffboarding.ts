import type { LicencePool } from './licencePool';
import { toLicencePool } from './licencePool';

export const LAST_ORGANISATION_ADMIN = 'LAST_ORGANISATION_ADMIN';
export const LAST_ORGANISATION_ADMIN_MESSAGE =
  'This is the last Organisation Administrator. Grant another Organisation Admin before deactivating this account.';

export const HIERARCHY_REASSIGNMENT_REQUIRED = 'HIERARCHY_REASSIGNMENT_REQUIRED';
export const HIERARCHY_REASSIGNMENT_MESSAGE =
  'Reassign this person’s active team, region, or reporting line before deactivating them. Historical reporting records are kept.';

export type MemberOffboardingResultMeta = {
  licenceReturned: boolean;
  organisationAdminRevoked: boolean;
  invitationRevoked: boolean;
  alreadyInactive: boolean;
  hierarchyAction: 'none';
};

export function previewPoolAfterLicenceReturn(pool: LicencePool, licenceReturned: boolean): LicencePool {
  if (!licenceReturned) return pool;
  return toLicencePool(pool.purchased, Math.max(0, pool.assigned - 1));
}
