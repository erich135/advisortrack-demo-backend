import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derives the AES-256 key from the configured PII encryption secret.
 */
const getEncryptionKey = (): Buffer | null => {
  if (!env.piiEncryptionKey) {
    return null;
  }

  const key = Buffer.from(env.piiEncryptionKey, 'base64');
  if (key.length !== 32) {
    throw new Error('PII_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)');
  }

  return key;
};

/**
 * Derives an HMAC key for one-way PII fingerprints (deduplication, not reversible).
 */
const getHmacKey = (): Buffer =>
  crypto
    .createHmac('sha256', env.jwtSecret)
    .update(env.piiEncryptionKey ?? 'dev-pii-hmac')
    .update(':pii-fingerprint')
    .digest();

/**
 * Normalizes an email address for hashing and deduplication.
 */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Normalizes a phone number to digits only for hashing and deduplication.
 */
export const normalizePhone = (phone: string): string => phone.replace(/\D/g, '');

/**
 * Creates a one-way HMAC fingerprint for email or phone (POPIA-safe dedup index).
 */
export const hashPii = (value: string, purpose: 'email' | 'phone'): string => {
  const normalized =
    purpose === 'email' ? normalizeEmail(value) : normalizePhone(value);

  if (!normalized) {
    return '';
  }

  return crypto
    .createHmac('sha256', getHmacKey())
    .update(`${purpose}:${normalized}`)
    .digest('hex');
};

/**
 * Builds a stable deduplication fingerprint from available contact identifiers.
 */
export const buildContactFingerprint = (email: string, phone: string): string => {
  const parts: string[] = [];
  const emailNorm = normalizeEmail(email);
  const phoneNorm = normalizePhone(phone);

  if (emailNorm) {
    parts.push(`e:${emailNorm}`);
  }
  if (phoneNorm) {
    parts.push(`p:${phoneNorm}`);
  }

  if (parts.length === 0) {
    return '';
  }

  return crypto.createHmac('sha256', getHmacKey()).update(parts.join('|')).digest('hex');
};

/**
 * Encrypts a PII field with AES-256-GCM. Returns null for empty values.
 */
export const encryptField = (plaintext: string): string | null => {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    return null;
  }

  const key = getEncryptionKey();
  if (!key) {
    return trimmed;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
};

/**
 * Decrypts a PII field. Falls back to plaintext for legacy rows or when encryption is off.
 */
export const decryptField = (stored: string | null | undefined): string => {
  if (!stored?.trim()) {
    return '';
  }

  const key = getEncryptionKey();
  if (!key) {
    return stored;
  }

  try {
    const buf = Buffer.from(stored, 'base64');
    if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
      return stored;
    }

    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const data = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return stored;
  }
};

/**
 * True when field-level encryption is configured (required for production POPIA posture).
 */
export const isPiiEncryptionEnabled = (): boolean => Boolean(env.piiEncryptionKey);
