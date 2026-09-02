/**
 * Public demo full customer-dashboard parity.
 * Run: DEMO_API_BASE=http://127.0.0.1:3001 npm run test:demo-dashboard
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { DEMO_DATABASE_NAME, parseDatabaseUrl } from '../src/config/databaseSafety';
import {
  NORTHSTAR_ASSIGNED_LICENCES,
  NORTHSTAR_AVAILABLE_LICENCES,
  NORTHSTAR_INVOICE_COUNT,
  NORTHSTAR_SEAT_LIMIT,
} from '../src/features/demoNorthstar';
import {
  DEMO_ACTION_SIMULATED_MESSAGE,
  DEMO_USER_CREATED_MESSAGE,
} from '../src/features/demoMessages';

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
const frontendRoot = path.resolve(__dirname, '../../advisortrack-demo-frontend');

type Envelope<T> = {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};

async function api<T>(
  baseUrl: string,
  pathName: string,
  options?: { method?: string; token?: string; body?: unknown }
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options?.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let parsed: Envelope<T> = {};
  try {
    parsed = text ? (JSON.parse(text) as Envelope<T>) : {};
  } catch {
    parsed = {};
  }
  return { status: response.status, body: parsed };
}

function readEnvValue(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const line = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

type EnterData = {
  token: string;
  session: { id: string; companyId: string; selectedRole: string; expiresAt: string };
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role?: { id: string; name: string } | null;
  licenceStatus?: string;
  accountStatus?: string;
  isActive?: boolean;
  actions?: { edit?: boolean; assignLicence?: boolean; deactivateAccount?: boolean; resendInvitation?: boolean };
};

type Region = { id: string; name: string; isActive: boolean; status: string };
type Team = { id: string; name: string; regionId: string; isActive: boolean; status: string };
type Pool = { purchased: number | null; assigned: number; available: number | null };
type InvoiceList = { invoices: Array<{ id: string; invoiceNumber: string; status: string }> };
type AuditList = { events: Array<{ action: string; targetUserId?: string | null }> };

function runStaticChecks(): void {
  const app = fs.readFileSync(path.join(frontendRoot, 'src/App.tsx'), 'utf8');
  assert(app.includes('path="/performance"'), 'Performance route exists');
  assert(app.includes('path="/audit"'), 'Audit route exists');
  assert(app.includes('path="/subscriptions"'), 'Subscriptions route exists');
  assert(app.includes('path="/invoices"'), 'Invoices route exists');
  assert(app.includes('path="/companies"'), 'Companies route exists');
  assert(app.includes('<RequireLeadership>') && app.includes('<PerformancePage'), 'Performance is leadership-gated');
  assert(app.includes('<RequireAuditViewer>'), 'Audit is gated to Exec and RM');
  assert(app.includes('AUDIT_PERMISSION_DENIED_TITLE'), 'Audit direct URL uses friendly permission copy');
  assert(app.includes('<PermissionDenied'), 'role-restricted routes use the shared permission state');
  assert(app.includes('<RequireExecutive>'), 'billing screens stay executive-gated');
  assert(app.includes('<RequirePlatform>') && app.includes('<SupportPage'), 'Support remains platform-only');
  assert(app.includes('<CustomerAccountPage'), 'platform customer-account route remains staff-only');

  const layout = fs.readFileSync(path.join(frontendRoot, 'src/components/Layout.tsx'), 'utf8');
  assert(layout.includes("label: 'Performance'"), 'sidebar includes Performance');
  assert(layout.includes("label: 'Audit'"), 'sidebar includes Audit');
  assert(layout.includes("label: 'Subscriptions'"), 'sidebar includes Subscriptions');
  assert(layout.includes("label: 'Invoices'"), 'sidebar includes Invoices');
  assert(layout.includes("label: 'Companies'"), 'sidebar includes Companies');
  assert(layout.includes("label: 'Users & Access'"), 'sidebar includes Users & Access');
  assert(layout.includes("label: 'Settings & Roles'"), 'sidebar includes Settings & Roles');
  assert(layout.includes('customerBusinessNav'), 'demo nav exposes business screens by role');
  assert(layout.includes('customerManagementNav'), 'demo nav exposes management screens by role');
  assert(layout.includes('isCustomerAuditViewer'), 'Audit sidebar is limited to Exec and RM');
  assert(!app.includes('EngineeringChangelog'), 'public demo has no Engineering Change Log page');
  assert(!app.includes('/engineering/changelog'), 'public demo has no Engineering Change Log route');
  assert(!layout.includes("label: 'Change Log'"), 'public demo sidebar has no Change Log item');
  assert(!fs.existsSync(path.join(root, 'src/routes/engineering.routes.ts')), 'demo backend has no engineering routes');
  const demoApiIndex = fs.readFileSync(path.join(root, 'src/routes/index.ts'), 'utf8');
  assert(!demoApiIndex.includes('createEngineeringRouter'), 'demo API index does not mount engineering changelog');

  const users = fs.readFileSync(path.join(frontendRoot, 'src/pages/UsersPage.tsx'), 'utf8');
  assert(users.includes('Demo user created. No real invitation was sent.') || users.includes('created.message'), 'Add User uses demo invitation copy');
  assert(users.includes('Demo user updated successfully.'), 'Edit save uses demo success copy');
  assert(users.includes('Demo action completed — no real message was sent.'), 'Resend uses simulated copy');

  const settings = fs.readFileSync(path.join(frontendRoot, 'src/pages/SettingsPage.tsx'), 'utf8');
  assert(settings.includes('Roles cannot be hard-deleted in the public demo.'), 'Settings blocks role hard-delete in demo');

  const invoices = fs.readFileSync(path.join(frontendRoot, 'src/pages/InvoicesPage.tsx'), 'utf8');
  assert(invoices.includes('listCompanyInvoices'), 'customer invoices use company-scoped API');
  assert(invoices.includes('sendCompanyInvoice'), 'customer invoice send is company-scoped');
  assert(!invoices.includes('Mark paid') || invoices.includes('!customerMode'), 'mark paid stays staff-only');

  const portal = fs.readFileSync(path.join(root, 'src/services/companyCustomerPortal.service.ts'), 'utf8');
  assert(portal.includes("requireRank(userId, ['executive', 'regional_manager'])"), 'Audit API allows Executive and Regional Manager only');
  assert(!/listAudit[\s\S]{0,400}team_leader/.test(portal), 'Audit API does not allow Team Leader');

  const permissionDenied = fs.readFileSync(path.join(frontendRoot, 'src/components/PermissionDenied.tsx'), 'utf8');
  assert(permissionDenied.includes('You don’t have access to this feature'), 'shared permission heading is present');
  assert(
    permissionDenied.includes('Your current role does not have permission to view this area.'),
    'shared permission message is present'
  );
  assert(
    permissionDenied.includes('Audit Trail is available to Regional Managers and Executives'),
    'Audit permission heading is present'
  );
  assert(permissionDenied.includes('Back to Dashboard'), 'permission state offers Back to Dashboard');

  const clone = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspaceClone.ts'), 'utf8');
  assert(clone.includes('cloneCommercialData'), 'clone copies commercial records');
  assert(clone.includes("nextval('invoice_number_seq')"), 'cloned invoices allocate real invoice numbers');
}

async function runHttp(baseUrl: string, databaseUrl?: string): Promise<void> {
  const execA = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'executive' },
  });
  assert(execA.status === 201 && Boolean(execA.body.data?.token), 'session A enters as Executive');
  const tokenA = execA.body.data!.token;
  const companyA = execA.body.data!.session.companyId;

  const execB = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'executive' },
  });
  assert(execB.status === 201, 'session B enters as Executive');
  assert(execB.body.data!.session.companyId !== companyA, 'session B is a different company');
  const tokenB = execB.body.data!.token;

  const membersA = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: tokenA });
  const peopleA = membersA.body.data ?? [];
  const maya = peopleA.find((row) => row.firstName === 'Maya' && row.lastName === 'Brooks');
  assert(Boolean(maya), 'Executive A can view Maya Brooks');
  const viewMaya = await api<Member>(baseUrl, `/api/v1/company/members/${maya!.id}`, { token: tokenA });
  assert(viewMaya.status === 200, 'View User succeeds');
  assert(/\.[0-9a-f]{12}@northstar\.demo\.invalid$/i.test(viewMaya.body.data?.email ?? ''), 'stored email stays clone-safe');

  const renamed = `Brooks-${Date.now().toString(36)}`;
  const edited = await api<Member>(baseUrl, `/api/v1/company/members/${maya!.id}`, {
    method: 'PATCH',
    token: tokenA,
    body: { lastName: renamed },
  });
  assert(edited.status === 200 && edited.body.data?.lastName === renamed, 'Edit User is a real isolated write');

  const keegan = peopleA.find((row) => row.firstName === 'Keegan' && row.lastName === 'Pillay');
  assert(Boolean(keegan), 'Executive can view Highveld advisor Keegan Pillay');
  const keeganRenamed = `Pillay-${Date.now().toString(36)}`;
  const editedKeegan = await api<Member>(baseUrl, `/api/v1/company/members/${keegan!.id}`, {
    method: 'PATCH',
    token: tokenA,
    body: { lastName: keeganRenamed },
  });
  assert(editedKeegan.status === 200, 'Executive can edit an advisor outside Coastal Region');

  const auditAfterEdit = await api<AuditList>(baseUrl, '/api/v1/company/audit', { token: tokenA });
  assert(auditAfterEdit.status === 200, 'Executive can open company audit');
  assert(
    (auditAfterEdit.body.data?.events ?? []).some(
      (event) => event.action === 'user_updated' && event.targetUserId === maya!.id
    ),
    'user edit is reflected in Audit'
  );
  assert(
    (auditAfterEdit.body.data?.events ?? []).some(
      (event) => event.action === 'user_updated' && event.targetUserId === keegan!.id
    ),
    'Executive audit includes organisation-wide events'
  );

  const auditB = await api<AuditList>(baseUrl, '/api/v1/company/audit', { token: tokenB });
  assert(auditB.status === 200, 'session B Executive can open own-company audit');
  assert(
    !(auditB.body.data?.events ?? []).some((event) => event.targetUserId === maya!.id),
    'Executive cannot read audit events from another company'
  );

  const roles = await api<Array<{ id: string; name: string; rank: string }>>(baseUrl, '/api/v1/company/assignable-roles', {
    token: tokenA,
  });
  const faRole = (roles.body.data ?? []).find((row) => row.rank === 'financial_advisor');
  assert(Boolean(faRole), 'Executive can assign Financial Advisor');
  assert(!(roles.body.data ?? []).some((row) => /app admin|platform/i.test(row.name)), 'platform roles are not assignable');

  const teams = await api<Team[]>(baseUrl, '/api/v1/company/teams', { token: tokenA });
  const regions = await api<Region[]>(baseUrl, '/api/v1/company/regions', { token: tokenA });
  const harbour = (teams.body.data ?? []).find((row) => row.name === 'Harbour Team' && row.isActive);
  const created = await api<Member & { demoSimulated?: boolean; message?: string }>(baseUrl, '/api/v1/company/members', {
    method: 'POST',
    token: tokenA,
    body: {
      firstName: 'Lerato',
      lastName: 'Maseko',
      email: 'lerato.maseko@northstaradvisory.dem',
      phone: '000 000 2099',
      roleId: faRole!.id,
      teamId: harbour?.id,
      regionId: harbour?.regionId,
    },
  });
  assert(created.status === 201, 'Add User creates a demo member');
  assert(created.body.data?.demoSimulated === true, 'Add User invitation is simulated');
  assert(
    (created.body.data?.message ?? '').includes('No real invitation was sent'),
    'Add User explains that no invitation was sent'
  );
  assert(
    /\.[0-9a-f]{12}@northstar\.demo\.invalid$/i.test(created.body.data?.email ?? ''),
    'Add User stores a clone-safe email, not the display domain'
  );
  assert(created.body.data?.message === DEMO_USER_CREATED_MESSAGE, 'Add User uses the approved demo created copy');

  const unlicensed = peopleA.find(
    (row) => row.licenceStatus === 'Unlicensed' && row.role?.name === 'Financial Advisor' && row.actions?.assignLicence
  );
  const poolBefore = await api<Pool>(baseUrl, '/api/v1/company/licence-pool', { token: tokenA });
  assert(poolBefore.body.data?.purchased === NORTHSTAR_SEAT_LIMIT, 'pool purchased is 50');
  assert(poolBefore.body.data?.assigned === NORTHSTAR_ASSIGNED_LICENCES, 'pool assigned starts at 42');
  assert(poolBefore.body.data?.available === NORTHSTAR_AVAILABLE_LICENCES, 'pool available starts at 8');
  if (unlicensed) {
    const assigned = await api(baseUrl, `/api/v1/company/members/${unlicensed.id}/licence`, {
      method: 'POST',
      token: tokenA,
    });
    assert(assigned.status === 200, 'Assign Licence is a real isolated write');
    const poolAfter = await api<Pool>(baseUrl, '/api/v1/company/licence-pool', { token: tokenA });
    assert(poolAfter.body.data?.assigned === NORTHSTAR_ASSIGNED_LICENCES + 1, 'assigned count increases after licence assign');
    assert(poolAfter.body.data?.available === NORTHSTAR_AVAILABLE_LICENCES - 1, 'available count decreases after licence assign');
  }
  const alreadyLicensed = await api(baseUrl, `/api/v1/company/members/${maya!.id}/licence`, {
    method: 'POST',
    token: tokenA,
  });
  assert(alreadyLicensed.status === 400, 'licence capacity/status rules reject assigning a licence twice');

  const deactivatable = peopleA.find(
    (row) => row.role?.name === 'Financial Advisor' && row.id !== unlicensed?.id && row.actions?.deactivateAccount
  );
  if (deactivatable) {
    const deactivated = await api<Member>(baseUrl, `/api/v1/company/members/${deactivatable.id}`, {
      method: 'PATCH',
      token: tokenA,
      body: { isActive: false },
    });
    assert(deactivated.status === 200 && deactivated.body.data?.accountStatus === 'Inactive', 'Deactivate is a real isolated write');
    const stillThere = await api<Member>(baseUrl, `/api/v1/company/members/${deactivatable.id}`, { token: tokenA });
    assert(stillThere.status === 200, 'deactivated user remains historically retained');
  }

  const resend = await api<{ demoSimulated?: boolean; message?: string }>(
    baseUrl,
    `/api/v1/company/members/${maya!.id}/resend-invitation`,
    { method: 'POST', token: tokenA }
  );
  assert(resend.status === 200 && resend.body.data?.demoSimulated === true, 'Resend Invitation is simulated');
  assert(resend.body.data?.message === DEMO_ACTION_SIMULATED_MESSAGE, 'Resend uses approved simulated copy');

  const crossView = await api(baseUrl, `/api/v1/company/members/${maya!.id}`, { token: tokenB });
  assert(crossView.status === 404 || crossView.status === 403, 'session B cannot view session A users');
  const crossEdit = await api(baseUrl, `/api/v1/company/members/${maya!.id}`, {
    method: 'PATCH',
    token: tokenB,
    body: { lastName: 'Hacked' },
  });
  assert(crossEdit.status === 404 || crossEdit.status === 403, 'session B cannot edit session A users');
  const crossLicence = await api(baseUrl, `/api/v1/company/members/${maya!.id}/licence`, {
    method: 'POST',
    token: tokenB,
  });
  assert(crossLicence.status === 404 || crossLicence.status === 403, 'session B cannot licence session A users');
  const crossDeactivate = await api(baseUrl, `/api/v1/company/members/${maya!.id}`, {
    method: 'PATCH',
    token: tokenB,
    body: { isActive: false },
  });
  assert(crossDeactivate.status === 404 || crossDeactivate.status === 403, 'session B cannot deactivate session A users');

  const newRegion = await api<Region>(baseUrl, '/api/v1/company/regions', {
    method: 'POST',
    token: tokenA,
    body: { name: `Demo Coast ${Date.now().toString(36)}` },
  });
  assert(newRegion.status === 201, 'Executive can create a Region');
  const archivedRegion = await api<Region>(baseUrl, `/api/v1/company/regions/${newRegion.body.data!.id}`, {
    method: 'PATCH',
    token: tokenA,
    body: { isActive: false },
  });
  assert(archivedRegion.status === 200 && archivedRegion.body.data?.isActive === false, 'Region archive is not a hard delete');

  const switchedRm = await api<EnterData>(baseUrl, '/api/v1/demo/switch-role', {
    method: 'POST',
    token: tokenA,
    body: { selectedRole: 'regional_manager' },
  });
  assert(switchedRm.status === 200, 'switch to Regional Manager');
  const rmToken = switchedRm.body.data!.token;
  const rmCreateRegion = await api(baseUrl, '/api/v1/company/regions', {
    method: 'POST',
    token: rmToken,
    body: { name: 'Should Fail' },
  });
  assert(rmCreateRegion.status === 403, 'Regional Manager cannot administer Regions');

  const rmRegions = await api<Region[]>(baseUrl, '/api/v1/company/regions', { token: rmToken });
  const rmRegion = (rmRegions.body.data ?? []).find((row) => row.isActive);
  const rmTeam = await api<Team>(baseUrl, '/api/v1/company/teams', {
    method: 'POST',
    token: rmToken,
    body: { name: `RM Team ${Date.now().toString(36)}`, regionId: rmRegion?.id },
  });
  assert(rmTeam.status === 201, 'Regional Manager can create a Team in own Region');

  const rmMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: rmToken });
  const rmPeople = rmMembers.body.data ?? [];
  assert(
    rmPeople.some((row) => row.id === maya!.id),
    'Regional Manager sees Coastal downline members'
  );
  assert(
    !rmPeople.some((row) => row.id === keegan!.id),
    'Regional Manager does not see Highveld members'
  );
  const rmAudit = await api<AuditList>(baseUrl, '/api/v1/company/audit', { token: rmToken });
  assert(rmAudit.status === 200, 'Regional Manager can open Audit');
  assert(
    (rmAudit.body.data?.events ?? []).some(
      (event) => event.action === 'user_updated' && event.targetUserId === maya!.id
    ),
    'Regional Manager sees in-scope audit events'
  );
  assert(
    !(rmAudit.body.data?.events ?? []).some((event) => event.targetUserId === keegan!.id),
    'Regional Manager cannot retrieve audit events outside Region scope'
  );

  const switchedTl = await api<EnterData>(baseUrl, '/api/v1/demo/switch-role', {
    method: 'POST',
    token: rmToken,
    body: { selectedRole: 'team_leader' },
  });
  const tlToken = switchedTl.body.data!.token;
  const tlRegion = await api(baseUrl, '/api/v1/company/regions', {
    method: 'POST',
    token: tlToken,
    body: { name: 'TL should fail' },
  });
  assert(tlRegion.status === 403, 'Team Leader cannot administer Regions');
  const tlTeam = await api(baseUrl, '/api/v1/company/teams', {
    method: 'POST',
    token: tlToken,
    body: { name: 'TL should fail', regionId: rmRegion?.id },
  });
  assert(tlTeam.status === 403, 'Team Leader cannot administer Teams');

  const tlSub = await api(baseUrl, '/api/v1/company/subscription', { token: tlToken });
  assert(tlSub.status === 403, 'Team Leader cannot open company subscription');
  const tlInvoices = await api(baseUrl, '/api/v1/company/invoices', { token: tlToken });
  assert(tlInvoices.status === 403, 'Team Leader cannot open company invoices');
  const tlAudit = await api<AuditList>(baseUrl, '/api/v1/company/audit', { token: tlToken });
  assert(tlAudit.status === 403, 'Team Leader is denied Audit by the API');
  assert(tlAudit.body.error?.code === 'FORBIDDEN', 'Team Leader Audit denial is an authorisation response');

  const execAgain = await api<EnterData>(baseUrl, '/api/v1/demo/switch-role', {
    method: 'POST',
    token: tlToken,
    body: { selectedRole: 'executive' },
  });
  const execToken = execAgain.body.data!.token;
  const subscription = await api<{
    plan?: { name?: string | null };
    licencePool?: Pool;
    subscriptionStatus?: string;
  }>(baseUrl, '/api/v1/company/subscription', { token: execToken });
  assert(subscription.status === 200, 'Executive can view company subscription');
  assert(Boolean(subscription.body.data?.plan?.name), 'subscription shows a plan name');
  assert(subscription.body.data?.licencePool?.purchased === NORTHSTAR_SEAT_LIMIT, 'subscription pool purchased is 50');

  const invoices = await api<InvoiceList>(baseUrl, '/api/v1/company/invoices', { token: execToken });
  assert(invoices.status === 200, 'Executive can list invoices');
  assert((invoices.body.data?.invoices ?? []).length === NORTHSTAR_INVOICE_COUNT, 'clone received Northstar invoices');
  assert(
    (invoices.body.data?.invoices ?? []).every((row) => /^INV[0-9]{6,}$/.test(row.invoiceNumber)),
    'invoices use real invoice numbers'
  );
  const sentInvoice = (invoices.body.data?.invoices ?? []).find((row) => row.status === 'sent' || row.status === 'paid');
  assert(Boolean(sentInvoice), 'seeded invoices include a sendable/sent record');
  const sent = await api<{ demoSimulated?: boolean; message?: string }>(
    baseUrl,
    `/api/v1/company/invoices/${sentInvoice!.id}/send`,
    { method: 'POST', token: execToken }
  );
  assert(sent.status === 200 && sent.body.data?.demoSimulated === true, 'invoice send is simulated');
  assert(sent.body.data?.message === DEMO_ACTION_SIMULATED_MESSAGE, 'invoice send uses simulated copy');

  const pdf = await fetch(`${baseUrl}/api/v1/company/invoices/${sentInvoice!.id}/pdf`, {
    headers: { Authorization: `Bearer ${execToken}` },
  });
  assert(pdf.status === 200 && (pdf.headers.get('content-type') ?? '').includes('pdf'), 'invoice PDF is generated locally');

  const deleteRole = await api(baseUrl, '/api/v1/company/roles/00000000-0000-4000-8000-000000000000', {
    method: 'DELETE',
    token: execToken,
  });
  assert(deleteRole.status === 403 || deleteRole.status === 404, 'role hard-delete is blocked or missing');

  const pay = await api(baseUrl, '/api/v1/subscription/revenuecat/sync', {
    method: 'POST',
    token: execToken,
    body: { productId: 'pro' },
  });
  assert(pay.status === 403 && pay.body.error?.code === 'DEMO_SIDE_EFFECT_BLOCKED', 'payment/RevenueCat sync is blocked');
  const platform = await api(baseUrl, '/api/v1/platform/companies', { token: execToken });
  assert(platform.status === 403, 'platform administration stays blocked');

  const bMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: tokenB });
  assert(!(bMembers.body.data ?? []).some((row) => row.lastName === renamed), 'session B does not see session A edits');
  const bPool = await api<Pool>(baseUrl, '/api/v1/company/licence-pool', { token: tokenB });
  assert(
    bPool.body.data?.assigned === NORTHSTAR_ASSIGNED_LICENCES && bPool.body.data?.available === NORTHSTAR_AVAILABLE_LICENCES,
    'session B licence pool stays pristine 50 / 42 / 8'
  );

  const reset = await api<EnterData>(baseUrl, '/api/v1/demo/reset', { method: 'POST', token: execToken });
  assert(reset.status === 200, 'Reset Demo succeeds after visitor edits');
  assert(reset.body.data?.session.companyId !== execAgain.body.data!.session.companyId, 'Reset Demo provisions a fresh company');
  assert(reset.body.data?.session.selectedRole === 'executive', 'Reset Demo preserves Executive');
  assert(reset.body.data?.token !== execToken, 'Reset Demo issues a new JWT');
  const resetMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: reset.body.data!.token });
  assert(!(resetMembers.body.data ?? []).some((row) => row.lastName === renamed), 'reset restores pristine names');
  assert(!(resetMembers.body.data ?? []).some((row) => row.firstName === 'Lerato' && row.lastName === 'Maseko'), 'reset removes added demo user');
  const resetPool = await api<Pool>(baseUrl, '/api/v1/company/licence-pool', { token: reset.body.data!.token });
  assert(
    resetPool.body.data?.purchased === NORTHSTAR_SEAT_LIMIT &&
      resetPool.body.data?.assigned === NORTHSTAR_ASSIGNED_LICENCES &&
      resetPool.body.data?.available === NORTHSTAR_AVAILABLE_LICENCES,
    'reset restores 50 / 42 / 8 licences'
  );
  const resetInvoices = await api<InvoiceList>(baseUrl, '/api/v1/company/invoices', { token: reset.body.data!.token });
  assert((resetInvoices.body.data?.invoices ?? []).length === NORTHSTAR_INVOICE_COUNT, 'reset clone has pristine invoices');

  if (databaseUrl) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const oldCompany = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM companies WHERE id = $1`,
        [execAgain.body.data!.session.companyId]
      );
      assert(oldCompany.rows[0]?.is_active === false, 'reset archives the previous visitor company');
      const template = await client.query<{ seed_version: number; company_id: string }>(
        `SELECT seed_version, company_id FROM demo_workspace_templates WHERE status = 'active' LIMIT 1`
      );
      assert((template.rows[0]?.seed_version ?? 0) >= 14, 'active template is Phase 14 Northstar');
      const masterTouched = await client.query<{ last_name: string }>(
        `SELECT last_name FROM users WHERE company_id = $1 AND first_name = 'Maya' AND last_name LIKE 'Brooks%' LIMIT 1`,
        [template.rows[0].company_id]
      );
      assert(
        !masterTouched.rows[0] || masterTouched.rows[0].last_name === 'Brooks',
        'Northstar master personas were not mutated'
      );
      const outbox = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM demo_outbox_events WHERE company_id = $1 AND action IN ('member_invitation', 'invoice_send')`,
        [companyA]
      );
      assert((outbox.rows[0]?.n ?? 0) >= 2, 'invitation and invoice send were recorded in demo outbox');
      const mailtrap = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
         FROM invoice_delivery_events e
         INNER JOIN invoices i ON i.id = e.invoice_id
         WHERE i.company_id = $1
           AND COALESCE(e.provider_message_id, '') NOT IN ('', 'demo-outbox')`,
        [companyA]
      );
      assert((mailtrap.rows[0]?.n ?? 0) === 0, 'Mailtrap/live email providers received nothing');
    } finally {
      await client.end();
    }
  }
}

async function main(): Promise<void> {
  runStaticChecks();
  const demoEnvPath = path.join(root, '.env.demo');
  const databaseUrl = readEnvValue(demoEnvPath, 'DATABASE_URL');
  if (databaseUrl) {
    const parsed = parseDatabaseUrl(databaseUrl);
    assert(parsed?.database === DEMO_DATABASE_NAME, `demo SQL targets ${DEMO_DATABASE_NAME}`);
  }
  const baseUrl = process.env.DEMO_API_BASE;
  if (!baseUrl) {
    console.log('NOTE  DEMO_API_BASE not set; skipped HTTP checks');
  } else {
    await runHttp(baseUrl.replace(/\/$/, ''), databaseUrl);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
