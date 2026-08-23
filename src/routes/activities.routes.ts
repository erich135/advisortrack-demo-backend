import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { ActivityService } from '../services';
import { ok } from '../utils/response';
import { createActivitySchema, updateActivitySchema, activityOutcomeSchema } from '../validators/schemas';
import { recordActivityOutcome } from '../services/activityOutcome.service';
import { createLogger } from '../utils/logger';

const log = createLogger('activities');

/**
 * Factory for activity routes bound to the shared service instance.
 */
export const createActivitiesRouter = (activityService: ActivityService) => {
  const router = Router();

  router.use(requireAuth, requireVerifiedEmail);

  /**
   * GET /api/v1/activities
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const date = typeof req.query.date === 'string' ? req.query.date : undefined;
      log.debug('List activities', { userId, date });
      const items = await activityService.list(userId, date);
      log.debug('List activities result', { userId, count: items.length, date });
      res.json(ok(items));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/activities
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      log.info('Create activity request', {
        userId,
        body: req.body,
      });

      const body = createActivitySchema.parse(req.body);
      log.info('Create activity validated', {
        userId,
        title: body.title,
        type: body.type,
        status: body.status,
        pipelineStage: body.pipelineStage,
        contactId: body.contactId,
        scheduledAt: body.scheduledAt,
      });

      const created = await activityService.create(userId, body);
      log.info('Create activity success', {
        userId,
        activityId: created.id,
        scheduledAt: created.scheduledAt,
        status: created.status,
      });
      res.status(201).json(ok(created));
    } catch (error) {
      log.error('Create activity failed', {
        userId: asAuthRequest(req).userId,
        body: req.body,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  });

  /**
   * PATCH /api/v1/activities/:id
   */
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateActivitySchema.parse(req.body);
      res.json(ok(await activityService.update(userId, String(req.params.id), body)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/activities/:id/outcome — proceed, lost, or complete with optional case link.
   */
  router.post('/:id/outcome', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = activityOutcomeSchema.parse(req.body);
      res.json(ok(await recordActivityOutcome(userId, String(req.params.id), body)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/v1/activities/:id
   */
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await activityService.delete(userId, String(req.params.id))));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
