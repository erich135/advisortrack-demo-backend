import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest } from '../middleware/auth';
import { androidResourceAuth } from '../middleware/androidAuth';
import { PlanningService } from '../services/planning.service';
import { ok } from '../utils/response';
import { updateGeneralSettingsSchema } from '../validators/schemas';

/**
 * Factory for planning and general settings routes.
 */
export const createPlanningRouter = (planningService: PlanningService) => {
  const router = Router();

  router.use(...androidResourceAuth);

  /**
   * GET /api/v1/planning/targets — weekly deliverables and point targets (gross target is internal only).
   */
  router.get('/targets', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await planningService.getTargets(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/planning/settings — general settings (ratios, tax, avg commission).
   */
  router.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await planningService.getGeneralSettings(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/planning/settings — update general settings overrides.
   */
  router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateGeneralSettingsSchema.parse(req.body);
      res.json(ok(await planningService.updateGeneralSettings(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
