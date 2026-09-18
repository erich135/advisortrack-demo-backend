/**
 * Task 15: public-demo enterprise parity / complete customer showcase.
 * Run: npm run test:demo-enterprise-parity
 *
 * Optional HTTP (same journey as verify-demo-dashboard):
 *   DEMO_API_BASE=http://127.0.0.1:3001 npm run test:demo-dashboard
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_DATABASE_NAME, parseDatabaseUrl } from '../src/config/databaseSafety';

const root = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(__dirname, '../../advisortrack-demo-frontend');

function read(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function readEnvValue(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const line = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

const clone = read(path.join(root, 'src/repositories/demoWorkspaceClone.ts'));
assert.match(clone, /CLONE from Northstar master/);
assert.match(clone, /enterprise_contracts/);
assert.match(clone, /invoice_commercial_details/);
assert.match(clone, /RESET EMPTY/);
assert.match(clone, /licence_increase_requests/);
assert.match(clone, /enterprise_contract_seat_changes/);
assert.match(clone, /enterprise_billing_adjustments/);
assert.match(clone, /enterprise_contract_events/);
assert.match(clone, /demo_outbox_events/);
assert.match(clone, /Organisation Admin: Executive rank/);
assert.match(clone, /organisation_admin_assignments is not cloned/);

const org = read(path.join(root, 'src/services/organisation.service.ts'));
assert.match(org, /Executive is the Organisation Admin proxy/);
assert.match(org, /isOrganisationAdmin = rank === 'executive'/);
assert.match(org, /does not persist organisation_admin_assignments/);

const portal = read(path.join(root, 'src/services/companyCustomerPortal.service.ts'));
assert.match(portal, /DEMO_ACTION_SIMULATED_MESSAGE/);
assert.match(portal, /action: 'invoice_send'/);
assert.doesNotMatch(portal, /Customers cannot issue or send invoices/);

const licenceIncrease = read(path.join(root, 'src/services/licenceIncrease.service.ts'));
assert.match(licenceIncrease, /northstarContractFallback/);
assert.match(licenceIncrease, /additionalSeatPolicy: 'next_invoice'/);

const seed = read(path.join(root, 'scripts/seed-northstar-master.ts'));
assert.match(seed, /FALSE, NULL, 0/);
assert.doesNotMatch(seed, /TRUE, '4123456789'/);

const env = read(path.join(root, 'src/config/env.ts'));
assert.match(env, /mailtrapApiToken: appMode === 'demo' \? undefined/);
assert.match(env, /localhost:5174/);

const northstar = read(path.join(root, 'src/features/demoNorthstar.ts'));
assert.match(northstar, /NORTHSTAR_SEED_VERSION = 16/);
assert.match(northstar, /NORTHSTAR_SEAT_LIMIT = 50/);
assert.match(northstar, /NORTHSTAR_ASSIGNED_LICENCES = 42/);

const app = read(path.join(frontendRoot, 'src/App.tsx'));
assert.doesNotMatch(app, /EnterpriseCustomer/);
assert.doesNotMatch(app, /LicenceRequestsPage/);
assert.doesNotMatch(app, /EngineeringChangelog/);
assert.doesNotMatch(app, /\/licence-requests/);
assert.doesNotMatch(app, /\/enterprise-customers/);
assert.match(app, /path="\/subscription"/);
assert.match(app, /path="\/bulk-import"/);
assert.match(app, /path="\/licences"/);

const layout = read(path.join(frontendRoot, 'src/components/Layout.tsx'));
assert.match(layout, /ENTERPRISE_PLAN_NAME/);
assert.match(layout, /AdvisorTrack Demo/);
assert.match(layout, /Reset Demo/);
assert.match(layout, /Viewing as/);
assert.doesNotMatch(layout, /to: '\/licence-requests'/);
assert.doesNotMatch(layout, /to: '\/enterprise-customers'/);

const mark = read(path.join(frontendRoot, 'src/components/CompanyContext.tsx'));
assert.match(mark, /company-context-mark-plan/);

const demoEnvPath = path.join(root, '.env.demo');
const databaseUrl = readEnvValue(demoEnvPath, 'DATABASE_URL');
if (databaseUrl) {
  const parsed = parseDatabaseUrl(databaseUrl);
  assert.equal(parsed?.database, DEMO_DATABASE_NAME);
}
const demoMode = readEnvValue(demoEnvPath, 'ADVISORTRACK_MODE');
if (demoMode !== undefined) {
  assert.equal(demoMode, 'demo');
}
assert.equal(readEnvValue(demoEnvPath, 'MAILTRAP_API_TOKEN') || '', '');

const frontendDev = path.join(frontendRoot, '.env.development');
const frontendDemo = path.join(frontendRoot, '.env.demo');
for (const envPath of [frontendDev, frontendDemo]) {
  const apiBase = readEnvValue(envPath, 'VITE_API_BASE_URL') ?? '';
  assert.doesNotMatch(apiBase, /api\.advisortrack\.co\.za/);
  assert.doesNotMatch(apiBase, /:3000\b/);
}

console.log('Demo enterprise parity static checks passed');
