import { ApiError, ApiSuccess } from '../types';

/**
 * Builds a consistent success JSON envelope for API responses.
 */
export const ok = <T>(data: T): ApiSuccess<T> => ({
  success: true,
  data,
});

/**
 * Builds a consistent error JSON envelope for API responses.
 */
export const fail = (message: string, code?: string, details?: unknown): ApiError => ({
  success: false,
  error: { message, code, details },
});

/**
 * Strips sensitive fields before returning a user to the client.
 */
export const toPublicUser = <T extends { passwordHash?: string }>(user: T) => {
  const { passwordHash: _removed, ...publicUser } = user;
  return publicUser;
};
