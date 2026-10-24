import { AppError } from '../middleware/errorHandler';
import { askAssistant } from './ask';
import { buildAssistantContext } from './context';
import {
  clearAssistantConversation,
  readAssistantConversation,
} from './conversationMemory';
import { trustedIdentityFromOrganisation, withConversationScope } from './identity';
import { createOrganisationLiveSource } from './live/organisationSource';
import { loadServerBundle } from './loadSnapshot';
import { createConfiguredAssistantProvider } from './model/createProvider';
import { allowAssistantAsk } from './model/throttle';
import type { AssistantModelProvider } from './model/types';
import { organisationService } from '../services/organisation.service';

const bundle = loadServerBundle();

export type AssistantAskBody = {
  question: string;
  pathname?: string;
  search?: string;
  previousQuestion?: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  viewport?: 'desktop' | 'phone' | 'unknown';
  resetConversation?: boolean;
};

type AssistantServiceOptions = {
  provider?: AssistantModelProvider;
  ip?: string | null;
  conversationScope?: string | null;
};

async function organisationForAssistant(userId: string) {
  try {
    return await organisationService.getMyOrganisation(userId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NO_COMPANY') {
      return null;
    }
    throw error;
  }
}

async function trustedAssistantIdentity(
  userId: string,
  conversationScope?: string | null,
) {
  const organisation = await organisationForAssistant(userId);
  return withConversationScope(
    trustedIdentityFromOrganisation(userId, organisation),
    conversationScope,
  );
}

export async function handleAssistantAsk(
  userId: string,
  body: AssistantAskBody,
  options?: AssistantServiceOptions,
) {
  if (!allowAssistantAsk(userId, Date.now(), {
    environment: 'demo',
    ip: options?.ip,
    conversationScope: options?.conversationScope,
  })) {
    throw new AppError(429, 'Too many Assistant questions. Try again shortly.', 'RATE_LIMITED');
  }

  const organisation = await organisationForAssistant(userId);
  const identity = withConversationScope(
    trustedIdentityFromOrganisation(userId, organisation),
    options?.conversationScope,
  );
  const navigation = {
    pathname: typeof body.pathname === 'string' ? body.pathname : '/',
    search: typeof body.search === 'string' ? body.search : '',
    viewport: body.viewport === 'desktop' || body.viewport === 'phone' ? body.viewport : 'unknown' as const,
  };
  const preview = buildAssistantContext({ environment: 'demo', identity, navigation });
  let licencePool = null;
  if (preview.capabilities.canViewLicences && organisation?.company?.id) {
    try {
      licencePool = await organisationService.getLicencePool(userId);
    } catch {
      licencePool = null;
    }
  }

  return askAssistant({
    question: body.question,
    previousQuestion: typeof body.previousQuestion === 'string' ? body.previousQuestion : null,
    history: Array.isArray(body.history) ? body.history : undefined,
    resetConversation: body.resetConversation === true,
    identity,
    navigation,
    environment: 'demo',
    bundle,
    licencePool,
    provider: options?.provider ?? createConfiguredAssistantProvider(),
    liveSource: createOrganisationLiveSource(),
  });
}

export async function handleAssistantConversationRead(
  userId: string,
  options?: AssistantServiceOptions,
) {
  const identity = await trustedAssistantIdentity(userId, options?.conversationScope);
  return { turns: readAssistantConversation({ environment: 'demo', identity }) };
}

export async function handleAssistantConversationReset(
  userId: string,
  options?: AssistantServiceOptions,
) {
  const identity = await trustedAssistantIdentity(userId, options?.conversationScope);
  clearAssistantConversation({ environment: 'demo', identity });
  return { cleared: true as const };
}
