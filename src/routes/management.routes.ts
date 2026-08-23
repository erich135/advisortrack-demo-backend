import { NextFunction, Request, Response, Router } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { PIPELINE_STAGES } from '../features/pipelineStages';
import { DEFAULT_PERFORMANCE_PERIOD, isPerformancePeriod } from '../features/performancePeriod';
import { ManagementPipelineFilters } from '../repositories/managementPipeline.repository';
import { managementPipelineService } from '../services/managementPipeline.service';
import { managementProductionService } from '../services/managementProduction.service';
import { managementPerformanceService } from '../services/managementPerformance.service';
import { ok } from '../utils/response';

const monthPattern = /^(?:[1-9]\d{3})-(?:0[1-9]|1[0-2])$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CASE_STATUSES = ['open', 'won', 'lost', 'closed'] as const;

const currentMonth = (): string => new Date().toISOString().slice(0, 7);

function readMonth(value: unknown): string {
  if (value === undefined) return currentMonth();
  if (typeof value !== 'string' || !monthPattern.test(value)) {
    throw new AppError(400, 'month must use YYYY-MM format', 'VALIDATION_ERROR');
  }
  return value;
}

function readOptionalString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(400, `${name} must be a single string value`, 'VALIDATION_ERROR');
  }

  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new AppError(400, `${name} must be at most ${maxLength} characters`, 'VALIDATION_ERROR');
  }
  return normalized;
}

function readPipelineFilters(query: Request['query']): ManagementPipelineFilters {
  const advisorId = readOptionalString(query.advisorId, 'advisorId', 36);
  const stage = readOptionalString(query.stage, 'stage', 64);
  const status = readOptionalString(query.status, 'status', 16);
  const search = readOptionalString(query.search, 'search', 120);

  if (advisorId && !uuidPattern.test(advisorId)) {
    throw new AppError(400, 'advisorId must be a valid UUID', 'VALIDATION_ERROR');
  }
  if (stage && !PIPELINE_STAGES.includes(stage as (typeof PIPELINE_STAGES)[number])) {
    throw new AppError(400, 'stage must be an existing pipeline stage', 'VALIDATION_ERROR');
  }
  if (status && !CASE_STATUSES.includes(status as (typeof CASE_STATUSES)[number])) {
    throw new AppError(400, 'status must be an existing case status', 'VALIDATION_ERROR');
  }

  return { advisorId, stage, status, search };
}

/** Management-scoped Dashboard APIs. */
export const createManagementRouter = () => {
  const router = Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.get('/production/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const month = readMonth(req.query.month);
      res.json(ok(await managementProductionService.getMonthlySummary(userId, month)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/production/entries', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const month = readMonth(req.query.month);
      res.json(ok(await managementProductionService.getMonthlyEntries(userId, month)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/pipeline', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const filters = readPipelineFilters(req.query);
      res.json(ok(await managementPipelineService.getPipeline(userId, filters)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/performance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const periodValue = req.query.period;
      if (periodValue !== undefined && typeof periodValue !== 'string') {
        throw new AppError(400, 'period must be a single string value', 'VALIDATION_ERROR');
      }
      if (periodValue !== undefined && !isPerformancePeriod(periodValue)) {
        throw new AppError(
          400,
          'period must be last_week, last_month, or year_to_date',
          'VALIDATION_ERROR'
        );
      }
      res.json(
        ok(
          await managementPerformanceService.getPerformance(
            userId,
            periodValue ?? DEFAULT_PERFORMANCE_PERIOD
          )
        )
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
};
