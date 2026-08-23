/**
 * Public-demo session lifetime defaults.
 * Runtime values come from env (DEMO_SESSION_TTL_MINUTES / DEMO_EXPIRY_SWEEP_MINUTES).
 * Do not scatter these numbers through call sites.
 */
export const DEFAULT_DEMO_SESSION_TTL_MINUTES = 120;
export const DEFAULT_DEMO_EXPIRY_SWEEP_MINUTES = 15;

export const demoSessionTtlMsFromMinutes = (minutes: number): number => {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_DEMO_SESSION_TTL_MINUTES * 60 * 1000;
  }
  return Math.floor(minutes) * 60 * 1000;
};
