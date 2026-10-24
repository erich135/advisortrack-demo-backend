import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import {
  handleAssistantAsk,
  handleAssistantConversationRead,
  handleAssistantConversationReset,
} from '../assistant/service';
import { ok } from '../utils/response';

const askSchema = z.object({
  question: z.string().trim().min(1).max(500),
  pathname: z.string().max(200).optional(),
  search: z.string().max(200).optional(),
  previousQuestion: z.string().trim().max(500).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string().trim().min(1).max(400),
  })).max(12).optional(),
  viewport: z.enum(['desktop', 'phone', 'unknown']).optional(),
  resetConversation: z.boolean().optional(),
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
 * Memory is scoped to the server-validated JWT demoSessionId, not Maya's userId.
 */
export const createAssistantRouter = () => {
  const router = Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.get('/conversation', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, demoSessionId } = asAuthRequest(req);
      const result = await handleAssistantConversationRead(userId, {
        conversationScope: demoSessionId ?? null,
      });
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/conversation/reset', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, demoSessionId } = asAuthRequest(req);
      const result = await handleAssistantConversationReset(userId, {
        conversationScope: demoSessionId ?? null,
      });
      res.json(ok(result));
    } catch (error) {
      next(error);
    }
  });

  router.post('/ask', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId, demoSessionId } = asAuthRequest(req);
      const body = askSchema.parse(req.body ?? {});
      const result = await handleAssistantAsk(userId, body, {
        ip: clientIp(req),
        conversationScope: demoSessionId ?? null,
      });
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
