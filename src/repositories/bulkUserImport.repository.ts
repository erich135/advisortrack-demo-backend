import { getPool } from '../config/database';

function missingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '42P01';
}

export const bulkUserImportRepository = {
  async findEmailOwners(
    emails: string[]
  ): Promise<Array<{ id: string; email: string; companyId: string | null }>> {
    if (emails.length === 0) return [];
    const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    const result = await getPool().query<{ id: string; email: string; company_id: string | null }>(
      `SELECT id, email::text AS email, company_id
       FROM users
       WHERE lower(email::text) = ANY($1::text[])`,
      [unique]
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: String(row.email).toLowerCase(),
      companyId: row.company_id,
    }));
  },

  async insert(): Promise<null> {
    return null;
  },

  async insertRow(): Promise<void> {
    return;
  },

  async complete(): Promise<void> {
    return;
  },

  async ensureAvailable(): Promise<boolean> {
    try {
      await getPool().query(`SELECT 1 FROM bulk_user_imports LIMIT 0`);
      return true;
    } catch (error) {
      if (missingTable(error)) return false;
      throw error;
    }
  },
};
