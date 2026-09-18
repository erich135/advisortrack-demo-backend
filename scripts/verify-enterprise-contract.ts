/**
 * Task 11: demo enterprise contract overlay (isolated demo DB / Northstar).
 * Run: npm run test:enterprise-contract
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVISORTRACK_VAT_REGISTERED, sellerChargesVat, vatRateForNewInvoiceLine } from '../src/features/advisortrackVat';
import {
  commercialAmountDueCents,
  stripInternalContractFields,
  toCustomerSubscriptionSummary,
  type EnterpriseContractRecord,
} from '../src/features/enterpriseContract';
import { NORTHSTAR_COMMITTED_LICENCES, NORTHSTAR_SEAT_LIMIT } from '../src/features/demoNorthstar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(root, 'database/demo/005_enterprise_contracts.sql'), 'utf8');
const migrateAll = fs.readFileSync(path.join(root, 'scripts/run-all-migrations.js'), 'utf8');
const portal = fs.readFileSync(path.join(root, 'src/services/companyCustomerPortal.service.ts'), 'utf8');
const pdf = fs.readFileSync(path.join(root, 'src/services/invoicePdf.ts'), 'utf8');

assert.match(sql, /DEMO ONLY/);
assert.match(sql, /enterprise_contracts/);
assert.match(sql, /enterprise_contract_events/);
assert.match(sql, /vat_applicable = FALSE/);
assert.doesNotMatch(sql, /ALTER TABLE users /);
assert.doesNotMatch(migrateAll, /database\/demo/);
assert.equal(ADVISORTRACK_VAT_REGISTERED, false);
assert.equal(sellerChargesVat(), false);
assert.equal(vatRateForNewInvoiceLine('15'), '0.00');
assert.equal(NORTHSTAR_COMMITTED_LICENCES, NORTHSTAR_SEAT_LIMIT);

const clone = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspaceClone.ts'), 'utf8');
assert.match(clone, /enterprise_contracts/);
assert.match(clone, /RESET EMPTY/);

const contract: EnterpriseContractRecord = {
  id: 'demo',
  companyId: 'co',
  onboardingId: null,
  commercialStatus: 'active',
  contractStartDate: '2026-09-01',
  contractEndDate: '2027-08-31',
  autoRenew: true,
  committedLicences: 50,
  billingModel: 'annual',
  billingFrequency: 'annual',
  pricingBasis: 'per_seat',
  negotiatedUnitPriceCents: 7500,
  negotiatedFixedAmountCents: null,
  currency: 'ZAR',
  vatApplicable: false,
  vatRatePercent: '0.00',
  paymentTermsCode: 'days_30',
  paymentTermsCustom: null,
  poReference: 'NS-ENT-2026',
  billingContactName: 'Finance',
  billingEmail: 'finance@northstar.demo.invalid',
  billingNotes: 'Visible',
  internalNotes: 'Never leak this',
  additionalSeatPolicy: 'next_invoice',
  seatReductionPolicy: 'renewal_only',
  createdByUserId: 'u',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};
const summary = toCustomerSubscriptionSummary({
  company: { id: 'co', name: 'Northstar Advisory' },
  contract,
  currentPurchasedLicences: 50,
});
assert.equal(summary.vatCharged, false);
assert.ok(!('internalNotes' in summary));
assert.equal(JSON.stringify(summary).includes('Never leak'), false);
assert.equal(JSON.stringify(stripInternalContractFields(contract)).includes('Never leak'), false);
assert.equal(commercialAmountDueCents(contract), 375000);
assert.match(portal, /enterprise/);
assert.match(pdf, /sellerChargesVat/);
assert.match(pdf, /Total Due/);

console.log('Demo enterprise contract checks passed');
