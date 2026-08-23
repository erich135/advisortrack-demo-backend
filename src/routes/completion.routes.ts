import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { CompletionService } from '../services/completion.service';
import { ok } from '../utils/response';

/**
 * Factory for setup completion checklist routes.
 */
export const createCompletionRouter = (completionService: CompletionService) => {
  const router = Router();

  router.use(requireAuth, requireVerifiedEmail);

  /**
   * GET /api/v1/setup/completion — onboarding progress groups.
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await completionService.getSummary(userId)));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
