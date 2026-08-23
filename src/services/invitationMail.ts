import { generateVerificationPin, hashToken } from '../utils/emailTokens';
import { authTokenRepository } from '../repositories/authToken.repository';
import { sendPasswordResetEmail } from './emailService';
import { createLogger } from '../utils/logger';

const log = createLogger('InvitationMail');
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Sends a password-reset PIN using the existing auth email path (invitation / resend).
 */
export const sendMemberInvitationEmail = async (user: {
  id: string;
  email: string;
  firstName: string;
}): Promise<boolean> => {
  const pin = generateVerificationPin();
  const tokenHash = hashToken(pin);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);
  await authTokenRepository.createPasswordResetToken(user.id, tokenHash, expiresAt);
  const delivered = await sendPasswordResetEmail(user.email, user.firstName, pin);
  if (delivered) {
    log.info('Member invitation / reset PIN emailed', { userId: user.id, email: user.email });
  } else {
    log.warn('Member invitation PIN saved but email was not delivered', {
      userId: user.id,
      email: user.email,
    });
  }
  return delivered;
};
