import { getPool } from '../config/database';

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

/**
 * PostgreSQL persistence for one-time email verification and password reset tokens.
 */
export const authTokenRepository = {
  /**
   * Stores a hashed email verification token for a newly registered user.
   */
  async createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    await getPool().query(
      `DELETE FROM email_verification_tokens WHERE user_id = $1`,
      [userId]
    );
    await getPool().query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );
  },

  /**
   * Finds a valid (unused, unexpired) email verification PIN for a specific user.
   */
  async findValidEmailVerificationToken(
    userId: string,
    tokenHash: string
  ): Promise<TokenRow | null> {
    const result = await getPool().query<TokenRow>(
      `SELECT id, user_id, token_hash, expires_at, used_at
       FROM email_verification_tokens
       WHERE user_id = $1
         AND token_hash = $2
         AND used_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [userId, tokenHash]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Marks an email verification token as consumed.
   */
  async markEmailVerificationTokenUsed(tokenId: string): Promise<void> {
    await getPool().query(
      `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenId]
    );
  },

  /**
   * Stores a hashed password reset token, replacing any previous reset tokens for the user.
   */
  async createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    await getPool().query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
    await getPool().query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );
  },

  /**
   * Finds a valid (unused, unexpired) password reset PIN for a specific user.
   */
  async findValidPasswordResetToken(
    userId: string,
    tokenHash: string
  ): Promise<TokenRow | null> {
    const result = await getPool().query<TokenRow>(
      `SELECT id, user_id, token_hash, expires_at, used_at
       FROM password_reset_tokens
       WHERE user_id = $1
         AND token_hash = $2
         AND used_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [userId, tokenHash]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Marks a password reset token as consumed after a successful password change.
   */
  async markPasswordResetTokenUsed(tokenId: string): Promise<void> {
    await getPool().query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [tokenId]
    );
  },
};
