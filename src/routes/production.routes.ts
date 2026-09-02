import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest } from '../middleware/auth';
import { androidResourceAuth } from '../middleware/androidAuth';
import { ProductionService } from '../services';
import { ok } from '../utils/response';
import { createProductionSchema, updateProductionSchema } from '../validators/schemas';
import { isDatabaseActive } from '../config/database';
import { productionDashboardRepository } from '../repositories/productionDashboard.repository';

/**
 * Factory for production routes bound to the shared service instance.
 */
export const createProductionRouter = (productionService: ProductionService) => {
  const router = Router();

  router.use(...androidResourceAuth);

  /**
   * GET /api/v1/production/dashboard — chart, gauges, and case list for Production tab.
   */
  router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const month =
        typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
          ? req.query.month
          : undefined;
      if (isDatabaseActive()) {
        res.json(ok(await productionDashboardRepository.getDashboard(userId, month)));
      } else {
        res.json(ok(await productionService.dashboard(userId)));
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/production/summary
   */
  router.get('/summary', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(productionService.summary(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/production
   */
  router.get('/', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(productionService.list(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/production
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createProductionSchema.parse(req.body);
      res.status(201).json(ok(await productionService.create(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/production/:id
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await productionService.getById(userId, String(req.params.id))));
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /api/v1/production/:id
   */
  router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateProductionSchema.parse(req.body);
      res.json(ok(await productionService.update(userId, String(req.params.id), body)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/v1/production/:id
   */
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await productionService.delete(userId, String(req.params.id))));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
