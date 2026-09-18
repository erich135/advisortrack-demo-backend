/**
 * Phase 7 verification: internal AdvisorTrack invoicing.
 * Run from Abel Backend: npm run test:phase7
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { createApp } from '../src/app';
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import {
  calculateInvoiceTotals,
  calculateLine,
  centsToRand,
  formatInvoiceNumber,
  randToCents,
  roundHalfAwayFromZero,
} from '../src/features/invoiceMoney';
import { addCalendarDays, johannesburgToday, presentationStatus } from '../src/features/invoiceLifecycle';
import { AppError } from '../src/middleware/errorHandler';
import { invoiceRepository } from '../src/repositories/invoice.repository';
import { organisationRepository } from '../src/repositories/organisation.repository';
import { organisationService } from '../src/services/organisation.service';
import { platformInvoicesService } from '../src/services/platformInvoices.service';
import { platformSubscriptionsService } from '../src/services/platformSubscriptions.service';
import { setTestMailer } from '../src/services/emailService';
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

function runUnitTests(): void {
  assert(roundHalfAwayFromZero(15n, 10n) === 2n, 'half away from zero rounds 1.5 up');
  assert(roundHalfAwayFromZero(25n, 10n) === 3n, 'half away from zero rounds 2.5 up');
  assert(randToCents('349.00') === 34900, 'randToCents stores integer cents');
  assert(randToCents('1.005') === 101, 'randToCents rounds half away from zero');
  assert(centsToRand(34900) === '349.00', 'centsToRand is two-decimal');
  assert(formatInvoiceNumber(100000) === 'INV100000', 'first invoice number format');
  assert(formatInvoiceNumber(100001) === 'INV100001', 'invoice numbers increment by 1');

  const licenceLine = calculateLine({
    description: 'AdvisorTrack Software Licence — 25 licences',
    quantity: '25',
    unitPriceCents: 34900,
    vatRatePercent: '15',
  });
  assert(licenceLine.lineSubtotalCents === 872500, 'subtotal calculation 25 × R349.00');
  assert(licenceLine.lineVatCents === 130875, 'VAT calculation 15% of subtotal');
  assert(licenceLine.lineTotalCents === 1003375, 'total calculation subtotal + VAT');

  const discounted = calculateLine({
    description: 'Discounted line',
    quantity: '2',
    unitPriceCents: 10000,
    discountCents: 1000,
    vatRatePercent: '15',
  });
  assert(discounted.lineSubtotalCents === 19000, 'discount is subtracted before VAT');
  assert(discounted.lineVatCents === 2850, 'VAT is calculated on the discounted subtotal');

  const zeroVat = calculateLine({
    description: 'Non-VAT line',
    quantity: '3',
    unitPriceCents: 10000,
    vatRatePercent: '0',
  });
  assert(zeroVat.lineVatCents === 0 && zeroVat.lineTotalCents === 30000, 'non-VAT line has zero VAT');

  const invoiceTotals = calculateInvoiceTotals([licenceLine, discounted]);
  assert(invoiceTotals.subtotalCents === 891500, 'invoice subtotal sums line subtotals');
  assert(invoiceTotals.vatCents === 133725, 'invoice VAT sums line VAT');
  assert(invoiceTotals.totalCents === 1025225, 'invoice total sums line totals');

  assert(
    presentationStatus('sent', '2000-01-01') === 'overdue',
    'sent invoices past due present as overdue'
  );
  assert(presentationStatus('sent', '2099-01-01') === 'sent', 'sent invoices not yet due stay sent');
  assert(presentationStatus('paid', '2000-01-01') === 'paid', 'paid invoices are not rewritten to overdue');
  assert(presentationStatus('draft', '2000-01-01') === 'draft', 'draft invoices are not overdue');
}

async function cleanupCompanies(slugs: string[]): Promise<void> {
  const pool = getPool();
  await pool.query(
    `DELETE FROM invoice_delivery_events
     WHERE invoice_id IN (SELECT id FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  );
  await pool.query(
    `DELETE FROM demo_outbox_events
     WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))
        OR actor_user_id IN (SELECT id FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[])))`,
    [slugs]
  ).catch((error: { code?: string }) => {
    if (error.code !== '42P01') throw error;
  });
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
  await pool.query(
    `DELETE FROM invoices WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  );
  await pool.query(
    `DELETE FROM company_billing_profiles WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`,
    [slugs]
  );
  await pool.query(`DELETE FROM users WHERE company_id IN (SELECT id FROM companies WHERE slug = ANY($1::text[]))`, [
    slugs,
  ]);
  await pool.query(`DELETE FROM companies WHERE slug = ANY($1::text[])`, [slugs]);
}

async function runIntegrationTests(): Promise<void> {
  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const tables = await pool.query<{ relname: string }>(
    `SELECT relname FROM pg_class WHERE relname = ANY($1::text[])`,
    [['invoices', 'invoice_line_items', 'company_billing_profiles', 'invoice_number_seq']]
  );
  if (tables.rows.length < 4) {
    throw new Error('Migration 027 has not been applied to advisortrack_local');
  }

  const slug = 'phase7-verify-org';
  const otherSlug = 'phase7-verify-other';
  const slugs = [slug, otherSlug];
  const passwordHash = await hashPassword('Phase7Test!1');
  await cleanupCompanies(slugs);
  setTestMailer({
    send: async () => ({ ok: true, messageId: 'phase7-mail-1' }),
  });

  const company = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 7 Verify Co', $1, FALSE, TRUE, 25)
     RETURNING id`,
    [slug]
  );
  const companyId = company.rows[0].id;
  const otherCompany = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, is_platform, is_active, seat_limit)
     VALUES ('Phase 7 Other Co', $1, FALSE, TRUE, 8)
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
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, '0820000007')
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
    const adminId = await insertUser('Ada', 'Admin', 'phase7.admin@verify.test', 'Executive', null, {
      platformAdmin: true,
    });
    const execId = await insertUser('Vera', 'Exec', 'phase7.exec@verify.test', 'Executive', null);
    const rmId = await insertUser('Nina', 'North', 'phase7.rm@verify.test', 'Regional Manager', execId);
    const tlId = await insertUser('Theo', 'Avery', 'phase7.tl@verify.test', 'Team Leader', rmId);
    const faId = await insertUser('Ada', 'One', 'phase7.fa@verify.test', 'Financial Advisor', tlId);
    await insertUser('Other', 'Exec', 'phase7.other@verify.test', 'Executive', null, {
      company: otherCompanyId,
    });

    await platformSubscriptionsService.updateSubscription(adminId, companyId, {
      packageSlug: 'pro',
      vatRegistered: false,
      billingContactName: 'Accounts Desk',
      billingContactEmail: 'accounts@verify.test',
    });

    const serviceSource = fs.readFileSync(path.join(__dirname, '../src/services/platformInvoices.service.ts'), 'utf8');
    const repoSource = fs.readFileSync(path.join(__dirname, '../src/repositories/invoice.repository.ts'), 'utf8');
    const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/platform.routes.ts'), 'utf8');
    assert(!/DELETE FROM invoices/i.test(serviceSource), 'invoice service has no hard-delete workflow');
    assert(!/DELETE FROM invoice_line_items/i.test(serviceSource), 'invoice service does not delete line items');
    assert(!/\.query\([^;]*DELETE FROM invoice_/i.test(repoSource), 'invoice repository does not DELETE invoice rows');
    assert(!/router\.delete\(\s*'\/invoices/i.test(routeSource), 'invoice routes do not expose DELETE');

    await expectAppError('FORBIDDEN', 403, () => platformInvoicesService.list(execId));
    await expectAppError('FORBIDDEN', 403, () => platformInvoicesService.list(rmId));
    await expectAppError('FORBIDDEN', 403, () => platformInvoicesService.list(tlId));
    await expectAppError('FORBIDDEN', 403, () => platformInvoicesService.list(faId));

    const billing = await platformInvoicesService.getBillingProfile(adminId, companyId);
    assert(billing.registeredName === 'Phase 7 Verify Co', 'customer billing information loads company name');
    assert(billing.billingEmail === 'accounts@verify.test', 'billing contact email is reused from the subscription');
    assert(billing.vatRegistered === false, 'non-VAT customer billing profile is not VAT registered');
    assert(billing.vatNumber == null, 'non-VAT customer does not require a VAT number');

    const invoiceDate = johannesburgToday();
    const dueDate = addCalendarDays(invoiceDate, 30);
    const paymentDate = invoiceDate;

    const nonVatInvoice = await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate,
      dueDate,
      poReference: 'PO-7',
      notes: 'Net 30',
      paymentTerms: 'Payment due within 30 days.',
      billing: {
        registeredName: 'Phase 7 Verify Co',
        tradingName: 'P7 Trading',
        registrationNumber: '2026/000007/07',
        vatRegistered: false,
        vatNumber: null,
        billingContactName: 'Accounts Desk',
        billingEmail: 'accounts@verify.test',
        telephone: '0110000007',
        address: '1 Test Street',
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: '2000',
        country: 'South Africa',
      },
      lines: [
        {
          description: 'AdvisorTrack Software Licence — 25 licences',
          quantity: '25',
          unitPriceCents: 34900,
          vatRatePercent: '15',
        },
        {
          description: 'Onboarding workshop',
          quantity: '1',
          unitPriceCents: 500000,
          discountCents: 50000,
          vatRatePercent: '15',
        },
      ],
    });
    assert(/^INV[0-9]{6,}$/.test(nonVatInvoice.invoiceNumber), 'platform admin can create an invoice with sequential number');
    assert(Number(nonVatInvoice.invoiceNumber.slice(3)) >= 100000, 'invoice numbers begin at INV100000');
    assert(nonVatInvoice.status === 'draft', 'new invoices are drafts');
    assert(nonVatInvoice.lines.length === 2, 'multiple line items are stored');
    assert(nonVatInvoice.subtotalCents === 872500 + 450000, 'server subtotal calculation');
    assert(nonVatInvoice.vatCents === 0, 'non-VAT customer lines are stored at 0% VAT');
    assert(nonVatInvoice.totalCents === 1322500, 'server total calculation without VAT');
    assert(nonVatInvoice.snapshot.vatRegistered === false && !nonVatInvoice.snapshot.vatNumber, 'non-VAT snapshot omits VAT number');

    await expectAppError('TOTALS_MISMATCH', 400, () =>
      platformInvoicesService.create(adminId, {
        companyId,
        invoiceDate,
        dueDate,
        billing: {
          registeredName: 'Phase 7 Verify Co',
          vatRegistered: false,
        },
        lines: [{ description: 'Manipulated', quantity: '1', unitPriceCents: 10000 }],
        totalCents: 1,
      })
    );

    const edited = await platformInvoicesService.updateDraft(adminId, nonVatInvoice.id, {
      notes: 'Updated draft notes',
      lines: [
        {
          description: 'AdvisorTrack Software Licence — 10 licences',
          quantity: '10',
          unitPriceCents: 34900,
        },
      ],
    });
    assert(edited.notes === 'Updated draft notes', 'draft invoices can be edited');
    assert(edited.lines.length === 1 && edited.lines[0].description.includes('10 licences'), 'draft line replacement keeps current lines');
    assert(edited.subtotalCents === 349000 && edited.vatCents === 0, 'draft totals are recalculated');
    const allLines = await invoiceRepository.countLines(nonVatInvoice.id);
    assert(allLines === 3, 'draft edits supersede lines instead of deleting them');

    const issued = await platformInvoicesService.send(adminId, nonVatInvoice.id);
    assert(issued.status === 'sent' && issued.presentationStatus === 'sent', 'draft can be sent by email');
    const deliveries = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM invoice_delivery_events WHERE invoice_id = $1`,
      [issued.id]
    );
    assert(deliveries.rows[0].count === 1, 'successful send records a delivery event');

    await expectAppError('INVOICE_NOT_DRAFT', 409, () =>
      platformInvoicesService.updateDraft(adminId, issued.id, { notes: 'should fail' })
    );

    await organisationService.updateCompany(adminId, companyId, { name: 'Phase 7 Renamed Co' });
    await platformInvoicesService.upsertBillingProfile(adminId, companyId, {
      registeredName: 'Phase 7 Renamed Co',
      vatRegistered: true,
      vatNumber: '4123456789',
      billingContactName: 'New Contact',
      billingEmail: 'new@verify.test',
      address: '99 Changed Road',
      city: 'Cape Town',
    });
    await platformSubscriptionsService.updateSubscription(adminId, companyId, {
      packageSlug: 'pro_yearly',
      vatRegistered: true,
      vatRatePercent: 15,
    });
    await platformSubscriptionsService.setPurchasedLicences(adminId, companyId, {
      purchased: 99,
      reason: 'Should not mutate historical invoice',
    });

    const afterMutations = await platformInvoicesService.get(adminId, issued.id);
    assert(afterMutations.snapshot.registeredName === 'Phase 7 Verify Co', 'historical snapshot ignores later company name changes');
    assert(afterMutations.snapshot.billingEmail === 'accounts@verify.test', 'historical snapshot ignores later billing contact changes');
    assert(afterMutations.snapshot.address === '1 Test Street', 'historical snapshot ignores later address changes');
    assert(afterMutations.snapshot.vatRegistered === false, 'historical snapshot ignores later VAT registration changes');
    assert(afterMutations.snapshot.planSlug === 'pro', 'historical snapshot ignores later subscription plan changes');
    assert(afterMutations.lines[0].quantity === '10' && afterMutations.lines[0].unitPriceCents === 34900, 'historical snapshot ignores later licence changes');
    assert(afterMutations.subtotalCents === 349000, 'historical totals remain frozen');

    const pdf = await platformInvoicesService.generatePdf(adminId, issued.id);
    const pdfText = pdf.buffer.toString('latin1');
    assert(pdf.buffer.subarray(0, 4).toString() === '%PDF', 'PDF generation returns a PDF');
    assert(pdf.filename === `${issued.invoiceNumber}.pdf`, 'PDF filename uses the invoice number');
    assert(pdfText.includes(issued.invoiceNumber), 'PDF contains the invoice number');
    assert(pdfText.includes('Phase 7 Verify Co'), 'PDF uses the stored customer snapshot');
    assert(!pdfText.includes('Phase 7 Renamed Co'), 'PDF does not use the current company name');
    assert(!pdfText.includes('99 Changed Road'), 'PDF does not use later billing address');

    const paid = await platformInvoicesService.markPaid(adminId, issued.id, paymentDate);
    assert(paid.status === 'paid' && paid.paymentDate === paymentDate, 'mark paid stores the payment date');
    const paidRow = await invoiceRepository.findInvoice(issued.id);
    assert(paidRow?.status === 'paid' && paidRow.payment_date != null, 'paid invoice remains stored');

    const cancellable = await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate: '2026-08-02',
      dueDate: '2026-09-01',
      billing: { registeredName: 'Phase 7 Verify Co', vatRegistered: false },
      lines: [{ description: 'Cancel me', quantity: '1', unitPriceCents: 10000 }],
    });
    const cancelled = await platformInvoicesService.cancel(adminId, cancellable.id);
    assert(cancelled.status === 'cancelled', 'cancel changes state');
    const cancelledStill = await invoiceRepository.findInvoice(cancellable.id);
    const cancelledLines = await invoiceRepository.countLines(cancellable.id);
    assert(cancelledStill != null && cancelledLines === 1, 'cancel retains the invoice and line items');
    assert(cancelled.invoiceNumber === cancellable.invoiceNumber, 'cancelled invoices retain their number');

    const voidable = await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate: '2026-08-03',
      dueDate: '2026-09-02',
      billing: { registeredName: 'Phase 7 Verify Co', vatRegistered: false },
      lines: [{ description: 'Void me', quantity: '1', unitPriceCents: 20000 }],
    });
    const voided = await platformInvoicesService.void(adminId, voidable.id);
    assert(voided.status === 'voided', 'void changes state');
    const voidedStill = await invoiceRepository.findInvoice(voidable.id);
    const voidedLines = await invoiceRepository.countLines(voidable.id);
    assert(voidedStill != null && voidedLines === 1, 'void retains the invoice and line items');
    assert(voided.invoiceNumber === voidable.invoiceNumber, 'voided invoices retain their number');

    const duplicate = await platformInvoicesService.duplicate(adminId, issued.id);
    assert(duplicate.status === 'draft', 'duplicate creates a new Draft');
    assert(duplicate.id !== issued.id, 'duplicate receives its own identity');
    assert(duplicate.invoiceNumber !== issued.invoiceNumber, 'duplicate receives the next invoice number');
    assert(duplicate.duplicatedFromInvoiceId === issued.id, 'duplicate records its source invoice');
    assert(duplicate.snapshot.registeredName === issued.snapshot.registeredName, 'duplicate copies the commercial snapshot');
    const originalAfterDup = await platformInvoicesService.get(adminId, issued.id);
    assert(originalAfterDup.status === 'paid' && originalAfterDup.invoiceNumber === issued.invoiceNumber, 'original survives duplicate');
    const editedDup = await platformInvoicesService.updateDraft(adminId, duplicate.id, {
      notes: 'Independent draft',
      lines: [{ description: 'Changed duplicate line', quantity: '1', unitPriceCents: 1000 }],
    });
    assert(editedDup.notes === 'Independent draft', 'duplicate remains independently editable as a Draft');
    const originalLines = await platformInvoicesService.get(adminId, issued.id);
    assert(originalLines.lines[0].description.includes('10 licences'), 'editing the duplicate does not change the original');

    const vatDraft = await platformInvoicesService.create(adminId, {
      companyId,
      invoiceDate: '2026-08-04',
      dueDate: '2026-09-03',
      billing: {
        registeredName: 'VAT Customer',
        vatRegistered: true,
        vatNumber: null,
      },
      lines: [{ description: 'VAT draft', quantity: '1', unitPriceCents: 10000, vatRatePercent: '15' }],
    });
    assert(vatDraft.status === 'draft' && !vatDraft.snapshot.vatNumber, 'VAT-registered draft may omit VAT number');
    await expectAppError('VAT_NUMBER_REQUIRED', 400, () => platformInvoicesService.send(adminId, vatDraft.id));
    const vatIssued = await platformInvoicesService.updateDraft(adminId, vatDraft.id, {
      billing: {
        registeredName: 'VAT Customer',
        vatRegistered: true,
        vatNumber: '4123999000',
        billingEmail: 'vat@verify.test',
      },
      lines: [{ description: 'VAT draft', quantity: '1', unitPriceCents: 10000, vatRatePercent: '15' }],
    });
    const vatSent = await platformInvoicesService.send(adminId, vatIssued.id);
    assert(vatSent.vatCents === 0 && vatSent.totalCents === 10000, 'AdvisorTrack does not charge VAT while unregistered');

    const otherInvoice = await platformInvoicesService.create(adminId, {
      companyId: otherCompanyId,
      invoiceDate: '2026-08-05',
      dueDate: '2026-09-04',
      billing: { registeredName: 'Phase 7 Other Co', vatRegistered: false },
      lines: [{ description: 'Other company licence', quantity: '2', unitPriceCents: 34900 }],
    });
    const listedA = await platformInvoicesService.list(adminId, companyId);
    const listedB = await platformInvoicesService.list(adminId, otherCompanyId);
    assert(
      listedA.invoices.every((row) => row.companyId === companyId),
      'company invoice list is scoped to the target company'
    );
    assert(
      listedB.invoices.some((row) => row.id === otherInvoice.id) &&
        listedA.invoices.every((row) => row.id !== otherInvoice.id),
      'cross-company invoice targeting uses the selected customer'
    );
    await platformInvoicesService.upsertBillingProfile(adminId, otherCompanyId, {
      registeredName: 'Should Not Leak',
      vatRegistered: false,
    });
    const firstCompanyInvoice = await platformInvoicesService.get(adminId, issued.id);
    assert(firstCompanyInvoice.snapshot.registeredName === 'Phase 7 Verify Co', 'other-company billing changes do not alter this invoice');

    const [firstParallel, secondParallel] = await Promise.all([
      platformInvoicesService.create(adminId, {
        companyId,
        invoiceDate: '2026-08-06',
        dueDate: '2026-09-05',
        billing: { registeredName: 'Phase 7 Verify Co', vatRegistered: false },
        lines: [{ description: 'Parallel A', quantity: '1', unitPriceCents: 100 }],
      }),
      platformInvoicesService.create(adminId, {
        companyId,
        invoiceDate: '2026-08-06',
        dueDate: '2026-09-05',
        billing: { registeredName: 'Phase 7 Verify Co', vatRegistered: false },
        lines: [{ description: 'Parallel B', quantity: '1', unitPriceCents: 200 }],
      }),
    ]);
    assert(firstParallel.invoiceNumber !== secondParallel.invoiceNumber, 'concurrent creates receive distinct invoice numbers');
    const seqA = Number(firstParallel.invoiceNumber.slice(3));
    const seqB = Number(secondParallel.invoiceNumber.slice(3));
    assert(Math.abs(seqA - seqB) >= 1, 'concurrent invoice numbers are unique sequential values');

    const adminToken = signToken({ userId: adminId, email: 'phase7.admin@verify.test' });
    const execToken = signToken({ userId: execId, email: 'phase7.exec@verify.test' });
    const faToken = signToken({ userId: faId, email: 'phase7.fa@verify.test' });

    const adminList = await apiRequest(baseUrl, 'GET', '/api/v1/platform/invoices', adminToken);
    assert(adminList.status === 200, 'platform admin API can list invoices');

    const execList = await apiRequest(baseUrl, 'GET', '/api/v1/platform/invoices', execToken);
    assert(execList.status === 403 && execList.code === 'FORBIDDEN', 'customer Executive cannot access invoice admin');

    const faCreate = await apiRequest(baseUrl, 'POST', '/api/v1/platform/invoices', faToken, {
      companyId,
      invoiceDate,
      dueDate,
      lines: [{ description: 'Nope', quantity: '1', unitPriceCents: 100 }],
    });
    assert(faCreate.status === 403 && faCreate.code === 'FORBIDDEN', 'customer role cannot create invoices');

    const execPdf = await fetch(`${baseUrl}/api/v1/platform/invoices/${issued.id}/pdf`, {
      headers: { Authorization: `Bearer ${execToken}` },
    });
    assert(execPdf.status === 403, 'customer role cannot download internal invoices');

    const adminPdf = await fetch(`${baseUrl}/api/v1/platform/invoices/${issued.id}/pdf`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(adminPdf.status === 200 && (adminPdf.headers.get('content-type') || '').includes('pdf'), 'admin can download the invoice PDF');

    const linked = await platformSubscriptionsService.get(adminId, companyId);
    assert(linked.invoicing.available === true, 'subscription detail links to invoicing');
    assert(
      linked.invoices.some((row) => row.id === issued.id),
      'issued invoices appear on the company subscription record'
    );
  } finally {
    setTestMailer(null);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await cleanupCompanies(slugs);
  }
}

async function main(): Promise<void> {
  console.log('Phase 7 verification\n');
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
