import { getPool } from '../config/database';
import type { DemoSelectedRole } from './demoSession.repository';

export type DemoPersonaRow = {
  id: string;
  company_id: string;
  role: DemoSelectedRole;
  user_id: string;
  status: 'active' | 'archived';
  created_at: Date;
};

export const demoPersonaRepository = {
  async findActive(companyId: string, role: DemoSelectedRole): Promise<DemoPersonaRow | null> {
    const result = await getPool().query<DemoPersonaRow>(
      `SELECT id, company_id, role, user_id, status, created_at
       FROM demo_company_personas
       WHERE company_id = $1 AND role = $2 AND status = 'active'
       LIMIT 1`,
      [companyId, role]
    );
    return result.rows[0] ?? null;
  },

  async listActive(companyId: string): Promise<DemoPersonaRow[]> {
    const result = await getPool().query<DemoPersonaRow>(
      `SELECT id, company_id, role, user_id, status, created_at
       FROM demo_company_personas
       WHERE company_id = $1 AND status = 'active'
       ORDER BY role`,
      [companyId]
    );
    return result.rows;
  },
};
