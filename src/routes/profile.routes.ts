import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest } from '../middleware/auth';
import { androidResourceAuth } from '../middleware/androidAuth';
import { ProfileService } from '../services/profile.service';
import { ok } from '../utils/response';
import {
  completeSetupSchema,
  updateFinancialProfileSchema,
  updateProfileSchema,
} from '../validators/schemas';
import { invalidateAssistantLiveForUser } from '../assistant/live/invalidate';

/**
 * Factory for profile / financial setup routes.
 */
export const createProfileRouter = (profileService: ProfileService) => {
  const router = Router();

  router.use(...androidResourceAuth);

  /**
   * GET /api/v1/profile — user identity + financial profile for Edit Profile.
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await profileService.getAdvisorProfile(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/profile — update user + financial fields from Edit Profile.
   */
  router.patch('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateProfileSchema.parse(req.body);
      const updated = await profileService.updateAdvisorProfile(userId, body);
      invalidateAssistantLiveForUser(userId, 'planning');
      res.json(ok(updated));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/profile/financial
   */
  router.get('/financial', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await profileService.getFinancialProfile(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/profile/financial
   */
  router.patch('/financial', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateFinancialProfileSchema.parse(req.body);
      const updated = await profileService.updateFinancialProfile(userId, body);
      invalidateAssistantLiveForUser(userId, 'planning');
      res.json(ok(updated));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/profile/setup/complete
   */
  router.post('/setup/complete', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = completeSetupSchema.parse(req.body);
      const completed = await profileService.completeSetup(userId, body);
      invalidateAssistantLiveForUser(userId, 'planning');
      res.json(ok(completed));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
