import type { Request } from 'express';

/** Header the web Advisor Workspace sends. Android clients omit it. */
export const ADVISORTRACK_CLIENT_HEADER = 'x-advisortrack-client';
export const ADVISORTRACK_CLIENT_WEB = 'web';

/**
 * True when the caller identified itself as the web Advisor Workspace.
 * Missing/unknown values are treated as Android so existing mobile clients
 * keep recording last_mobile_activity_at without a client change.
 */
export const isWebAdvisorClient = (req: Request): boolean => {
  const raw =
    typeof req.header === 'function'
      ? req.header(ADVISORTRACK_CLIENT_HEADER)
      : (req.headers?.[ADVISORTRACK_CLIENT_HEADER] as string | string[] | undefined);
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return false;
  return value.trim().toLowerCase() === ADVISORTRACK_CLIENT_WEB;
};
