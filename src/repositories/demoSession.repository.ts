import crypto from 'crypto';
import { getPool } from '../config/database';

export type DemoSessionStatus = 'active' | 'expired' | 'archived';
export type DemoSelectedRole = 'executive' | 'regional_manager' | 'team_leader';

export type DemoSessionRow = {
  id: string;
  token_hash: string;
  company_id: string | null;
  selected_role: DemoSelectedRole | null;
  status: DemoSessionStatus;
  created_at: Date;
  expires_at: Date;
};

const COLUMNS = `
  id, token_hash, company_id, selected_role, status, created_at, expires_at
`;

const mapRow = (row: DemoSessionRow): DemoSessionRow => row;

export const hashDemoSessionToken = (token: string): string =>
  crypto.createHash('sha256').update(token, 'utf8').digest('hex');

export const demoSessionRepository = {
  async insert(input: {
    tokenHash: string;
    companyId: string | null;
    selectedRole: DemoSelectedRole | null;
    expiresAt: Date;
  }): Promise<DemoSessionRow> {
    const result = await getPool().query<DemoSessionRow>(
      `INSERT INTO demo_sessions (token_hash, company_id, selected_role, status, expires_at)
       VALUES ($1, $2, $3, 'active', $4)
       RETURNING ${COLUMNS}`,
      [input.tokenHash, input.companyId, input.selectedRole, input.expiresAt]
    );
    return mapRow(result.rows[0]);
  },

  async findByTokenHash(tokenHash: string): Promise<DemoSessionRow | null> {
    const result = await getPool().query<DemoSessionRow>(
      `SELECT ${COLUMNS} FROM demo_sessions WHERE token_hash = $1`,
      [tokenHash]
    );
    return result.rows[0] ?? null;
  },

  async findById(id: string): Promise<DemoSessionRow | null> {
    const result = await getPool().query<DemoSessionRow>(
      `SELECT ${COLUMNS} FROM demo_sessions WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  },

  async setStatus(id: string, status: DemoSessionStatus): Promise<DemoSessionRow | null> {
    const result = await getPool().query<DemoSessionRow>(
      `UPDATE demo_sessions
       SET status = $2
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, status]
    );
    return result.rows[0] ?? null;
  },

  async setSelectedRole(
    id: string,
    selectedRole: DemoSelectedRole
  ): Promise<DemoSessionRow | null> {
    const result = await getPool().query<DemoSessionRow>(
      `UPDATE demo_sessions
       SET selected_role = $2
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [id, selectedRole]
    );
    return result.rows[0] ?? null;
  },

  async repoint(input: {
    id: string;
    companyId: string;
    selectedRole: DemoSelectedRole;
    expiresAt: Date;
  }): Promise<DemoSessionRow | null> {
    const result = await getPool().query<DemoSessionRow>(
      `UPDATE demo_sessions
       SET company_id = $2,
           selected_role = $3,
           expires_at = $4
       WHERE id = $1 AND status = 'active'
       RETURNING ${COLUMNS}`,
      [input.id, input.companyId, input.selectedRole, input.expiresAt]
    );
    return result.rows[0] ?? null;
  },

  async expireActivePast(now: Date = new Date()): Promise<DemoSessionRow[]> {
    const result = await getPool().query<DemoSessionRow>(
      `UPDATE demo_sessions
       SET status = 'expired'
       WHERE status = 'active'
         AND expires_at <= $1
       RETURNING ${COLUMNS}`,
      [now]
    );
    return result.rows;
  },
};
