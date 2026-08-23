/**
 * Phase 6 verification: internal customer subscription administration.
 * Run from Abel Backend: npm run test:phase6
 */
import http from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../src/app';
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import { assertPurchasedNotBelowAssigned, purchasedBelowAssignedMessage, toLicencePool } from '../src/features/licencePool';
import {
  billingIntervalLabel,
  planFamilyFromSlug,
  vatTreatmentLabel,
} from '../src/features/companySubscription';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { organisationService } from '../src/services/organisation.service';
import { platformSubscriptionsService } from '../src/services/platformSubscriptions.service';
import { AppError } from '../src/middleware/errorHandler';
import { hashPassword, signToken } from '../src/utils/auth';

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
  const increased = toLicencePool(60, 42);
  assert(increased.available === 18, 'Increasing purchased immediately increases available');

  const decreased = toLicencePool(45, 42);
  assert(decreased.available === 3, 'Decreasing purchased correctly recalculates available');

  try {
    assertPurchasedNotBelowAssigned(1, 2);
    assert(false, 'reduction below assigned should throw');
  } catch (error) {
    const appError = error as AppError;
    assert(
      appError instanceof AppError && appError.code === 'PURCHASED_BELOW_ASSIGNED',
      'reduction below Assigned is rejected in the pool rule'
    );
    assert(
      appError.message === purchasedBelowAssignedMessage(2),
      'reduction below Assigned uses a clear message'
    );
  }

  assert(planFamilyFromSlug('pro_yearly') === 'pro', 'Yearly Standard belongs to the Standard plan family');
  assert(billingIntervalLabel('month') === 'Monthly', 'Monthly billing cycle label');
  assert(vatTreatmentLabel(false, 15) === 'Not VAT registered', 'VAT treatment when not registered');
  assert(vatTreatmentLabel(true, 15) === 'VAT registered (15%)', 'VAT treatment when registered');
}

async function apiRequest(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; code?: string; data?: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    success?: boolean;
    data?: unknown;
    error?: { code?: string; message?: string };
  };
  return { status: response.status, code: payload.error?.code, data: payload.data };
}

async function runIntegrationTests(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const slug = 'phase6-verify-org';
  const otherSlug = 'phase6-verify-other';
  const unlimitedSlug = 'phase6-verify-unlimited';
  const passwordHash = await hashPassword('Phase6Test!1');

  await pool.query(
    `DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [[slug, otherSlug, unlimitedSlug]]
  );
  await pool.query(`DELETE FROM companies WHERE slug = ANY($1::text[])`, [[slug, otherSlug, unlimitedSlug]]);

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 6 Verify Co', $1, FALSE, TRUE, 3)
     RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const otherCompany = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 6 Other Co', $1, FALSE, TRUE, 8)
     RETURNING id`,
    [otherSlug]
  );
  const otherCompanyId = otherCompany.rows[0].id;
  const unlimitedCompany = await pool.query<{ id: string; seat_limit: number | null }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 6 Unlimited Co', $1, FALSE, TRUE, NULL)
     RETURNING id, seat_limit`,
    [unlimitedSlug]
  );
  const unlimitedCompanyId = unlimitedCompany.rows[0].id;
  assert(unlimitedCompany.rows[0].seat_limit == null, 'existing unlimited accounts are not converted');

  await organisationRepository.ensureCustomerHierarchyRoles(companyId);
  await organisationRepository.ensureCustomerHierarchyRoles(otherCompanyId);
  await organisationRepository.ensureCustomerHierarchyRoles(unlimitedCompanyId);

  const packages = await pool.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM subscription_packages WHERE slug IN ('free', 'pro', 'pro_yearly')`
  );
  const freeId = packages.rows.find((row) => row.slug === 'free')?.id;
  const proId = packages.rows.find((row) => row.slug === 'pro')?.id;
  const yearlyId = packages.rows.find((row) => row.slug === 'pro_yearly')?.id;
  if (!freeId || !proId || !yearlyId) throw new Error('free/pro/pro_yearly packages are required');

  const insertUser = async (
    first: string,
    last: string,
    email: string,
    roleName: string,
    reportsTo: string | null,
    options?: { company?: string; platformAdmin?: boolean }
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
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, '0820000006')
       RETURNING id`,
      [first, last, email, passwordHash, targetCompany, assigned.id, reportsTo, options?.platformAdmin ?? false]
    );
    const userId = result.rows[0].id;
    await pool.query(
      `INSERT INTO user_subscriptions (user_id, package_id, status)
       VALUES ($1, $2, 'active')`,
      [userId, freeId]
    );
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
    const adminId = await insertUser('Ada', 'Admin', 'phase6.admin@verify.test', 'Executive', null, {
      platformAdmin: true,
    });
    const execId = await insertUser('Vera', 'Exec', 'phase6.exec@verify.test', 'Executive', null);
    const rmId = await insertUser('Nina', 'North', 'phase6.rm@verify.test', 'Regional Manager', execId);
    const tlId = await insertUser('Theo', 'Avery', 'phase6.tl@verify.test', 'Team Leader', rmId);
    const faId = await insertUser('Ada', 'One', 'phase6.fa@verify.test', 'Financial Advisor', tlId);
    const fa2 = await insertUser('Ben', 'Two', 'phase6.fa2@verify.test', 'Financial Advisor', tlId);
    const otherExec = await insertUser('Other', 'Exec', 'phase6.other@verify.test', 'Executive', null, {
      company: otherCompanyId,
    });
    const otherFa = await insertUser(
      'Other',
      'Advisor',
      'phase6.other.fa@verify.test',
      'Financial Advisor',
      otherExec,
      { company: otherCompanyId }
    );

    await expectAppError('FORBIDDEN', 403, () => platformSubscriptionsService.list(execId));
    await expectAppError('FORBIDDEN', 403, () => platformSubscriptionsService.list(rmId));
    await expectAppError('FORBIDDEN', 403, () => platformSubscriptionsService.list(tlId));
    await expectAppError('FORBIDDEN', 403, () => platformSubscriptionsService.list(faId));
    await expectAppError('FORBIDDEN', 403, () =>
      platformSubscriptionsService.addLicences(execId, companyId, { quantity: 1 })
    );

    const listed = await platformSubscriptionsService.list(adminId);
    const record = listed.companies.find((row) => row.company.id === companyId);
    assert(Boolean(record), 'internal admin can view subscription record');
    assert(record?.licencePool.purchased === 3 && record.licencePool.assigned === 0, 'new company starts with purchased 3 / assigned 0');
    assert(
      listed.companies.some((row) => row.company.id === companyId) &&
        listed.companies.some((row) => row.company.id === otherCompanyId),
      'subscription list includes each customer company'
    );
    const otherRecord = listed.companies.find((row) => row.company.id === otherCompanyId);
    assert(otherRecord?.licencePool.purchased === 8, 'cross-company list uses each company\'s own purchased quantity');

    const unlimitedRecord = listed.companies.find((row) => row.company.id === unlimitedCompanyId);
    assert(
      unlimitedRecord?.licencePool.purchased == null && unlimitedRecord.licencePool.available == null,
      'unlimited seat_limit remains Unlimited'
    );

    await organisationService.assignMemberLicence(execId, faId);
    await organisationService.assignMemberLicence(execId, fa2);

    const before = await platformSubscriptionsService.get(adminId, companyId);
    assert(before.licencePool.assigned === 2 && before.licencePool.available === 1, 'assigned licences count toward the pool');

    const increased = await platformSubscriptionsService.addLicences(adminId, companyId, {
      quantity: 2,
      reason: 'Expansion',
    });
    assert(
      increased.licencePool.purchased === 5 &&
        increased.licencePool.assigned === 2 &&
        increased.licencePool.available === 3,
      'purchased licence increase'
    );

    const execPool = await organisationService.getLicencePool(execId);
    assert(execPool.purchased === 5 && execPool.available === 3, 'customer pool reflects the internal purchased increase');

    const decreased = await platformSubscriptionsService.reduceLicences(adminId, companyId, {
      quantity: 1,
      reason: 'Right-size',
    });
    assert(
      decreased.licencePool.purchased === 4 &&
        decreased.licencePool.assigned === 2 &&
        decreased.licencePool.available === 2,
      'purchased licence decrease'
    );

    await expectAppError('PURCHASED_BELOW_ASSIGNED', 400, () =>
      platformSubscriptionsService.reduceLicences(adminId, companyId, { quantity: 3 })
    );
    const still = await platformSubscriptionsService.get(adminId, companyId);
    assert(still.licencePool.purchased === 4 && still.licencePool.assigned === 2, 'rejected reduction leaves purchased unchanged');

    await expectAppError('UNLIMITED_POOL', 400, () =>
      platformSubscriptionsService.addLicences(adminId, unlimitedCompanyId, { quantity: 5 })
    );

    const activated = await platformSubscriptionsService.activate(adminId, companyId, 'Go live');
    assert(activated.subscriptionStatus === 'active', 'subscription activation');
    assert(Boolean(activated.subscriptionStartedAt), 'activation records a subscription start date');

    const suspended = await platformSubscriptionsService.suspend(adminId, companyId, 'Payment hold');
    assert(suspended.subscriptionStatus === 'suspended', 'subscription suspension');
    assert(suspended.accountStatus === 'Active', 'suspending a subscription does not deactivate the company account');
    const stillLicensed = await pool.query<{ status: string; is_active: boolean }>(
      `SELECT us.status, u.is_active
       FROM users u
       JOIN user_subscriptions us ON us.user_id = u.id
       WHERE u.id = $1`,
      [faId]
    );
    assert(
      stillLicensed.rows[0].is_active === true && stillLicensed.rows[0].status !== 'cancelled',
      'suspension does not deactivate users or automatically remove licences'
    );
    assert(suspended.licencePool.assigned === 2, 'assigned licences remain after subscription suspension');

    const cancelled = await platformSubscriptionsService.cancel(adminId, companyId, 'Closed');
    assert(cancelled.subscriptionStatus === 'cancelled', 'subscription cancellation');
    const companyAccount = await pool.query<{ is_active: boolean }>(
      `SELECT is_active FROM companies WHERE id = $1`,
      [companyId]
    );
    assert(companyAccount.rows[0].is_active === true, 'cancelling a subscription does not deactivate the company');

    await platformSubscriptionsService.activate(adminId, companyId);

    const planned = await platformSubscriptionsService.updateSubscription(adminId, companyId, {
      packageSlug: 'pro',
      reason: 'Standard monthly',
    });
    assert(planned.plan?.slug === 'pro', 'subscription plan change');
    assert(planned.billingInterval === 'month', 'Standard monthly sets monthly billing');
    assert(planned.licencePriceCents === 34900, 'licence price comes from the selected package');

    const cycled = await platformSubscriptionsService.updateSubscription(adminId, companyId, {
      billingInterval: 'year',
      reason: 'Annual',
    });
    assert(cycled.plan?.slug === 'pro_yearly' && cycled.billingInterval === 'year', 'billing-cycle change');
    assert(cycled.licencePriceCents === 349000, 'yearly licence price comes from the yearly package');

    const otherBefore = await platformSubscriptionsService.get(adminId, otherCompanyId);
    await platformSubscriptionsService.setPurchasedLicences(adminId, companyId, {
      purchased: 6,
      reason: 'Target company only',
    });
    const otherAfter = await platformSubscriptionsService.get(adminId, otherCompanyId);
    assert(
      otherBefore.licencePool.purchased === 8 && otherAfter.licencePool.purchased === 8,
      'cross-company internal action uses the correct target company'
    );
    const targetAfter = await platformSubscriptionsService.get(adminId, companyId);
    assert(targetAfter.licencePool.purchased === 6, 'purchased change applies only to the target company');

    const vat = await platformSubscriptionsService.updateSubscription(adminId, companyId, {
      vatRegistered: true,
      vatRatePercent: 15,
      billingContactName: 'Accounts Desk',
      billingContactEmail: 'accounts@verify.test',
    });
    assert(vat.vatTreatment.registered === true && vat.billingContact?.email === 'accounts@verify.test', 'VAT and billing contact can be stored on the company');

    const history = targetAfter.allocationHistory;
    const purchaseEvent = history.find((event) => event.action === 'purchased_licences_changed');
    assert(Boolean(purchaseEvent), 'purchased-licence changes are recorded');
    assert(
      purchaseEvent?.actor.email === 'phase6.admin@verify.test' &&
        purchaseEvent.previousQuantity === 4 &&
        purchaseEvent.newQuantity === 6 &&
        purchaseEvent.difference === 2 &&
        purchaseEvent.reason === 'Target company only',
      'audit values recorded correctly'
    );
    assert(
      history.some((event) => event.action === 'subscription_plan_changed') &&
        history.some((event) => event.action === 'subscription_billing_cycle_changed') &&
        history.some((event) => event.action === 'subscription_activated') &&
        history.some((event) => event.action === 'subscription_suspended') &&
        history.some((event) => event.action === 'subscription_cancelled'),
      'status, plan, and billing-cycle actions are in allocation history'
    );
    assert(
      history.some((event) => event.action === 'licence_assigned'),
      'user licence allocation history is visible on the company subscription'
    );
    assert(
      targetAfter.invoicing.available === true && Array.isArray(targetAfter.invoices),
      'subscription detail exposes the internal invoicing link'
    );

    const adminToken = signToken({ userId: adminId, email: 'phase6.admin@verify.test' });
    const execToken = signToken({ userId: execId, email: 'phase6.exec@verify.test' });
    const faToken = signToken({ userId: faId, email: 'phase6.fa@verify.test' });

    const adminView = await apiRequest(baseUrl, 'GET', '/api/v1/platform/subscriptions', adminToken);
    assert(adminView.status === 200, 'internal admin API can view subscription records');

    const execView = await apiRequest(baseUrl, 'GET', '/api/v1/platform/subscriptions', execToken);
    assert(execView.status === 403 && execView.code === 'FORBIDDEN', 'customer Executive cannot access subscription admin');

    const faAdd = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/platform/subscriptions/${companyId}/licences/add`,
      faToken,
      { quantity: 10 }
    );
    assert(faAdd.status === 403 && faAdd.code === 'FORBIDDEN', 'manipulated customer API request to add purchased licences is rejected');

    const execPatch = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/platform/companies/${companyId}`,
      execToken,
      { seatLimit: 99 }
    );
    assert(execPatch.status === 403, 'customers cannot alter purchased quantity through the company API');

    const adminReduce = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/platform/subscriptions/${companyId}/licences/reduce`,
      adminToken,
      { quantity: 10 }
    );
    assert(
      adminReduce.status === 400 && adminReduce.code === 'PURCHASED_BELOW_ASSIGNED',
      'direct API reduction below Assigned is rejected'
    );

    const otherFaLicensed = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM users u
       JOIN user_subscriptions us ON us.user_id = u.id
       JOIN subscription_packages p ON p.id = us.package_id
       WHERE u.id = $1 AND p.slug <> 'free' AND us.status IN ('active', 'trialing')`,
      [otherFa]
    );
    assert(otherFaLicensed.rows[0].count === '0', 'actions on one company do not assign licences to another');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await pool.query(
      `DELETE FROM users WHERE company_id = ANY($1::uuid[])`,
      [[companyId, otherCompanyId, unlimitedCompanyId]]
    );
    await pool.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [
      [companyId, otherCompanyId, unlimitedCompanyId],
    ]);
  }
}

async function main(): Promise<void> {
  console.log('Phase 6 verification\n');
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
