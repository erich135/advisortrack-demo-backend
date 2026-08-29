import { Router, Request, Response, NextFunction } from 'express';

import { asAuthRequest } from '../middleware/auth';
import { androidResourceAuth } from '../middleware/androidAuth';

import { ContactService } from '../services';

import { ok } from '../utils/response';

import { createContactSchema, batchCreateContactsSchema, updateContactSchema } from '../validators/schemas';



/**

 * Factory for contact routes bound to the shared service instance.

 */

export const createContactsRouter = (contactService: ContactService) => {

  const router = Router();



  router.use(...androidResourceAuth);



  /**

   * GET /api/v1/contacts

   */

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {

    try {

      const { userId } = asAuthRequest(req);

      const search = typeof req.query.search === 'string' ? req.query.search : undefined;

      res.json(ok(await contactService.list(userId, search)));

    } catch (error) {

      next(error);

    }

  });



  /**

   * POST /api/v1/contacts/import — bulk import batch (max 50 per request; client chunks large imports).

   */

  router.post('/import', async (req: Request, res: Response, next: NextFunction) => {

    try {

      const { userId } = asAuthRequest(req);

      const body = batchCreateContactsSchema.parse(req.body);

      const result = await contactService.batchImport(userId, body.contacts, {

        popiaNoticeVersion: body.popiaNoticeVersion,

      });

      res.status(201).json(ok(result));

    } catch (error) {

      next(error);

    }

  });



  /**

   * GET /api/v1/contacts/popia-audit — POPIA import audit trail (no PII).

   */

  router.get('/popia-audit', async (req: Request, res: Response, next: NextFunction) => {

    try {

      const { userId } = asAuthRequest(req);

      res.json(ok(await contactService.getPopiaAudit(userId)));

    } catch (error) {

      next(error);

    }

  });



  /**

   * GET /api/v1/contacts/:id

   */

  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {

    try {

      const { userId } = asAuthRequest(req);

      res.json(ok(await contactService.getById(userId, String(req.params.id))));

    } catch (error) {

      next(error);

    }

  });



  /**

   * POST /api/v1/contacts

   */

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {

    try {

      const { userId } = asAuthRequest(req);

      const body = createContactSchema.parse(req.body);

      res.status(201).json(ok(await contactService.create(userId, body)));

    } catch (error) {

      next(error);

    }

  });

  /**
   * POST /api/v1/contacts/:id/activate — swap an archived client into an active Live Preview slot.
   */
  router.post('/:id/activate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await contactService.activateContact(userId, String(req.params.id))));
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/contacts/:id
   */
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateContactSchema.parse(req.body);
      res.json(ok(await contactService.update(userId, String(req.params.id), body)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/v1/contacts/:id
   */
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      await contactService.delete(userId, String(req.params.id));
      res.json(ok({ deleted: true }));
    } catch (error) {
      next(error);
    }
  });

  return router;

};

