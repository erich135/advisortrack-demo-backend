import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest } from '../middleware/auth';
import { androidResourceAuth } from '../middleware/androidAuth';
import { ok } from '../utils/response';
import { caseService } from '../services/case.service';
import { invalidateAssistantLiveForUser } from '../assistant/live/invalidate';
import {
  createCaseDocumentSchema,
  createCaseSchema,
  listCasesQuerySchema,
  updateCaseDocumentSchema,
  updateCaseSchema,
} from '../validators/schemas';

/**
 * Client case routes — 6-step pipeline per contact.
 */
export const createCasesRouter = () => {
  const router = Router();
  router.use(...androidResourceAuth);

  /**
   * GET /api/v1/cases/contact/:contactId/open-count — number of open cases for a contact.
   */
  router.get('/contact/:contactId/open-count', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const count = await caseService.getOpenCaseCount(userId, String(req.params.contactId));
      res.json(ok({ count }));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cases/contact/:contactId — open case for contact (creates if missing).
   */
  router.get('/contact/:contactId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await caseService.getOrCreateForContact(userId, String(req.params.contactId))));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cases — self-scope list for Advisor Workspace. Additive; Android does not use this.
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const query = listCasesQuerySchema.parse({
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        stage: typeof req.query.stage === 'string' ? req.query.stage : undefined,
      });
      res.json(ok(await caseService.list(userId, query)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/cases/:id
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await caseService.getById(userId, String(req.params.id))));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/cases
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createCaseSchema.parse(req.body);
      const created = await caseService.create(userId, body);
      invalidateAssistantLiveForUser(userId, 'pipeline');
      res.status(201).json(ok(created));
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/cases/:id
   */
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateCaseSchema.parse(req.body);
      const updated = await caseService.update(userId, String(req.params.id), body);
      invalidateAssistantLiveForUser(userId, 'pipeline');
      res.json(ok(updated));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/cases/:id/documents
   */
  router.post('/:id/documents', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createCaseDocumentSchema.parse(req.body);
      res.status(201).json(ok(await caseService.addDocument(userId, String(req.params.id), body)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/cases/:id/documents/:documentId
   */
  router.patch(
    '/:id/documents/:documentId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = updateCaseDocumentSchema.parse(req.body);
        res.json(
          ok(
            await caseService.updateDocument(
              userId,
              String(req.params.id),
              String(req.params.documentId),
              body
            )
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/cases/:id/schedule-review — sets review due ~11 months out.
   */
  router.post('/:id/schedule-review', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await caseService.scheduleReview(userId, String(req.params.id))));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/cases/:id/duplicate — copies phases 1–2 into a new open case.
   */
  router.post('/:id/duplicate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.status(201).json(ok(await caseService.duplicateCase(userId, String(req.params.id))));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
