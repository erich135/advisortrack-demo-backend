/**
 * Task 12 (demo): isolated draft invoices, issue lock, VAT lock, customer view.
 * Run: npm run test:draft-invoices
 */
import fs from 'fs';
import path from 'path';
import { ADVISORTRACK_VAT_REGISTERED, sellerChargesVat, vatRateForNewInvoiceLine } from '../src/features/advisortrackVat';
import type { EnterpriseContractRecord } from '../src/features/enterpriseContract';
import { prefillFromEnterpriseContract } from '../src/features/invoiceDraft';
import { addCalendarDays, johannesburgToday, presentationStatus, STORED_INVOICE_STATUSES } from '../src/features/invoiceLifecycle';
import { calculateInvoiceTotals, calculateLine } from '../src/features/invoiceMoney';

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
    billingModel: 'annual',
    billingFrequency: 'annual',
    pricingBasis: 'fixed_amount',
    negotiatedUnitPriceCents: null,
    negotiatedFixedAmountCents: 120_000_000,
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
    createdByUserId: '33333333-3333-4333-8333-333333333333',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const sql = fs.readFileSync(path.join(root, 'database/demo/006_invoice_draft_details.sql'), 'utf8');
const service = fs.readFileSync(path.join(root, 'src/services/platformInvoices.service.ts'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'src/services/invoicePdf.ts'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes/platform.routes.ts'), 'utf8');
const companyRoutes = fs.readFileSync(path.join(root, 'src/routes/company.routes.ts'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'src/services/companyCustomerPortal.service.ts'), 'utf8');

assert(sql.includes('DEMO ONLY'), '006 is demo only');
assert(sql.includes('invoice_commercial_details'), 'demo commercial details table');
assert(service.includes('async issue('), 'demo issue() exists');
assert(service.includes('INVOICE_NOT_DRAFT'), 'issued invoices cannot be edited');
assert(routes.includes('/invoices/:invoiceId/issue'), 'demo issue route');
assert(routes.includes('/invoice-prefill'), 'demo prefill route');
assert(companyRoutes.includes('/invoices'), 'demo customer invoice routes');
assert(portal.includes("action: 'invoice_send'"), 'customer invoice send is simulated into the demo outbox');
assert(portal.includes('DEMO_ACTION_SIMULATED_MESSAGE'), 'simulated send uses demo copy');
assert(!portal.includes('sendMail('), 'customer simulate send does not call real mail');
assert(fs.readFileSync(path.join(root, 'src/services/emailService.ts'), 'utf8').includes('isDemoMode') || fs.readFileSync(path.join(root, 'src/config/env.ts'), 'utf8').includes('isDemoMode'), 'demo runtime stays isolated');
assert(!service.includes('credit_note'), 'no invented credit-note model');
assert(!(STORED_INVOICE_STATUSES as readonly string[]).includes('partially_paid'), 'no partially_paid stored status');
assert(pdf.includes("sellerChargesVat() ? 'TAX INVOICE' : 'INVOICE'"), 'PDF heading stays INVOICE');
assert(pdf.includes("['Total Due'"), 'PDF uses Total Due');
assert(ADVISORTRACK_VAT_REGISTERED === false, 'VAT registered = NO');
assert(sellerChargesVat() === false, 'sellerChargesVat locked off');
assert(vatRateForNewInvoiceLine(15) === '0.00', 'cannot charge VAT');

const discountLine = calculateLine({
  description: 'Negotiated discount',
  quantity: '1',
  unitPriceCents: -1_000_000,
});
const subscription = calculateLine({
  description: 'AdvisorTrack Enterprise Annual Subscription',
  quantity: '1',
  unitPriceCents: 12_000_000,
});
assert(calculateInvoiceTotals([subscription, discountLine]).totalCents === 11_000_000, 'transparent discount');
assert(calculateInvoiceTotals([subscription, discountLine]).vatCents === 0, 'no VAT');

const annual = prefillFromEnterpriseContract({
  company: { id: 'c1', name: 'Northstar' },
  contract: sampleContract(),
});
assert(annual.lines[0].unitPriceCents === 120_000_000, 'annual fixed-amount prefill');
const monthly = prefillFromEnterpriseContract({
  company: { id: 'c1', name: 'Northstar' },
  contract: sampleContract({
    billingFrequency: 'monthly',
    pricingBasis: 'per_seat',
    negotiatedUnitPriceCents: 7500,
    negotiatedFixedAmountCents: null,
  }),
});
assert(monthly.lines[0].quantity === 1000, 'per-seat prefill');
const custom = prefillFromEnterpriseContract({
  company: { id: 'c1', name: 'Northstar' },
  contract: sampleContract({ pricingBasis: 'custom', negotiatedFixedAmountCents: null }),
});
assert(custom.lines[0].unitPriceCents === 0, 'custom prefill');
assert(presentationStatus('sent', '2000-01-01') === 'overdue', 'overdue logic unchanged');
assert(presentationStatus('sent', addCalendarDays(johannesburgToday(), 30)) === 'sent', 'future due stays sent');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
