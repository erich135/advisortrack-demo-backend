/**
 * Task 13: additional licences / seat-increase workflow.
 * Run: npm run test:seat-increase
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { createApp } from '../src/app';
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import { ADVISORTRACK_VAT_REGISTERED, sellerChargesVat } from '../src/features/advisortrackVat';
import type { EnterpriseContractRecord } from '../src/features/enterpriseContract';
import { prefillFromEnterpriseContract } from '../src/features/invoiceDraft';
import { addCalendarDays, johannesburgToday } from '../src/features/invoiceLifecycle';
import { toLicencePool } from '../src/features/licencePool';
import {
  calendarDaysInclusive,
  decideSeatIncreaseBilling,
  divideRoundHalfUp,
  proratePerSeatCents,
} from '../src/features/seatIncrease';
import { AppError } from '../src/middleware/errorHandler';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { enterpriseSeatChangeRepository } from '../src/repositories/enterpriseSeatChange.repository';
import { env } from '../src/config/env';
import { licenceIncreaseService } from '../src/services/licenceIncrease.service';
import { organisationService } from '../src/services/organisation.service';
import { platformInvoicesService } from '../src/services/platformInvoices.service';
import { hashPassword } from '../src/utils/auth';

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

const root = path.resolve(__dirname, '..');

function sampleContract(overrides: Partial<EnterpriseContractRecord> = {}): EnterpriseContractRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    companyId: '22222222-2222-4222-8222-222222222222',
    onboardingId: null,
    commercialStatus: 'active',
    contractStartDate: '2026-09-01',
    contractEndDate: '2027-08-31',
    autoRenew: false,
    committedLicences: 1000,
    billingModel: 'monthly',
    billingFrequency: 'monthly',
    pricingBasis: 'per_seat',
    negotiatedUnitPriceCents: 7500,
    negotiatedFixedAmountCents: null,
    currency: 'ZAR',
    vatApplicable: false,
    vatRatePercent: '0.00',
    paymentTermsCode: 'days_30',
    paymentTermsCustom: null,
    poReference: 'PO MOM-12345',
    billingContactName: 'Accounts',
    billingEmail: 'accounts@example.test',
    billingNotes: null,
    internalNotes: 'hidden',
    additionalSeatPolicy: 'next_invoice',
    seatReductionPolicy: 'renewal_only',
    additionalSeatsAutoActivate: false,
    createdByUserId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function runStaticAndUnitTests(): void {
  const sql = fs.readFileSync(path.join(root, 'database/demo/007_licence_seat_increases.sql'), 'utf8');
  const migrateAll = fs.readFileSync(path.join(root, 'scripts/run-all-migrations.js'), 'utf8');
  const migrateDemo = fs.readFileSync(path.join(root, 'scripts/run-demo-migrations.js'), 'utf8');
  const clone = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspaceClone.ts'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/services/licenceIncrease.service.ts'), 'utf8');
  const org = fs.readFileSync(path.join(root, 'src/services/organisation.service.ts'), 'utf8');
  const companyRoutes = fs.readFileSync(path.join(root, 'src/routes/company.routes.ts'), 'utf8');
  const platformRoutes = fs.readFileSync(path.join(root, 'src/routes/platform.routes.ts'), 'utf8');
  const prodSql = fs.readdirSync(path.join(root, 'database')).filter((name) => name.endsWith('.sql'));

  assert(sql.includes('DEMO ONLY'), '007 is marked demo only');
  assert(sql.includes('enterprise_contract_seat_changes'), '007 adds seat-change ledger');
  assert(sql.includes('enterprise_billing_adjustments'), '007 adds billing adjustments');
  assert(sql.includes('CREATE TABLE IF NOT EXISTS licence_increase_requests'), '007 creates isolated request table');
  assert(sql.includes("'pending', 'approved', 'rejected', 'cancelled', 'applied'"), '007 supports request states');
  assert(sql.includes('additional_seats_auto_activate'), '007 models explicit auto-activation');
  assert(sql.includes('DEFAULT FALSE'), 'auto-activation defaults off');
  assert(sql.includes('vat_amount_cents     INTEGER NOT NULL DEFAULT 0'), 'adjustments lock VAT at 0');
  assert(!prodSql.includes('007_licence_seat_increases.sql'), '007 is not in production database/');
  assert(!migrateAll.includes('database/local'), 'db:migrate:all does not apply local SQL');
  assert(migrateDemo.includes('database') && migrateDemo.includes('demo'), 'demo migrate applies database/demo');
  assert(!/INSERT INTO licence_increase_requests/i.test(clone), 'Reset Demo does not copy licence requests');
  assert(!/INSERT INTO enterprise_contract_seat_changes/i.test(clone), 'Reset Demo does not copy seat-change ledger');
  assert(!/INSERT INTO enterprise_billing_adjustments/i.test(clone), 'Reset Demo does not copy billing adjustments');
  assert(service.includes('BEGIN'), 'apply uses a DB transaction');
  assert(service.includes('SEAT_POOL_CONFLICT'), 'stale pool conflict is detected');
  assert(service.includes('ALREADY_APPLIED'), 'duplicate apply is blocked');
  assert(service.includes('assignedUnchanged'), 'assigned seats stay unchanged in audit');
  assert(!service.includes('INSERT INTO user_subscriptions'), 'increasing the pool does not assign licences');
  assert(org.includes('licenceIncreaseService.submitForCompany'), 'org admin submit delegates to seat-increase service');
  assert(companyRoutes.includes('/licence-requests'), 'customer request routes exist');
  assert(platformRoutes.includes('/licence-requests/:requestId/approve'), 'internal approve route exists');
  assert(platformRoutes.includes('/licence-requests/:requestId/reject'), 'internal reject route exists');
  assert(platformRoutes.includes('blockDemoPlatformAdmin'), 'public demo blocks internal approval HTTP');
  assert(env.isDemoMode, 'demo isolation');

  const pool = toLicencePool(1000, 875);
  assert(pool.purchased === 1000 && pool.assigned === 875 && pool.available === 125, 'example pool 1000 / 875 / 125');
  const after = toLicencePool(1050, 875);
  assert(after.available === 175, 'available increases after +50 without assignment');
  assert(after.assigned === 875, 'assigned is unchanged by a pool increase');

  assert(divideRoundHalfUp(7500 * 50 * 15, 30) === 187_500, '50 seats × 15/30 of R75 is integer cents');
  assert(proratePerSeatCents({ additionalSeats: 50, unitPriceCents: 7500, remainingDays: 15, periodDays: 30 }) === 187_500, 'monthly proration example');
  assert(calendarDaysInclusive('2026-09-16', '2026-09-30') === 15, '16–30 Sep is 15 remaining days');

  const monthly = decideSeatIncreaseBilling({
    contract: sampleContract({ additionalSeatPolicy: 'immediate_proration', billingFrequency: 'monthly' }),
    additionalSeats: 50,
    asOf: '2026-09-16',
  });
  assert(monthly.billingTreatment === 'immediate_proration' && monthly.amountCents === 187_500, 'Immediate proration per-seat monthly');
  assert(monthly.vatAmountCents === 0, 'proration VAT is 0');
  assert(monthly.requiresManualReview === false, 'safe per-seat monthly proration does not need review');

  const annual = decideSeatIncreaseBilling({
    contract: sampleContract({
      additionalSeatPolicy: 'immediate_proration',
      billingModel: 'annual',
      billingFrequency: 'annual',
      negotiatedUnitPriceCents: 90_000,
    }),
    additionalSeats: 50,
    asOf: '2026-09-16',
  });
  assert(annual.billingTreatment === 'immediate_proration' && annual.amountCents != null && annual.amountCents > 0, 'Immediate proration per-seat annual');
  assert(annual.vatAmountCents === 0, 'annual proration VAT is 0');

  const fixed = decideSeatIncreaseBilling({
    contract: sampleContract({
      additionalSeatPolicy: 'immediate_proration',
      pricingBasis: 'fixed_amount',
      negotiatedUnitPriceCents: null,
      negotiatedFixedAmountCents: 12_000_000,
    }),
    additionalSeats: 50,
    asOf: '2026-09-16',
  });
  assert(fixed.requiresManualReview === true && fixed.amountCents == null, 'Fixed Amount unsafe proration requires manual review');
  assert(fixed.billingTreatment === 'manual_review', 'unsafe immediate proration does not invent a charge');

  const custom = decideSeatIncreaseBilling({
    contract: sampleContract({ additionalSeatPolicy: 'immediate_proration', pricingBasis: 'custom' }),
    additionalSeats: 50,
  });
  assert(custom.requiresManualReview === true && custom.amountCents == null, 'Custom unsafe proration requires manual review');

  const next = decideSeatIncreaseBilling({
    contract: sampleContract({ additionalSeatPolicy: 'next_invoice' }),
    additionalSeats: 50,
  });
  assert(next.billingTreatment === 'next_invoice' && next.amountCents === 7500 * 50, 'Next invoice stores a pending per-seat amount');

  const quarterly = decideSeatIncreaseBilling({
    contract: sampleContract({ additionalSeatPolicy: 'quarterly_true_up' }),
    additionalSeats: 50,
  });
  assert(quarterly.billingTreatment === 'quarterly_true_up' && quarterly.amountCents == null, 'Quarterly true-up records the change without an auto-charge');

  const yearly = decideSeatIncreaseBilling({
    contract: sampleContract({ additionalSeatPolicy: 'annual_true_up' }),
    additionalSeats: 50,
  });
  assert(yearly.billingTreatment === 'annual_true_up' && yearly.amountCents == null, 'Annual true-up records the change without an auto-charge');

  const manual = decideSeatIncreaseBilling({
    contract: sampleContract({ additionalSeatPolicy: 'manual_review' }),
    additionalSeats: 50,
  });
  assert(manual.requiresManualReview === true && manual.amountCents == null, 'Manual review has no auto-charge');

  assert(ADVISORTRACK_VAT_REGISTERED === false && sellerChargesVat() === false, 'VAT lock remains off');

  const prefill = prefillFromEnterpriseContract({
    company: { id: 'c1', name: 'Momentum' },
    contract: sampleContract(),
    pendingAdjustments: [{ id: 'adj-1', description: '+50 licences — next invoice', amountCents: 375_000 }],
  });
  assert(prefill.lines.some((line) => line.unitPriceCents === 375_000), 'pending billing adjustment prefills a future Draft');
  assert(prefill.pendingAdjustmentIds.includes('adj-1'), 'prefill exposes adjustment ids for attach');
}

async function cleanup(slugs: string[]): Promise<void> {
  const pool = getPool();
  await pool.query(
    `DELETE FROM enterprise_billing_adjustments
     WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(
    `DELETE FROM enterprise_contract_seat_changes
     WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(
    `DELETE FROM licence_increase_requests
     WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(
    `DELETE FROM enterprise_contract_events
     WHERE contract_id IN (SELECT id FROM enterprise_contracts WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(
    `DELETE FROM invoice_delivery_events
     WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  );
  await pool.query(
    `DELETE FROM invoice_status_events
     WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  );
  await pool.query(
    `DELETE FROM invoice_commercial_details
     WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(
    `DELETE FROM invoice_line_items
     WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  );
  await pool.query(`DELETE FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`, [
    slugs,
  ]);
  await pool.query(
    `DELETE FROM company_billing_profiles WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  );
  await pool.query(
    `DELETE FROM enterprise_contracts WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(
    `DELETE FROM organisation_admin_assignment_events
     WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(
    `DELETE FROM organisation_admin_assignments
     WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
  await pool.query(`DELETE FROM user_subscriptions WHERE user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`, [
    slugs,
  ]);
  await pool.query(`DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`, [
    slugs,
  ]);
  await pool.query(`DELETE FROM companies WHERE slug = ANY($1::text[])`, [slugs]);
}

async function runIntegration(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }
  const pool = getPool();
  const slug = 'task13-seat-org';
  const otherSlug = 'task13-seat-other';
  const slugs = [slug, otherSlug];
  const passwordHash = await hashPassword('Task13Test!1');
  await cleanup(slugs);

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Momentum Task 13', $1, FALSE, TRUE, 1000) RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const other = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Other Task 13', $1, FALSE, TRUE, 25) RETURNING id`,
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
    options?: { company?: string; platformAdmin?: boolean; licensed?: boolean }
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
         company_id, company_role_id, is_platform_admin, phone
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, '0820000013')
       RETURNING id`,
      [first, last, email, passwordHash, targetCompany, assigned.id, options?.platformAdmin ?? false]
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
    const adminId = await insertUser('Ada', 'Admin', 'task13.admin@verify.test', 'Executive', { platformAdmin: true });
    const orgAdminId = await insertUser('Omar', 'Admin', 'task13.orgadmin@verify.test', 'Executive');
    const advisorId = await insertUser('Ann', 'Advisor', 'task13.advisor@verify.test', 'Financial Advisor');
    const licensedA = await insertUser('Licensed', 'One', 'task13.lic1@verify.test', 'Financial Advisor', { licensed: true });
    const licensedB = await insertUser('Licensed', 'Two', 'task13.lic2@verify.test', 'Financial Advisor', { licensed: true });
    const otherAdminId = await insertUser('Other', 'Admin', 'task13.other@verify.test', 'Executive', {
      company: otherCompanyId,
    });
    void licensedA;
    void licensedB;

    await pool.query(
      `INSERT INTO enterprise_contracts (
         company_id, commercial_status, contract_start_date, contract_end_date, committed_licences,
         billing_model, billing_frequency, pricing_basis, negotiated_unit_price_cents, currency,
         additional_seat_policy, seat_reduction_policy, created_by_user_id, additional_seats_auto_activate
       ) VALUES ($1, 'active', '2026-09-01', '2027-08-31', 1000, 'monthly', 'monthly', 'per_seat', 7500, 'ZAR',
                 'next_invoice', 'renewal_only', $2, FALSE)`,
      [companyId, adminId]
    );

    const beforePool = await organisationRepository.countLicensedSeats(companyId);
    const submitted = await licenceIncreaseService.submitForCompany({
      companyId,
      userId: orgAdminId,
      additional: 50,
      notes: 'Mid-month extra seats',
    });
    assert(submitted.status === 'pending' && submitted.additionalRequested === 50, 'submit +50 request');
    assert(submitted.currentPurchased === 1000 && submitted.proposedTotal === 1050, 'proposed total is 1,050');
    assert(submitted.seatLimitUnchanged === true, 'request does not change seat_limit');
    const afterSubmit = await pool.query<{ seat_limit: number }>(`SELECT seat_limit FROM companies WHERE id = $1`, [
      companyId,
    ]);
    assert(afterSubmit.rows[0].seat_limit === 1000, 'seat_limit stays 1,000 until approval');
    assert(beforePool === 2, 'fixture has two assigned licences');

    await expectAppError('FORBIDDEN', 403, () =>
      organisationService.requestLicenceIncrease(advisorId, { additional: 50 })
    );
    assert(true, 'unauthorised user cannot request licences');

    const ownPost = await organisationService.requestLicenceIncrease(orgAdminId, { additional: 10 });
    assert(ownPost.status === 'pending' && ownPost.additionalRequested === 10, 'Organisation Admin can request for own company');

    await expectAppError('NOT_FOUND', 404, () =>
      organisationService.cancelLicenceIncreaseRequest(otherAdminId, submitted.id)
    );
    assert(true, 'cross-company request access blocked');

    const enter = await fetch(`${baseUrl}/api/v1/demo/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedRole: 'executive' }),
    });
    assert(enter.status === 201, 'demo executive session can request additional licences');
    const enterBody = (await enter.json()) as { data?: { token?: string } };
    const demoToken = enterBody.data?.token ?? '';
    const demoPost = await fetch(`${baseUrl}/api/v1/company/licence-requests`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${demoToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ additional: 50 }),
    });
    assert(demoPost.status === 201, 'demo customer HTTP can request additional licences');

    const queue = await fetch(`${baseUrl}/api/v1/platform/licence-requests`, {
      headers: { Authorization: `Bearer ${demoToken}` },
    });
    assert(queue.status === 403, 'internal licence request queue');
    const customerQueue = await fetch(`${baseUrl}/api/v1/platform/licence-requests`, {
      headers: { Authorization: `Bearer ${demoToken}` },
    });
    assert(customerQueue.status === 403, 'customer cannot open internal queue');

    const applied = await licenceIncreaseService.approve(adminId, submitted.id);
    assert(applied?.status === 'applied', 'approve/apply +50');
    const afterApply = await pool.query<{ seat_limit: number }>(`SELECT seat_limit FROM companies WHERE id = $1`, [
      companyId,
    ]);
    assert(afterApply.rows[0].seat_limit === 1050, 'seat_limit increases exactly once to 1,050');
    const assignedAfter = await organisationRepository.countLicensedSeats(companyId);
    assert(assignedAfter === 2, 'Assigned unchanged');
    const available = toLicencePool(1050, assignedAfter).available;
    assert(available === 1048, 'Available increases correctly');

    const ledger = await enterpriseSeatChangeRepository.listForCompany(companyId);
    assert(ledger.length === 1 && ledger[0].delta === 50 && ledger[0].new_purchased_seats === 1050, 'immutable ledger created');
    assert(ledger[0].previous_purchased_seats === 1000, 'ledger retains previous purchased seats');

    const duplicate = await licenceIncreaseService.approve(adminId, submitted.id);
    assert(duplicate?.alreadyApplied === true, 'duplicate apply blocked / already-applied');
    const still = await pool.query<{ seat_limit: number }>(`SELECT seat_limit FROM companies WHERE id = $1`, [companyId]);
    assert(still.rows[0].seat_limit === 1050, 'retry does not add seats twice');

    const stale = await licenceIncreaseService.submitForCompany({
      companyId,
      userId: orgAdminId,
      additional: 50,
    });
    await pool.query(`UPDATE companies SET seat_limit = 1025 WHERE id = $1`, [companyId]);
    await expectAppError('SEAT_POOL_CONFLICT', 409, () => licenceIncreaseService.approve(adminId, stale.id));
    const afterConflict = await pool.query<{ seat_limit: number }>(`SELECT seat_limit FROM companies WHERE id = $1`, [
      companyId,
    ]);
    assert(afterConflict.rows[0].seat_limit === 1025, 'stale request does not overwrite to 1,050');
    await pool.query(`UPDATE companies SET seat_limit = 1050 WHERE id = $1`, [companyId]);

    const rejected = await licenceIncreaseService.submitForCompany({ companyId, userId: orgAdminId, additional: 5 });
    await licenceIncreaseService.reject(adminId, rejected.id, 'Not this month');
    await expectAppError('REQUEST_NOT_APPLIABLE', 409, () => licenceIncreaseService.approve(adminId, rejected.id));

    const policies: Array<{ policy: string; expectType: string; expectAmount: number | null; expectStatus: string }> = [
      { policy: 'immediate_proration', expectType: 'immediate_proration', expectAmount: null, expectStatus: 'pending' },
      { policy: 'quarterly_true_up', expectType: 'quarterly_true_up', expectAmount: null, expectStatus: 'recorded' },
      { policy: 'annual_true_up', expectType: 'annual_true_up', expectAmount: null, expectStatus: 'recorded' },
      { policy: 'manual_review', expectType: 'manual_review', expectAmount: null, expectStatus: 'pending' },
    ];
    for (const item of policies) {
      await pool.query(`UPDATE enterprise_contracts SET additional_seat_policy = $2 WHERE company_id = $1`, [
        companyId,
        item.policy,
      ]);
      const current = await pool.query<{ seat_limit: number }>(`SELECT seat_limit FROM companies WHERE id = $1`, [
        companyId,
      ]);
      const req = await licenceIncreaseService.submitForCompany({ companyId, userId: orgAdminId, additional: 2 });
      const result = await licenceIncreaseService.approve(adminId, req.id);
      assert(result?.adjustment?.adjustment_type === item.expectType, `${item.policy} billing type recorded`);
      assert(result?.adjustment?.status === item.expectStatus, `${item.policy} adjustment status`);
      if (item.policy === 'manual_review') {
        assert(result?.adjustment?.amount_cents == null, 'manual review no auto-charge');
      }
      assert(result?.adjustment?.vat_amount_cents === 0, `${item.policy} VAT remains zero`);
      assert(result?.status === 'applied', `${item.policy} still applies seats`);
      const nextLimit = await pool.query<{ seat_limit: number }>(`SELECT seat_limit FROM companies WHERE id = $1`, [
        companyId,
      ]);
      assert(nextLimit.rows[0].seat_limit === current.rows[0].seat_limit + 2, `${item.policy} increases purchased`);
    }

    await pool.query(
      `UPDATE enterprise_contracts
       SET additional_seat_policy = 'immediate_proration', pricing_basis = 'fixed_amount',
           negotiated_unit_price_cents = NULL, negotiated_fixed_amount_cents = 120000000
       WHERE company_id = $1`,
      [companyId]
    );
    const unsafe = await licenceIncreaseService.submitForCompany({ companyId, userId: orgAdminId, additional: 3 });
    const unsafeApplied = await licenceIncreaseService.approve(adminId, unsafe.id);
    assert(unsafeApplied?.adjustment?.adjustment_type === 'manual_review', 'fixed-amount proration requires manual review');
    assert(unsafeApplied?.adjustment?.amount_cents == null, 'unsafe proration does not invent an amount');

    await pool.query(
      `UPDATE enterprise_contracts
       SET additional_seat_policy = 'next_invoice', pricing_basis = 'per_seat',
           negotiated_unit_price_cents = 7500, negotiated_fixed_amount_cents = NULL
       WHERE company_id = $1`,
      [companyId]
    );
    const nextReq = await licenceIncreaseService.submitForCompany({ companyId, userId: orgAdminId, additional: 4 });
    const nextApplied = await licenceIncreaseService.approve(adminId, nextReq.id);
    assert(nextApplied?.adjustment?.adjustment_type === 'next_invoice', 'Next invoice adjustment created');
    assert(nextApplied?.adjustment?.amount_cents === 7500 * 4, 'next invoice uses per-seat amount');
    assert(nextApplied?.adjustment?.vat_amount_cents === 0, 'next invoice VAT is 0');

    const invoiceDate = johannesburgToday();
    const issued = await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate,
      dueDate: addCalendarDays(invoiceDate, 30),
      billing: {
        registeredName: 'Momentum Task 13',
        vatRegistered: false,
        billingContactName: 'Accounts',
        billingEmail: 'accounts@verify.test',
      },
      lines: [{ description: 'Existing issued invoice', quantity: '1', unitPriceCents: 1000 }],
    });
    const issuedLocked = await platformInvoicesService.issue(adminId, issued.id);
    const issuedTotal = issuedLocked.totalCents;
    const prefill = await platformInvoicesService.prefillFromContract(adminId, companyId);
    assert(
      prefill.lines.some((line) => line.unitPriceCents === 7500 * 4),
      'new billing adjustment can prefill future Draft invoice'
    );
    const draft = await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate,
      dueDate: addCalendarDays(invoiceDate, 30),
      sourceContractId: prefill.sourceContractId,
      attachPendingAdjustments: true,
      billing: {
        registeredName: 'Momentum Task 13',
        vatRegistered: false,
        billingContactName: 'Accounts',
        billingEmail: 'accounts@verify.test',
      },
      lines: prefill.lines,
    });
    assert(draft.status === 'draft' && draft.vatCents === 0, 'draft from adjustments remains VAT 0');
    const reloadedIssued = await platformInvoicesService.get(adminId, issuedLocked.id);
    assert(reloadedIssued.totalCents === issuedTotal && reloadedIssued.status === 'sent', 'issued invoice unaffected');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await cleanup(slugs);
  }
}

async function main(): Promise<void> {
  console.log('Task 13 seat-increase verification\n');
  runStaticAndUnitTests();
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
