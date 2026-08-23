import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthTokenPayload, User, UserRecord } from '../types';

/**
 * Hashes a plain-text password for storage.
 */
export const hashPassword = async (password: string): Promise<string> =>
  bcrypt.hash(password, 10);

/**
 * Compares a plain-text password with a stored hash.
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash);

/**
 * Signs a JWT for an authenticated user session.
 */
export const signToken = (
  payload: AuthTokenPayload,
  expiresIn: SignOptions['expiresIn'] = env.jwtExpiresIn as SignOptions['expiresIn']
): string => {
  const options: SignOptions = { expiresIn };
  return jwt.sign(payload, env.jwtSecret, options);
};

/**
 * Verifies and decodes a JWT, throwing if invalid.
 */
export const verifyToken = (token: string): AuthTokenPayload =>
  jwt.verify(token, env.jwtSecret) as AuthTokenPayload;

/**
 * Converts a stored user record to the public API user shape.
 */
export const toUserDto = (record: UserRecord): User => {
  const { passwordHash: _hash, ...user } = record;
  return user;
};
