import { getPool } from '../config/database';
import { UserRecord } from '../types';

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company: string | null;
  role: string | null;
  avatar_url: string | null;
  fsp_number: string | null;
  completed_guided_tour: boolean;
  email_verified_at: Date | null;
  is_active: boolean;
  created_at: Date;
  password_hash: string;
}

const USER_COLUMNS = `
  id,
  first_name,
  last_name,
  email,
  phone,
  company,
  role,
  avatar_url,
  fsp_number,
  COALESCE(completed_guided_tour, FALSE) AS completed_guided_tour,
  email_verified_at,
  COALESCE(is_active, TRUE) AS is_active,
  created_at,
  password_hash
`;

/**
 * Maps a PostgreSQL users row to the application UserRecord type.
 */
const mapUserRow = (row: UserRow): UserRecord => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  phone: row.phone ?? undefined,
  company: row.company ?? undefined,
  role: row.role ?? undefined,
  avatarUrl: row.avatar_url ?? undefined,
  fspNumber: row.fsp_number ?? undefined,
  completedGuidedTour: Boolean(row.completed_guided_tour),
  emailVerifiedAt: row.email_verified_at?.toISOString(),
  isActive: Boolean(row.is_active),
  createdAt: row.created_at.toISOString(),
  passwordHash: row.password_hash,
});

/**
 * PostgreSQL persistence for user accounts.
 */
export const userRepository = {
  /**
   * Finds a user by email address (case-insensitive).
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await getPool().query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`,
      [email.toLowerCase()]
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  },

  /**
   * Finds a user by primary key.
   */
  async findById(id: string): Promise<UserRecord | null> {
    const result = await getPool().query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : null;
  },

  /**
   * Inserts a new user; advisor_general_settings and advisor_financial_profile rows are created by DB trigger.
   */
  async create(input: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    role?: string;
  }): Promise<UserRecord> {
    const result = await getPool().query<UserRow>(
      `INSERT INTO users (first_name, last_name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_COLUMNS}`,
      [
        input.firstName,
        input.lastName,
        input.email.toLowerCase(),
        input.passwordHash,
        input.role ?? 'Financial Advisor',
      ]
    );

    return mapUserRow(result.rows[0]);
  },

  /**
   * Partially updates user identity fields for Profile Settings.
   */
  async updateProfile(
    userId: string,
    input: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string | null;
      fspNumber?: string | null;
      role?: string | null;
    }
  ): Promise<UserRecord> {
    const sets: string[] = [];
    const values: unknown[] = [userId];
    let param = 2;

    if (input.firstName !== undefined) {
      sets.push(`first_name = $${param++}`);
      values.push(input.firstName);
    }
    if (input.lastName !== undefined) {
      sets.push(`last_name = $${param++}`);
      values.push(input.lastName);
    }
    if (input.email !== undefined) {
      sets.push(`email = $${param++}`);
      values.push(input.email.toLowerCase());
    }
    if (input.phone !== undefined) {
      sets.push(`phone = $${param++}`);
      values.push(input.phone);
    }
    if (input.fspNumber !== undefined) {
      sets.push(`fsp_number = $${param++}`);
      values.push(input.fspNumber?.trim() || null);
    }
    if (input.role !== undefined) {
      sets.push(`role = $${param++}`);
      values.push(input.role?.trim() || 'Financial Advisor');
    }

    if (sets.length === 0) {
      const existing = await this.findById(userId);
      if (!existing) {
        throw new Error('User not found');
      }
      return existing;
    }

    sets.push('updated_at = NOW()');

    const result = await getPool().query<UserRow>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      values
    );

    return mapUserRow(result.rows[0]);
  },

  /**
   * Records a successful authenticated session.
   */
  async recordLastLogin(userId: string): Promise<void> {
    await getPool().query(
      `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [userId]
    );
  },

  /**
   * Permanently deletes an advisor account (cascades to related data).
   */
  async deleteById(userId: string): Promise<boolean> {
    const result = await getPool().query<{ id: string }>(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [userId]
    );
    return Boolean(result.rows[0]);
  },

  /**
   * Persists whether the advisor has finished or skipped the guided tour.
   */
  async setGuidedTourCompleted(userId: string, completed: boolean): Promise<UserRecord> {
    const result = await getPool().query<UserRow>(
      `UPDATE users
       SET completed_guided_tour = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [userId, completed]
    );
    return mapUserRow(result.rows[0]);
  },

  /**
   * Marks the advisor's email as verified.
   */
  async markEmailVerified(userId: string): Promise<UserRecord> {
    const result = await getPool().query<UserRow>(
      `UPDATE users
       SET email_verified_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [userId]
    );
    return mapUserRow(result.rows[0]);
  },

  /**
   * Updates the stored password hash after a successful reset.
   */
  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await getPool().query(
      `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
      [userId, passwordHash]
    );
  },

  /**
   * Records Terms of Service acceptance (no-op if migration 005 not applied yet).
   */
  async recordTermsAcceptance(userId: string, termsVersion: string): Promise<void> {
    const columnCheck = await getPool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'users' AND column_name = 'terms_accepted_at'
       ) AS exists`
    );

    if (!columnCheck.rows[0]?.exists) {
      return;
    }

    await getPool().query(
      `UPDATE users
       SET terms_accepted_at = NOW(),
           terms_version = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [userId, termsVersion]
    );
  },
};
