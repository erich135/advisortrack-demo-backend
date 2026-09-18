import { AppError } from '../middleware/errorHandler';

/** Existing AdvisorTrack member phone: optional unless required, max 30, digits with common separators. */
export const MEMBER_PHONE_MAX = 30;

const MEMBER_PHONE_PATTERN = /^[\d+\s()-]+$/;

export const normalizeMemberPhone = (phone: string | null | undefined): string =>
  (phone ?? '').trim();

export const memberPhoneDigits = (phone: string | null | undefined): string =>
  normalizeMemberPhone(phone).replace(/\D/g, '');

export const inspectMemberPhone = (
  phone: string | null | undefined,
  options?: { required?: boolean }
): { ok: true; value: string | null } | { ok: false; message: string } => {
  const value = normalizeMemberPhone(phone);
  if (!value) {
    if (options?.required) {
      return { ok: false, message: 'Mobile is required' };
    }
    return { ok: true, value: null };
  }
  if (value.length > MEMBER_PHONE_MAX) {
    return { ok: false, message: 'Mobile must be 30 characters or fewer' };
  }
  const digits = value.replace(/\D/g, '');
  if (!MEMBER_PHONE_PATTERN.test(value) || digits.length < 8) {
    return { ok: false, message: 'Enter a valid mobile number' };
  }
  return { ok: true, value };
};

export const assertMemberPhone = (
  phone: string | null | undefined,
  options?: { required?: boolean }
): string | null => {
  const inspected = inspectMemberPhone(phone, options);
  if (!inspected.ok) {
    throw new AppError(400, inspected.message, 'INVALID_PHONE');
  }
  return inspected.value;
};
