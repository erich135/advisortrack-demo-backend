import { AppError } from '../middleware/errorHandler';
import { askAssistant } from './ask';
import { buildAssistantContext } from './context';
import { trustedIdentityFromOrganisation } from './identity';
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

export async function handleAssistantAsk(
  userId: string,
  body: AssistantAskBody,
  options?: {
    provider?: AssistantModelProvider;
    ip?: string | null;
  },
) {
  if (!allowAssistantAsk(userId, Date.now(), { environment: 'demo', ip: options?.ip })) {
    throw new AppError(429, 'Too many Assistant questions. Try again shortly.', 'RATE_LIMITED');
  }

  const organisation = await organisationForAssistant(userId);
  const identity = trustedIdentityFromOrganisation(userId, organisation);
  const navigation = {
    pathname: typeof body.pathname === 'string' ? body.pathname : '/',
    search: typeof body.search === 'string' ? body.search : '',
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
    identity,
    navigation,
    environment: 'demo',
    bundle,
    licencePool,
    provider: options?.provider ?? createConfiguredAssistantProvider(),
    liveSource: createOrganisationLiveSource(),
  });
}
