import { getPool } from '../config/database';

export interface SubscriptionPackageRow {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_interval: string | null;
  trial_days: number;
  sort_order: number;
  is_active: boolean;
  is_highlighted: boolean;
  badge_label: string | null;
}

export interface UserSubscriptionRow {
  user_id: string;
  package_id: string;
  status: string;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  started_at: Date;
  package_slug: string;
  package_name: string;
  trial_days: number;
  live_preview_enabled: boolean;
  live_preview_enabled_at: Date | null;
  sandbox_completed_at: Date | null;
  grace_period_ends_at: Date | null;
  revenuecat_app_user_id: string | null;
  billing_store: string | null;
}

/**
 * PostgreSQL persistence for subscription packages and user entitlements.
 */
export const subscriptionRepository = {
  /**
   * Lists active packages ordered for display in the upsell modal.
   */
  async listActivePackages(): Promise<SubscriptionPackageRow[]> {
    const result = await getPool().query<SubscriptionPackageRow>(
      `SELECT id, slug, name, tagline, description, price_cents, currency,
              billing_interval, trial_days, sort_order, is_active, is_highlighted, badge_label
       FROM subscription_packages
       WHERE is_active = TRUE
       ORDER BY sort_order ASC, price_cents ASC`
    );
    return result.rows;
  },

  /**
   * Loads feature keys granted by a package.
   */
  async listFeaturesForPackage(packageId: string): Promise<string[]> {
    const result = await getPool().query<{ feature_key: string }>(
      `SELECT feature_key FROM package_features WHERE package_id = $1 ORDER BY feature_key`,
      [packageId]
    );
    return result.rows.map((row) => row.feature_key);
  },

  /**
   * Loads feature keys for a package slug.
   */
  async listFeaturesForPackageSlug(slug: string): Promise<string[]> {
    const result = await getPool().query<{ feature_key: string }>(
      `SELECT pf.feature_key
       FROM package_features pf
       JOIN subscription_packages p ON p.id = pf.package_id
       WHERE p.slug = $1`,
      [slug]
    );
    return result.rows.map((row) => row.feature_key);
  },

  /**
   * Finds a package by slug.
   */
  async findPackageBySlug(slug: string): Promise<SubscriptionPackageRow | null> {
    const result = await getPool().query<SubscriptionPackageRow>(
      `SELECT id, slug, name, tagline, description, price_cents, currency,
              billing_interval, trial_days, sort_order, is_active, is_highlighted, badge_label
       FROM subscription_packages
       WHERE slug = $1 AND is_active = TRUE
       LIMIT 1`,
      [slug]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Finds a package by id, including inactive rows used for historical display.
   */
  async findPackageById(id: string): Promise<SubscriptionPackageRow | null> {
    const result = await getPool().query<SubscriptionPackageRow>(
      `SELECT id, slug, name, tagline, description, price_cents, currency,
              billing_interval, trial_days, sort_order, is_active, is_highlighted, badge_label
       FROM subscription_packages
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Paid plans available for company commercial subscriptions.
   */
  async listCommercialPackages(): Promise<SubscriptionPackageRow[]> {
    const result = await getPool().query<SubscriptionPackageRow>(
      `SELECT id, slug, name, tagline, description, price_cents, currency,
              billing_interval, trial_days, sort_order, is_active, is_highlighted, badge_label
       FROM subscription_packages
       WHERE is_active = TRUE AND price_cents > 0
       ORDER BY sort_order ASC, price_cents ASC`
    );
    return result.rows;
  },

  /**
   * Returns the user's current subscription joined with package metadata.
   */
  async findUserSubscription(userId: string): Promise<UserSubscriptionRow | null> {
    const result = await getPool().query<UserSubscriptionRow>(
      `SELECT
         us.user_id,
         us.package_id,
         us.status,
         us.trial_ends_at,
         us.current_period_end,
         us.started_at,
         us.live_preview_enabled,
         us.live_preview_enabled_at,
         us.sandbox_completed_at,
         us.grace_period_ends_at,
         us.revenuecat_app_user_id,
         us.billing_store,
         p.slug AS package_slug,
         p.name AS package_name,
         p.trial_days
       FROM user_subscriptions us
       JOIN subscription_packages p ON p.id = us.package_id
       WHERE us.user_id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Creates or replaces a user's subscription row.
   */
  async upsertUserSubscription(input: {
    userId: string;
    packageId: string;
    status: string;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date | null;
  }): Promise<void> {
    await getPool().query(
      `INSERT INTO user_subscriptions (user_id, package_id, status, trial_ends_at, current_period_end)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         package_id = EXCLUDED.package_id,
         status = EXCLUDED.status,
         trial_ends_at = EXCLUDED.trial_ends_at,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()`,
      [
        input.userId,
        input.packageId,
        input.status,
        input.trialEndsAt ?? null,
        input.currentPeriodEnd ?? null,
      ]
    );
  },
};
