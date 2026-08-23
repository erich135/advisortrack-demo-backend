/**
 * Canonical subscription feature keys — keep in sync with package_features.feature_key in the DB.
 */
export const SUBSCRIPTION_FEATURES = {
  /** Live Preview — up to 3 real contacts (free tier opt-in). */
  LIVE_PREVIEW: 'live_preview',
  /** Open pipeline case on contacts (free Live Preview + Pro). */
  PIPELINE_CASE: 'pipeline_case',
  /** Basic nett income summary on dashboard. */
  BASIC_INCOME: 'basic_income',
  WEEKLY_POINTS: 'weekly_points',
  PIPELINE_ANALYTICS: 'pipeline_analytics',
  UPCOMING_EVENTS: 'upcoming_events',
  ADAPTIVE_RATIOS: 'adaptive_ratios',
  /** Bulk device import — Standard + Pro. */
  BULK_IMPORT: 'bulk_import',
  /** Advisor Pro — priority human support. */
  PRIORITY_SUPPORT: 'priority_support',
  /** Advisor Pro — advanced reporting suite. */
  ADVANCED_REPORTING: 'advanced_reporting',
} as const;

export type SubscriptionFeatureKey =
  (typeof SUBSCRIPTION_FEATURES)[keyof typeof SUBSCRIPTION_FEATURES];

/** Standard (and Pro) paid feature keys used for dashboard gating. */
export const PRO_FEATURE_KEYS: SubscriptionFeatureKey[] = [
  SUBSCRIPTION_FEATURES.WEEKLY_POINTS,
  SUBSCRIPTION_FEATURES.PIPELINE_ANALYTICS,
  SUBSCRIPTION_FEATURES.UPCOMING_EVENTS,
  SUBSCRIPTION_FEATURES.ADAPTIVE_RATIOS,
  SUBSCRIPTION_FEATURES.BULK_IMPORT,
];

/** Features only on Advisor Pro (premium slug). */
export const PREMIUM_ONLY_FEATURE_KEYS: SubscriptionFeatureKey[] = [
  SUBSCRIPTION_FEATURES.PRIORITY_SUPPORT,
  SUBSCRIPTION_FEATURES.ADVANCED_REPORTING,
];

/** Human-readable labels for upsell UI and admin docs. */
export const SUBSCRIPTION_FEATURE_LABELS: Record<SubscriptionFeatureKey, string> = {
  live_preview: 'Live Preview (up to 3 real clients)',
  pipeline_case: 'Client pipeline cases',
  basic_income: 'Basic income summary',
  weekly_points: 'Weekly activity points & targets',
  pipeline_analytics: 'Pipeline conversion analytics',
  upcoming_events: 'Upcoming events on dashboard',
  adaptive_ratios: 'Adaptive planning ratios',
  bulk_import: 'Bulk contact import',
  priority_support: 'Priority support',
  advanced_reporting: 'Advanced reporting',
};

/** All feature keys in display order for upgrade modal. */
export const ALL_SUBSCRIPTION_FEATURES: SubscriptionFeatureKey[] = [
  SUBSCRIPTION_FEATURES.LIVE_PREVIEW,
  SUBSCRIPTION_FEATURES.PIPELINE_CASE,
  SUBSCRIPTION_FEATURES.BASIC_INCOME,
  SUBSCRIPTION_FEATURES.WEEKLY_POINTS,
  SUBSCRIPTION_FEATURES.PIPELINE_ANALYTICS,
  SUBSCRIPTION_FEATURES.UPCOMING_EVENTS,
  SUBSCRIPTION_FEATURES.ADAPTIVE_RATIOS,
  SUBSCRIPTION_FEATURES.BULK_IMPORT,
  SUBSCRIPTION_FEATURES.PRIORITY_SUPPORT,
  SUBSCRIPTION_FEATURES.ADVANCED_REPORTING,
];

/**
 * Returns true when the feature set includes the given key.
 */
export const hasSubscriptionFeature = (
  features: readonly string[],
  key: SubscriptionFeatureKey
): boolean => features.includes(key);

/** Max active real contacts on free Live Preview tier. */
export const LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS = 3;

/** Days of full Pro access after payment lapse before downgrade. */
export const GRACE_PERIOD_DAYS = 14;

/** Soft-launch Standard trial length after guided tour completion. */
export const STANDARD_TRIAL_DAYS = 7;
