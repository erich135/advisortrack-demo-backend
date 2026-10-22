import { requireAuth, requireVerifiedEmail } from './auth';

/**
 * Auth chain for self-scope advisor resources (Android and Advisor Workspace web).
 * Does not record last_mobile_activity_at.
 * Do not use on /management, /company, /platform, /auth, or /webhooks.
 */
export const advisorResourceAuth = [requireAuth, requireVerifiedEmail];
