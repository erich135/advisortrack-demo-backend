/**
 * Phase 3 verification: hierarchy, date windows, ranking, and server-side scope.
 * Run from Abel Backend: npm run test:phase3
 */
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import {
  canManageRank,
  isInternalRoleName,
  resolveHierarchyRank,
} from '../src/features/customerHierarchy';
import { resolvePerformancePeriod } from '../src/features/performancePeriod';
import { buildDownlineIndex, pickTopAndWorst } from '../src/features/performanceRanking';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { organisationService } from '../src/services/organisation.service';
import { managementPerformanceService } from '../src/services/managementPerformance.service';
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
  assert(resolveHierarchyRank({
    isPlatformAdmin: true,
    roleName: 'Advisor',
    permissions: [],
  }) === 'platform_admin', 'platform admin flag wins over Advisor role name');

  assert(resolveHierarchyRank({
    isPlatformAdmin: false,
    roleName: 'Company admin',
    permissions: ['view_company'],
  }) === 'executive', 'Company admin maps to Executive');

  assert(resolveHierarchyRank({
    isPlatformAdmin: false,
    roleName: 'Regional Manager',
    permissions: ['view_team', 'manage_members'],
  }) === 'regional_manager', 'Regional Manager name maps to regional rank');

  assert(resolveHierarchyRank({
    isPlatformAdmin: false,
    roleName: 'Team Leader',
    permissions: ['view_team'],
  }) === 'team_leader', 'Team Leader name maps to team rank');

  assert(resolveHierarchyRank({
    isPlatformAdmin: false,
    roleName: 'Advisor',
    permissions: [],
  }) === 'financial_advisor', 'Advisor maps to Financial Advisor');

  assert(isInternalRoleName('App Admin'), 'App Admin is an internal role name');
  assert(isInternalRoleName('App Manager'), 'App Manager is an internal role name');
  assert(isInternalRoleName('Founder/Admin'), 'Founder/Admin is an internal role name');
  assert(!isInternalRoleName('Executive'), 'Executive is not an internal role name');

  assert(canManageRank('executive', 'regional_manager'), 'Executive may manage Regional Manager');
  assert(!canManageRank('executive', 'executive'), 'Executive may not manage a peer Executive');
  assert(!canManageRank('regional_manager', 'executive'), 'Regional Manager may not manage Executive');
  assert(canManageRank('team_leader', 'financial_advisor'), 'Team Leader may manage Financial Advisor');
  assert(!canManageRank('platform_admin', 'platform_admin'), 'Platform admin cannot grant platform admin');

  const now = new Date('2026-08-22T10:00:00+02:00');
  const lastWeek = resolvePerformancePeriod('last_week', now);
  assert(lastWeek.startDate === '2026-08-10' && lastWeek.endDate === '2026-08-16', 'Last Week is previous Mon–Sun');
  const lastMonth = resolvePerformancePeriod('last_month', now);
  assert(lastMonth.startDate === '2026-07-01' && lastMonth.endDate === '2026-07-31', 'Last Month is previous calendar month');
  const ytd = resolvePerformancePeriod('year_to_date', now);
  assert(ytd.startDate === '2026-01-01' && ytd.endDate === '2026-08-22', 'Year to Date is 1 Jan through today');
  assert(lastWeek.timezone === 'Africa/Johannesburg', 'Performance windows use Africa/Johannesburg');

  const none = pickTopAndWorst([]);
  assert(none.emptyReason === 'no_subordinates' && !none.top && !none.worst, 'No subordinates → no fabricated performers');

  const zero = pickTopAndWorst([
    { userId: 'a', name: 'A', role: 'Regional Manager', issuedAmount: 0 },
    { userId: 'b', name: 'B', role: 'Regional Manager', issuedAmount: 0 },
  ]);
  assert(zero.emptyReason === 'no_issued_cases' && !zero.top && !zero.worst, 'No issued cases → no fabricated performers');

  const single = pickTopAndWorst([
    { userId: 'a', name: 'Only', role: 'Team Leader', issuedAmount: 50000 },
  ]);
  assert(
    single.top?.userId === 'a' && !single.worst && single.emptyReason === 'single_subordinate',
    'Single subordinate is Top only, not also Worst'
  );

  const tied = pickTopAndWorst([
    { userId: 'b', name: 'Beta', role: 'Regional Manager', issuedAmount: 100 },
    { userId: 'a', name: 'Alpha', role: 'Regional Manager', issuedAmount: 100 },
  ]);
  assert(
    tied.top?.userId === 'a' && !tied.worst && tied.emptyReason === 'tied',
    'Exact tie uses name/id order only and does not label a Worst Performer'
  );

  const ranked = pickTopAndWorst([
    { userId: 'b', name: 'South', role: 'Regional Manager', issuedAmount: 5000 },
    { userId: 'a', name: 'North', role: 'Regional Manager', issuedAmount: 150000 },
  ]);
  assert(ranked.top?.name === 'North' && ranked.worst?.name === 'South' && !ranked.emptyReason, 'Highest is Top, lowest is Worst');

  const downline = buildDownlineIndex([
    { id: 'rm', reportsToUserId: 'exec' },
    { id: 'tl', reportsToUserId: 'rm' },
    { id: 'fa', reportsToUserId: 'tl' },
    { id: 'exec', reportsToUserId: null },
  ]);
  assert(downline.get('rm')?.includes('fa') === true, 'Regional downline includes nested advisors');
}

async function runIntegrationTests(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const slug = 'phase3-verify-scope';
  const passwordHash = await hashPassword('Phase3Test!1');

  await pool.query(
    `DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = $1)`,
    [slug]
  );
  await pool.query(`DELETE FROM companies WHERE slug = $1`, [slug]);

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active)
     VALUES ('Phase 3 Verify Co', $1, FALSE, TRUE)
     RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  await organisationRepository.ensureCustomerHierarchyRoles(companyId);

  const roles = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM company_roles WHERE company_id = $1`,
    [companyId]
  );
  const roleId = (name: string) => {
    const row = roles.rows.find((item) => item.name === name);
    if (!row) throw new Error(`Missing role ${name}`);
    return row.id;
  };

  const insertUser = async (
    first: string,
    last: string,
    email: string,
    roleName: string,
    reportsTo: string | null
  ): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (
         first_name, last_name, email, password_hash, email_verified_at,
         company_id, company_role_id, reports_to_user_id, is_platform_admin
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, FALSE)
       RETURNING id`,
      [first, last, email, passwordHash, companyId, roleId(roleName), reportsTo]
    );
    return result.rows[0].id;
  };

  try {
    const execId = await insertUser('Vera', 'Exec', 'phase3.exec@verify.test', 'Executive', null);
    const rmNorthId = await insertUser('Nina', 'North', 'phase3.rm.north@verify.test', 'Regional Manager', execId);
    const rmSouthId = await insertUser('Sipho', 'South', 'phase3.rm.south@verify.test', 'Regional Manager', execId);
    const rmEastId = await insertUser('Elena', 'East', 'phase3.rm.east@verify.test', 'Regional Manager', execId);
    const tlAId = await insertUser('Theo', 'Avery', 'phase3.tl.a@verify.test', 'Team Leader', rmNorthId);
    const tlBId = await insertUser('Tara', 'Blake', 'phase3.tl.b@verify.test', 'Team Leader', rmNorthId);
    const tlCId = await insertUser('Chris', 'Cole', 'phase3.tl.c@verify.test', 'Team Leader', rmSouthId);
    const tlDId = await insertUser('Dana', 'Drew', 'phase3.tl.d@verify.test', 'Team Leader', rmSouthId);
    const tlEId = await insertUser('Evan', 'Earl', 'phase3.tl.e@verify.test', 'Team Leader', rmEastId);
    const faA1 = await insertUser('Ada', 'One', 'phase3.fa.a1@verify.test', 'Financial Advisor', tlAId);
    const faA2 = await insertUser('Abe', 'Two', 'phase3.fa.a2@verify.test', 'Financial Advisor', tlAId);
    const faB1 = await insertUser('Ben', 'One', 'phase3.fa.b1@verify.test', 'Financial Advisor', tlBId);
    const faC1 = await insertUser('Cara', 'One', 'phase3.fa.c1@verify.test', 'Financial Advisor', tlCId);
    const faD1 = await insertUser('Drew', 'One', 'phase3.fa.d1@verify.test', 'Financial Advisor', tlDId);
    const faE1 = await insertUser('Eve', 'One', 'phase3.fa.e1@verify.test', 'Financial Advisor', tlEId);

    const insertIssued = async (userId: string, amount: number, issuedAt: string) => {
      await pool.query(
        `INSERT INTO production_entries (
           user_id, title, entry_type, amount, is_issued, issued_at, application_status
         )
         VALUES ($1, 'Issued case', 'commission', $2, TRUE, $3::timestamptz, 'accepted_issued')`,
        [userId, amount, issuedAt]
      );
    };

    await insertIssued(faA1, 100000, '2026-07-15T10:00:00+02:00');
    await insertIssued(faA2, 40000, '2026-07-16T10:00:00+02:00');
    await insertIssued(faB1, 10000, '2026-07-17T10:00:00+02:00');
    await insertIssued(faC1, 5000, '2026-07-18T10:00:00+02:00');
    await insertIssued(faE1, 8000, '2026-07-19T10:00:00+02:00');

    const execOrg = await organisationService.getMyOrganisation(execId);
    assert(execOrg.hierarchy.rank === 'executive' && execOrg.hierarchy.portalAccess, 'Executive portal access');

    const execScope = await organisationService.resolveManagementScope(execId);
    assert(execScope.kind === 'organisation' && execScope.userIds.includes(faC1), 'Executive scope is the whole organisation');

    const northScope = await organisationService.resolveManagementScope(rmNorthId);
    assert(
      northScope.kind === 'region' &&
        northScope.userIds.includes(faA1) &&
        !northScope.userIds.includes(faC1),
      'Regional Manager is limited to their reporting-line region'
    );

    const tlAScope = await organisationService.resolveManagementScope(tlAId);
    assert(
      tlAScope.kind === 'team' &&
        tlAScope.userIds.includes(faA2) &&
        !tlAScope.userIds.includes(faB1),
      'Team Leader is limited to their assigned team'
    );

    await expectAppError('FORBIDDEN', 403, () => organisationService.resolveManagementScope(faA1));

    await expectAppError('NOT_FOUND', 404, () => organisationService.getMyMember(rmNorthId, faC1));
    const visible = await organisationService.getMyMember(execId, faC1);
    assert(visible.id === faC1, 'Executive can read a member inside the organisation');

    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.updateMyMember(tlAId, faA1, { roleId: roleId('Executive') })
    );
    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.createMyRole(execId, { name: 'App Admin', permissions: ['manage_company'] })
    );
    await expectAppError('NOT_FOUND', 404, () =>
      organisationService.updateMyMember(rmNorthId, rmSouthId, { reportsToUserId: rmNorthId })
    );

    const execMonth = await managementPerformanceService.getPerformance(execId);
    assert(execMonth.period === 'last_month', 'Default performance period is Last Month');
    assert(execMonth.topPerformer?.userId === rmNorthId, 'Executive Top Performer is the highest-issued Regional Manager');
    assert(execMonth.worstPerformer?.userId === rmSouthId, 'Executive Worst Performer is the lowest-issued Regional Manager with issued business');
    assert(execMonth.topPerformer?.issuedAmount === 150000, 'North region issued total is 150000');
    assert(execMonth.worstPerformer?.issuedAmount === 5000, 'South region issued total is 5000');
    assert(execMonth.timezone === 'Africa/Johannesburg', 'Performance API uses Africa/Johannesburg');

    const northMonth = await managementPerformanceService.getPerformance(rmNorthId, 'last_month');
    assert(northMonth.topPerformer?.userId === tlAId, 'Regional Manager Top Performer is the highest-issued Team Leader');
    assert(northMonth.worstPerformer?.userId === tlBId, 'Regional Manager Worst Performer is the lowest-issued Team Leader');

    const tlMonth = await managementPerformanceService.getPerformance(tlAId, 'last_month');
    assert(tlMonth.topPerformer?.userId === faA1, 'Team Leader Top Performer is the highest-issued Advisor');
    assert(tlMonth.worstPerformer?.userId === faA2, 'Team Leader Worst Performer is the lowest-issued Advisor');

    const lastWeek = await managementPerformanceService.getPerformance(execId, 'last_week');
    assert(
      lastWeek.emptyReason === 'no_issued_cases' && !lastWeek.topPerformer && !lastWeek.worstPerformer,
      'Last Week with no issued_at in range shows no-data state'
    );
    assert(lastWeek.emptyMessage === 'No issued cases for selected period', 'No-data copy is exact');

    const ytd = await managementPerformanceService.getPerformance(execId, 'year_to_date');
    assert(ytd.topPerformer?.userId === rmNorthId, 'Year to Date uses issued_at and still ranks North first');

    const east = await managementPerformanceService.getPerformance(rmEastId, 'last_month');
    assert(
      east.topPerformer?.userId === tlEId && !east.worstPerformer && east.emptyReason === 'single_subordinate',
      'Single Team Leader is Top Performer only'
    );
    assert(east.emptyMessage === 'Not enough people to compare', 'Single-subordinate copy is exact');

    await expectAppError('FORBIDDEN', 403, () => managementPerformanceService.getPerformance(faA1, 'last_month'));
  } finally {
    await pool.query(`DELETE FROM users WHERE company_id = $1`, [companyId]);
    await pool.query(`DELETE FROM companies WHERE id = $1`, [companyId]);
  }
}

async function main(): Promise<void> {
  console.log('Phase 3 verification\n');
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
