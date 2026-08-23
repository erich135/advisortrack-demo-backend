import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { AuthService } from '../services';
import { ok } from '../utils/response';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validators/schemas';
import { assertDemoSelfServeRegistrationAllowed, assertDemoPasswordLoginAllowed } from '../middleware/demoGuard';

/**
 * Factory for auth routes bound to the shared service instance.
 */
export const createAuthRouter = (authService: AuthService) => {
  const router = Router();

  /**
   * POST /api/v1/auth/login
   */
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertDemoPasswordLoginAllowed();
      const body = loginSchema.parse(req.body);
      const result = await authService.login(body);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/auth/register
   */
  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertDemoSelfServeRegistrationAllowed();
      const body = registerSchema.parse(req.body);
      const result = await authService.register(body);
      console.log('[auth] Register response', {
        email: result.email,
        requiresVerification: result.requiresVerification,
      });
      res.status(201).json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/auth/verify-email
   */
  router.post('/verify-email', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = verifyEmailSchema.parse(req.body);
      const result = await authService.verifyEmail(body);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/auth/resend-verification
   */
  router.post('/resend-verification', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = resendVerificationSchema.parse(req.body);
      const result = await authService.resendVerification(body.email);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/auth/forgot-password
   */
  router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = forgotPasswordSchema.parse(req.body);
      const result = await authService.forgotPassword(body.email);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/auth/reset-password
   */
  router.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = resetPasswordSchema.parse(req.body);
      const result = await authService.resetPassword(body);
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/v1/auth/me
   */
  router.get('/me', requireAuth, requireVerifiedEmail, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await authService.getMe(userId)));
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/v1/auth/logout
   */
  router.post('/logout', requireAuth, (_req: Request, res: Response) => {
    res.json(ok({ message: 'Logged out successfully' }));
  });

  /**
   * DELETE /api/v1/auth/me — permanently delete the authenticated account.
   */
  router.delete('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await authService.deleteAccount(userId)));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
