import { requireAuth, requireVerifiedEmail } from './auth';
import { recordMobileActivity } from './mobileActivity';

/**
 * Auth chain for Android-app resource routers.
 * Do not use on /management, /company, /platform, /auth, /subscription, or /webhooks.
 */
export const androidResourceAuth = [requireAuth, requireVerifiedEmail, recordMobileActivity];
