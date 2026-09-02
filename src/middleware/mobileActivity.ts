import { NextFunction, Request, Response } from 'express';
import { isDatabaseActive } from '../config/database';
import { userRepository } from '../repositories/user.repository';
import { createLogger } from '../utils/logger';
import { asAuthRequest } from './auth';

const log = createLogger('MobileActivity');

/**
 * Records last Android-app resource activity after authentication.
 * Failures are logged and never fail the request.
 */
export const recordMobileActivity = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  if (!isDatabaseActive()) {
    next();
    return;
  }

  try {
    const { userId } = asAuthRequest(req);
    await userRepository.recordLastMobileActivity(userId);
  } catch (error) {
    log.warn('Mobile activity telemetry failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  next();
};
