import crypto from 'crypto';

/**
 * Generates a cryptographically secure one-time token for password-reset deep links.
 */
export const generateSecureToken = (): string => crypto.randomBytes(32).toString('hex');

/**
 * Generates a 6-digit numeric PIN for in-app email verification.
 */
export const generateVerificationPin = (): string => {
  const value = crypto.randomInt(0, 1_000_000);
  return value.toString().padStart(6, '0');
};

/**
 * Hashes a plain token or PIN before persisting — only the hash is stored in PostgreSQL.
 */
export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex');
