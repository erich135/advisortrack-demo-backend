/**
 * RevenueCat + store product identifiers for Advisor Standard (v1).
 * Product IDs must match App Store Connect, Google Play Console, and RevenueCat dashboard.
 */
export const REVENUECAT_CONFIG = {
  /** Entitlement — both monthly and yearly products unlock this. */
  proEntitlementId: 'pro',
  /** Reserved for a future Advisor Pro tier — not sold in v1. */
  premiumEntitlementId: 'premium',
  /** App-side Standard trial length (days) after guided tour — not a store intro offer. */
  standardTrialDays: 7,
  /** Monthly Advisor Standard price in cents (ZAR). */
  standardMonthlyPriceCents: 34900,
  /** Yearly Advisor Standard price in cents (ZAR) — R3490 (~2 months free vs monthly). */
  standardYearlyPriceCents: 349000,
  /**
   * Store product IDs — create matching subscriptions in App Store Connect and Google Play.
   */
  products: {
    ios: {
      pro_monthly: 'advisortrack_pro_monthly',
      pro_yearly: 'advisortrack_pro_yearly',
    },
    android: {
      pro_monthly: 'advisortrack_pro_monthly',
      pro_yearly: 'advisortrack_pro_yearly',
    },
  },
  /** Maps RevenueCat / store product id to internal package slug. */
  productIdToPackageSlug: {
    advisortrack_pro_monthly: 'pro',
    advisortrack_pro_yearly: 'pro_yearly',
  } as Record<string, 'pro' | 'pro_yearly'>,
} as const;

/**
 * Resolves a store product id to the internal subscription package slug.
 */
export const packageSlugForProductId = (productId: string | undefined): 'pro' | 'pro_yearly' | null => {
  if (!productId) {
    return null;
  }
  return REVENUECAT_CONFIG.productIdToPackageSlug[productId] ?? null;
};
