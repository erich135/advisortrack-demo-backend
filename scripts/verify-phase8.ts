/**
 * Phase 8 verification: invoice delivery, connected customer account, audit trail.
 * Run from Abel Backend: npm run test:phase8
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { createApp } from '../src/app';
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import { AppError } from '../src/middleware/errorHandler';
import { invoiceRepository } from '../src/repositories/invoice.repository';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { organisationService } from '../src/services/organisation.service';
import { organisationStructureService } from '../src/services/organisationStructure.service';
import { platformAuditService } from '../src/services/platformAudit.service';
import { platformCustomersService } from '../src/services/platformCustomers.service';
import { platformInvoicesService } from '../src/services/platformInvoices.service';
import { platformSubscriptionsService } from '../src/services/platformSubscriptions.service';
import { sendMail, setTestMailer, type SendMailInput, type SendMailResult } from '../src/services/emailService';
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

async function apiRequest(
  baseUrl: string,
  method: string,
  pathName: string,
  token: string,
  body?: unknown
): Promise<{ status: number; code?: string; data?: unknown }> {
  const response = await fetch(`${baseUrl}${pathName}`, {
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

async function cleanupCompanies(slugs: string[]): Promise<void> {
  const pool = getPool();
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
    `DELETE FROM invoice_line_items
     WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  );
  await pool.query(
    `DELETE FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  );
  await pool.query(
    `DELETE FROM company_billing_profiles WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
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
}

async function runUnitTests(): Promise<void> {
  setTestMailer(null);
  const unconfigured = await sendMail({
    to: 'nobody@example.test',
    subject: 'Should not send',
    text: 'test',
    html: '<p>test</p>',
    category: 'Invoice',
  });
  assert(unconfigured.ok === false, 'missing Mailtrap token does not send');
  assert(
    (unconfigured.error ?? '').includes('MAILTRAP_API_TOKEN'),
    'missing token returns a clear development message'
  );
  assert((unconfigured.error ?? '').includes('No external delivery'), 'missing token does not attempt external delivery');
}

async function runIntegrationTests(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const deliveryCols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'invoice_delivery_events'
       AND column_name = ANY($1::text[])`,
    [['provider_message_id', 'snapshot_ref']]
  );
  if (deliveryCols.rows.length < 2) {
    throw new Error('Migration 028 has not been applied to advisortrack_local');
  }

  const slug = 'phase8-verify-org';
  const otherSlug = 'phase8-verify-other';
  const slugs = [slug, otherSlug];
  const passwordHash = await hashPassword('Phase8Test!1');
  await cleanupCompanies(slugs);

  let sentMails: SendMailInput[] = [];
  const successMailer = {
    send: async (input: SendMailInput): Promise<SendMailResult> => {
      sentMails.push(input);
      return { ok: true, messageId: `msg-${sentMails.length}` };
    },
  };
  const failMailer = {
    send: async (input: SendMailInput): Promise<SendMailResult> => {
      sentMails.push(input);
      return { ok: false, error: 'Simulated provider rejection' };
    },
  };
  setTestMailer(successMailer);

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 8 Verify Co', $1, FALSE, TRUE, 5)
     RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const otherCompany = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 8 Other Co', $1, FALSE, TRUE, 8)
     RETURNING id`,
    [otherSlug]
  );
  const otherCompanyId = otherCompany.rows[0].id;

  await organisationRepository.ensureCustomerHierarchyRoles(companyId);
  await organisationRepository.ensureCustomerHierarchyRoles(otherCompanyId);

  const packages = await pool.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM subscription_packages WHERE slug IN ('free', 'pro', 'pro_yearly')`
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
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, '0820000008')
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
    const adminId = await insertUser('Ada', 'Admin', 'phase8.admin@verify.test', 'Executive', null, {
      platformAdmin: true,
    });
    const execId = await insertUser('Vera', 'Exec', 'phase8.exec@verify.test', 'Executive', null);
    const rmId = await insertUser('Nina', 'North', 'phase8.rm@verify.test', 'Regional Manager', execId);
    const tlId = await insertUser('Theo', 'Avery', 'phase8.tl@verify.test', 'Team Leader', rmId);
    const faId = await insertUser('Ada', 'One', 'phase8.fa@verify.test', 'Financial Advisor', tlId);
    const otherExecId = await insertUser('Other', 'Exec', 'phase8.other@verify.test', 'Executive', null, {
      company: otherCompanyId,
    });
    await insertUser('Other', 'Advisor', 'phase8.other.fa@verify.test', 'Financial Advisor', otherExecId, {
      company: otherCompanyId,
    });

    await platformSubscriptionsService.updateSubscription(adminId, companyId, {
      packageSlug: 'pro',
      vatRegistered: false,
      billingContactName: 'Accounts Desk',
      billingContactEmail: 'accounts@verify.test',
    });
    await platformSubscriptionsService.updateSubscription(adminId, otherCompanyId, {
      packageSlug: 'pro',
      vatRegistered: false,
    });

    const srcRoot = path.join(__dirname, '../src');
    const scan = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), 'utf8');
    const invoiceService = scan('services/platformInvoices.service.ts');
    const invoiceRepo = scan('repositories/invoice.repository.ts');
    const platformRoutes = scan('routes/platform.routes.ts');
    const orgRepo = scan('repositories/organisation.repository.ts');
    assert(!/DELETE FROM invoices/i.test(invoiceService), 'invoice service has no hard-delete workflow');
    assert(!/DELETE FROM invoice_delivery_events/i.test(invoiceService), 'delivery events are not hard-deleted');
    assert(!/DELETE FROM popia_audit_log/i.test(orgRepo), 'audit log is not hard-deleted');
    assert(!/router\.delete\(\s*'\/invoices/i.test(platformRoutes), 'invoice routes do not expose DELETE');
    assert(!/router\.delete\(\s*'\/audit/i.test(platformRoutes), 'audit routes do not expose DELETE');
    assert(!/\.query\([^;]*DELETE FROM invoice_/i.test(invoiceRepo), 'invoice repository does not DELETE invoice rows');

    await expectAppError('FORBIDDEN', 403, () => platformInvoicesService.send(execId, '00000000-0000-4000-8000-000000000001'));
    await expectAppError('FORBIDDEN', 403, () => platformCustomersService.get(execId, companyId));
    await expectAppError('FORBIDDEN', 403, () => platformAuditService.list(faId));
    await expectAppError('FORBIDDEN', 403, () => platformAuditService.list(rmId));
    await expectAppError('FORBIDDEN', 403, () => platformAuditService.list(tlId));

    const created = await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate: '2026-08-01',
      dueDate: '2026-08-31',
      billing: {
        registeredName: 'Phase 8 Verify Co',
        billingContactName: 'Accounts Desk',
        billingEmail: 'accounts@verify.test',
        vatRegistered: false,
        address: '1 Test Street',
      },
      lines: [{ description: 'AdvisorTrack Software Licence — 2 licences', quantity: '2', unitPriceCents: 34900 }],
    });
    assert(created.status === 'draft', 'new invoices stay Draft until a successful send');
    const createdAudit = await platformAuditService.list(adminId, { companyId, resourceType: 'invoice' });
    assert(
      createdAudit.events.some((event) => event.action === 'invoice_created' && event.invoiceNumber === created.invoiceNumber),
      'audit User/invoice created records invoice_created'
    );

    setTestMailer(failMailer);
    sentMails = [];
    await expectAppError('INVOICE_DELIVERY_FAILED', 502, () => platformInvoicesService.send(adminId, created.id));
    const afterFail = await platformInvoicesService.get(adminId, created.id);
    assert(afterFail.status === 'draft', 'failed send does NOT transition invoice to Sent');
    assert(afterFail.deliveryEvents.length === 1, 'failed delivery event is retained');
    assert(afterFail.deliveryEvents[0].status === 'failed', 'failed attempt is recorded as failed');
    assert(afterFail.deliveryEvents[0].recipientEmail === 'accounts@verify.test', 'recipient stored on failed attempt');
    assert(afterFail.deliveryEvents[0].createdAt != null, 'send timestamp stored on failed attempt');
    assert(afterFail.deliveryEvents[0].errorMessage?.includes('Simulated'), 'failure information is stored');
    assert(afterFail.lastDelivery?.status === 'failed', 'failed-delivery state is visible on the invoice');

    setTestMailer(successMailer);
    sentMails = [];
    const sent = await platformInvoicesService.send(adminId, created.id);
    assert(sent.status === 'sent', 'successful send transitions invoice to Sent');
    assert(sent.deliveryEvents.length === 2, 'successful delivery event is retained alongside the failed attempt');
    const successEvent = sent.deliveryEvents[1];
    assert(successEvent.status === 'sent', 'successful attempt is recorded as sent');
    assert(successEvent.recipientEmail === 'accounts@verify.test', 'recipient stored on successful attempt');
    assert(successEvent.providerMessageId === 'msg-1', 'provider message reference is stored');
    assert((successEvent.snapshotRef ?? '').startsWith(`${sent.invoiceNumber}@`), 'invoice snapshot identifier is recorded');
    assert(sentMails[0]?.attachments?.[0]?.filename === `${sent.invoiceNumber}.pdf`, 'email attaches the invoice PDF');
    const firstPdf = sentMails[0]?.attachments?.[0]?.content?.toString('latin1') ?? '';
    assert(firstPdf.includes('Phase 8 Verify Co'), 'PDF attachment uses stored invoice snapshot');
    assert(firstPdf.includes(sent.invoiceNumber), 'PDF attachment contains the invoice number');

    await organisationService.updateCompany(adminId, companyId, { name: 'Phase 8 Renamed Co' });
    await platformInvoicesService.upsertBillingProfile(adminId, companyId, {
      registeredName: 'Phase 8 Renamed Co',
      vatRegistered: false,
      billingContactName: 'New Contact',
      billingEmail: 'new@verify.test',
      address: '99 Changed Road',
    });
    const afterRename = await platformInvoicesService.get(adminId, sent.id);
    assert(afterRename.snapshot.registeredName === 'Phase 8 Verify Co', 'customer detail changes do not change previously sent invoice');
    assert(afterRename.snapshot.billingEmail === 'accounts@verify.test', 'sent snapshot billing email stays frozen');
    const pdfAfterRename = await platformInvoicesService.generatePdf(adminId, sent.id);
    const pdfAfterText = pdfAfterRename.buffer.toString('latin1');
    assert(pdfAfterText.includes('Phase 8 Verify Co'), 'download PDF still uses stored snapshot');
    assert(!pdfAfterText.includes('Phase 8 Renamed Co'), 'download PDF ignores later customer name');

    sentMails = [];
    const resent = await platformInvoicesService.send(adminId, sent.id);
    assert(resent.invoiceNumber === sent.invoiceNumber, 'resend does not change invoice number');
    assert(resent.deliveryEvents.length === 3, 'resend creates another delivery-history event');
    assert(resent.snapshot.registeredName === 'Phase 8 Verify Co', 'resend does not regenerate commercial snapshot');
    const resendPdf = sentMails[0]?.attachments?.[0]?.content?.toString('latin1') ?? '';
    assert(resendPdf.includes('Phase 8 Verify Co') && !resendPdf.includes('Phase 8 Renamed Co'), 'resend PDF uses stored snapshot');

    const paid = await platformInvoicesService.markPaid(adminId, resent.id, '2026-08-20');
    assert(paid.status === 'paid', 'invoice can be marked paid after send');
    const voided = await platformInvoicesService.void(
      adminId,
      (
        await platformInvoicesService.create(adminId, {
          companyId,
          invoiceDate: '2026-08-02',
          dueDate: '2026-09-01',
          billing: { registeredName: 'Phase 8 Verify Co', vatRegistered: false, billingEmail: 'accounts@verify.test' },
          lines: [{ description: 'Void me', quantity: '1', unitPriceCents: 1000 }],
        })
      ).id
    );
    assert(voided.status === 'voided', 'voided invoices remain retained');

    const account = await platformCustomersService.get(adminId, companyId);
    assert(account.company.id === companyId, 'connected customer Overview uses the selected company');
    assert(account.members.every((member) => member.email.endsWith('@verify.test')), 'Users tab members belong to the verification set');
    assert(
      account.members.some((member) => member.id === faId) && account.members.every((member) => member.id !== otherExecId),
      'connected customer Users are scoped to the selected company'
    );
    assert(account.subscription.company.id === companyId, 'Subscription tab uses the selected company');
    assert(account.subscription.licencePool.purchased === 5, 'Licences tab uses the selected company pool');
    assert(
      account.invoices.every((invoice) => invoice.companyId === companyId),
      'Invoices tab uses the selected company'
    );
    const otherAccount = await platformCustomersService.get(adminId, otherCompanyId);
    assert(otherAccount.company.id === otherCompanyId, 'cross-company customer account uses the other company');
    assert(
      otherAccount.members.every((member) => member.id !== faId && member.id !== execId),
      'cross-company isolation on Users'
    );
    assert(
      otherAccount.invoices.every((invoice) => invoice.companyId === otherCompanyId),
      'cross-company isolation on Invoices'
    );

    const roles = await organisationService.listAssignableRoles(adminId, companyId);
    const rmRole = roles.find((role) => role.rank === 'regional_manager');
    const faRole = roles.find((role) => role.rank === 'financial_advisor');
    if (!rmRole || !faRole) throw new Error('expected customer ranks for audit coverage');

    const invited = await organisationService.createMyMember(
      adminId,
      {
        firstName: 'New',
        lastName: 'Advisor',
        email: 'phase8.new@verify.test',
        roleId: faRole.id,
        reportsToUserId: execId,
      },
      { companyId }
    );
    const userCreated = await platformAuditService.list(adminId, { companyId, resourceType: 'user' });
    assert(
      userCreated.events.some((event) => event.action === 'user_created' && event.targetUserId === invited.id),
      'audit User created'
    );

    const region = await organisationStructureService.createRegion(
      adminId,
      { name: 'Phase 8 North', managerUserId: rmId },
      companyId
    );
    const team = await organisationStructureService.createTeam(
      adminId,
      { name: 'Phase 8 Alpha', regionId: region.id, leaderUserId: tlId },
      companyId
    );
    await organisationService.updateMyMember(
      adminId,
      invited.id,
      { teamId: team.id, regionId: region.id },
      { companyId }
    );
    await organisationService.updateMyMember(
      adminId,
      invited.id,
      { roleId: rmRole.id, reportsToUserId: execId },
      { companyId }
    );
    await organisationService.updateMyMember(adminId, invited.id, { isActive: false }, { companyId });
    const userAudit = await platformAuditService.list(adminId, { companyId, resourceType: 'user' });
    assert(userAudit.events.some((event) => event.action === 'role_changed'), 'audit Role changed');
    assert(userAudit.events.some((event) => event.action === 'team_changed'), 'audit Team changed');
    assert(userAudit.events.some((event) => event.action === 'region_changed'), 'audit Region changed');
    assert(userAudit.events.some((event) => event.action === 'user_deactivated'), 'audit User deactivated');

    await organisationService.assignMemberLicence(adminId, invited.id, companyId);
    await organisationService.removeMemberLicence(adminId, invited.id, companyId);
    const licenceAudit = await platformAuditService.list(adminId, { companyId, resourceType: 'licence' });
    assert(licenceAudit.events.some((event) => event.action === 'licence_assigned'), 'audit licence assigned');
    assert(licenceAudit.events.some((event) => event.action === 'licence_removed'), 'audit licence removed');

    await platformSubscriptionsService.setPurchasedLicences(adminId, companyId, {
      purchased: 7,
      reason: 'Phase 8 increase',
    });
    await platformSubscriptionsService.setPurchasedLicences(adminId, companyId, {
      purchased: 6,
      reason: 'Phase 8 decrease',
    });
    const subAudit = await platformAuditService.list(adminId, { companyId, resourceType: 'subscription' });
    const poolEvents = subAudit.events.filter((event) => event.action === 'purchased_licences_changed');
    assert(
      poolEvents.some((event) => Number(event.difference) > 0),
      'audit customer licence pool increased'
    );
    assert(
      poolEvents.some((event) => Number(event.difference) < 0),
      'audit customer licence pool decreased'
    );
    assert(
      subAudit.events.some((event) => event.action === 'subscription_plan_changed' || event.action === 'subscription_updated'),
      'audit subscription changes'
    );

    const invoiceAudit = await platformAuditService.list(adminId, { companyId, resourceType: 'invoice' });
    assert(invoiceAudit.events.some((event) => event.action === 'invoice_sent'), 'audit invoice sent');
    assert(invoiceAudit.events.some((event) => event.action === 'invoice_marked_paid'), 'audit invoice marked paid');
    assert(invoiceAudit.events.some((event) => event.action === 'invoice_voided'), 'audit invoice voided');
    const firstInvoiceAuditId = invoiceAudit.events.find((event) => event.action === 'invoice_created')?.id;
    await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate: '2026-08-03',
      dueDate: '2026-09-02',
      billing: { registeredName: 'Phase 8 Verify Co', vatRegistered: false, billingEmail: 'accounts@verify.test' },
      lines: [{ description: 'Later invoice', quantity: '1', unitPriceCents: 500 }],
    });
    const laterAudit = await platformAuditService.list(adminId, { companyId, resourceType: 'invoice' });
    assert(
      firstInvoiceAuditId != null && laterAudit.events.some((event) => event.id === firstInvoiceAuditId),
      'audit history retained'
    );

    const adminToken = signToken({ userId: adminId, email: 'phase8.admin@verify.test' });
    const execToken = signToken({ userId: execId, email: 'phase8.exec@verify.test' });
    const faToken = signToken({ userId: faId, email: 'phase8.fa@verify.test' });
    const adminSend = await apiRequest(baseUrl, 'POST', `/api/v1/platform/invoices/${created.id}/send`, adminToken);
    assert(adminSend.status === 200, 'platform admin can send invoice');
    const execSend = await apiRequest(baseUrl, 'POST', `/api/v1/platform/invoices/${created.id}/send`, execToken);
    assert(execSend.status === 403 && execSend.code === 'FORBIDDEN', 'customer roles cannot send invoices');
    const faCustomer = await apiRequest(baseUrl, 'GET', `/api/v1/platform/customers/${companyId}`, faToken);
    assert(faCustomer.status === 403, 'customer roles cannot access connected customer admin');
    const execAudit = await apiRequest(baseUrl, 'GET', '/api/v1/platform/audit', execToken);
    assert(execAudit.status === 403, 'customer roles cannot access internal audit');
  } finally {
    setTestMailer(null);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await cleanupCompanies(slugs);
  }
}

async function main(): Promise<void> {
  console.log('Phase 8 verification\n');
  await runUnitTests();
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
