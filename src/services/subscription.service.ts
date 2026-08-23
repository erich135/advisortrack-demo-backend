import {

  ALL_SUBSCRIPTION_FEATURES,

  PREMIUM_ONLY_FEATURE_KEYS,

  PRO_FEATURE_KEYS,

  STANDARD_TRIAL_DAYS,

  SUBSCRIPTION_FEATURE_LABELS,

  SubscriptionFeatureKey,

} from '../features/subscriptionFeatures';

import { isDatabaseActive } from '../config/database';

import { AppError } from '../middleware/errorHandler';

import { subscriptionRepository } from '../repositories/subscription.repository';

import { DashboardSummary } from '../types/dashboard';

import {

  applyDowngradeContactRules,

  buildEntitlements,

  enableLivePreview as enableLivePreviewDb,

  isProPackage,

  markSandboxCompleted,

  markPracticeContactsIntro,

  resolveEffectiveFeatures,

} from './entitlement.service';

import {

  clearGracePeriod,

  reactivateAllRealContacts,

  seedSandboxContacts,
  prepareTourFlywheel,
  completeTourFlywheelIssue,

  startGracePeriod,

  UserEntitlementsDto,

} from './sandbox.service';



export type SubscriptionStatus = 'active' | 'trialing' | 'expired' | 'cancelled' | 'grace';



export interface SubscriptionPackageDto {

  id: string;

  slug: string;

  name: string;

  tagline?: string;

  description?: string;

  priceCents: number;

  currency: string;

  billingInterval?: string;

  trialDays: number;

  isHighlighted: boolean;

  badgeLabel?: string;

  features: SubscriptionFeatureKey[];

}



export interface UserSubscriptionDto {

  packageSlug: string;

  packageName: string;

  status: SubscriptionStatus;

  features: SubscriptionFeatureKey[];

  currentPeriodEnd?: string;

  isTrialing: boolean;

  entitlements: UserEntitlementsDto;

}



interface MemorySubscriptionState {

  packageSlug: string;

  status: SubscriptionStatus;

  currentPeriodEnd?: string;

  livePreviewEnabled: boolean;

  sandboxCompleted: boolean;

  practiceContactsIntroCompleted: boolean;

  gracePeriodEndsAt?: string;

  trialEndsAt?: string;

}



/** In-memory fallback when PostgreSQL is unavailable. */

const memoryPackages: SubscriptionPackageDto[] = [

  {

    id: 'pkg-free',

    slug: 'free',

    name: 'Starter',

    tagline: 'Practice & Live Preview',

    description: 'Sandbox practice clients and optional Live Preview (up to 3 real clients).',

    priceCents: 0,

    currency: 'ZAR',

    trialDays: 0,

    isHighlighted: false,

    features: ['live_preview', 'pipeline_case', 'basic_income'],

  },

  {

    id: 'pkg-pro',

    slug: 'pro',

    name: 'Advisor Standard',

    tagline: 'Full performance toolkit',

    description: 'Unlimited clients, weekly points, pipeline conversion, and planning tools.',

    priceCents: 34900,

    currency: 'ZAR',

    billingInterval: 'month',

    trialDays: STANDARD_TRIAL_DAYS,

    isHighlighted: true,
    features: ALL_SUBSCRIPTION_FEATURES.filter((k) => !PREMIUM_ONLY_FEATURE_KEYS.includes(k)),

  },

  {

    id: 'pkg-pro-yearly',

    slug: 'pro_yearly',

    name: 'Advisor Standard',

    tagline: 'Annual billing',

    description: 'Unlimited clients, weekly points, pipeline conversion, and planning tools — billed once per year.',

    priceCents: 349000,

    currency: 'ZAR',

    billingInterval: 'year',

    trialDays: STANDARD_TRIAL_DAYS,

    isHighlighted: false,

    badgeLabel: 'Save 2 months',

    features: ALL_SUBSCRIPTION_FEATURES.filter((k) => !PREMIUM_ONLY_FEATURE_KEYS.includes(k)),

  },

];



const memoryUserSubscriptions = new Map<string, MemorySubscriptionState>();



/**

 * Maps a DB package row to the public API DTO including resolved features.

 */

const mapPackageDto = async (

  row: Awaited<ReturnType<typeof subscriptionRepository.listActivePackages>>[number]

): Promise<SubscriptionPackageDto> => {

  const features = await subscriptionRepository.listFeaturesForPackage(row.id);

  return {

    id: row.id,

    slug: row.slug,

    name: row.name,

    tagline: row.tagline ?? undefined,

    description: row.description ?? undefined,

    priceCents: row.price_cents,

    currency: row.currency,

    billingInterval: row.billing_interval ?? undefined,

    trialDays: row.trial_days,

    isHighlighted: row.is_highlighted,

    badgeLabel: row.badge_label ?? undefined,

    features: features as SubscriptionFeatureKey[],

  };

};



/**

 * Builds in-memory entitlements for dev without PostgreSQL.

 */

const buildMemoryEntitlements = (userId: string): UserEntitlementsDto => {

  const state = memoryUserSubscriptions.get(userId);

  const inGrace =

    state?.gracePeriodEndsAt != null && new Date(state.gracePeriodEndsAt).getTime() > Date.now();

  const isPro =

    state != null && isProPackage(state.packageSlug) && (state.status === 'active' || inGrace || (state.status === 'trialing' && state.trialEndsAt != null && new Date(state.trialEndsAt).getTime() > Date.now()));



  let tier: UserEntitlementsDto['tier'] = 'sandbox';

  if (isPro && inGrace) {

    tier = 'grace';

  } else if (isPro) {

    tier = 'pro';

  } else if (state?.livePreviewEnabled) {

    tier = 'live_preview';

  }



  return {

    tier,

    livePreviewEnabled: state?.livePreviewEnabled ?? false,

    sandboxCompleted: state?.sandboxCompleted ?? false,

    isPro,

    contacts: {

      practiceCount: 3,

      activeRealCount: 0,

      archivedRealCount: 0,

      maxActiveRealContacts: 3,

      canCreateRealContact: isPro || (state?.livePreviewEnabled ?? false),

      canImportContacts: isPro,

      livePreviewEnabled: state?.livePreviewEnabled ?? false,

      sandboxCompleted: state?.sandboxCompleted ?? false,

    },

  };

};



/**

 * Subscription entitlements — sandbox, Live Preview, Pro, grace period.

 */

export class SubscriptionService {

  /**

   * Lists sellable packages for the upsell modal.

   */

  async listPackages(): Promise<SubscriptionPackageDto[]> {

    if (!isDatabaseActive()) {

      return memoryPackages;

    }



    const rows = await subscriptionRepository.listActivePackages();

    return Promise.all(rows.map(mapPackageDto));

  }



  /**

   * Returns the authenticated user's plan, features, and entitlements.

   */

  async getUserSubscription(userId: string): Promise<UserSubscriptionDto> {

    if (!isDatabaseActive()) {

      if (!memoryUserSubscriptions.has(userId)) {

        await this.assignDefaultSubscription(userId);

      }

      const state = memoryUserSubscriptions.get(userId)!;

      const pkg = memoryPackages.find((p) => p.slug === state.packageSlug) ?? memoryPackages[0];

      const inTrial =
        state.status === 'trialing' &&
        state.trialEndsAt != null &&
        new Date(state.trialEndsAt).getTime() > Date.now();

      const entitlements = buildMemoryEntitlements(userId);
      if (inTrial) {
        const ms = new Date(state.trialEndsAt!).getTime() - Date.now();
        entitlements.trialEndsAt = state.trialEndsAt;
        entitlements.trialDaysRemaining = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
        entitlements.isPro = true;
        entitlements.tier = 'pro';
      }

      return {

        packageSlug: pkg.slug,

        packageName: pkg.name,

        status: state.status,

        features: pkg.features,

        currentPeriodEnd: state.currentPeriodEnd,

        isTrialing: inTrial,

        entitlements,

      };

    }



    let sub = await subscriptionRepository.findUserSubscription(userId);

    if (!sub) {

      await this.assignDefaultSubscription(userId);

      sub = await subscriptionRepository.findUserSubscription(userId);

    }



    if (!sub) {

      throw new AppError(500, 'Could not resolve subscription', 'SUBSCRIPTION_ERROR');

    }



    if (

      isProPackage(sub.package_slug) &&

      sub.grace_period_ends_at &&

      sub.grace_period_ends_at.getTime() < Date.now()

    ) {

      await this.downgradeToFree(userId);

      sub = await subscriptionRepository.findUserSubscription(userId);

      if (!sub) {

        throw new AppError(500, 'Could not resolve subscription after grace expiry', 'SUBSCRIPTION_ERROR');

      }

    }



    if (

      isProPackage(sub.package_slug) &&

      sub.current_period_end &&

      sub.current_period_end.getTime() < Date.now() &&

      !sub.grace_period_ends_at

    ) {

      await startGracePeriod(userId);

      sub = await subscriptionRepository.findUserSubscription(userId);

      if (!sub) {

        throw new AppError(500, 'Could not resolve subscription after grace start', 'SUBSCRIPTION_ERROR');

      }

    }



    if (
      sub.status === 'trialing' &&
      sub.trial_ends_at &&
      sub.trial_ends_at.getTime() < Date.now()
    ) {
      await this.downgradeToFree(userId);
      sub = await subscriptionRepository.findUserSubscription(userId);
      if (!sub) {
        throw new AppError(500, 'Could not resolve subscription after trial expiry', 'SUBSCRIPTION_ERROR');
      }
    }

    const features = await resolveEffectiveFeatures(userId);

    const entitlements = await buildEntitlements(userId);



    const inGrace =

      sub.grace_period_ends_at != null && sub.grace_period_ends_at.getTime() > Date.now();



    const inTrial =

      sub.status === 'trialing' &&

      sub.trial_ends_at != null &&

      sub.trial_ends_at.getTime() > Date.now();



    return {

      packageSlug: sub.package_slug,

      packageName: sub.package_name,

      status: inGrace ? 'grace' : (sub.status as SubscriptionStatus),

      features,

      currentPeriodEnd: sub.current_period_end?.toISOString(),

      isTrialing: inTrial,

      entitlements,

    };

  }



  /**

   * Returns unlocked feature keys for API gating.

   */

  async getUserFeatures(userId: string): Promise<SubscriptionFeatureKey[]> {

    if (!isDatabaseActive()) {

      const sub = await this.getUserSubscription(userId);

      return sub.features;

    }

    return resolveEffectiveFeatures(userId);

  }



  /**

   * Assigns free Starter on registration (practice clients are added only when the user opts in).

   */

  async assignDefaultSubscription(userId: string): Promise<UserSubscriptionDto> {

    if (!isDatabaseActive()) {

      memoryUserSubscriptions.set(userId, {

        packageSlug: 'free',

        status: 'active',

        livePreviewEnabled: false,

        sandboxCompleted: false,

        practiceContactsIntroCompleted: false,

      });

      return this.getUserSubscription(userId);

    }



    const free = await subscriptionRepository.findPackageBySlug('free');

    if (!free) {

      throw new AppError(500, 'Free package not configured', 'SUBSCRIPTION_ERROR');

    }



    await subscriptionRepository.upsertUserSubscription({

      userId,

      packageId: free.id,

      status: 'active',

    });



    return this.getUserSubscription(userId);

  }



  /**

   * Marks sandbox onboarding tour as complete.

   */

  async completeSandbox(userId: string): Promise<UserSubscriptionDto> {

    if (!isDatabaseActive()) {

      const state = memoryUserSubscriptions.get(userId);

      if (state) {

        state.sandboxCompleted = true;

      }

      return this.getUserSubscription(userId);

    }



    await markSandboxCompleted(userId);

    return this.getUserSubscription(userId);

  }



  /**

   * Seeds practice clients and marks the contacts learning step complete.

   */

  async addPracticeContacts(userId: string): Promise<{ subscription: UserSubscriptionDto; created: number }> {

    if (!isDatabaseActive()) {

      const state = memoryUserSubscriptions.get(userId);

      if (state) {

        state.practiceContactsIntroCompleted = true;

      }

      return { subscription: await this.getUserSubscription(userId), created: 0 };

    }



    const created = await seedSandboxContacts(userId);

    await markPracticeContactsIntro(userId);

    const subscription = await this.getUserSubscription(userId);

    return { subscription, created };

  }



  /**

   * Ensures the John Doe tour demo client when the advisor has no practice contacts.

   */

  async ensureTourDemo(userId: string): Promise<{
    contactId?: string;
    caseId?: string;
    productionId?: string;
    created: boolean;
  }> {

    if (!isDatabaseActive()) {

      return { created: false };

    }



    const flywheel = await prepareTourFlywheel(userId);

    return {

      contactId: flywheel.contactId,

      caseId: flywheel.caseId,
      productionId: flywheel.productionId,

      created: flywheel.createdContact,

    };

  }



  /**

   * Marks the tour demo case as issued (confetti step).

   */

  async completeTourIssue(userId: string): Promise<{ productionId?: string; contactId: string }> {

    if (!isDatabaseActive()) {

      return { contactId: 'demo' };

    }

    return completeTourFlywheelIssue(userId);

  }



  /**

   * Persists guided tour completion on the user profile.

   */

  
  /**
   * Starts a 7-day Advisor Standard trial when the user is still on free Starter.
   */
  async startStandardTrial(userId: string): Promise<UserSubscriptionDto> {
    if (!isDatabaseActive()) {
      const state = memoryUserSubscriptions.get(userId);
      if (state && !isProPackage(state.packageSlug) && state.status !== 'trialing') {
        const ends = new Date();
        ends.setDate(ends.getDate() + STANDARD_TRIAL_DAYS);
        state.packageSlug = 'pro';
        state.status = 'trialing';
        state.trialEndsAt = ends.toISOString();
        state.sandboxCompleted = true;
      }
      return this.getUserSubscription(userId);
    }

    const current = await subscriptionRepository.findUserSubscription(userId);
    if (
      current &&
      isProPackage(current.package_slug) &&
      (current.status === 'active' ||
        (current.status === 'trialing' &&
          current.trial_ends_at &&
          current.trial_ends_at.getTime() > Date.now()))
    ) {
      return this.getUserSubscription(userId);
    }

    const pro = await subscriptionRepository.findPackageBySlug('pro');
    if (!pro) {
      throw new AppError(500, 'Standard package not configured', 'SUBSCRIPTION_ERROR');
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + (pro.trial_days || STANDARD_TRIAL_DAYS));

    await subscriptionRepository.upsertUserSubscription({
      userId,
      packageId: pro.id,
      status: 'trialing',
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
    });

    await markSandboxCompleted(userId);
    return this.getUserSubscription(userId);
  }

async setGuidedTourCompleted(
    userId: string,
    completed: boolean
  ): Promise<{ completedGuidedTour: boolean }> {

    if (!isDatabaseActive()) {
      if (completed) {
        await this.startStandardTrial(userId);
      }
      return { completedGuidedTour: completed };
    }

    const { userRepository } = await import('../repositories/user.repository');

    const user = await userRepository.setGuidedTourCompleted(userId, completed);
    if (completed) {
      await this.startStandardTrial(userId);
    }
    return { completedGuidedTour: Boolean(user.completedGuidedTour) };

  }



  /**

   * Enables Live Preview — up to 3 real clients on the free tier.

   */

  async enableLivePreview(userId: string): Promise<UserSubscriptionDto> {

    if (!isDatabaseActive()) {

      const state = memoryUserSubscriptions.get(userId);

      if (state) {

        state.livePreviewEnabled = true;

        state.sandboxCompleted = true;

      }

      return this.getUserSubscription(userId);

    }



    await enableLivePreviewDb(userId);

    return this.getUserSubscription(userId);

  }



  /**

   * Stub upgrade — selects a paid package (RevenueCat / store billing wired later).

   */

  async selectPackage(userId: string, packageSlug: string): Promise<UserSubscriptionDto> {

    if (!isDatabaseActive()) {

      const pkg = memoryPackages.find((p) => p.slug === packageSlug);

      if (!pkg) {

        throw new AppError(404, 'Package not found', 'NOT_FOUND');

      }



      const periodEnd = new Date();

      if (pkg.billingInterval === 'month') {

        periodEnd.setMonth(periodEnd.getMonth() + 1);

      } else if (pkg.billingInterval === 'year') {

        periodEnd.setFullYear(periodEnd.getFullYear() + 1);

      }



      memoryUserSubscriptions.set(userId, {

        packageSlug: pkg.slug,

        status: 'active',

        currentPeriodEnd: pkg.priceCents > 0 ? periodEnd.toISOString() : undefined,

        livePreviewEnabled: pkg.slug === 'free',

        sandboxCompleted: true,

        practiceContactsIntroCompleted: false,

      });



      return this.getUserSubscription(userId);

    }



    const pkg = await subscriptionRepository.findPackageBySlug(packageSlug);

    if (!pkg) {

      throw new AppError(404, 'Package not found', 'NOT_FOUND');

    }



    const periodEnd = new Date();

    if (pkg.billing_interval === 'month') {

      periodEnd.setMonth(periodEnd.getMonth() + 1);

    } else if (pkg.billing_interval === 'year') {

      periodEnd.setFullYear(periodEnd.getFullYear() + 1);

    }



    const wasPro = await this.isCurrentlyPro(userId);



    await subscriptionRepository.upsertUserSubscription({

      userId,

      packageId: pkg.id,

      status: 'active',

      trialEndsAt: null,

      currentPeriodEnd: pkg.price_cents > 0 ? periodEnd : null,

    });



    if (isProPackage(packageSlug)) {

      await clearGracePeriod(userId);

      await reactivateAllRealContacts(userId);

    } else if (wasPro) {

      await startGracePeriod(userId);

    }



    return this.getUserSubscription(userId);

  }



  /**

   * Starts grace period when Pro subscription lapses (RevenueCat webhook later).

   */

  async beginGracePeriod(userId: string): Promise<UserSubscriptionDto> {

    if (!isDatabaseActive()) {

      const state = memoryUserSubscriptions.get(userId);

      if (state && isProPackage(state.packageSlug)) {

        const ends = new Date();

        ends.setDate(ends.getDate() + 14);

        state.gracePeriodEndsAt = ends.toISOString();

        state.status = 'grace';

      }

      return this.getUserSubscription(userId);

    }



    await startGracePeriod(userId);

    return this.getUserSubscription(userId);

  }



  /**

   * Moves the user to the free tier after grace expires — archives excess contacts.

   */

  async downgradeToFree(userId: string): Promise<void> {

    if (!isDatabaseActive()) {

      memoryUserSubscriptions.set(userId, {

        packageSlug: 'free',

        status: 'active',

        livePreviewEnabled: true,

        sandboxCompleted: true,

        practiceContactsIntroCompleted: false,

      });

      return;

    }



    const free = await subscriptionRepository.findPackageBySlug('free');

    if (!free) {

      return;

    }



    await subscriptionRepository.upsertUserSubscription({

      userId,

      packageId: free.id,

      status: 'active',

      trialEndsAt: null,

      currentPeriodEnd: null,

    });



    await applyDowngradeContactRules(userId);

  }



  /**

   * Returns true when the user currently has an active Pro package.

   */

  private async isCurrentlyPro(userId: string): Promise<boolean> {

    const sub = await subscriptionRepository.findUserSubscription(userId);

    return sub != null && isProPackage(sub.package_slug) && sub.status === 'active';

  }



  /**

   * Strips locked metrics from the dashboard payload for non-Pro users.

   */

  applyDashboardFeatureGates(

    summary: DashboardSummary,

    features: SubscriptionFeatureKey[]

  ): DashboardSummary {

    const has = (key: SubscriptionFeatureKey) => features.includes(key);

    const gated = { ...summary };



    if (!has('weekly_points')) {

      gated.weeklyPoints = { earned: 0, total: 0, locked: true };

      gated.weeklyStats = gated.weeklyStats.map((stat) => ({

        ...stat,

        current: 0,

        target: 0,

        locked: true,

      }));

    }



    if (!has('upcoming_events')) {

      gated.upcomingEvents = [];

      gated.upcomingEventsLocked = true;

    }



    if (!has('pipeline_analytics')) {

      gated.pipeline = {

        ...gated.pipeline,

        locked: true,

        stages: [],

        overall: {

          totalProceeded: 0,

          totalLost: 0,

          lostRatio: 0,

          conversionRatio: 0,

        },

      };

    }



    return gated;

  }

}



export const subscriptionService = new SubscriptionService();



/** Feature labels exported for API docs / admin tooling. */

export { SUBSCRIPTION_FEATURE_LABELS, PRO_FEATURE_KEYS };


