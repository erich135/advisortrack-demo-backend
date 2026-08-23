/**
 * Phase 4A verification: Region and Team organisation entities.
 * Run from Abel Backend: npm run test:phase4a
 */
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import { structureAccessFor } from '../src/features/customerHierarchy';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { organisationService } from '../src/services/organisation.service';
import { organisationStructureService } from '../src/services/organisationStructure.service';
import { hashPassword } from '../src/utils/auth';
import { AppError } from '../src/middleware/errorHandler';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${message}`);
}

async function expectAppError(code: string, status: number, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    assert(false, `expected ${code} (${status})`);
  } catch (error) {
    const appError = error as AppError;
    assert(
      appError instanceof AppError && appError.code === code && appError.statusCode === status,
      `${code} (${status}) — received ${appError?.code ?? error} (${appError?.statusCode ?? '?'})`
    );
  }
}

function runUnitTests(): void {
  const exec = structureAccessFor('executive');
  assert(exec.canManageRegions && exec.canManageTeams, 'Executive may administer Regions and Teams');

  const rm = structureAccessFor('regional_manager');
  assert(!rm.canManageRegions && rm.canManageTeams && rm.canViewRegions, 'Regional Manager may administer Teams only');

  const tl = structureAccessFor('team_leader');
  assert(!tl.canManageRegions && !tl.canManageTeams, 'Team Leader has no structural administration');

  const fa = structureAccessFor('financial_advisor');
  assert(!fa.canViewRegions && !fa.canManageTeams, 'Financial Advisor has no Region/Team administration');

  const admin = structureAccessFor('platform_admin');
  assert(admin.canManageRegions && admin.canManageTeams, 'App Admin / App Manager may administer structure');
}

async function runIntegrationTests(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const slug = 'phase4a-verify-org';
  const otherSlug = 'phase4a-verify-other';
  const passwordHash = await hashPassword('Phase4ATest!1');

  await pool.query(
    `DELETE FROM teams WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [[slug, otherSlug]]
  );
  await pool.query(
    `DELETE FROM regions WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [[slug, otherSlug]]
  );
  await pool.query(
    `DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [[slug, otherSlug]]
  );
  await pool.query(`DELETE FROM companies WHERE slug = ANY($1::text[])`, [[slug, otherSlug]]);

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active)
     VALUES ('Phase 4A Verify Co', $1, FALSE, TRUE)
     RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const otherCompany = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active)
     VALUES ('Phase 4A Other Co', $1, FALSE, TRUE)
     RETURNING id`,
    [otherSlug]
  );
  const otherCompanyId = otherCompany.rows[0].id;
  await organisationRepository.ensureCustomerHierarchyRoles(companyId);
  await organisationRepository.ensureCustomerHierarchyRoles(otherCompanyId);

  const insertUser = async (
    first: string,
    last: string,
    email: string,
    roleName: string,
    reportsTo: string | null,
    company = companyId
  ): Promise<string> => {
    const companyRoles = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM company_roles WHERE company_id = $1`,
      [company]
    );
    const assigned = companyRoles.rows.find((item) => item.name === roleName);
    if (!assigned) throw new Error(`Missing role ${roleName}`);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (
         first_name, last_name, email, password_hash, email_verified_at,
         company_id, company_role_id, reports_to_user_id, is_platform_admin, phone
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, FALSE, '0820000000')
       RETURNING id`,
      [first, last, email, passwordHash, company, assigned.id, reportsTo]
    );
    return result.rows[0].id;
  };

  try {
    const execId = await insertUser('Vera', 'Exec', 'phase4a.exec@verify.test', 'Executive', null);
    const rmNorthId = await insertUser('Nina', 'North', 'phase4a.rm.north@verify.test', 'Regional Manager', execId);
    const rmSouthId = await insertUser('Sipho', 'South', 'phase4a.rm.south@verify.test', 'Regional Manager', execId);
    const tlAId = await insertUser('Theo', 'Avery', 'phase4a.tl.a@verify.test', 'Team Leader', rmNorthId);
    const tlBId = await insertUser('Bheki', 'West', 'phase4a.tl.b@verify.test', 'Team Leader', rmNorthId);
    const tlCId = await insertUser('Chris', 'Cole', 'phase4a.tl.c@verify.test', 'Team Leader', rmSouthId);
    const faA1 = await insertUser('Ada', 'One', 'phase4a.fa.a1@verify.test', 'Financial Advisor', tlAId);
    const otherExec = await insertUser(
      'Other',
      'Exec',
      'phase4a.other@verify.test',
      'Executive',
      null,
      otherCompanyId
    );
    const otherRm = await insertUser(
      'Other',
      'Manager',
      'phase4a.other.rm@verify.test',
      'Regional Manager',
      otherExec,
      otherCompanyId
    );

    const north = await organisationStructureService.createRegion(execId, {
      name: 'North Region',
      managerUserId: rmNorthId,
    });
    assert(north.name === 'North Region' && north.managerUserId === rmNorthId, 'Executive Region creation');
    assert(north.isActive && north.status === 'Active', 'New Region is active');

    const south = await organisationStructureService.createRegion(execId, {
      name: 'South Region',
      managerUserId: rmSouthId,
    });
    assert(south.managerUserId === rmSouthId, 'Second Region assigned to a different Regional Manager');

    const alpha = await organisationStructureService.createTeam(execId, {
      name: 'Alpha Team',
      regionId: north.id,
      leaderUserId: tlAId,
    });
    assert(alpha.name === 'Alpha Team' && alpha.regionId === north.id, 'Executive Team creation');
    assert(alpha.leaderUserId === tlAId, 'Team Leader assigned on Executive Team create');

    const rmReports = await pool.query<{ reports_to_user_id: string | null }>(
      `SELECT reports_to_user_id FROM users WHERE id = $1`,
      [rmNorthId]
    );
    const tlReports = await pool.query<{ reports_to_user_id: string | null }>(
      `SELECT reports_to_user_id FROM users WHERE id = $1`,
      [tlAId]
    );
    assert(rmReports.rows[0].reports_to_user_id === execId, 'Assigning a Regional Manager aligns reports_to to the Executive');
    assert(tlReports.rows[0].reports_to_user_id === rmNorthId, 'Assigning a Team Leader aligns reports_to to the Regional Manager');

    await organisationService.updateMyMember(execId, faA1, { teamId: alpha.id, regionId: north.id });
    const faReports = await pool.query<{ reports_to_user_id: string | null }>(
      `SELECT reports_to_user_id FROM users WHERE id = $1`,
      [faA1]
    );
    assert(faReports.rows[0].reports_to_user_id === tlAId, 'Assigning a Financial Advisor to a Team aligns reports_to to the Team Leader');

    const listed = await organisationService.listMyMembers(execId);
    const ada = listed.find((row) => row.id === faA1);
    const nina = listed.find((row) => row.id === rmNorthId);
    const theo = listed.find((row) => row.id === tlAId);
    assert(ada?.team?.id === alpha.id && ada?.team?.name === 'Alpha Team', 'User list Team is the organisation entity');
    assert(ada?.region?.id === north.id && ada?.region?.name === 'North Region', 'User list Region is the organisation entity');
    assert(nina?.region?.id === north.id && !nina?.team, 'Regional Manager placement is the Region they manage');
    assert(theo?.team?.id === alpha.id && theo?.region?.id === north.id, 'Team Leader placement is the Team they lead');

    const rmTeam = await organisationStructureService.createTeam(rmNorthId, {
      name: 'North Bravo',
      regionId: north.id,
    });
    assert(rmTeam.regionId === north.id, 'RM Team creation inside own Region');

    await expectAppError('FORBIDDEN', 403, () =>
      organisationStructureService.createRegion(rmNorthId, { name: 'RM Should Not' })
    );
    await expectAppError('FORBIDDEN', 403, () =>
      organisationStructureService.updateRegion(rmNorthId, north.id, { name: 'Hijacked North' })
    );

    await expectAppError('FORBIDDEN', 403, () =>
      organisationStructureService.createTeam(rmNorthId, { name: 'South Raid', regionId: south.id })
    );

    await expectAppError('FORBIDDEN', 403, () =>
      organisationStructureService.createRegion(tlAId, { name: 'TL Region' })
    );
    await expectAppError('FORBIDDEN', 403, () =>
      organisationStructureService.createTeam(tlAId, { name: 'TL Team', regionId: north.id })
    );

    await expectAppError('FORBIDDEN', 403, () => organisationStructureService.listRegions(faA1));
    await expectAppError('FORBIDDEN', 403, () =>
      organisationStructureService.createRegion(faA1, { name: 'FA Region' })
    );
    await expectAppError('FORBIDDEN', 403, () =>
      organisationStructureService.createTeam(faA1, { name: 'FA Team', regionId: north.id })
    );

    const otherRegion = await organisationStructureService.createRegion(otherExec, {
      name: 'Other North',
      managerUserId: otherRm,
    });
    const otherTl = await insertUser(
      'Other',
      'Leader',
      'phase4a.other.tl@verify.test',
      'Team Leader',
      otherRm,
      otherCompanyId
    );
    const otherTeam = await organisationStructureService.createTeam(otherExec, {
      name: 'Other Team',
      regionId: otherRegion.id,
      leaderUserId: otherTl,
    });
    await expectAppError('INVALID_REGION', 400, () =>
      organisationStructureService.createTeam(execId, { name: 'Cross Company Team', regionId: otherRegion.id })
    );
    await expectAppError('INVALID_ASSIGNMENT', 400, () =>
      organisationStructureService.createRegion(execId, {
        name: 'Cross Manager',
        managerUserId: otherRm,
      })
    );
    await expectAppError('INVALID_TEAM', 400, () =>
      organisationService.updateMyMember(execId, faA1, { teamId: otherTeam.id })
    );

    await expectAppError('REGION_NAME_EXISTS', 409, () =>
      organisationStructureService.createRegion(execId, { name: 'North Region' })
    );
    await expectAppError('TEAM_NAME_EXISTS', 409, () =>
      organisationStructureService.createTeam(execId, { name: 'Alpha Team', regionId: north.id })
    );

    const sameNameSouth = await organisationStructureService.createTeam(execId, {
      name: 'Alpha Team',
      regionId: south.id,
      leaderUserId: tlCId,
    });
    assert(sameNameSouth.regionId === south.id, 'Duplicate Team names are allowed in different Regions');

    await expectAppError('ONE_ACTIVE_REGION', 409, () =>
      organisationStructureService.createRegion(execId, {
        name: 'East Region',
        managerUserId: rmNorthId,
      })
    );
    await expectAppError('ONE_ACTIVE_TEAM', 409, () =>
      organisationStructureService.createTeam(execId, {
        name: 'North Charlie',
        regionId: north.id,
        leaderUserId: tlAId,
      })
    );

    const archivedTeam = await organisationStructureService.updateTeam(execId, alpha.id, { isActive: false });
    assert(archivedTeam.isActive === false && archivedTeam.status === 'Archived', 'Archive behaviour for Teams');
    const teamStillThere = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM teams WHERE id = $1`,
      [alpha.id]
    );
    assert(teamStillThere.rows[0].count === '1', 'Archive does not hard-delete the Team');
    await organisationStructureService.updateTeam(execId, alpha.id, { isActive: true });

    await organisationStructureService.updateTeam(execId, alpha.id, { leaderUserId: tlBId });
    const faAfterLeaderChange = await pool.query<{ reports_to_user_id: string | null }>(
      `SELECT reports_to_user_id FROM users WHERE id = $1`,
      [faA1]
    );
    const tlBReports = await pool.query<{ reports_to_user_id: string | null }>(
      `SELECT reports_to_user_id FROM users WHERE id = $1`,
      [tlBId]
    );
    assert(
      faAfterLeaderChange.rows[0].reports_to_user_id === tlBId,
      'Changing Team Leader realigns advisor reporting lines'
    );
    assert(tlBReports.rows[0].reports_to_user_id === rmNorthId, 'New Team Leader reports to the Region’s Regional Manager');

    const archived = await organisationStructureService.updateRegion(execId, north.id, { isActive: false });
    assert(archived.isActive === false && archived.status === 'Archived', 'Archive behaviour sets is_active false');
    const stillThere = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM regions WHERE id = $1`,
      [north.id]
    );
    assert(stillThere.rows[0].count === '1', 'Archive does not hard-delete the Region');

    const east = await organisationStructureService.createRegion(execId, {
      name: 'East Region',
      managerUserId: rmNorthId,
    });
    assert(east.managerUserId === rmNorthId, 'Archived Region frees the Regional Manager for one new active Region');
  } finally {
    await pool.query(`DELETE FROM teams WHERE company_id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
    await pool.query(`DELETE FROM regions WHERE company_id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
    await pool.query(`DELETE FROM users WHERE company_id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
    await pool.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
  }
}

async function main(): Promise<void> {
  console.log('Phase 4A verification\n');
  runUnitTests();
  await runIntegrationTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  await closeDatabase();
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
