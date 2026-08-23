import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from './errorHandler';

export const DEMO_PLATFORM_FORBIDDEN =
  'Internal AdvisorTrack administration is not available in the public demo.';

export const DEMO_SIDE_EFFECT_BLOCKED = 'The public demo cannot perform this external action.';

export const DEMO_REGISTER_DISABLED =
  'Public registration is not available in the AdvisorTrack demo. Use the demo session entry when it is enabled.';

export const DEMO_LOGIN_DISABLED =
  'Password sign-in is not available in the public demo. Choose a management role to continue.';

export const DEMO_NO_DELETE =
  'AdvisorTrack does not hard-delete records, including in the public demo.';

/**
 * Blocks every /platform route in demo mode, including manipulated requests
 * that present an App Admin / Founder token.
 */
export const blockDemoPlatformAdmin = (
  _req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (env.isDemoMode) {
    next(new AppError(403, DEMO_PLATFORM_FORBIDDEN, 'DEMO_PLATFORM_FORBIDDEN'));
    return;
  }
  next();
};

/**
 * Throws when demo mode would perform a real customer-facing or paid side effect.
 */
export const assertDemoExternalWriteAllowed = (kind: string): void => {
  if (env.isDemoMode) {
    throw new AppError(403, `${DEMO_SIDE_EFFECT_BLOCKED} (${kind})`, 'DEMO_SIDE_EFFECT_BLOCKED');
  }
};

/**
 * Public self-serve signup would place every visitor in the shared platform
 * company. Demo visitors get an isolated company via demo sessions (Phase 11).
 */
export const assertDemoSelfServeRegistrationAllowed = (): void => {
  if (env.isDemoMode) {
    throw new AppError(403, DEMO_REGISTER_DISABLED, 'DEMO_REGISTER_DISABLED');
  }
};

export const assertDemoPasswordLoginAllowed = (): void => {
  if (env.isDemoMode) {
    throw new AppError(403, DEMO_LOGIN_DISABLED, 'DEMO_LOGIN_DISABLED');
  }
};

export const assertDemoAccountDeleteAllowed = (): void => {
  if (env.isDemoMode) {
    throw new AppError(403, DEMO_NO_DELETE, 'DEMO_NO_DELETE');
  }
};
