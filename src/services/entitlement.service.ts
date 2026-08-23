import { getPool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import {
  LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS,
  SubscriptionFeatureKey,
} from '../features/subscriptionFeatures';
import { subscriptionRepository } from '../repositories/subscription.repository';
import {
  archiveExcessRealContacts,
  ContactQuota,
  getContactQuota,
  UserEntitlementsDto,
  UserTier,
} from './sandbox.service';

interface SubscriptionMeta {
  packageSlug: string;
  status: string;
  livePreviewEnabled: boolean;
  sandboxCompleted: boolean;
  gracePeriodEndsAt: Date | null;
  trialEndsAt: Date | null;
}

/**
 * Resolves subscription metadata needed for entitlement checks.
 */
const loadSubscriptionMeta = async (userId: string): Promise<SubscriptionMeta | null> => {
  const result = await getPool().query<{
    package_slug: string;
    status: string;
    live_preview_enabled: boolean;
    sandbox_completed_at: Date | null;
    grace_period_ends_at: Date | null;
    trial_ends_at: Date | null;
  }>(
    `SELECT
       p.slug AS package_slug,
       us.status,
       us.live_preview_enabled,
       us.sandbox_completed_at,
       us.grace_period_ends_at,
       us.trial_ends_at
     FROM user_subscriptions us
     JOIN subscription_packages p ON p.id = us.package_id
     WHERE us.user_id = $1
     LIMIT 1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    packageSlug: row.package_slug,
    status: row.status,
    livePreviewEnabled: row.live_preview_enabled,
    sandboxCompleted: row.sandbox_completed_at != null,
    gracePeriodEndsAt: row.grace_period_ends_at,
    trialEndsAt: row.trial_ends_at,
  };
};

/**
 * Returns true when the user has paid Pro (or Premium) access, including grace period.
 */
export const isProPackage = (slug: string): boolean =>
  slug === 'pro' || slug === 'pro_yearly' || slug === 'premium';

/**
 * Computes whole days remaining until a timestamp.
 */
const daysUntil = (date: Date): number => {
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};

/**
 * True when the subscription is in an active Standard trial window.
 */
const isActiveTrial = (meta: SubscriptionMeta): boolean =>
  meta.status === 'trialing' &&
  meta.trialEndsAt != null &&
  meta.trialEndsAt.getTime() > Date.now();

/**
 * Builds the user-facing entitlements DTO for subscription/me responses.
 */
export const buildEntitlements = async (userId: string): Promise<UserEntitlementsDto> => {
  const meta = await loadSubscriptionMeta(userId);
  const quotaBase = await getContactQuota(userId);

  const inGrace =
    meta?.gracePeriodEndsAt != null && meta.gracePeriodEndsAt.getTime() > Date.now();
  const inTrial = meta != null && isActiveTrial(meta);
  const isPro =
    meta != null &&
    isProPackage(meta.packageSlug) &&
    (meta.status === 'active' || inGrace || inTrial);

  let tier: UserTier = 'sandbox';
  if (isPro && inGrace) {
    tier = 'grace';
  } else if (isPro) {
    tier = 'pro';
  } else if (meta?.livePreviewEnabled) {
    tier = 'live_preview';
  }

  const canCreateRealContact =
    isPro ||
    (meta?.livePreviewEnabled === true &&
      quotaBase.activeRealCount < LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS);

  const canImportContacts = isPro;

  const contacts: ContactQuota = {
    ...quotaBase,
    livePreviewEnabled: meta?.livePreviewEnabled ?? false,
    sandboxCompleted: meta?.sandboxCompleted ?? false,
    canCreateRealContact,
    canImportContacts,
  };

  return {
    tier,
    livePreviewEnabled: meta?.livePreviewEnabled ?? false,
    sandboxCompleted: meta?.sandboxCompleted ?? false,
    gracePeriodEndsAt: inGrace ? meta!.gracePeriodEndsAt!.toISOString() : undefined,
    graceDaysRemaining:
      inGrace && meta?.gracePeriodEndsAt ? daysUntil(meta.gracePeriodEndsAt) : undefined,
    trialEndsAt: inTrial && meta?.trialEndsAt ? meta.trialEndsAt.toISOString() : undefined,
    trialDaysRemaining: inTrial && meta?.trialEndsAt ? daysUntil(meta.trialEndsAt) : undefined,
    isPro,
    contacts,
  };
};

/**
 * Ensures the user may create a new real (non-practice) contact.
 */
export const assertCanCreateRealContact = async (userId: string): Promise<void> => {
  const entitlements = await buildEntitlements(userId);

  if (entitlements.contacts.canCreateRealContact) {
    return;
  }

  if (!entitlements.livePreviewEnabled) {
    throw new AppError(
      403,
      'Enable Live Preview or upgrade to Pro to add real clients. Practice clients are available in the sandbox.',
      'LIVE_PREVIEW_REQUIRED'
    );
  }

  throw new AppError(
    403,
    `Live Preview allows up to ${LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS} active real clients. Upgrade to Pro for unlimited clients.`,
    'CONTACT_LIMIT_REACHED'
  );
};

/**
 * Ensures bulk import is allowed (Pro only).
 */
export const assertCanImportContacts = async (userId: string): Promise<void> => {
  const entitlements = await buildEntitlements(userId);
  if (!entitlements.contacts.canImportContacts) {
    throw new AppError(
      403,
      'Bulk import is a Pro feature. Upgrade to import your full contact book.',
      'IMPORT_PRO_REQUIRED'
    );
  }
};

/**
 * Ensures the contact can be edited (not archived unless Pro).
 */
export const assertCanEditContact = async (
  userId: string,
  contact: { isPractice: boolean; activationStatus: string }
): Promise<void> => {
  if (contact.isPractice) {
    return;
  }

  const entitlements = await buildEntitlements(userId);

  if (entitlements.isPro) {
    return;
  }

  if (contact.activationStatus === 'archived') {
    throw new AppError(
      403,
      'This client is read-only on your current plan. Upgrade to Pro to edit archived clients, or swap an active slot.',
      'CONTACT_ARCHIVED'
    );
  }

  if (!entitlements.livePreviewEnabled) {
    throw new AppError(
      403,
      'Enable Live Preview or upgrade to Pro to edit real clients.',
      'LIVE_PREVIEW_REQUIRED'
    );
  }
};

/**
 * Returns merged feature keys for the user's effective plan tier.
 */
export const resolveEffectiveFeatures = async (userId: string): Promise<SubscriptionFeatureKey[]> => {
  const meta = await loadSubscriptionMeta(userId);
  if (!meta) {
    return [];
  }

  const inGrace =
    meta.gracePeriodEndsAt != null && meta.gracePeriodEndsAt.getTime() > Date.now();
  const inTrial =
    meta.status === 'trialing' &&
    meta.trialEndsAt != null &&
    meta.trialEndsAt.getTime() > Date.now();
  const isPro = isProPackage(meta.packageSlug) && (meta.status === 'active' || inGrace || inTrial);

  if (isPro) {
    const proFeatures = await subscriptionRepository.listFeaturesForPackageSlug(meta.packageSlug);
    return proFeatures as SubscriptionFeatureKey[];
  }

  const freeFeatures = await subscriptionRepository.listFeaturesForPackageSlug('free');
  return freeFeatures as SubscriptionFeatureKey[];
};

/**
 * Applies downgrade rules when grace period ends — archive excess contacts.
 */
export const applyDowngradeContactRules = async (userId: string): Promise<void> => {
  await archiveExcessRealContacts(userId, LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS);
  await getPool().query(
    `UPDATE user_subscriptions
     SET live_preview_enabled = TRUE,
         live_preview_enabled_at = COALESCE(live_preview_enabled_at, NOW()),
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
};

/**
 * Marks sandbox onboarding as complete.
 */
export const markSandboxCompleted = async (userId: string): Promise<void> => {
  await getPool().query(
    `UPDATE user_subscriptions
     SET sandbox_completed_at = COALESCE(sandbox_completed_at, NOW()),
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
};

/**
 * Marks the practice-contacts learning step as complete for setup checklist.
 */
export const markPracticeContactsIntro = async (userId: string): Promise<void> => {
  await getPool().query(
    `UPDATE user_subscriptions
     SET practice_contacts_intro_at = COALESCE(practice_contacts_intro_at, NOW()),
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
};

/**
 * Returns true when the user finished the practice-contacts onboarding action.
 */
export const hasPracticeContactsIntro = async (userId: string): Promise<boolean> => {
  const result = await getPool().query<{ practice_contacts_intro_at: Date | null }>(
    `SELECT practice_contacts_intro_at FROM user_subscriptions WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.practice_contacts_intro_at != null;
};

/**
 * Opts the user into Live Preview (3 real clients, limited Pro features).
 */
export const enableLivePreview = async (userId: string): Promise<void> => {
  await getPool().query(
    `UPDATE user_subscriptions
     SET live_preview_enabled = TRUE,
         live_preview_enabled_at = COALESCE(live_preview_enabled_at, NOW()),
         sandbox_completed_at = COALESCE(sandbox_completed_at, NOW()),
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
};

/**
 * Activates an archived real contact, archiving another if at the Live Preview cap.
 */
export const activateContactSlot = async (userId: string, contactId: string): Promise<void> => {
  const entitlements = await buildEntitlements(userId);

  if (entitlements.isPro) {
    await getPool().query(
      `UPDATE contacts SET activation_status = 'active'
       WHERE user_id = $1 AND id = $2 AND is_practice = FALSE`,
      [userId, contactId]
    );
    return;
  }

  if (!entitlements.livePreviewEnabled) {
    throw new AppError(403, 'Enable Live Preview or upgrade to Pro.', 'LIVE_PREVIEW_REQUIRED');
  }

  const contact = await getPool().query<{ is_practice: boolean }>(
    `SELECT is_practice FROM contacts WHERE user_id = $1 AND id = $2`,
    [userId, contactId]
  );

  if (!contact.rows[0] || contact.rows[0].is_practice) {
    throw new AppError(404, 'Contact not found', 'NOT_FOUND');
  }

  const activeCount = entitlements.contacts.activeRealCount;
  const targetActive = await getPool().query<{ activation_status: string }>(
    `SELECT activation_status FROM contacts WHERE user_id = $1 AND id = $2`,
    [userId, contactId]
  );

  if (targetActive.rows[0]?.activation_status === 'active') {
    return;
  }

  if (activeCount >= LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS) {
    await getPool().query(
      `WITH oldest AS (
         SELECT id FROM contacts
         WHERE user_id = $1 AND is_practice = FALSE AND activation_status = 'active'
         ORDER BY updated_at ASC NULLS FIRST, created_at ASC
         LIMIT 1
       )
       UPDATE contacts SET activation_status = 'archived'
       WHERE id IN (SELECT id FROM oldest)`,
      [userId]
    );
  }

  await getPool().query(
    `UPDATE contacts SET activation_status = 'active' WHERE user_id = $1 AND id = $2`,
    [userId, contactId]
  );
};
