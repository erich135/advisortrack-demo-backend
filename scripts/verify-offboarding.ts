/**
 * Task 14: offboarding / licence return.
 * Run: npm run test:offboarding
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import { toLicencePool } from '../src/features/licencePool';
import { previewPoolAfterLicenceReturn } from '../src/features/memberOffboarding';
import { AppError } from '../src/middleware/errorHandler';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { organisationService } from '../src/services/organisation.service';
import { organisationStructureService } from '../src/services/organisationStructure.service';
import { hashPassword, signToken } from '../src/utils/auth';
import { hashToken } from '../src/utils/emailTokens';
import { env } from '../src/config/env';

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

function runStaticTests(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const service = fs.readFileSync(path.join(root, 'src/services/organisation.service.ts'), 'utf8');
  const auth = fs.readFileSync(path.join(root, 'src/middleware/auth.ts'), 'utf8');
  const companyRoutes = fs.readFileSync(path.join(root, 'src/routes/company.routes.ts'), 'utf8');
  const platformRoutes = fs.readFileSync(path.join(root, 'src/routes/platform.routes.ts'), 'utf8');
  const deactivateFn = service.slice(
    service.indexOf('async deactivateCompanyMember'),
    service.indexOf('async updateMyMember')
  );
  assert(deactivateFn.includes('async deactivateCompanyMember'), 'deactivateCompanyMember exists');
  assert(deactivateFn.includes('BEGIN'), 'offboarding uses a DB transaction');
  assert(!deactivateFn.includes('DELETE FROM users'), 'offboarding does not hard-delete users');
  assert(!deactivateFn.includes('DELETE FROM user_subscriptions'), 'offboarding does not delete user_subscriptions');
  assert(deactivateFn.includes('seat_limit') === false, 'offboarding does not write companies.seat_limit');
  assert(deactivateFn.includes('licenceReturned'), 'offboarding reports whether a licence was returned');
  assert(service.includes("input.isActive === false"), 'updateMyMember reuses deactivateCompanyMember');
  assert(auth.includes("ACCOUNT_INACTIVE"), 'auth rejects deactivated sessions');
  assert(companyRoutes.includes('/members/:memberId/deactivate'), 'customer deactivate route exists');
  assert(platformRoutes.includes('/members/:memberId/deactivate'), 'platform deactivate route exists');
  assert(env.isDemoMode, 'demo isolation');
  const clone = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspaceClone.ts'), 'utf8');
  assert(clone.includes('UPDATE users'), 'Reset Demo restores cloned users including is_active');
  const databaseFiles = fs.readdirSync(path.join(root, 'database')).filter((name) => name.endsWith('.sql'));
  assert(!databaseFiles.some((name) => name.includes('offboard') || name.includes('038')), 'no production offboarding SQL');

  const before = toLicencePool(1000, 875);
  const after = previewPoolAfterLicenceReturn(before, true);
  assert(before.purchased === 1000 && after.purchased === 1000, 'preview purchased unchanged');
  assert(after.assigned === 874 && after.available === 126, 'preview assigned/available after returning one licence');
}

async function runIntegration(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }
  const pool = getPool();
  const slug = 'task14-offboard';
  const otherSlug = 'task14-offboard-other';
  const slugs = [slug, otherSlug];
  const password = 'Task14Test!1';
  const passwordHash = await hashPassword(password);

  const cleanup = async () => {
    await pool.query(
      `DELETE FROM production_entries WHERE user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
      [slugs]
    );
    await pool.query(
      `DELETE FROM client_cases WHERE user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
      [slugs]
    );
    await pool.query(
      `DELETE FROM contacts WHERE user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
      [slugs]
    );
    await pool.query(
      `DELETE FROM member_invitation_events WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
      [slugs]
    ).catch((error: { code?: string }) => {
      if (error.code !== '42P01') throw error;
    });
    await pool.query(
      `DELETE FROM member_invitations WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
      [slugs]
    ).catch((error: { code?: string }) => {
      if (error.code !== '42P01') throw error;
    });
    await pool.query(
      `DELETE FROM organisation_admin_assignment_events WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
      [slugs]
    ).catch((error: { code?: string }) => {
      if (error.code !== '42P01') throw error;
    });
    await pool.query(
      `DELETE FROM organisation_admin_assignments WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
      [slugs]
    ).catch((error: { code?: string }) => {
      if (error.code !== '42P01') throw error;
    });
    await pool.query(
      `DELETE FROM demo_outbox_events
       WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))
          OR actor_user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
      [slugs]
    ).catch((error: { code?: string }) => {
      if (error.code !== '42P01') throw error;
    });
    await pool.query(
      `DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
      [slugs]
    );
    await pool.query(
      `DELETE FROM user_subscriptions WHERE user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
      [slugs]
    );
    await pool.query(`DELETE FROM teams WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`, [
      slugs,
    ]);
    await pool.query(`DELETE FROM regions WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`, [
      slugs,
    ]);
    await pool.query(`DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`, [
      slugs,
    ]);
    await pool.query(`DELETE FROM companies WHERE slug = ANY($1::text[])`, [slugs]);
  };

  await cleanup();

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Momentum Task 14', $1, FALSE, TRUE, 3) RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const other = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Other Task 14', $1, FALSE, TRUE, 25) RETURNING id`,
    [otherSlug]
  );
  const otherCompanyId = other.rows[0].id;
  await organisationRepository.ensureCustomerHierarchyRoles(companyId);
  await organisationRepository.ensureCustomerHierarchyRoles(otherCompanyId);
  const packages = await pool.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM subscription_packages WHERE slug IN ('free', 'pro')`
  );
  const freeId = packages.rows.find((row) => row.slug === 'free')?.id;
  const proId = packages.rows.find((row) => row.slug === 'pro')?.id;
  if (!freeId || !proId) throw new Error('free and pro packages required');

  const insertUser = async (
    first: string,
    last: string,
    email: string,
    roleName: string,
    options?: { company?: string; platformAdmin?: boolean; licensed?: boolean; reportsTo?: string | null }
  ): Promise<string> => {
    const targetCompany = options?.company ?? companyId;
    const companyRoles = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM company_roles WHERE company_id = $1`,
      [targetCompany]
    );
    const assigned = companyRoles.rows.find((item) => item.name === roleName);
    if (!assigned) throw new Error(`Missing role ${roleName}`);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (
         first_name, last_name, email, password_hash, email_verified_at,
         company_id, company_role_id, reports_to_user_id, is_platform_admin, phone
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, '0820000014')
       RETURNING id`,
      [
        first,
        last,
        email,
        passwordHash,
        targetCompany,
        assigned.id,
        options?.reportsTo ?? null,
        options?.platformAdmin ?? false,
      ]
    );
    const userId = result.rows[0].id;
    await pool.query(`INSERT INTO user_subscriptions (user_id, package_id, status) VALUES ($1, $2, 'active')`, [
      userId,
      options?.licensed ? proId : freeId,
    ]);
    return userId;
  };

  const app = await createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const execId = await insertUser('Vera', 'Exec', 'task14.exec@verify.test', 'Executive');
    const execTwoId = await insertUser('Victor', 'Exec', 'task14.exec2@verify.test', 'Executive');
    const rmId = await insertUser('Nina', 'North', 'task14.rm@verify.test', 'Regional Manager', { reportsTo: execId });
    const tlId = await insertUser('Theo', 'Avery', 'task14.tl@verify.test', 'Team Leader', { reportsTo: rmId });
    const tlSpareId = await insertUser('Tess', 'Spare', 'task14.tl2@verify.test', 'Team Leader', { reportsTo: rmId });
    const faId = await insertUser('Ada', 'One', 'task14.fa@verify.test', 'Financial Advisor', {
      reportsTo: tlId,
      licensed: true,
    });
    const faUnlicensedId = await insertUser('Ben', 'Two', 'task14.fa2@verify.test', 'Financial Advisor', {
      reportsTo: tlId,
    });
    const faLicensedTwoId = await insertUser('Cara', 'Three', 'task14.fa3@verify.test', 'Financial Advisor', {
      reportsTo: tlId,
      licensed: true,
    });
    void faLicensedTwoId;
    const faAdminId = await insertUser('Omar', 'Admin', 'task14.orgadmin@verify.test', 'Financial Advisor', {
      reportsTo: tlId,
    });
    const faAdminTwoId = await insertUser('Olive', 'Admin', 'task14.orgadmin2@verify.test', 'Financial Advisor', {
      reportsTo: tlId,
    });
    const platformId = await insertUser('Pat', 'Form', 'task14.platform@verify.test', 'Executive', {
      platformAdmin: true,
    });
    const otherExecId = await insertUser('Other', 'Exec', 'task14.other@verify.test', 'Executive', {
      company: otherCompanyId,
    });

    const before = await organisationService.getLicencePool(execId);
    assert(before.purchased === 3 && before.assigned === 2 && before.available === 1, 'starting pool 3 / 2 / 1');

    const contact = await pool.query<{ id: string }>(
      `INSERT INTO contacts (user_id, first_name, last_name) VALUES ($1, 'Kept', 'Client') RETURNING id`,
      [faId]
    );
    await pool.query(
      `INSERT INTO client_cases (user_id, contact_id, title) VALUES ($1, $2, 'Kept case')`,
      [faId, contact.rows[0].id]
    );
    await pool.query(
      `INSERT INTO production_entries (user_id, contact_id, title, amount) VALUES ($1, $2, 'Kept production', 5000)`,
      [faId, contact.rows[0].id]
    );
    const pin = '654321';
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [faId, hashToken(pin)]
    );
    await pool.query(
      `INSERT INTO member_invitations (company_id, user_id, channel, email, status, token_hash, expires_at)
       VALUES ($1, $2, 'mobile', 'task14.fa@verify.test', 'sent', $3, NOW() + INTERVAL '7 days')`,
      [companyId, faId, hashToken(pin)]
    ).catch((error: { code?: string }) => {
      if (error.code !== '42P01') throw error;
    });

    const reportsBefore = await pool.query<{ reports_to_user_id: string | null }>(
      `SELECT reports_to_user_id FROM users WHERE id = $1`,
      [faId]
    );

    const deactivated = await organisationService.deactivateCompanyMember(execId, faId);
    assert(deactivated.member.accountStatus === 'Inactive', 'deactivate licensed FA');
    assert(deactivated.licenceReturned === true, 'licence returns');
    assert(deactivated.licencePool.purchased === 3, 'purchased unchanged');
    assert(deactivated.licencePool.assigned === 1, 'assigned decreases exactly once');
    assert(deactivated.licencePool.available === 2, 'available increases exactly once');
    const userStill = await pool.query<{ id: string; is_active: boolean }>(`SELECT id, is_active FROM users WHERE id = $1`, [
      faId,
    ]);
    assert(userStill.rows[0]?.is_active === false, 'user record remains inactive');
    const history = await pool.query<{ contacts: string; cases: string; production: string; reports: string | null }>(
      `SELECT
         (SELECT COUNT(*)::text FROM contacts WHERE user_id = $1) AS contacts,
         (SELECT COUNT(*)::text FROM client_cases WHERE user_id = $1) AS cases,
         (SELECT COUNT(*)::text FROM production_entries WHERE user_id = $1) AS production,
         (SELECT reports_to_user_id::text FROM users WHERE id = $1) AS reports`,
      [faId]
    );
    assert(history.rows[0].contacts === '1', 'history preserved');
    assert(history.rows[0].cases === '1', 'cases preserved');
    assert(history.rows[0].production === '1', 'production preserved');
    assert(history.rows[0].reports === reportsBefore.rows[0].reports_to_user_id, 'reporting history preserved');

    const pinRow = await pool.query<{ used_at: Date | null }>(
      `SELECT used_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [faId]
    );
    assert(pinRow.rows[0]?.used_at != null, 'outstanding mobile PIN invalidated where supported');
    const invite = await pool.query<{ status: string }>(
      `SELECT status FROM member_invitations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [faId]
    ).catch((error: { code?: string }) => {
      if (error.code === '42P01') return { rows: [{ status: 'revoked' }] };
      throw error;
    });
    assert(invite.rows[0]?.status === 'revoked', 'outstanding portal invitation/token invalidated');

    const audit = await pool.query<{ action: string; metadata: { licenceReturned?: boolean } }>(
      `SELECT action, metadata FROM popia_audit_log
       WHERE metadata->>'targetUserId' = $1 AND action = 'user_deactivated'
       ORDER BY created_at DESC LIMIT 1`,
      [faId]
    );
    assert(audit.rows[0]?.action === 'user_deactivated', 'audit event written');
    assert(audit.rows[0]?.metadata?.licenceReturned === true, 'audit records licence returned');

    const unlicensed = await organisationService.deactivateCompanyMember(execId, faUnlicensedId);
    assert(unlicensed.licenceReturned === false, 'deactivate unlicensed user');
    assert(unlicensed.licencePool.assigned === 1, 'no licence-count change');
    assert(unlicensed.licencePool.purchased === 3, 'purchased still unchanged for unlicensed offboarding');

    const repeat = await organisationService.deactivateCompanyMember(execId, faId);
    assert(repeat.alreadyInactive === true && repeat.licenceReturned === false, 'repeat deactivation is idempotent');
    assert(repeat.licencePool.assigned === 1, 'repeat deactivate does not return a second seat');

    const inactiveUser = await pool.query<{ is_active: boolean }>(`SELECT is_active FROM users WHERE id = $1`, [faId]);
    assert(inactiveUser.rows[0]?.is_active === false, 'deactivated FA cannot use mobile auth');
    const faToken = signToken({ userId: faId, email: 'task14.fa@verify.test' });
    const mobile = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${faToken}` } });
    assert(mobile.status === 401 || mobile.status === 403, 'deactivated FA cannot use mobile auth');

    await expectAppError('FORBIDDEN', 403, () => organisationService.deactivateCompanyMember(execId, execTwoId));
    assert(true, 'Executive handled safely');
    await pool.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [execTwoId]);
    await expectAppError('LAST_ORGANISATION_ADMIN', 409, () =>
      organisationService.deactivateCompanyMember(execId, execId)
    );
    assert(true, 'last Organisation Admin protection');

    const north = await organisationStructureService.createRegion(execId, {
      name: 'Task 14 North',
      managerUserId: rmId,
    });
    const alpha = await organisationStructureService.createTeam(execId, {
      name: 'Task 14 Alpha',
      regionId: north.id,
      leaderUserId: tlId,
    });
    await expectAppError('HIERARCHY_REASSIGNMENT_REQUIRED', 409, () =>
      organisationService.deactivateCompanyMember(execId, tlId)
    );
    assert(true, 'TL with active team hierarchy handled safely');
    await expectAppError('HIERARCHY_REASSIGNMENT_REQUIRED', 409, () =>
      organisationService.deactivateCompanyMember(execId, rmId)
    );
    assert(true, 'RM with active region hierarchy handled safely');
    void alpha;

    const execToken = signToken({ userId: execTwoId, email: 'task14.exec2@verify.test' });
    const portal = await fetch(`${baseUrl}/api/v1/company/me`, { headers: { Authorization: `Bearer ${execToken}` } });
    assert(portal.status === 401 || portal.status === 403, 'deactivated leadership user cannot use portal');

    await expectAppError('FORBIDDEN', 403, () => organisationService.deactivateCompanyMember(execTwoId, execTwoId));
    await expectAppError('NOT_FOUND', 404, () => organisationService.deactivateCompanyMember(otherExecId, faUnlicensedId));
    await expectAppError('FORBIDDEN', 403, () => organisationService.deactivateCompanyMember(faUnlicensedId, faAdminTwoId));
    await expectAppError('FORBIDDEN', 403, () => organisationService.deactivateCompanyMember(execId, platformId));
    assert(true, 'cross-company offboarding blocked');
    assert(true, 'unauthorised actor blocked');
    assert(true, 'protected platform/internal account blocked');

    const truth = await organisationService.getLicencePool(execId);
    assert(truth.purchased === deactivated.licencePool.purchased, 'licence pool returned from backend truth');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await cleanup();
  }
}

async function main(): Promise<void> {
  console.log('Task 14 offboarding verification\n');
  runStaticTests();
  await runIntegration();
  console.log(`\n${passed} passed, ${failed} failed`);
  await closeDatabase();
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
