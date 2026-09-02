import crypto from 'crypto';
import { getPool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { cloneCommercialData, cloneOperationalData } from './demoWorkspaceClone';

export type ClonedDemoWorkspace = {
  companyId: string;
  visitorKey: string;
};

/**
 * Clones the active demo template company into an isolated visitor workspace.
 * Copies roles, users, reporting lines, regions, teams, personas, licences,
 * contacts, pipeline, production and activities. Applies rolling dates at clone time.
 * Never hard-deletes.
 */
export const demoWorkspaceRepository = {
  async isTemplateCompany(companyId: string): Promise<boolean> {
    const result = await getPool().query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM demo_workspace_templates WHERE company_id = $1
       ) AS exists`,
      [companyId]
    );
    return Boolean(result.rows[0]?.exists);
  },

  async assertNotTemplateCompany(companyId: string): Promise<void> {
    if (await this.isTemplateCompany(companyId)) {
      throw new AppError(
        403,
        'The demo master template cannot be changed by a public session.',
        'DEMO_TEMPLATE_IMMUTABLE'
      );
    }
  },

  async getActiveTemplateCompanyId(): Promise<string> {
    const result = await getPool().query<{ company_id: string }>(
      `SELECT company_id
       FROM demo_workspace_templates
       WHERE status = 'active'
       LIMIT 1`
    );
    const companyId = result.rows[0]?.company_id;
    if (!companyId) {
      throw new AppError(503, 'Demo workspace template is not available', 'DEMO_TEMPLATE_MISSING');
    }
    return companyId;
  },

  async cloneFromActiveTemplate(): Promise<ClonedDemoWorkspace> {
    const templateCompanyId = await this.getActiveTemplateCompanyId();
    const visitorKey = crypto.randomBytes(6).toString('hex');
    const client = await getPool().connect();

    try {
      await client.query('BEGIN');

      const company = await client.query<{ id: string }>(
        `INSERT INTO companies (name, slug, seat_limit, is_platform, is_active)
         SELECT name, $2, seat_limit, FALSE, TRUE
         FROM companies
         WHERE id = $1
         RETURNING id`,
        [templateCompanyId, `northstar-${visitorKey}`]
      );
      const companyId = company.rows[0]?.id;
      if (!companyId) {
        throw new AppError(500, 'Failed to provision demo company', 'DEMO_PROVISION_FAILED');
      }

      await client.query(
        `INSERT INTO company_roles (company_id, name, is_default, is_system)
         SELECT $2, name, is_default, is_system
         FROM company_roles
         WHERE company_id = $1`,
        [templateCompanyId, companyId]
      );

      await client.query(
        `INSERT INTO company_role_permissions (role_id, permission_key)
         SELECT nr.id, p.permission_key
         FROM company_roles tr
         INNER JOIN company_role_permissions p ON p.role_id = tr.id
         INNER JOIN company_roles nr
           ON nr.company_id = $2 AND nr.name = tr.name
         WHERE tr.company_id = $1
         ON CONFLICT DO NOTHING`,
        [templateCompanyId, companyId]
      );

      await client.query(
        `CREATE TEMP TABLE demo_user_map (
           old_id UUID PRIMARY KEY,
           new_id UUID NOT NULL
         ) ON COMMIT DROP`
      );

      const templateUsers = await client.query<{
        id: string;
        first_name: string;
        last_name: string;
        email: string;
        phone: string | null;
        role: string | null;
        password_hash: string;
        role_name: string | null;
        reports_to_user_id: string | null;
      }>(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.role, u.password_hash,
                r.name AS role_name, u.reports_to_user_id
         FROM users u
         LEFT JOIN company_roles r ON r.id = u.company_role_id
         WHERE u.company_id = $1
         ORDER BY u.created_at ASC, u.id ASC`,
        [templateCompanyId]
      );

      for (const user of templateUsers.rows) {
        const [localPart, domain] = user.email.split('@');
        const email = domain
          ? `${localPart}.${visitorKey}@${domain}`
          : `${user.email}.${visitorKey}@northstar.demo.invalid`;
        const roleId = user.role_name
          ? (
              await client.query<{ id: string }>(
                `SELECT id FROM company_roles WHERE company_id = $1 AND name = $2 LIMIT 1`,
                [companyId, user.role_name]
              )
            ).rows[0]?.id ?? null
          : null;

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO users (
             first_name, last_name, email, phone, company, role, password_hash,
             company_id, company_role_id, reports_to_user_id, is_platform_admin,
             is_active, email_verified_at, completed_guided_tour
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, FALSE, TRUE, NOW(), TRUE)
           RETURNING id`,
          [
            user.first_name,
            user.last_name,
            email.toLowerCase(),
            user.phone,
            'Northstar Advisory',
            user.role,
            user.password_hash,
            companyId,
            roleId,
          ]
        );
        await client.query(`INSERT INTO demo_user_map (old_id, new_id) VALUES ($1, $2)`, [
          user.id,
          inserted.rows[0].id,
        ]);
      }

      await client.query(
        `UPDATE users u
         SET reports_to_user_id = map_manager.new_id
         FROM demo_user_map map_self
         INNER JOIN users old_u ON old_u.id = map_self.old_id
         INNER JOIN demo_user_map map_manager ON map_manager.old_id = old_u.reports_to_user_id
         WHERE u.id = map_self.new_id
           AND u.company_id = $1`,
        [companyId]
      );

      await client.query(
        `CREATE TEMP TABLE demo_region_map (
           old_id UUID PRIMARY KEY,
           new_id UUID NOT NULL
         ) ON COMMIT DROP`
      );

      const regions = await client.query<{
        id: string;
        name: string;
        manager_user_id: string | null;
      }>(
        `SELECT id, name, manager_user_id
         FROM regions
         WHERE company_id = $1 AND is_active = TRUE`,
        [templateCompanyId]
      );

      for (const region of regions.rows) {
        const managerId = region.manager_user_id
          ? (
              await client.query<{ new_id: string }>(
                `SELECT new_id FROM demo_user_map WHERE old_id = $1`,
                [region.manager_user_id]
              )
            ).rows[0]?.new_id ?? null
          : null;
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO regions (company_id, name, manager_user_id, is_active)
           VALUES ($1, $2, $3, TRUE)
           RETURNING id`,
          [companyId, region.name, managerId]
        );
        await client.query(`INSERT INTO demo_region_map (old_id, new_id) VALUES ($1, $2)`, [
          region.id,
          inserted.rows[0].id,
        ]);
      }

      const teams = await client.query<{
        name: string;
        region_id: string;
        leader_user_id: string | null;
      }>(
        `SELECT name, region_id, leader_user_id
         FROM teams
         WHERE company_id = $1 AND is_active = TRUE`,
        [templateCompanyId]
      );

      for (const team of teams.rows) {
        const regionId = (
          await client.query<{ new_id: string }>(
            `SELECT new_id FROM demo_region_map WHERE old_id = $1`,
            [team.region_id]
          )
        ).rows[0]?.new_id;
        if (!regionId) continue;
        const leaderId = team.leader_user_id
          ? (
              await client.query<{ new_id: string }>(
                `SELECT new_id FROM demo_user_map WHERE old_id = $1`,
                [team.leader_user_id]
              )
            ).rows[0]?.new_id ?? null
          : null;
        await client.query(
          `INSERT INTO teams (company_id, region_id, name, leader_user_id, is_active)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [companyId, regionId, team.name, leaderId]
        );
      }

      await client.query(
        `INSERT INTO demo_company_personas (company_id, role, user_id, status)
         SELECT $2, p.role, map.new_id, 'active'
         FROM demo_company_personas p
         INNER JOIN demo_user_map map ON map.old_id = p.user_id
         WHERE p.company_id = $1 AND p.status = 'active'`,
        [templateCompanyId, companyId]
      );

      await cloneOperationalData(client, templateCompanyId);
      await cloneCommercialData(client, templateCompanyId, companyId);

      if (companyId === templateCompanyId) {
        throw new AppError(500, 'Demo clone must not return the master template', 'DEMO_TEMPLATE_IMMUTABLE');
      }

      await client.query('COMMIT');
      return { companyId, visitorKey };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
