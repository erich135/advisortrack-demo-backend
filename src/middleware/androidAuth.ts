import { advisorResourceAuth } from './advisorAuth';
import { recordMobileActivity } from './mobileActivity';

/**
 * Auth chain for Android-app resource routers.
 * Android clients omit X-AdvisorTrack-Client, so telemetry still records.
 * Web Advisor Workspace sends X-AdvisorTrack-Client: web and is not stamped.
 * Do not use on /management, /company, /platform, /auth, /subscription, or /webhooks.
 */
export const androidResourceAuth = [...advisorResourceAuth, recordMobileActivity];
