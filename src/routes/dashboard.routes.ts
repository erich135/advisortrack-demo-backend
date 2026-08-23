import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { DashboardService } from '../services/dashboard.service';
import { ok } from '../utils/response';

/**
 * Factory for dashboard routes bound to the shared service instance.
 */
export const createDashboardRouter = (dashboardService: DashboardService) => {
  const router = Router();

  router.use(requireAuth, requireVerifiedEmail);

  /**
   * GET /api/v1/dashboard
   * Home screen — income summary, weekly activity stats, and period metadata.
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await dashboardService.getSummary(userId)));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
