import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { handleAssistantAsk } from '../assistant/service';
import { ok } from '../utils/response';

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
  pathname: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
});

function clientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? null;
}

/**
 * AdvisorTrack Assistant A6 — demo API.
 * Uses the Abel-generated knowledge snapshot and demo auth/context only.
 * Never proxies through the production AdvisorTrack backend.
 */
export const createAssistantRouter = () => {
  const router = Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.post('/ask', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = askSchema.parse(req.body ?? {});
      const result = await handleAssistantAsk(userId, body, { ip: clientIp(req) });
      res.json(
        ok({
          ...result.answer,
          origin: result.origin,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
};
