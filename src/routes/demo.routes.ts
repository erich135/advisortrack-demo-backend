import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth } from '../middleware/auth';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { demoSessionService } from '../services/demoSession.service';
import { ok } from '../utils/response';

/**
 * Public demo entry and role switching. Live environments return 404.
 */
export const createDemoRouter = () => {
  const router = Router();

  router.use((_req: Request, _res: Response, next: NextFunction) => {
    if (!env.isDemoMode) {
      next(new AppError(404, 'Demo sessions are not available in this environment', 'NOT_FOUND'));
      return;
    }
    next();
  });

  router.post('/enter', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await demoSessionService.enter(req.body?.selectedRole);
      res.status(201).json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  router.get('/session', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { demoSessionId } = asAuthRequest(req);
      const result = await demoSessionService.current(demoSessionId!);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/switch-role', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { demoSessionId } = asAuthRequest(req);
      const result = await demoSessionService.switchRole(demoSessionId!, req.body?.selectedRole);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/reset', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { demoSessionId } = asAuthRequest(req);
      const result = await demoSessionService.reset(demoSessionId!);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
