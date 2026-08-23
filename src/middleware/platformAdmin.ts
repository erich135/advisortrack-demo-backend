import { NextFunction, Request, Response } from 'express';
import { asAuthRequest } from './auth';
import { AppError } from './errorHandler';
import { organisationService } from '../services/organisation.service';
import { isDatabaseActive } from '../config/database';

/**
 * Restricts a route to AdvisorTrack staff (`users.is_platform_admin`).
 */
export const requirePlatformAdmin = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  if (!isDatabaseActive()) {
    next(new AppError(503, 'Database unavailable', 'DB_UNAVAILABLE'));
    return;
  }

  try {
    const { userId } = asAuthRequest(req);
    const allowed = await organisationService.isPlatformAdmin(userId);
    if (!allowed) {
      next(new AppError(403, 'Platform admin access required', 'FORBIDDEN'));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
