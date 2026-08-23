import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { assertDemoExternalWriteAllowed } from '../middleware/demoGuard';
import { ok } from '../utils/response';
import { subscriptionService } from '../services/subscription.service';
import { selectSubscriptionPackageSchema } from '../validators/schemas';
import { REVENUECAT_CONFIG, packageSlugForProductId } from '../config/revenueCat';

/**
 * Subscription packages, entitlements, Live Preview, and billing prep routes.
 */
export const createSubscriptionRouter = () => {
  const router = Router();

  /**
   * GET /api/v1/subscription/packages — sellable plans for the upsell modal.
   */
  router.get('/packages', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(ok(await subscriptionService.listPackages()));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/subscription/revenuecat-config — product IDs for mobile SDK (no secrets).
   */
  router.get('/revenuecat-config', (_req: Request, res: Response) => {
    res.json(
      ok({
        proEntitlementId: REVENUECAT_CONFIG.proEntitlementId,
        standardTrialDays: REVENUECAT_CONFIG.standardTrialDays,
        products: REVENUECAT_CONFIG.products,
        productIdToPackageSlug: REVENUECAT_CONFIG.productIdToPackageSlug,
      })
    );
  });

  router.use(requireAuth, requireVerifiedEmail);

  /**
   * GET /api/v1/subscription/me — current plan, entitlements, and contact quotas.
   */
  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await subscriptionService.getUserSubscription(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/complete-sandbox — marks practice onboarding tour done.
   */
  router.post('/complete-sandbox', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await subscriptionService.completeSandbox(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/add-practice-contacts — seeds practice clients and marks contacts setup step.
   */
  router.post('/add-practice-contacts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await subscriptionService.addPracticeContacts(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/ensure-tour-demo — seeds John Doe + flywheel demo data.
   */
  router.post('/ensure-tour-demo', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await subscriptionService.ensureTourDemo(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/complete-tour-issue — marks tour demo production as issued.
   */
  router.post('/complete-tour-issue', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await subscriptionService.completeTourIssue(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/guided-tour-completed — persist tour completion on user profile.
   */
  router.post('/guided-tour-completed', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const completed = req.body?.completed !== false;
      res.json(ok(await subscriptionService.setGuidedTourCompleted(userId, Boolean(completed))));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/enable-live-preview — opt in to 3 real clients on free tier.
   */
  router.post('/enable-live-preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await subscriptionService.enableLivePreview(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/select — stub upgrade until RevenueCat + store billing is wired.
   */
  router.post('/select', async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertDemoExternalWriteAllowed('payment/subscription select');
      const { userId } = asAuthRequest(req);
      const body = selectSubscriptionPackageSchema.parse(req.body);
      res.json(ok(await subscriptionService.selectPackage(userId, body.packageSlug)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/begin-grace — dev/testing: simulate payment lapse grace window.
   */
  router.post('/begin-grace', async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertDemoExternalWriteAllowed('payment/grace simulation');
      const { userId } = asAuthRequest(req);
      res.json(ok(await subscriptionService.beginGracePeriod(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/subscription/revenuecat/sync — placeholder for RevenueCat webhook / client sync.
   */
  router.post('/revenuecat/sync', async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertDemoExternalWriteAllowed('payment/subscription sync');
      const { userId } = asAuthRequest(req);
      const { entitlementId, productId } = req.body as {
        entitlementId?: string;
        productId?: string;
      };

      let packageSlug = packageSlugForProductId(productId);
      if (!packageSlug && entitlementId === REVENUECAT_CONFIG.proEntitlementId) {
        packageSlug = 'pro';
      }
      if (!packageSlug) {
        throw new AppError(400, 'Unknown store product or entitlement', 'INVALID_PRODUCT');
      }

      const result = await subscriptionService.selectPackage(userId, packageSlug);
      res.json(ok({ synced: true, subscription: result }));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
