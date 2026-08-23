import { NextFunction, Request, Response } from 'express';
import { isDatabaseActive } from '../config/database';
import { env } from '../config/env';
import { userRepository } from '../repositories/user.repository';
import { verifyToken } from '../utils/auth';
import { demoSessionService } from '../services/demoSession.service';
import { AppError } from './errorHandler';

/**
 * Express request extended with authenticated user context.
 */
export interface AuthenticatedRequest extends Request {
  userId: string;
  userEmail: string;
  demoSessionId?: string;
}

/**
 * Requires a valid Bearer JWT on protected routes.
 * In demo mode the JWT must be bound to an active demo session and mapped persona.
 */
export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'Authentication required', 'UNAUTHORIZED'));
    return;
  }

  try {
    const token = header.slice('Bearer '.length);
    const payload = verifyToken(token);
    (req as AuthenticatedRequest).userId = payload.userId;
    (req as AuthenticatedRequest).userEmail = payload.email;
    if (payload.demoSessionId) {
      (req as AuthenticatedRequest).demoSessionId = payload.demoSessionId;
    }

    if (env.isDemoMode) {
      await demoSessionService.assertJwtBinding({
        userId: payload.userId,
        demoSessionId: payload.demoSessionId,
      });
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError(401, 'Invalid or expired token', 'UNAUTHORIZED'));
  }
};

/**
 * Requires a verified email on protected routes (PostgreSQL only).
 */
export const requireVerifiedEmail = async (
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
    const user = await userRepository.findById(userId);

    if (!user) {
      next(new AppError(401, 'User not found', 'UNAUTHORIZED'));
      return;
    }

    if (!user.emailVerifiedAt) {
      next(
        new AppError(
          403,
          'Please verify your email before using AdvisorTrack.',
          'EMAIL_NOT_VERIFIED',
          { email: user.email }
        )
      );
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Type guard for requests that passed requireAuth.
 */
export const asAuthRequest = (req: Request): AuthenticatedRequest => req as AuthenticatedRequest;

/**
 * Standard protected-route chain: valid JWT plus verified email.
 */
export const requireAuthAndVerifiedEmail = [requireAuth, requireVerifiedEmail];
