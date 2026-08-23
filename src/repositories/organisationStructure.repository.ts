import { getPool } from '../config/database';

export interface RegionRow {
  id: string;
  company_id: string;
  name: string;
  manager_user_id: string | null;
  manager_first_name: string | null;
  manager_last_name: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TeamRow {
  id: string;
  company_id: string;
  region_id: string;
  region_name: string;
  name: string;
  leader_user_id: string | null;
  leader_first_name: string | null;
  leader_last_name: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const REGION_SELECT = `
  r.id,
  r.company_id,
  r.name,
  r.manager_user_id,
  m.first_name AS manager_first_name,
  m.last_name AS manager_last_name,
  r.is_active,
  r.created_at,
  r.updated_at
`;

const TEAM_SELECT = `
  t.id,
  t.company_id,
  t.region_id,
  rg.name AS region_name,
  t.name,
  t.leader_user_id,
  l.first_name AS leader_first_name,
  l.last_name AS leader_last_name,
  t.is_active,
  t.created_at,
  t.updated_at
`;

/**
 * Persistence for organisation regions and teams.
 */
export const organisationStructureRepository = {
  async listRegions(companyId: string, regionIds?: string[]): Promise<RegionRow[]> {
    const result = await getPool().query<RegionRow>(
      `SELECT ${REGION_SELECT}
       FROM regions r
       LEFT JOIN users m ON m.id = r.manager_user_id
       WHERE r.company_id = $1
         AND ($2::uuid[] IS NULL OR r.id = ANY($2::uuid[]))
       ORDER BY r.is_active DESC, r.name ASC`,
      [companyId, regionIds ?? null]
    );
    return result.rows;
  },

  async findRegion(companyId: string, regionId: string): Promise<RegionRow | null> {
    const result = await getPool().query<RegionRow>(
      `SELECT ${REGION_SELECT}
       FROM regions r
       LEFT JOIN users m ON m.id = r.manager_user_id
       WHERE r.company_id = $1 AND r.id = $2
       LIMIT 1`,
      [companyId, regionId]
    );
    return result.rows[0] ?? null;
  },

  async findActiveRegionByManager(companyId: string, managerUserId: string): Promise<RegionRow | null> {
    const result = await getPool().query<RegionRow>(
      `SELECT ${REGION_SELECT}
       FROM regions r
       LEFT JOIN users m ON m.id = r.manager_user_id
       WHERE r.company_id = $1
         AND r.manager_user_id = $2
         AND r.is_active = TRUE
       LIMIT 1`,
      [companyId, managerUserId]
    );
    return result.rows[0] ?? null;
  },

  async createRegion(input: {
    companyId: string;
    name: string;
    managerUserId: string | null;
  }): Promise<RegionRow> {
    const inserted = await getPool().query<{ id: string }>(
      `INSERT INTO regions (company_id, name, manager_user_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [input.companyId, input.name, input.managerUserId]
    );
    const row = await this.findRegion(input.companyId, inserted.rows[0].id);
    if (!row) throw new Error('Created region could not be reloaded');
    return row;
  },

  async updateRegion(
    companyId: string,
    regionId: string,
    input: { name?: string; managerUserId?: string | null; isActive?: boolean }
  ): Promise<RegionRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [regionId, companyId];
    let param = 3;

    if (input.name !== undefined) {
      sets.push(`name = $${param++}`);
      values.push(input.name);
    }
    if (input.managerUserId !== undefined) {
      sets.push(`manager_user_id = $${param++}`);
      values.push(input.managerUserId);
    }
    if (input.isActive !== undefined) {
      sets.push(`is_active = $${param++}`);
      values.push(input.isActive);
    }

    if (sets.length === 0) {
      return this.findRegion(companyId, regionId);
    }

    await getPool().query(
      `UPDATE regions SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
      values
    );
    return this.findRegion(companyId, regionId);
  },

  async listTeams(
    companyId: string,
    filters?: { regionId?: string; teamIds?: string[] }
  ): Promise<TeamRow[]> {
    const result = await getPool().query<TeamRow>(
      `SELECT ${TEAM_SELECT}
       FROM teams t
       INNER JOIN regions rg ON rg.id = t.region_id
       LEFT JOIN users l ON l.id = t.leader_user_id
       WHERE t.company_id = $1
         AND ($2::uuid IS NULL OR t.region_id = $2)
         AND ($3::uuid[] IS NULL OR t.id = ANY($3::uuid[]))
       ORDER BY t.is_active DESC, rg.name ASC, t.name ASC`,
      [companyId, filters?.regionId ?? null, filters?.teamIds ?? null]
    );
    return result.rows;
  },

  async findTeam(companyId: string, teamId: string): Promise<TeamRow | null> {
    const result = await getPool().query<TeamRow>(
      `SELECT ${TEAM_SELECT}
       FROM teams t
       INNER JOIN regions rg ON rg.id = t.region_id
       LEFT JOIN users l ON l.id = t.leader_user_id
       WHERE t.company_id = $1 AND t.id = $2
       LIMIT 1`,
      [companyId, teamId]
    );
    return result.rows[0] ?? null;
  },

  async findActiveTeamByLeader(companyId: string, leaderUserId: string): Promise<TeamRow | null> {
    const result = await getPool().query<TeamRow>(
      `SELECT ${TEAM_SELECT}
       FROM teams t
       INNER JOIN regions rg ON rg.id = t.region_id
       LEFT JOIN users l ON l.id = t.leader_user_id
       WHERE t.company_id = $1
         AND t.leader_user_id = $2
         AND t.is_active = TRUE
       LIMIT 1`,
      [companyId, leaderUserId]
    );
    return result.rows[0] ?? null;
  },

  async createTeam(input: {
    companyId: string;
    regionId: string;
    name: string;
    leaderUserId: string | null;
  }): Promise<TeamRow> {
    const inserted = await getPool().query<{ id: string }>(
      `INSERT INTO teams (company_id, region_id, name, leader_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.companyId, input.regionId, input.name, input.leaderUserId]
    );
    const row = await this.findTeam(input.companyId, inserted.rows[0].id);
    if (!row) throw new Error('Created team could not be reloaded');
    return row;
  },

  async updateTeam(
    companyId: string,
    teamId: string,
    input: { name?: string; regionId?: string; leaderUserId?: string | null; isActive?: boolean }
  ): Promise<TeamRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [teamId, companyId];
    let param = 3;

    if (input.name !== undefined) {
      sets.push(`name = $${param++}`);
      values.push(input.name);
    }
    if (input.regionId !== undefined) {
      sets.push(`region_id = $${param++}`);
      values.push(input.regionId);
    }
    if (input.leaderUserId !== undefined) {
      sets.push(`leader_user_id = $${param++}`);
      values.push(input.leaderUserId);
    }
    if (input.isActive !== undefined) {
      sets.push(`is_active = $${param++}`);
      values.push(input.isActive);
    }

    if (sets.length === 0) {
      return this.findTeam(companyId, teamId);
    }

    await getPool().query(
      `UPDATE teams SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2`,
      values
    );
    return this.findTeam(companyId, teamId);
  },

  /**
   * Moves reporting lines from one manager to another inside the same company.
   */
  async realignReportsTo(companyId: string, fromUserId: string, toUserId: string): Promise<void> {
    await getPool().query(
      `UPDATE users
       SET reports_to_user_id = $3, updated_at = NOW()
       WHERE company_id = $1
         AND reports_to_user_id = $2
         AND id <> $3`,
      [companyId, fromUserId, toUserId]
    );
  },
};
