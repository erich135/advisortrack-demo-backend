/**
 * Phase 4 verification: scoped user management, role assignment, licences, account status.
 * Run from Abel Backend: npm run test:phase4
 */
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import {
  allowedManagerRanksFor,
  canManageRank,
  ranksAssignableBy,
} from '../src/features/customerHierarchy';
import { isLicensedSubscription, licenceStatusLabel } from '../src/features/memberLicence';
import { deriveTeamAndRegion } from '../src/features/reportingLine';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { organisationService } from '../src/services/organisation.service';
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
  assert(
    JSON.stringify(ranksAssignableBy('executive')) ===
      JSON.stringify(['regional_manager', 'team_leader', 'financial_advisor']),
    'Executive may assign RM, TL, FA only'
  );
  assert(
    JSON.stringify(ranksAssignableBy('regional_manager')) ===
      JSON.stringify(['team_leader', 'financial_advisor']),
    'Regional Manager may assign TL and FA only'
  );
  assert(
    JSON.stringify(ranksAssignableBy('team_leader')) === JSON.stringify(['financial_advisor']),
    'Team Leader may assign Financial Advisor only'
  );
  assert(!ranksAssignableBy('executive').includes('platform_admin'), 'Executive cannot assign App Admin');
  assert(!canManageRank('regional_manager', 'executive'), 'Regional Manager cannot promote to Executive');
  assert(allowedManagerRanksFor('team_leader').includes('regional_manager'), 'TL reports to RM');
  assert(!allowedManagerRanksFor('regional_manager').includes('team_leader'), 'RM cannot report to TL');
  assert(licenceStatusLabel('pro', 'active') === 'Licensed', 'Active paid subscription is Licensed');
  assert(licenceStatusLabel('free', 'active') === 'Unlicensed', 'Free subscription is Unlicensed');
  assert(!isLicensedSubscription('pro', 'cancelled'), 'Cancelled paid subscription is not licensed');

  const members = new Map([
    [
      'fa',
      {
        id: 'fa',
        firstName: 'Ada',
        lastName: 'Advisor',
        reportsToUserId: 'tl',
        isPlatformAdmin: false,
        roleName: 'Financial Advisor',
        permissions: [] as string[],
      },
    ],
    [
      'tl',
      {
        id: 'tl',
        firstName: 'Theo',
        lastName: 'Leader',
        reportsToUserId: 'rm',
        isPlatformAdmin: false,
        roleName: 'Team Leader',
        permissions: ['view_team'],
      },
    ],
    [
      'rm',
      {
        id: 'rm',
        firstName: 'Nina',
        lastName: 'North',
        reportsToUserId: 'exec',
        isPlatformAdmin: false,
        roleName: 'Regional Manager',
        permissions: ['view_team', 'manage_members'],
      },
    ],
    [
      'exec',
      {
        id: 'exec',
        firstName: 'Vera',
        lastName: 'Exec',
        reportsToUserId: null,
        isPlatformAdmin: false,
        roleName: 'Executive',
        permissions: ['view_company'],
      },
    ],
  ]);
  const derived = deriveTeamAndRegion('fa', members);
  assert(derived.team?.name === 'Theo Leader' && derived.region?.name === 'Nina North', 'Team/region walk reports_to_user_id');
}

async function runIntegrationTests(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const slug = 'phase4-verify-users';
  const otherSlug = 'phase4-verify-other';
  const passwordHash = await hashPassword('Phase4Test!1');

  await pool.query(
    `DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [[slug, otherSlug]]
  );
  await pool.query(`DELETE FROM companies WHERE slug = ANY($1::text[])`, [[slug, otherSlug]]);

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 4 Verify Co', $1, FALSE, TRUE, 1)
     RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const otherCompany = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active)
     VALUES ('Phase 4 Other Co', $1, FALSE, TRUE)
     RETURNING id`,
    [otherSlug]
  );
  const otherCompanyId = otherCompany.rows[0].id;
  await organisationRepository.ensureCustomerHierarchyRoles(companyId);
  await organisationRepository.ensureCustomerHierarchyRoles(otherCompanyId);

  const roles = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM company_roles WHERE company_id = $1`,
    [companyId]
  );
  const roleId = (name: string) => {
    const row = roles.rows.find((item) => item.name === name);
    if (!row) throw new Error(`Missing role ${name}`);
    return row.id;
  };

  await pool.query(
    `INSERT INTO company_roles (company_id, name, is_default, is_system)
     VALUES ($1, 'App Admin', FALSE, FALSE)
     ON CONFLICT (company_id, name) DO NOTHING`,
    [companyId]
  );
  const appAdminRole = await pool.query<{ id: string }>(
    `SELECT id FROM company_roles WHERE company_id = $1 AND name = 'App Admin' LIMIT 1`,
    [companyId]
  );

  const insertUser = async (
    first: string,
    last: string,
    email: string,
    roleName: string,
    reportsTo: string | null,
    company = companyId
  ): Promise<string> => {
    const companyRoles = company === companyId
      ? roles
      : await pool.query<{ id: string; name: string }>(
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
    const execId = await insertUser('Vera', 'Exec', 'phase4.exec@verify.test', 'Executive', null);
    const rmNorthId = await insertUser('Nina', 'North', 'phase4.rm.north@verify.test', 'Regional Manager', execId);
    const rmSouthId = await insertUser('Sipho', 'South', 'phase4.rm.south@verify.test', 'Regional Manager', execId);
    const tlAId = await insertUser('Theo', 'Avery', 'phase4.tl.a@verify.test', 'Team Leader', rmNorthId);
    const tlCId = await insertUser('Chris', 'Cole', 'phase4.tl.c@verify.test', 'Team Leader', rmSouthId);
    const faA1 = await insertUser('Ada', 'One', 'phase4.fa.a1@verify.test', 'Financial Advisor', tlAId);
    const faC1 = await insertUser('Cara', 'One', 'phase4.fa.c1@verify.test', 'Financial Advisor', tlCId);
    const otherExec = await insertUser(
      'Other',
      'Exec',
      'phase4.other@verify.test',
      'Executive',
      null,
      otherCompanyId
    );

    const listed = await organisationService.listMyMembers(execId);
    const ada = listed.find((row) => row.id === faA1);
    assert(ada?.phone === '0820000000', 'User list includes existing mobile field');
    assert(!ada?.team && !ada?.region, 'Without Region/Team entities, member DTO does not use person-name labels');
    assert(ada?.accountStatus === 'Active', 'Account status uses users.is_active');
    assert(ada?.licenceStatus === 'Unlicensed', 'Default/free subscription is Unlicensed');
    assert(ada?.actions?.edit === true, 'Executive may edit a Financial Advisor in the company');

    const execRoles = await organisationService.listAssignableRoles(execId);
    assert(
      execRoles.every((role) => !['App Admin', 'App Manager', 'Executive', 'Company admin'].includes(role.name)),
      'Executive assignable roles exclude internal roles and peer Executive ranks'
    );
    assert(
      execRoles.some((role) => role.rank === 'regional_manager') &&
        execRoles.some((role) => role.rank === 'financial_advisor'),
      'Executive may assign Regional Manager and Financial Advisor'
    );

    const rmRoles = await organisationService.listAssignableRoles(rmNorthId);
    assert(
      rmRoles.every((role) => role.rank === 'team_leader' || role.rank === 'financial_advisor'),
      'Regional Manager assignable roles are only beneath Regional Manager'
    );

    const tlRoles = await organisationService.listAssignableRoles(tlAId);
    assert(
      tlRoles.length > 0 && tlRoles.every((role) => role.rank === 'financial_advisor'),
      'Team Leader assignable roles are Financial Advisor only'
    );

    await expectAppError('FORBIDDEN', 403, () => organisationService.listMyMembers(faA1));

    const northList = await organisationService.listMyMembers(rmNorthId);
    assert(
      northList.some((row) => row.id === faA1) && !northList.some((row) => row.id === faC1),
      'Regional Manager list is limited to their reporting-line region'
    );

    const teamList = await organisationService.listMyMembers(tlAId);
    assert(
      teamList.some((row) => row.id === faA1) && !teamList.some((row) => row.id === faC1),
      'Team Leader list is limited to their assigned team'
    );

    await expectAppError('NOT_FOUND', 404, () =>
      organisationService.updateMyMember(rmNorthId, faC1, { firstName: 'Nope' })
    );
    await expectAppError('NOT_FOUND', 404, () => organisationService.getMyMember(execId, otherExec));

    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.updateMyMember(tlAId, faA1, { roleId: roleId('Executive') })
    );
    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.updateMyMember(rmNorthId, faA1, { roleId: roleId('Executive') })
    );
    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.updateMyMember(execId, faA1, { roleId: appAdminRole.rows[0].id })
    );

    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.createMyMember(rmNorthId, {
        firstName: 'Promoted',
        lastName: 'Exec',
        email: 'phase4.promoted.exec@verify.test',
        roleId: roleId('Executive'),
      })
    );

    const invited = await organisationService.createMyMember(tlAId, {
      firstName: 'Invited',
      lastName: 'Advisor',
      email: 'phase4.invited.fa@verify.test',
      phone: '0831111111',
      roleId: roleId('Financial Advisor'),
    });
    assert(invited.reportsToUserId === tlAId, 'Team Leader invite defaults reporting line to the Team Leader');
    assert(invited.rank === 'financial_advisor', 'Invited user is Financial Advisor');
    assert(invited.phone === '0831111111', 'Invite stores mobile on users.phone');

    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.createMyMember(tlAId, {
        firstName: 'Peer',
        lastName: 'Leader',
        email: 'phase4.promoted.tl@verify.test',
        roleId: roleId('Team Leader'),
      })
    );

    await organisationService.updateMyMember(execId, faA1, { isActive: false });
    const inactive = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM users WHERE id = $1`,
      [faA1]
    );
    assert(inactive.rows[0].is_active === false, 'Deactivate sets users.is_active = false');

    await organisationService.updateMyMember(rmNorthId, faA1, { isActive: true });

    const licensed = await organisationService.assignMemberLicence(execId, faA1);
    assert(licensed.licenceStatus === 'Licensed', 'Assign licence uses existing paid subscription package');
    await expectAppError('NO_LICENCES', 400, () => organisationService.assignMemberLicence(execId, faC1));
    const unlicensed = await organisationService.removeMemberLicence(execId, faA1);
    assert(unlicensed.licenceStatus === 'Unlicensed', 'Remove licence returns the user to the free default');

    const resent = await organisationService.resendMemberInvitation(tlAId, invited.id);
    assert(resent.email === 'phase4.invited.fa@verify.test', 'Resend invitation targets the invited user');

    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.updateMyMember(execId, execId, { firstName: 'Self' })
    );
  } finally {
    await pool.query(`DELETE FROM users WHERE company_id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
    await pool.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
  }
}

async function main(): Promise<void> {
  console.log('Phase 4 verification\n');
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
