/**
 * Phase 5 verification: customer licence pool (purchased / assigned / available).
 * Run from Abel Backend: npm run test:phase5
 */
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import { toLicencePool } from '../src/features/licencePool';
import { isLicensedSubscription, licenceStatusLabel } from '../src/features/memberLicence';
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
  const zero = toLicencePool(50, 0);
  assert(zero.purchased === 50 && zero.assigned === 0 && zero.available === 50, 'Zero assigned: available equals purchased');

  const partial = toLicencePool(50, 42);
  assert(partial.purchased === 50 && partial.assigned === 42 && partial.available === 8, 'Purchased / Assigned / Available calculations');

  const full = toLicencePool(3, 3);
  assert(full.available === 0, 'Fully assigned: available is 0');

  const unlimited = toLicencePool(null, 12);
  assert(unlimited.purchased == null && unlimited.available == null, 'Null seat_limit is unlimited');

  assert(isLicensedSubscription('pro', 'active') === true, 'active eligible licence counts correctly');
  assert(isLicensedSubscription('pro', 'trialing') === true, 'trialing eligible licence counts correctly');
  assert(isLicensedSubscription('free', 'active') === false, 'free subscription does not incorrectly consume a paid licence');
  assert(isLicensedSubscription('pro', 'cancelled') === false, 'cancelled paid subscription is not assigned');
  assert(licenceStatusLabel('pro', 'active') === 'Licensed', 'Licensed label for active paid');
  assert(licenceStatusLabel('free', 'active') === 'Unlicensed', 'Unlicensed label for free');
}

async function runIntegrationTests(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const slug = 'phase5-verify-org';
  const otherSlug = 'phase5-verify-other';
  const passwordHash = await hashPassword('Phase5Test!1');

  await pool.query(
    `DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [[slug, otherSlug]]
  );
  await pool.query(`DELETE FROM companies WHERE slug = ANY($1::text[])`, [[slug, otherSlug]]);

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 5 Verify Co', $1, FALSE, TRUE, 3)
     RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const otherCompany = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 5 Other Co', $1, FALSE, TRUE, 5)
     RETURNING id`,
    [otherSlug]
  );
  const otherCompanyId = otherCompany.rows[0].id;
  await organisationRepository.ensureCustomerHierarchyRoles(companyId);
  await organisationRepository.ensureCustomerHierarchyRoles(otherCompanyId);

  const packages = await pool.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM subscription_packages WHERE slug IN ('free', 'pro')`
  );
  const freeId = packages.rows.find((row) => row.slug === 'free')?.id;
  const proId = packages.rows.find((row) => row.slug === 'pro')?.id;
  if (!freeId || !proId) throw new Error('free/pro packages are required');

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
    const userId = result.rows[0].id;
    await pool.query(
      `INSERT INTO user_subscriptions (user_id, package_id, status)
       VALUES ($1, $2, 'active')`,
      [userId, freeId]
    );
    return userId;
  };

  try {
    const execId = await insertUser('Vera', 'Exec', 'phase5.exec@verify.test', 'Executive', null);
    const rmNorthId = await insertUser('Nina', 'North', 'phase5.rm.north@verify.test', 'Regional Manager', execId);
    const rmSouthId = await insertUser('Sipho', 'South', 'phase5.rm.south@verify.test', 'Regional Manager', execId);
    const tlAId = await insertUser('Theo', 'Avery', 'phase5.tl.a@verify.test', 'Team Leader', rmNorthId);
    const tlCId = await insertUser('Chris', 'Cole', 'phase5.tl.c@verify.test', 'Team Leader', rmSouthId);
    const faA1 = await insertUser('Ada', 'One', 'phase5.fa.a1@verify.test', 'Financial Advisor', tlAId);
    const faA2 = await insertUser('Ben', 'Two', 'phase5.fa.a2@verify.test', 'Financial Advisor', tlAId);
    const faC1 = await insertUser('Cara', 'One', 'phase5.fa.c1@verify.test', 'Financial Advisor', tlCId);
    const faExtra = await insertUser('Dana', 'Four', 'phase5.fa.a4@verify.test', 'Financial Advisor', tlAId);
    const otherExec = await insertUser(
      'Other',
      'Exec',
      'phase5.other@verify.test',
      'Executive',
      null,
      otherCompanyId
    );
    const otherFa = await insertUser(
      'Other',
      'Advisor',
      'phase5.other.fa@verify.test',
      'Financial Advisor',
      otherExec,
      otherCompanyId
    );

    let licencePool = await organisationService.getLicencePool(execId);
    assert(
      licencePool.purchased === 3 && licencePool.assigned === 0 && licencePool.available === 3,
      'zero assigned'
    );

    const assignedFirst = await organisationService.assignMemberLicence(execId, faA1);
    assert(assignedFirst.licenceStatus === 'Licensed', 'Executive can assign a licence in their organisation');
    licencePool = await organisationService.getLicencePool(execId);
    assert(licencePool.assigned === 1 && licencePool.available === 2, 'partially assigned');

    await pool.query(
      `INSERT INTO contacts (user_id, first_name, last_name) VALUES ($1, 'Kept', 'Client')`,
      [faA1]
    );

    await pool.query(
      `UPDATE user_subscriptions SET package_id = $2, status = 'trialing' WHERE user_id = $1`,
      [faA2, proId]
    );
    licencePool = await organisationService.getLicencePool(execId);
    assert(licencePool.assigned === 2 && licencePool.available === 1, 'trialing eligible licence is counted in assigned');

    await organisationService.assignMemberLicence(execId, faC1);
    licencePool = await organisationService.getLicencePool(execId);
    assert(licencePool.assigned === 3 && licencePool.available === 0, 'fully assigned');

    await expectAppError('NO_LICENCES', 400, () => organisationService.assignMemberLicence(execId, faExtra));
    await expectAppError('NO_LICENCES', 400, () => organisationService.assignMemberLicence(rmNorthId, faExtra));

    await expectAppError('NOT_FOUND', 404, () => organisationService.assignMemberLicence(execId, otherFa));
    await expectAppError('NOT_FOUND', 404, () => organisationService.assignMemberLicence(rmNorthId, faC1));
    await expectAppError('NOT_FOUND', 404, () => organisationService.assignMemberLicence(tlAId, faC1));
    await expectAppError('FORBIDDEN', 403, () => organisationService.getLicencePool(faA1));
    await expectAppError('FORBIDDEN', 403, () => organisationService.assignMemberLicence(faA1, faExtra));

    const removed = await organisationService.removeMemberLicence(execId, faA1);
    assert(removed.licenceStatus === 'Unlicensed', 'Licence removal returns the user to Unlicensed');
    licencePool = await organisationService.getLicencePool(execId);
    assert(licencePool.assigned === 2 && licencePool.available === 1, 'licence removal returns capacity');

    const retained = await pool.query<{ count: string; is_active: boolean }>(
      `SELECT
         (SELECT COUNT(*)::text FROM contacts WHERE user_id = $1) AS count,
         (SELECT is_active FROM users WHERE id = $1) AS is_active`,
      [faA1]
    );
    assert(retained.rows[0].count === '1', 'history retained after licence removal');
    assert(retained.rows[0].is_active === true, 'licence removal does not deactivate the account');

    const stillUser = await pool.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [faA1]);
    assert(stillUser.rows.length === 1, 'licence removal does not delete the user');

    await organisationService.assignMemberLicence(execId, faA1);
    await organisationService.updateMyMember(execId, faA1, { isActive: false });
    licencePool = await organisationService.getLicencePool(execId);
    assert(licencePool.assigned === 3, 'deactivated user still consumes an assigned licence until it is removed');
    const inactive = await organisationService.removeMemberLicence(execId, faA1);
    assert(inactive.licenceStatus === 'Unlicensed' && inactive.accountStatus === 'Inactive', 'deactivated/unlicensed state behaves correctly');

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM popia_audit_log
       WHERE metadata->>'targetUserId' = $1
         AND resource_type = 'licence'
       ORDER BY created_at`,
      [faA1]
    );
    assert(
      audit.rows.some((row) => row.action === 'licence_assigned') &&
        audit.rows.some((row) => row.action === 'licence_removed'),
      'licence assign/remove is recorded for later audit'
    );

    const freeCount = await organisationRepository.countLicensedSeats(companyId);
    assert(freeCount === 2, 'remaining assigned seats are only eligible paid/trial rows');
  } finally {
    await pool.query(
      `DELETE FROM contacts WHERE user_id IN (SELECT id FROM users WHERE company_id = ANY($1::uuid[]))`,
      [[companyId, otherCompanyId]]
    );
    await pool.query(`DELETE FROM users WHERE company_id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
    await pool.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [[companyId, otherCompanyId]]);
  }
}

async function main(): Promise<void> {
  console.log('Phase 5 verification\n');
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
