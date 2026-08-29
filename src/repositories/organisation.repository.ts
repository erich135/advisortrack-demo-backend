import { getPool } from '../config/database';
import { CUSTOMER_HIERARCHY_ROLE_SEED } from '../features/customerHierarchy';
import { assertPurchasedNotBelowAssigned } from '../features/licencePool';
import { AppError } from '../middleware/errorHandler';

const COMPANY_COLUMNS = `id, name, slug, seat_limit, is_platform, is_active, created_at`;

export interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  seat_limit: number | null;
  is_platform: boolean;
  is_active: boolean;
  created_at: Date;
  member_count?: string | number;
  subscription_status?: string;
  package_id?: string | null;
  subscription_started_at?: Date | null;
  next_billing_at?: Date | null;
  vat_registered?: boolean;
  vat_rate_percent?: string | number | null;
  billing_contact_user_id?: string | null;
  billing_contact_name?: string | null;
  billing_contact_email?: string | null;
}

export interface CompanySubscriptionRow extends CompanyRow {
  package_slug: string | null;
  package_name: string | null;
  price_cents: number | null;
  currency: string | null;
  billing_interval: string | null;
  billing_user_first_name: string | null;
  billing_user_last_name: string | null;
  billing_user_email: string | null;
  assigned_count: number;
}

export interface SubscriptionAuditRow {
  id: string;
  action: string;
  resource_type: string;
  resource_count: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  actor_first_name: string | null;
  actor_last_name: string | null;
  actor_email: string;
}

const COMPANY_SUBSCRIPTION_SELECT = `
  c.id, c.name, c.slug, c.seat_limit, c.is_platform, c.is_active, c.created_at,
  COALESCE(cs.status, 'active') AS subscription_status,
  cs.package_id,
  cs.started_at AS subscription_started_at,
  cs.next_billing_at,
  COALESCE(cs.vat_registered, FALSE) AS vat_registered,
  cs.vat_rate_percent,
  cs.billing_contact_user_id,
  cs.billing_contact_name,
  cs.billing_contact_email,
  p.slug AS package_slug, p.name AS package_name, p.price_cents, p.currency, p.billing_interval,
  bu.first_name AS billing_user_first_name, bu.last_name AS billing_user_last_name,
  bu.email AS billing_user_email,
  COALESCE(lic.assigned, 0)::int AS assigned_count
`;

const COMPANY_SUBSCRIPTION_FROM = `
  FROM companies c
  LEFT JOIN company_subscriptions cs ON cs.company_id = c.id
  LEFT JOIN subscription_packages p ON p.id = cs.package_id
  LEFT JOIN users bu ON bu.id = cs.billing_contact_user_id
  LEFT JOIN (
    SELECT u.company_id, COUNT(*)::int AS assigned
    FROM users u
    INNER JOIN user_subscriptions us ON us.user_id = u.id
    INNER JOIN subscription_packages sp ON sp.id = us.package_id
    WHERE us.status IN ('active', 'trialing')
      AND sp.slug <> 'free'
    GROUP BY u.company_id
  ) lic ON lic.company_id = c.id
`;

export interface CompanyRoleRow {
  id: string;
  company_id: string;
  name: string;
  is_default: boolean;
  is_system: boolean;
  created_at: Date;
}

export interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  company_id: string | null;
  company_role_id: string | null;
  role_name: string | null;
  reports_to_user_id: string | null;
  is_platform_admin: boolean;
  is_active: boolean;
  last_login_at: Date | null;
  last_mobile_activity_at: Date | null;
  email_verified_at: Date | null;
  created_at: Date;
  package_slug: string | null;
  package_name: string | null;
  subscription_status: string | null;
}

export interface MembershipRow {
  user_id: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  seat_limit: number | null;
  company_role_id: string | null;
  role_name: string | null;
  reports_to_user_id: string | null;
  is_platform_admin: boolean;
  is_platform_company: boolean;
}

/**
 * PostgreSQL persistence for companies, roles, and membership.
 */
export const organisationRepository = {
  /**
   * Loads the platform company used for self-serve sign-ups.
   */
  async findPlatformCompany(): Promise<CompanyRow | null> {
    const result = await getPool().query<CompanyRow>(
      `SELECT ${COMPANY_COLUMNS}
       FROM companies
       WHERE is_platform = TRUE AND is_active = TRUE
       LIMIT 1`
    );
    return result.rows[0] ?? null;
  },

  /**
   * Finds a company by id.
   */
  async findCompanyById(id: string): Promise<CompanyRow | null> {
    const result = await getPool().query<CompanyRow>(
      `SELECT ${COMPANY_COLUMNS}
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Lists all companies with member counts for platform staff.
   */
  async listCompanies(): Promise<CompanyRow[]> {
    const result = await getPool().query<CompanyRow>(
      `SELECT c.id, c.name, c.slug, c.seat_limit, c.is_platform, c.is_active, c.created_at,
              COUNT(u.id)::int AS member_count
       FROM companies c
       LEFT JOIN users u ON u.company_id = c.id
       GROUP BY c.id
       ORDER BY c.is_platform DESC, c.name ASC`
    );
    return result.rows;
  },

  /**
   * Creates a company and returns the inserted row.
   */
  async createCompany(input: {
    name: string;
    slug: string;
    seatLimit?: number | null;
  }): Promise<CompanyRow> {
    const result = await getPool().query<CompanyRow>(
      `INSERT INTO companies (name, slug, seat_limit)
       VALUES ($1, $2, $3)
       RETURNING ${COMPANY_COLUMNS}`,
      [input.name, input.slug, input.seatLimit ?? null]
    );
    return result.rows[0];
  },

  /**
   * Updates company name or account active flag. Purchased seats use setPurchasedSeats.
   */
  async updateCompany(
    id: string,
    input: { name?: string; isActive?: boolean }
  ): Promise<CompanyRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    let param = 2;

    if (input.name !== undefined) {
      sets.push(`name = $${param++}`);
      values.push(input.name);
    }
    if (input.isActive !== undefined) {
      sets.push(`is_active = $${param++}`);
      values.push(input.isActive);
    }

    if (sets.length === 0) {
      return this.findCompanyById(id);
    }

    sets.push('updated_at = NOW()');
    const result = await getPool().query<CompanyRow>(
      `UPDATE companies SET ${sets.join(', ')} WHERE id = $1
       RETURNING ${COMPANY_COLUMNS}`,
      values
    );
    return result.rows[0] ?? null;
  },

  /**
   * Locks the company row and sets purchased licences if the new quantity is not below assigned.
   */
  async setPurchasedSeats(input: {
    companyId: string;
    actorUserId: string;
    purchased: number | null;
    reason?: string | null;
  }): Promise<{ previous: number | null; next: number | null; assigned: number }> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const company = await client.query<{ seat_limit: number | null }>(
        `SELECT seat_limit FROM companies WHERE id = $1 FOR UPDATE`,
        [input.companyId]
      );
      if (!company.rows[0]) {
        await client.query('ROLLBACK');
        throw new AppError(404, 'Company not found', 'NOT_FOUND');
      }
      const previous = company.rows[0].seat_limit;
      const usedResult = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM users u
         INNER JOIN user_subscriptions us ON us.user_id = u.id
         INNER JOIN subscription_packages p ON p.id = us.package_id
         WHERE u.company_id = $1
           AND us.status IN ('active', 'trialing')
           AND p.slug <> 'free'`,
        [input.companyId]
      );
      const assigned = Number(usedResult.rows[0]?.count ?? 0);
      assertPurchasedNotBelowAssigned(input.purchased, assigned);

      await client.query(
        `UPDATE companies SET seat_limit = $2, updated_at = NOW() WHERE id = $1`,
        [input.companyId, input.purchased]
      );

      const difference =
        previous == null || input.purchased == null ? null : input.purchased - previous;
      await client.query(
        `INSERT INTO popia_audit_log (user_id, action, resource_type, resource_count, metadata)
         VALUES ($1, 'purchased_licences_changed', 'subscription', $2, $3::jsonb)`,
        [
          input.actorUserId,
          difference == null ? 0 : Math.abs(difference),
          JSON.stringify({
            companyId: input.companyId,
            previousQuantity: previous,
            newQuantity: input.purchased,
            difference,
            reason: input.reason ?? null,
          }),
        ]
      );
      await client.query('COMMIT');
      return { previous, next: input.purchased, assigned };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async listCustomerSubscriptions(): Promise<CompanySubscriptionRow[]> {
    const result = await getPool().query<CompanySubscriptionRow>(
      `SELECT ${COMPANY_SUBSCRIPTION_SELECT}
       ${COMPANY_SUBSCRIPTION_FROM}
       WHERE c.is_platform = FALSE
       ORDER BY c.name ASC`
    );
    return result.rows;
  },

  async findCompanySubscription(companyId: string): Promise<CompanySubscriptionRow | null> {
    const result = await getPool().query<CompanySubscriptionRow>(
      `SELECT ${COMPANY_SUBSCRIPTION_SELECT}
       ${COMPANY_SUBSCRIPTION_FROM}
       WHERE c.id = $1
       LIMIT 1`,
      [companyId]
    );
    return result.rows[0] ?? null;
  },

  async updateSubscriptionFields(
    id: string,
    input: {
      subscriptionStatus?: string;
      packageId?: string | null;
      subscriptionStartedAt?: Date | null;
      nextBillingAt?: Date | null;
      vatRegistered?: boolean;
      vatRatePercent?: number | null;
      billingContactUserId?: string | null;
      billingContactName?: string | null;
      billingContactEmail?: string | null;
    }
  ): Promise<CompanyRow | null> {
    const existing = await this.findCompanyById(id);
    if (!existing) return null;

    await getPool().query(
      `INSERT INTO company_subscriptions (company_id) VALUES ($1)
       ON CONFLICT (company_id) DO NOTHING`,
      [id]
    );

    const sets: string[] = [];
    const values: unknown[] = [id];
    let param = 2;

    if (input.subscriptionStatus !== undefined) {
      sets.push(`status = $${param++}`);
      values.push(input.subscriptionStatus);
    }
    if (input.packageId !== undefined) {
      sets.push(`package_id = $${param++}`);
      values.push(input.packageId);
    }
    if (input.subscriptionStartedAt !== undefined) {
      sets.push(`started_at = $${param++}`);
      values.push(input.subscriptionStartedAt);
    }
    if (input.nextBillingAt !== undefined) {
      sets.push(`next_billing_at = $${param++}`);
      values.push(input.nextBillingAt);
    }
    if (input.vatRegistered !== undefined) {
      sets.push(`vat_registered = $${param++}`);
      values.push(input.vatRegistered);
    }
    if (input.vatRatePercent !== undefined) {
      sets.push(`vat_rate_percent = $${param++}`);
      values.push(input.vatRatePercent);
    }
    if (input.billingContactUserId !== undefined) {
      sets.push(`billing_contact_user_id = $${param++}`);
      values.push(input.billingContactUserId);
    }
    if (input.billingContactName !== undefined) {
      sets.push(`billing_contact_name = $${param++}`);
      values.push(input.billingContactName);
    }
    if (input.billingContactEmail !== undefined) {
      sets.push(`billing_contact_email = $${param++}`);
      values.push(input.billingContactEmail);
    }

    if (sets.length === 0) {
      return existing;
    }

    await getPool().query(
      `UPDATE company_subscriptions SET ${sets.join(', ')} WHERE company_id = $1`,
      values
    );
    return this.findCompanyById(id);
  },

  async listSubscriptionAudit(companyId: string): Promise<SubscriptionAuditRow[]> {
    const result = await getPool().query<SubscriptionAuditRow>(
      `SELECT
         a.id,
         a.action,
         a.resource_type,
         a.resource_count,
         a.metadata,
         a.created_at,
         u.first_name AS actor_first_name,
         u.last_name AS actor_last_name,
         u.email AS actor_email
       FROM popia_audit_log a
       INNER JOIN users u ON u.id = a.user_id
       WHERE a.metadata->>'companyId' = $1
         AND a.resource_type IN ('licence', 'subscription')
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [companyId]
    );
    return result.rows;
  },

  async listAdminAudit(input?: {
    companyId?: string;
    resourceType?: string;
    /** When set, only events whose actor or target user is in this server-resolved set. */
    permittedUserIds?: string[];
  }): Promise<SubscriptionAuditRow[]> {
    const result = await getPool().query<SubscriptionAuditRow>(
      `SELECT
         a.id,
         a.action,
         a.resource_type,
         a.resource_count,
         a.metadata,
         a.created_at,
         u.first_name AS actor_first_name,
         u.last_name AS actor_last_name,
         u.email AS actor_email
       FROM popia_audit_log a
       INNER JOIN users u ON u.id = a.user_id
       WHERE a.resource_type IN ('licence', 'subscription', 'user', 'invoice', 'organisation')
         AND ($1::text IS NULL OR a.metadata->>'companyId' = $1)
         AND ($2::text IS NULL OR a.resource_type = $2)
         AND ($3::uuid[] IS NULL OR (
           a.user_id = ANY($3::uuid[])
           OR COALESCE(a.metadata->>'targetUserId', '') = ANY(SELECT unnest($3::uuid[])::text)
         ))
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [
        input?.companyId ?? null,
        input?.resourceType ?? null,
        input?.permittedUserIds === undefined ? null : input.permittedUserIds,
      ]
    );
    return result.rows;
  },

  /**
   * Lists roles for a company.
   */
  async listRoles(companyId: string): Promise<CompanyRoleRow[]> {
    const result = await getPool().query<CompanyRoleRow>(
      `SELECT id, company_id, name, is_default, is_system, created_at
       FROM company_roles
       WHERE company_id = $1
       ORDER BY is_system DESC, name ASC`,
      [companyId]
    );
    return result.rows;
  },

  /**
   * Finds a single role in a company.
   */
  async findRole(companyId: string, roleId: string): Promise<CompanyRoleRow | null> {
    const result = await getPool().query<CompanyRoleRow>(
      `SELECT id, company_id, name, is_default, is_system, created_at
       FROM company_roles
       WHERE company_id = $1 AND id = $2
       LIMIT 1`,
      [companyId, roleId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Permission keys attached to a role.
   */
  async listRolePermissionKeys(roleId: string): Promise<string[]> {
    const result = await getPool().query<{ permission_key: string }>(
      `SELECT permission_key FROM company_role_permissions WHERE role_id = $1 ORDER BY permission_key`,
      [roleId]
    );
    return result.rows.map((row) => row.permission_key);
  },

  /**
   * Creates a custom role. Optionally marks it as the default join role.
   */
  async createRole(input: {
    companyId: string;
    name: string;
    isDefault?: boolean;
  }): Promise<CompanyRoleRow> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      if (input.isDefault) {
        await client.query(`UPDATE company_roles SET is_default = FALSE WHERE company_id = $1`, [
          input.companyId,
        ]);
      }
      const result = await client.query<CompanyRoleRow>(
        `INSERT INTO company_roles (company_id, name, is_default, is_system)
         VALUES ($1, $2, $3, FALSE)
         RETURNING id, company_id, name, is_default, is_system, created_at`,
        [input.companyId, input.name, Boolean(input.isDefault)]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Renames a role, updates default flag, and replaces its permission set.
   */
  async updateRole(
    roleId: string,
    companyId: string,
    input: { name?: string; isDefault?: boolean; permissions?: string[] }
  ): Promise<CompanyRoleRow | null> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      if (input.isDefault) {
        await client.query(`UPDATE company_roles SET is_default = FALSE WHERE company_id = $1`, [
          companyId,
        ]);
      }

      const sets: string[] = [];
      const values: unknown[] = [roleId, companyId];
      let param = 3;
      if (input.name !== undefined) {
        sets.push(`name = $${param++}`);
        values.push(input.name);
      }
      if (input.isDefault !== undefined) {
        sets.push(`is_default = $${param++}`);
        values.push(input.isDefault);
      }

      if (sets.length > 0) {
        sets.push('updated_at = NOW()');
        await client.query(
          `UPDATE company_roles SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
          values
        );
      }

      if (input.permissions) {
        await client.query(`DELETE FROM company_role_permissions WHERE role_id = $1`, [roleId]);
        for (const key of input.permissions) {
          await client.query(
            `INSERT INTO company_role_permissions (role_id, permission_key) VALUES ($1, $2)`,
            [roleId, key]
          );
        }
      }

      await client.query('COMMIT');
      return this.findRole(companyId, roleId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Deletes a non-system role. Members on that role are moved to the default role.
   */
  async deleteRole(roleId: string, companyId: string): Promise<boolean> {
    const role = await this.findRole(companyId, roleId);
    if (!role || role.is_system) {
      return false;
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const defaultRole = await client.query<{ id: string }>(
        `SELECT id FROM company_roles WHERE company_id = $1 AND is_default = TRUE LIMIT 1`,
        [companyId]
      );
      const fallbackId = defaultRole.rows[0]?.id ?? null;
      if (fallbackId) {
        await client.query(
          `UPDATE users SET company_role_id = $1 WHERE company_id = $2 AND company_role_id = $3`,
          [fallbackId, companyId, roleId]
        );
      }
      await client.query(`DELETE FROM company_roles WHERE id = $1 AND company_id = $2`, [
        roleId,
        companyId,
      ]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Seeds Advisor + Company admin roles on a newly created company.
   */
  async seedDefaultRoles(companyId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO company_roles (company_id, name, is_default, is_system)
       VALUES ($1, 'Advisor', TRUE, TRUE), ($1, 'Company admin', FALSE, TRUE)
       ON CONFLICT (company_id, name) DO NOTHING`,
      [companyId]
    );

    await getPool().query(
      `INSERT INTO company_role_permissions (role_id, permission_key)
       SELECT r.id, p.permission_key
       FROM company_roles r
       CROSS JOIN (
         VALUES ('view_company'), ('view_team'), ('manage_roles'), ('manage_members'), ('manage_company')
       ) AS p(permission_key)
       WHERE r.company_id = $1 AND r.name = 'Company admin'
       ON CONFLICT DO NOTHING`,
      [companyId]
    );

    await this.ensureCustomerHierarchyRoles(companyId);
  },

  /**
   * Ensures Executive / Regional Manager / Team Leader / Financial Advisor exist.
   * Inserts missing rows only — does not create a schema migration.
   */
  async ensureCustomerHierarchyRoles(companyId: string): Promise<void> {
    for (const role of CUSTOMER_HIERARCHY_ROLE_SEED) {
      await getPool().query(
        `INSERT INTO company_roles (company_id, name, is_default, is_system)
         VALUES ($1, $2, FALSE, TRUE)
         ON CONFLICT (company_id, name) DO NOTHING`,
        [companyId, role.name]
      );

      if (role.permissions.length === 0) continue;

      await getPool().query(
        `INSERT INTO company_role_permissions (role_id, permission_key)
         SELECT r.id, p.permission_key
         FROM company_roles r
         CROSS JOIN UNNEST($2::text[]) AS p(permission_key)
         WHERE r.company_id = $1 AND r.name = $3
         ON CONFLICT DO NOTHING`,
        [companyId, role.permissions, role.name]
      );
    }
  },

  /**
   * Loads company membership for one user.
   */
  async findMembership(userId: string): Promise<MembershipRow | null> {
    const result = await getPool().query<MembershipRow>(
      `SELECT
         u.id AS user_id,
         u.company_id,
         c.name AS company_name,
         c.slug AS company_slug,
         c.seat_limit,
         u.company_role_id,
         r.name AS role_name,
         u.reports_to_user_id,
         u.is_platform_admin,
         COALESCE(c.is_platform, FALSE) AS is_platform_company
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       LEFT JOIN company_roles r ON r.id = u.company_role_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Lists user IDs in a company, optionally narrowed to one manager's direct reports.
   * This is the lightweight primitive used to resolve reusable management scope.
   */
  async listMemberIds(companyId: string, reportsToUserId?: string): Promise<string[]> {
    const result = await getPool().query<{ id: string }>(
      `SELECT id
       FROM users
       WHERE company_id = $1
         AND ($2::uuid IS NULL OR reports_to_user_id = $2)
       ORDER BY id ASC`,
      [companyId, reportsToUserId ?? null]
    );
    return result.rows.map((row) => row.id);
  },

  /**
   * Member IDs in a manager's authorised downline, including the manager.
   * Region and team scope are this reporting tree inside the caller's company.
   */
  async listDownlineMemberIds(companyId: string, managerUserId: string): Promise<string[]> {
    const result = await getPool().query<{ id: string }>(
      `WITH RECURSIVE downline AS (
         SELECT id, company_id, ARRAY[id] AS seen
         FROM users
         WHERE id = $2 AND company_id = $1
         UNION ALL
         SELECT u.id, u.company_id, d.seen || u.id
         FROM users u
         INNER JOIN downline d
           ON u.reports_to_user_id = d.id
          AND u.company_id = d.company_id
         WHERE NOT u.id = ANY(d.seen)
       )
       SELECT id FROM downline ORDER BY id ASC`,
      [companyId, managerUserId]
    );
    return result.rows.map((row) => row.id);
  },

  /**
   * Lists members of a company with role and subscription snapshot, optionally
   * restricted to a server-resolved set of permitted user IDs.
   */
  async listMembers(companyId: string, permittedUserIds?: string[]): Promise<MemberRow[]> {
    const result = await getPool().query<MemberRow>(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.email::text AS email,
         u.phone,
         u.company_id,
         u.company_role_id,
         r.name AS role_name,
         u.reports_to_user_id,
         u.is_platform_admin,
         u.is_active,
         u.last_login_at,
         u.last_mobile_activity_at,
         u.email_verified_at,
         u.created_at,
         p.slug AS package_slug,
         p.name AS package_name,
         us.status AS subscription_status
       FROM users u
       LEFT JOIN company_roles r ON r.id = u.company_role_id
       LEFT JOIN user_subscriptions us ON us.user_id = u.id
       LEFT JOIN subscription_packages p ON p.id = us.package_id
       WHERE u.company_id = $1
         AND ($2::uuid[] IS NULL OR u.id = ANY($2::uuid[]))
       ORDER BY u.last_name ASC, u.first_name ASC`,
      [companyId, permittedUserIds ?? null]
    );
    return result.rows;
  },

  /**
   * Assigns a role, manager, profile fields, or account status for a member.
   */
  async updateMember(
    companyId: string,
    userId: string,
    input: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string | null;
      companyRoleId?: string;
      reportsToUserId?: string | null;
      isActive?: boolean;
    }
  ): Promise<MemberRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [userId, companyId];
    let param = 3;

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
    if (input.companyRoleId !== undefined) {
      sets.push(`company_role_id = $${param++}`);
      values.push(input.companyRoleId);
    }
    if (input.reportsToUserId !== undefined) {
      sets.push(`reports_to_user_id = $${param++}`);
      values.push(input.reportsToUserId);
    }
    if (input.isActive !== undefined) {
      sets.push(`is_active = $${param++}`);
      values.push(input.isActive);
    }

    if (sets.length === 0) {
      const members = await this.listMembers(companyId);
      return members.find((row) => row.id === userId) ?? null;
    }

    sets.push('updated_at = NOW()');
    await getPool().query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
      values
    );

    const members = await this.listMembers(companyId);
    return members.find((row) => row.id === userId) ?? null;
  },

  /**
   * Creates a company member. company_id is set explicitly so the default-company trigger is not used.
   */
  async createMember(input: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
    profileRole: string;
    companyId: string;
    companyRoleId: string;
    reportsToUserId: string | null;
  }): Promise<MemberRow> {
    const result = await getPool().query<{ id: string }>(
      `INSERT INTO users (
         first_name, last_name, email, phone, password_hash, role,
         company_id, company_role_id, reports_to_user_id, is_active, email_verified_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, NOW())
       RETURNING id`,
      [
        input.firstName,
        input.lastName,
        input.email.toLowerCase(),
        input.phone ?? null,
        input.passwordHash,
        input.profileRole,
        input.companyId,
        input.companyRoleId,
        input.reportsToUserId,
      ]
    );
    const members = await this.listMembers(input.companyId);
    const created = members.find((row) => row.id === result.rows[0].id);
    if (!created) {
      throw new Error('Created member could not be reloaded');
    }
    return created;
  },

  /**
   * Count of currently licensed (paid, active/trialing) seats in a company.
   */
  async countLicensedSeats(companyId: string): Promise<number> {
    const result = await getPool().query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM users u
       INNER JOIN user_subscriptions us ON us.user_id = u.id
       INNER JOIN subscription_packages p ON p.id = us.package_id
       WHERE u.company_id = $1
         AND us.status IN ('active', 'trialing')
         AND p.slug <> 'free'`,
      [companyId]
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  /**
   * Assigns a paid licence while the company row is locked so assigned cannot exceed purchased.
   */
  async tryAssignLicensedSeat(input: {
    companyId: string;
    memberId: string;
    actorUserId: string;
    packageId: string;
    status?: string;
    trialEndsAt?: Date | null;
    currentPeriodEnd?: Date | null;
  }): Promise<{ assigned: boolean; purchased: number | null; used: number }> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const company = await client.query<{ seat_limit: number | null }>(
        `SELECT seat_limit FROM companies WHERE id = $1 FOR UPDATE`,
        [input.companyId]
      );
      if (!company.rows[0]) {
        await client.query('ROLLBACK');
        return { assigned: false, purchased: null, used: 0 };
      }
      const purchased = company.rows[0].seat_limit;
      const usedResult = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM users u
         INNER JOIN user_subscriptions us ON us.user_id = u.id
         INNER JOIN subscription_packages p ON p.id = us.package_id
         WHERE u.company_id = $1
           AND us.status IN ('active', 'trialing')
           AND p.slug <> 'free'`,
        [input.companyId]
      );
      const used = Number(usedResult.rows[0]?.count ?? 0);
      if (purchased != null && used >= purchased) {
        await client.query('ROLLBACK');
        return { assigned: false, purchased, used };
      }

      await client.query(
        `INSERT INTO user_subscriptions (user_id, package_id, status, trial_ends_at, current_period_end)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           package_id = EXCLUDED.package_id,
           status = EXCLUDED.status,
           trial_ends_at = EXCLUDED.trial_ends_at,
           current_period_end = EXCLUDED.current_period_end,
           updated_at = NOW()`,
        [
          input.memberId,
          input.packageId,
          input.status ?? 'active',
          input.trialEndsAt ?? null,
          input.currentPeriodEnd ?? null,
        ]
      );
      await client.query(
        `INSERT INTO popia_audit_log (user_id, action, resource_type, resource_count, metadata)
         VALUES ($1, 'licence_assigned', 'licence', 1, $2::jsonb)`,
        [
          input.actorUserId,
          JSON.stringify({ companyId: input.companyId, targetUserId: input.memberId, previousValue: 'Unlicensed', newValue: 'Licensed' }),
        ]
      );
      await client.query('COMMIT');
      return { assigned: true, purchased, used: used + 1 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async recordAuditEvent(
    actorUserId: string,
    action: string,
    resourceType: 'licence' | 'subscription' | 'user' | 'invoice' | 'organisation',
    metadata: Record<string, unknown>,
    resourceCount = 1
  ): Promise<void> {
    await getPool().query(
      `INSERT INTO popia_audit_log (user_id, action, resource_type, resource_count, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [actorUserId, action, resourceType, resourceCount, JSON.stringify(metadata)]
    );
  },

  async recordLicenceEvent(
    actorUserId: string,
    action: 'licence_assigned' | 'licence_removed',
    metadata: { companyId: string; targetUserId: string; previousValue?: string; newValue?: string }
  ): Promise<void> {
    await this.recordAuditEvent(actorUserId, action, 'licence', metadata);
  },
};
