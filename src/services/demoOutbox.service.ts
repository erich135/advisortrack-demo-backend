import { env } from '../config/env';
import { DEMO_ACTION_SIMULATED_MESSAGE } from '../features/demoMessages';
import { demoOutboxRepository } from '../repositories/demoOutbox.repository';

export const demoOutboxService = {
  async record(input: {
    companyId?: string | null;
    sessionId?: string | null;
    actorUserId?: string | null;
    action: string;
    recipient?: string | null;
    payload?: Record<string, unknown>;
  }) {
    if (!env.isDemoMode) return null;
    return demoOutboxRepository.insert(input);
  },
};

export const demoSimulatedInvitationResult = (email: string) => ({
  sent: true,
  email,
  demoSimulated: true as const,
  message: DEMO_ACTION_SIMULATED_MESSAGE,
});
