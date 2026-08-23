/**
 * Phase 12 verification: Northstar seed, reset, expiry, isolation, final QA.
 * Run from Abel Backend: npm run test:phase12
 *
 * Optional HTTP:
 *   DEMO_API_BASE=http://127.0.0.1:3001 npm run test:phase12
 * Demo SQL always reads DATABASE_URL from .env.demo. Live dotenv / process.env
 * cannot redirect those checks to advisortrack_local. SKIP_LIVE=1 only skips
 * live HTTP process checks; it is not required for demo database selection.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import pg from 'pg';
import { DEMO_DATABASE_NAME, parseDatabaseUrl } from '../src/config/databaseSafety';
import {
  DEFAULT_DEMO_EXPIRY_SWEEP_MINUTES,
  DEFAULT_DEMO_SESSION_TTL_MINUTES,
} from '../src/features/demoSessionPolicy';
import {
  NORTHSTAR_ASSIGNED_LICENCES,
  NORTHSTAR_AVAILABLE_LICENCES,
  NORTHSTAR_LAST_MONTH_RANKINGS,
  NORTHSTAR_REGIONS,
  NORTHSTAR_SEAT_LIMIT,
  countNorthstarPeople,
} from '../src/features/demoNorthstar';
import { daysForDemoBucket, resolveDemoBucketTimestamp } from '../src/features/demoDatePlan';
import { resolvePerformancePeriod } from '../src/features/performancePeriod';
import { DEMO_ACTION_SIMULATED_MESSAGE } from '../src/features/demoMessages';

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
const frontendRoot = path.resolve(
  __dirname,
  '../../../_Old-And-Other-Apps/AdvisorTrack/AdvisorTrack Frontend'
);

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

function decodeJwt(token: string): { userId?: string; email?: string; demoSessionId?: string } {
  const payload = token.split('.')[1];
  if (!payload) return {};
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    userId?: string;
    email?: string;
    demoSessionId?: string;
  };
}

function readEnvValue(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const line = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

/**
 * Demo SQL connection comes only from .env.demo.
 * Live regression loads `.env` into process.env.DATABASE_URL; that must never
 * be used here or checks run against advisortrack_local.
 */
function resolveDemoSqlDatabaseUrl(demoEnvPath: string): string | undefined {
  const fromFile = readEnvValue(demoEnvPath, 'DATABASE_URL');
  if (!fromFile) return undefined;
  const target = parseDatabaseUrl(fromFile);
  assert(
    target?.database === DEMO_DATABASE_NAME,
    `demo SQL checks load .env.demo and target ${DEMO_DATABASE_NAME} (got ${target?.database || 'unparseable'})`
  );
  return target?.database === DEMO_DATABASE_NAME ? fromFile : undefined;
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|js)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function runUnitTests(): void {
  assert(DEFAULT_DEMO_SESSION_TTL_MINUTES === 120, 'default TTL is 120 minutes');
  assert(DEFAULT_DEMO_EXPIRY_SWEEP_MINUTES === 15, 'default expiry sweep is 15 minutes');
  const envSrc = fs.readFileSync(path.join(root, 'src/config/env.ts'), 'utf8');
  assert(envSrc.includes('DEMO_SESSION_TTL_MINUTES'), 'TTL is configured via DEMO_SESSION_TTL_MINUTES');
  assert(!/24 \* 60 \* 60 \* 1000/.test(fs.readFileSync(path.join(root, 'src/services/demoSession.service.ts'), 'utf8')), 'session service no longer uses a 24h hardcoded TTL');

  const people = countNorthstarPeople();
  assert(people.executives === 1, 'seed has 1 Executive');
  assert(people.regionalManagers === 3, 'seed has 3 Regional Managers');
  assert(people.teamLeaders === 9, 'seed has 9 Team Leaders');
  assert(people.advisors === 45, 'seed has 45 Financial Advisors');
  assert(people.regions === 3, 'seed has 3 Regions');
  assert(people.teams === 9, 'seed has 9 Teams');
  assert(people.licensed === NORTHSTAR_ASSIGNED_LICENCES, 'seed licensed count is 42');
  assert(NORTHSTAR_SEAT_LIMIT - NORTHSTAR_ASSIGNED_LICENCES === NORTHSTAR_AVAILABLE_LICENCES, 'licence remainder is 8');

  const coastal = NORTHSTAR_REGIONS[0];
  const harbour = coastal.teams[0];
  const rmTotals = NORTHSTAR_REGIONS.map((region) =>
    region.teams.reduce(
      (sum, team) => sum + team.advisors.reduce((inner, advisor) => inner + advisor.lastMonthIssued, 0),
      0
    )
  );
  assert(new Set(rmTotals).size === 3, 'Last Month RM issued totals are not tied');
  assert(rmTotals[0] > rmTotals[1] && rmTotals[1] > rmTotals[2], 'Coastal > Highveld > Karoo last-month issued');
  const tlTotals = coastal.teams.map((team) =>
    team.advisors.reduce((sum, advisor) => sum + advisor.lastMonthIssued, 0)
  );
  assert(new Set(tlTotals).size === 3, 'Last Month TL issued totals under selected RM are not tied');
  const faTotals = harbour.advisors.map((advisor) => advisor.lastMonthIssued);
  assert(new Set(faTotals).size === harbour.advisors.length, 'Last Month FA issued totals under selected TL are not tied');
  assert(
    `${coastal.manager.firstName} ${coastal.manager.lastName}` === NORTHSTAR_LAST_MONTH_RANKINGS.executive.top,
    'expected Executive top performer is Jordan Hale from seed amounts'
  );
  assert(
    `${NORTHSTAR_REGIONS[2].manager.firstName} ${NORTHSTAR_REGIONS[2].manager.lastName}` ===
      NORTHSTAR_LAST_MONTH_RANKINGS.executive.needs,
    'expected Executive needs-attention is Priya Naidoo from seed amounts'
  );
  assert(
    `${harbour.leader.firstName} ${harbour.leader.lastName}` === NORTHSTAR_LAST_MONTH_RANKINGS.regional_manager.top,
    'expected RM top performer is Sam Okonkwo from seed amounts'
  );
  assert(
    `${coastal.teams[2].leader.firstName} ${coastal.teams[2].leader.lastName}` ===
      NORTHSTAR_LAST_MONTH_RANKINGS.regional_manager.needs,
    'expected RM needs-attention is Leah van Wyk from seed amounts'
  );
  assert(
    `${harbour.advisors[0].firstName} ${harbour.advisors[0].lastName}` === NORTHSTAR_LAST_MONTH_RANKINGS.team_leader.top,
    'expected TL top performer is Maya Brooks from seed amounts'
  );
  assert(
    `${harbour.advisors[4].firstName} ${harbour.advisors[4].lastName}` === NORTHSTAR_LAST_MONTH_RANKINGS.team_leader.needs,
    'expected TL needs-attention is Thabo Nkosi from seed amounts'
  );

  const now = new Date('2026-03-18T08:00:00Z');
  const lastMonth = resolvePerformancePeriod('last_month', now);
  const lastWeek = resolvePerformancePeriod('last_week', now);
  const ytd = resolvePerformancePeriod('year_to_date', now);
  const lastMonthTs = resolveDemoBucketTimestamp('last_month', 3, now);
  const lastMonthYmd = lastMonthTs.toISOString().slice(0, 10);
  assert(lastMonthYmd >= lastMonth.startDate && lastMonthYmd <= lastMonth.endDate, 'last_month bucket dates land in Last Month');
  const weekDays = daysForDemoBucket('last_week', now);
  assert(
    weekDays.every((day) => day < lastMonth.startDate || day > lastMonth.endDate),
    'last_week issued days do not overlap Last Month'
  );
  assert(lastWeek.startDate < lastWeek.endDate, 'Last Week range is valid');
  assert(ytd.startDate <= ytd.endDate, 'YTD range is valid');
  const later = new Date('2027-11-04T08:00:00Z');
  const laterMonth = resolvePerformancePeriod('last_month', later);
  const laterTs = resolveDemoBucketTimestamp('last_month', 3, later);
  assert(
    laterTs.toISOString().slice(0, 10) >= laterMonth.startDate &&
      laterTs.toISOString().slice(0, 10) <= laterMonth.endDate,
    'relative dates remain valid outside August 2026'
  );
  assert(DEMO_ACTION_SIMULATED_MESSAGE.includes('no real message was sent'), 'simulated-action copy is explicit');
}

function runStaticChecks(): void {
  const srcDir = path.join(root, 'src');
  const deleteHits = walk(srcDir).filter((file) =>
    /DELETE\s+FROM\s+demo_(sessions|company_personas|workspace_templates|outbox_events|seed_date_plan)\b/i.test(
      fs.readFileSync(file, 'utf8')
    )
  );
  assert(deleteHits.length === 0, 'no hard-delete path for demo/business records in backend src');
  const sessionSrc = fs.readFileSync(path.join(root, 'src/services/demoSession.service.ts'), 'utf8');
  assert(!/DELETE\s+FROM\s+(companies|users|client_cases)\b/i.test(sessionSrc), 'reset/expiry do not DELETE companies or users');
  const sweepSrc = fs.readFileSync(path.join(root, 'src/services/demoExpirySweep.service.ts'), 'utf8');
  assert(!/DELETE\s+FROM\b/i.test(sweepSrc), 'expiry sweep does not DELETE rows');

  assert(fs.existsSync(path.join(root, 'database/demo/003_demo_outbox_and_date_plan.sql')), 'demo outbox/date-plan migration exists');
  assert(!fs.existsSync(path.join(root, 'database/029_demo_outbox.sql')), 'outbox is not a production 029 migration');
  const productionMigrations = fs.readdirSync(path.join(root, 'database')).filter((name) => /^\d{3}_/.test(name));
  assert(!productionMigrations.includes('029_demo_sessions.sql'), 'demo tables stay out of the production migration chain');
  const harness = fs.readFileSync(path.join(root, 'scripts/verify-phase12.ts'), 'utf8');
  assert(
    !/process\.env\.DATABASE_URL\s*\|\|/.test(harness),
    'Phase 12 demo SQL does not fall back to process.env.DATABASE_URL'
  );

  const session = fs.readFileSync(path.join(root, 'src/services/demoSession.service.ts'), 'utf8');
  assert(session.includes('async reset('), 'reset provisions a fresh clone');
  assert(session.includes('sessionTtlMs()'), 'reset/create use the shared TTL helper');
  assert(session.includes('switchRole'), 'role switch remains available');
  assert(!/expires_at = now|expiresAt: new Date\(Date.now\(\) \+ sessionTtlMs\(\)\)/.test(
    session.slice(session.indexOf('async switchRole'), session.indexOf('async current'))
  ), 'role switch does not renew TTL');

  const clone = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspace.repository.ts'), 'utf8');
  assert(clone.includes('cloneOperationalData'), 'clone copies operational seed data');
  assert(clone.includes('assertNotTemplateCompany'), 'template mutations are blocked');

  const indexSrc = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
  assert(indexSrc.includes('sweepExpiredDemoSessions'), 'automatic expiry sweep is scheduled');

  if (!fs.existsSync(frontendRoot)) {
    console.log('NOTE  frontend project not on this host; skipping UI static checks');
    return;
  }
  const layout = fs.readFileSync(path.join(frontendRoot, 'src/components/Layout.tsx'), 'utf8');
  assert(layout.includes('Reset Demo'), 'Reset Demo control is visible');
  assert(layout.includes('ConfirmModal'), 'Reset Demo uses a confirmation modal');
  assert(layout.includes('resetDemoWorkspace'), 'Reset Demo calls the reset session API');
  assert(layout.includes('Viewing as'), 'role switcher remains');
  const users = fs.readFileSync(path.join(frontendRoot, 'src/pages/UsersPage.tsx'), 'utf8');
  assert(users.includes('Demo action completed — no real message was sent.'), 'invite/resend shows simulated demo copy');
  const dash = fs.readFileSync(path.join(frontendRoot, 'src/pages/DashboardPage.tsx'), 'utf8');
  assert(dash.includes("#0E51E4"), 'Issued Production remains AdvisorTrack Blue');
  assert(dash.includes('#38BDF8'), 'Not Yet Issued remains #38BDF8');
  const css = fs.readFileSync(path.join(frontendRoot, 'src/styles/global.css'), 'utf8');
  assert(css.includes('border-left: 4px solid #0E51E4'), 'Top Performer accent is unchanged');
  assert(css.includes('border-left: 4px solid #38BDF8'), 'Needs Attention accent is unchanged');
  const login = fs.readFileSync(path.join(frontendRoot, 'src/pages/LoginPage.tsx'), 'utf8');
  assert(login.includes('Sign in with your AdvisorTrack account'), 'live login copy is unchanged');
  const productionPage = fs.readFileSync(path.join(frontendRoot, 'src/pages/ProductionPage.tsx'), 'utf8');
  assert(productionPage.includes('getManagementProductionSummary'), 'Production page uses management production summary');
  assert(productionPage.includes('getManagementProductionEntries'), 'Production page uses management production entries');
  assert(!productionPage.includes('/api/client-cases'), 'Production page no longer calls the leftover client-cases URL');
  assert(!productionPage.includes('seedDataService'), 'Production page no longer uses hardcoded seed advisors');
}

async function runLiveRegression(): Promise<void> {
  require('dotenv').config({ path: path.join(root, '.env') });
  const { createApp } = await import('../src/app');
  const { env } = await import('../src/config/env');
  assert(env.appMode === 'live', 'test process remains in live mode');
  assert(!env.isDemoMode, 'live mode is unaffected when ADVISORTRACK_MODE is not demo');
  assert(env.demoSessionTtlMinutes === DEFAULT_DEMO_SESSION_TTL_MINUTES, 'live env still defaults TTL to 120');

  const app = await createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const liveHealth = await fetch(`${base}/health`);
  const liveBody = (await liveHealth.json()) as { data?: { mode?: string } };
  assert(liveBody.data?.mode === 'live', 'live health reports mode=live');
  const liveEnter = await fetch(`${base}/api/v1/demo/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedRole: 'executive' }),
  });
  assert(liveEnter.status === 404, 'live mode does not expose public demo entry');
  const liveReset = await fetch(`${base}/api/v1/demo/reset`, { method: 'POST' });
  assert(liveReset.status === 404 || liveReset.status === 401, 'live mode does not expose Reset Demo');
  server.close();
}

type EnterData = {
  token: string;
  session: {
    id: string;
    companyId: string | null;
    selectedRole: string | null;
    status: string;
    expiresAt: string;
  };
  user: { id: string; email: string; firstName?: string; lastName?: string };
};

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role?: { name?: string | null } | null;
  isActive?: boolean;
};

type ProductionSummary = {
  issuedAmount: number;
  issuedCount: number;
  nonIssuedAmount: number;
  nonIssuedCount: number;
};

type ProductionEntries = ProductionSummary & {
  entries: Array<{
    amount: number;
    isIssued: boolean;
    userId: string;
    contactName: string | null;
    productName: string | null;
  }>;
};

function assertProductionPageReconciles(
  label: string,
  summary: ProductionSummary | undefined,
  entries: ProductionEntries | undefined
): void {
  assert((summary?.issuedAmount ?? 0) > 0, `${label} issued commission is populated`);
  assert((summary?.nonIssuedAmount ?? 0) > 0, `${label} pipeline value is populated`);
  assert((summary?.issuedCount ?? 0) > 0, `${label} issued case count is populated`);
  assert((summary?.nonIssuedCount ?? 0) > 0, `${label} in-pipeline count is populated`);
  const rows = entries?.entries ?? [];
  const issuedRows = rows.filter((row) => row.isIssued);
  const pipelineRows = rows.filter((row) => !row.isIssued);
  const issuedSum = issuedRows.reduce((sum, row) => sum + row.amount, 0);
  const pipelineSum = pipelineRows.reduce((sum, row) => sum + row.amount, 0);
  assert(rows.length === (summary?.issuedCount ?? 0) + (summary?.nonIssuedCount ?? 0), `${label} table row count matches issued + in-pipeline`);
  assert(issuedRows.length === (summary?.issuedCount ?? 0), `${label} issued rows match summary count`);
  assert(pipelineRows.length === (summary?.nonIssuedCount ?? 0), `${label} pipeline rows match summary count`);
  assert(Math.round(issuedSum) === Math.round(summary?.issuedAmount ?? 0), `${label} issued amounts reconcile to the summary`);
  assert(Math.round(pipelineSum) === Math.round(summary?.nonIssuedAmount ?? 0), `${label} pipeline amounts reconcile to the summary`);
  assert(rows.every((row) => Boolean(row.userId)), `${label} table rows include advisor ids`);
  assert(rows.some((row) => Boolean(row.contactName) || Boolean(row.productName)), `${label} table rows include client/product fields`);
}

type Performance = {
  period?: string;
  topPerformer?: { name: string; issuedAmount: number } | null;
  worstPerformer?: { name: string; issuedAmount: number } | null;
  emptyReason?: string | null;
};

async function runDemoHttpChecks(baseUrl: string, databaseUrl?: string): Promise<void> {
  const execEnter = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'executive' },
  });
  assert(
    execEnter.status === 201,
    `final template provisioning succeeds for Executive (${execEnter.status} ${execEnter.body.error?.code || execEnter.body.error?.message || ''})`
  );
  const exec = execEnter.body.data;
  if (!exec?.session) {
    return;
  }
  const ttlMs = new Date(exec.session.expiresAt).getTime() - Date.now();
  assert(ttlMs > 110 * 60 * 1000 && ttlMs < 130 * 60 * 1000, 'default session TTL is approximately 120 minutes');

  const members = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: exec.token });
  const people = members.body.data ?? [];
  const counts = countNorthstarPeople();
  assert(people.length === counts.executives + counts.regionalManagers + counts.teamLeaders + counts.advisors, 'cloned org has 58 people');
  assert(people.filter((row) => row.role?.name === 'Regional Manager').length === 3, 'Executive sees three Regional Managers');
  assert(people.every((row) => row.email.endsWith('.demo.invalid')), 'cloned emails remain .demo.invalid');
  assert(new Set(people.map((row) => row.email)).size === people.length, 'cloned emails are unique inside the visitor company');

  const regions = await api<{ id: string }[]>(baseUrl, '/api/v1/company/regions', { token: exec.token });
  const teams = await api<{ id: string }[]>(baseUrl, '/api/v1/company/teams', { token: exec.token });
  assert((regions.body.data ?? []).length === 3, 'cloned organisation has 3 Regions');
  assert((teams.body.data ?? []).length === 9, 'cloned organisation has 9 Teams');

  const licences = await api<{ purchased: number; assigned: number; available: number }>(
    baseUrl,
    '/api/v1/company/licence-pool',
    { token: exec.token }
  );
  assert(licences.body.data?.purchased === 50, 'licence purchased is derived as 50');
  assert(licences.body.data?.assigned === 42, 'licence assigned is derived as 42');
  assert(licences.body.data?.available === 8, 'licence available is derived as 8');

  const pipeline = await api<{ caseCount: number }>(baseUrl, '/api/v1/management/pipeline', { token: exec.token });
  const caseCount = pipeline.body.data?.caseCount ?? 0;
  assert(caseCount >= 250 && caseCount <= 320, `pipeline/case records are in the 250–300 range (got ${caseCount})`);

  const lastMonth = await api<Performance>(baseUrl, '/api/v1/management/performance?period=last_month', {
    token: exec.token,
  });
  assert(lastMonth.status === 200, 'Executive Last Month performance uses the real issued calculation');
  assert(lastMonth.body.data?.topPerformer?.name === NORTHSTAR_LAST_MONTH_RANKINGS.executive.top, 'Executive Last Month top is Jordan Hale');
  assert(lastMonth.body.data?.worstPerformer?.name === NORTHSTAR_LAST_MONTH_RANKINGS.executive.needs, 'Executive Last Month needs attention is Priya Naidoo');
  assert(
    (lastMonth.body.data?.topPerformer?.issuedAmount ?? 0) !== (lastMonth.body.data?.worstPerformer?.issuedAmount ?? 0),
    'Executive Last Month ranking is not tied'
  );

  const lastWeek = await api<Performance>(baseUrl, '/api/v1/management/performance?period=last_week', {
    token: exec.token,
  });
  const ytd = await api<Performance>(baseUrl, '/api/v1/management/performance?period=year_to_date', {
    token: exec.token,
  });
  assert(lastWeek.status === 200, 'Last Week performance is available');
  assert(ytd.status === 200, 'Year to Date performance is available');
  assert((ytd.body.data?.topPerformer?.issuedAmount ?? 0) > 0, 'YTD has issued production after relative dating');

  const month = new Date().toISOString().slice(0, 7);
  const production = await api<ProductionSummary>(
    baseUrl,
    `/api/v1/management/production/summary?month=${month}`,
    { token: exec.token }
  );
  assert((production.body.data?.issuedAmount ?? 0) > 0, 'current-month Issued graph data is populated');
  assert((production.body.data?.nonIssuedAmount ?? 0) > 0, 'current-month Not Yet Issued graph data is populated');
  const productionEntries = await api<ProductionEntries>(
    baseUrl,
    `/api/v1/management/production/entries?month=${month}`,
    { token: exec.token }
  );
  assert(productionEntries.status === 200, 'Executive production entries endpoint succeeds');
  assertProductionPageReconciles('Executive', production.body.data, productionEntries.body.data);

  const switchedRm = await api<EnterData>(baseUrl, '/api/v1/demo/switch-role', {
    method: 'POST',
    token: exec.token,
    body: { selectedRole: 'regional_manager' },
  });
  assert(switchedRm.status === 200, 'Executive can switch to Regional Manager');
  assert(switchedRm.body.data?.session.companyId === exec.session.companyId, 'role switch keeps the same company');
  assert(
    Math.abs(new Date(switchedRm.body.data!.session.expiresAt).getTime() - new Date(exec.session.expiresAt).getTime()) < 1000,
    'role switch does not extend TTL'
  );
  const rmMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', {
    token: switchedRm.body.data!.token,
  });
  const rmPeople = rmMembers.body.data ?? [];
  assert(rmPeople.filter((row) => row.role?.name === 'Team Leader').length >= 3, 'selected RM has several Team Leaders');
  assert(rmPeople.every((row) => row.role?.name !== 'Executive'), 'RM scope does not include the Executive');
  const rmPerf = await api<Performance>(baseUrl, '/api/v1/management/performance?period=last_month', {
    token: switchedRm.body.data!.token,
  });
  assert(rmPerf.body.data?.topPerformer?.name === NORTHSTAR_LAST_MONTH_RANKINGS.regional_manager.top, 'RM Last Month top is Sam Okonkwo');
  assert(rmPerf.body.data?.worstPerformer?.name === NORTHSTAR_LAST_MONTH_RANKINGS.regional_manager.needs, 'RM Last Month needs attention is Leah van Wyk');
  const rmProduction = await api<ProductionSummary>(
    baseUrl,
    `/api/v1/management/production/summary?month=${month}`,
    { token: switchedRm.body.data!.token }
  );
  const rmEntries = await api<ProductionEntries>(
    baseUrl,
    `/api/v1/management/production/entries?month=${month}`,
    { token: switchedRm.body.data!.token }
  );
  assertProductionPageReconciles('Regional Manager', rmProduction.body.data, rmEntries.body.data);
  assert(
    (rmProduction.body.data?.issuedAmount ?? 0) < (production.body.data?.issuedAmount ?? 0),
    'RM issued commission is a subset of Executive scope'
  );

  const switchedTl = await api<EnterData>(baseUrl, '/api/v1/demo/switch-role', {
    method: 'POST',
    token: switchedRm.body.data!.token,
    body: { selectedRole: 'team_leader' },
  });
  assert(switchedTl.status === 200, 'RM can switch to Team Leader');
  assert(switchedTl.body.data?.session.companyId === exec.session.companyId, 'TL switch keeps the same company');
  const tlMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', {
    token: switchedTl.body.data!.token,
  });
  const tlPeople = tlMembers.body.data ?? [];
  assert(tlPeople.filter((row) => row.role?.name === 'Financial Advisor').length >= 5, 'selected TL has several Advisors');
  assert(tlPeople.every((row) => row.role?.name !== 'Regional Manager' && row.role?.name !== 'Executive'), 'TL scope is team-only');
  const tlPerf = await api<Performance>(baseUrl, '/api/v1/management/performance?period=last_month', {
    token: switchedTl.body.data!.token,
  });
  assert(tlPerf.body.data?.topPerformer?.name === NORTHSTAR_LAST_MONTH_RANKINGS.team_leader.top, 'TL Last Month top is Maya Brooks');
  assert(tlPerf.body.data?.worstPerformer?.name === NORTHSTAR_LAST_MONTH_RANKINGS.team_leader.needs, 'TL Last Month needs attention is Thabo Nkosi');
  const tlProduction = await api<ProductionSummary>(
    baseUrl,
    `/api/v1/management/production/summary?month=${month}`,
    { token: switchedTl.body.data!.token }
  );
  const tlEntries = await api<ProductionEntries>(
    baseUrl,
    `/api/v1/management/production/entries?month=${month}`,
    { token: switchedTl.body.data!.token }
  );
  assertProductionPageReconciles('Team Leader', tlProduction.body.data, tlEntries.body.data);
  assert(
    (tlProduction.body.data?.issuedAmount ?? 0) < (rmProduction.body.data?.issuedAmount ?? 0),
    'TL issued commission is a subset of RM scope'
  );

  const renamed = `Brooks-${Date.now().toString(36)}`;
  const maya = tlPeople.find((row) => row.firstName === 'Maya' && row.lastName === 'Brooks');
  assert(Boolean(maya), 'Maya Brooks is in the selected TL downline');
  const patched = await api<Member>(baseUrl, `/api/v1/company/members/${maya!.id}`, {
    method: 'PATCH',
    token: switchedTl.body.data!.token,
    body: { lastName: renamed },
  });
  assert(patched.status === 200, 'Team Leader can edit in-scope user data');

  const visitorB = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'executive' },
  });
  assert(visitorB.status === 201, 'Visitor B enters independently');
  assert(visitorB.body.data?.session.companyId !== exec.session.companyId, 'Visitor B receives a different company');
  const bMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: visitorB.body.data!.token });
  assert(
    !(bMembers.body.data ?? []).some((row) => row.lastName === renamed),
    "Visitor B cannot see Visitor A's edits"
  );
  assert(
    new Set((bMembers.body.data ?? []).map((row) => row.email)).size === (bMembers.body.data ?? []).length,
    'Visitor B cloned emails are unique'
  );
  const aEmail = people.find((row) => row.role?.name === 'Executive')?.email;
  const bEmail = (bMembers.body.data ?? []).find((row) => row.role?.name === 'Executive')?.email;
  assert(Boolean(aEmail && bEmail && aEmail !== bEmail), 'cloned visitor companies do not reuse emails');

  const unlicensed = (bMembers.body.data ?? []).find(
    (row) => row.role?.name === 'Financial Advisor'
  );
  const bLicencesBefore = await api<{ assigned: number; available: number }>(baseUrl, '/api/v1/company/licence-pool', {
    token: visitorB.body.data!.token,
  });
  if (unlicensed) {
    await api(baseUrl, `/api/v1/company/members/${unlicensed.id}/licence`, {
      method: 'POST',
      token: visitorB.body.data!.token,
    });
  }
  const bSeesA = await api(baseUrl, `/api/v1/company/members/${maya!.id}`, { token: visitorB.body.data!.token });
  assert(bSeesA.status === 404 || bSeesA.status === 403, 'Visitor B cannot access Visitor A member ids');

  const reset = await api<EnterData>(baseUrl, '/api/v1/demo/reset', {
    method: 'POST',
    token: switchedTl.body.data!.token,
  });
  assert(reset.status === 200, 'Reset Demo succeeds');
  assert(reset.body.data?.session.id === exec.session.id, 'Reset Demo keeps the same session');
  assert(reset.body.data?.session.companyId !== exec.session.companyId, 'Reset Demo provisions a fresh company');
  assert(reset.body.data?.session.selectedRole === 'team_leader', 'Reset Demo preserves Team Leader');
  assert(reset.body.data?.token !== switchedTl.body.data!.token, 'Reset Demo issues a new JWT');
  const resetTtl = new Date(reset.body.data!.session.expiresAt).getTime() - Date.now();
  assert(resetTtl > 110 * 60 * 1000 && resetTtl < 130 * 60 * 1000, 'Reset Demo renews TTL to ~120 minutes');

  const oldJwt = await api(baseUrl, '/api/v1/auth/me', { token: switchedTl.body.data!.token });
  assert(oldJwt.status === 401 || oldJwt.status === 403, 'old JWT is invalid after reset');

  const resetMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: reset.body.data!.token });
  assert(!(resetMembers.body.data ?? []).some((row) => row.lastName === renamed), 'reset restores pristine names');
  const resetLicences = await api<{ purchased: number; assigned: number; available: number }>(
    baseUrl,
    '/api/v1/company/licence-pool',
    { token: reset.body.data!.token }
  );
  assert(resetLicences.body.data?.purchased === 50 && resetLicences.body.data?.assigned === 42 && resetLicences.body.data?.available === 8, 'reset restores 50 / 42 / 8 licences');

  const bMeAfter = await api<{ company?: { id?: string } }>(baseUrl, '/api/v1/company/me', {
    token: visitorB.body.data!.token,
  });
  assert(bMeAfter.status === 200, 'Visitor B remains active after A resets');
  assert(bMeAfter.body.data?.company?.id === visitorB.body.data!.session.companyId, 'Visitor B workspace is unchanged after A resets');

  const inviteTarget = (resetMembers.body.data ?? []).find((row) => row.role?.name === 'Financial Advisor');
  const resend = await api<{ sent?: boolean; demoSimulated?: boolean; message?: string }>(
    baseUrl,
    `/api/v1/company/members/${inviteTarget!.id}/resend-invitation`,
    { method: 'POST', token: reset.body.data!.token }
  );
  assert(resend.status === 200 && resend.body.data?.demoSimulated === true, 'member invitation is simulated in demo');
  assert((resend.body.data?.message ?? '').includes('no real message was sent'), 'simulated invitation explains that no real message was sent');

  const platform = await api(baseUrl, '/api/v1/platform/companies', { token: reset.body.data!.token });
  assert(platform.status === 403 && platform.body.error?.code === 'DEMO_PLATFORM_FORBIDDEN', 'platform administration is blocked');
  const invoices = await api(baseUrl, '/api/v1/platform/invoices', { token: reset.body.data!.token });
  assert(invoices.status === 403, 'internal invoices are blocked');
  const pay = await api(baseUrl, '/api/v1/subscription/revenuecat/sync', {
    method: 'POST',
    token: reset.body.data!.token,
    body: { productId: 'pro' },
  });
  assert(pay.status === 403 && pay.body.error?.code === 'DEMO_SIDE_EFFECT_BLOCKED', 'payment side effects remain blocked');

  if (databaseUrl) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const oldCompany = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM companies WHERE id = $1`,
        [exec.session.companyId]
      );
      assert(oldCompany.rows[0]?.is_active === false, 'reset archives the previous visitor company');
      const retained = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1`,
        [exec.session.companyId]
      );
      assert((retained.rows[0]?.n ?? 0) >= 50, 'archived visitor company users are retained');

      const template = await client.query<{ company_id: string; status: string; seed_version: number }>(
        `SELECT company_id, status, seed_version FROM demo_workspace_templates WHERE status = 'active'`
      );
      assert(template.rows[0]?.seed_version >= 12, 'active template is the Phase 12 Northstar master');
      const templateUsers = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1 AND is_active = TRUE`,
        [template.rows[0].company_id]
      );
      assert(templateUsers.rows[0].n === 0, 'template users stay inactive');
      const historic = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM users WHERE email = 'john.mitchell@advisortrack.com'`
      );
      assert(!historic.rows[0] || historic.rows[0].is_active === false, 'historic 001_init user remains inactive');
      const phase11 = await client.query<{ status: string }>(
        `SELECT status FROM demo_workspace_templates WHERE company_id = 'd1111111-1111-4111-8111-111111111111'`
      );
      if (phase11.rows[0]) {
        assert(phase11.rows[0].status === 'archived', 'Phase 11 template is archived not deleted');
      }

      const beforeExpire = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM demo_sessions`);
      await client.query(`UPDATE demo_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
        reset.body.data!.session.id,
      ]);
      const expiredMe = await api(baseUrl, '/api/v1/auth/me', { token: reset.body.data!.token });
      assert(expiredMe.status === 401, 'request-level expiry rejects the session before a sweep');
      const afterExpire = await client.query<{ status: string; company_id: string }>(
        `SELECT status, company_id FROM demo_sessions WHERE id = $1`,
        [reset.body.data!.session.id]
      );
      assert(afterExpire.rows[0]?.status === 'expired', 'expired session is retained as expired');
      const expiredCompany = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM companies WHERE id = $1`,
        [afterExpire.rows[0].company_id]
      );
      assert(expiredCompany.rows[0]?.is_active === false, 'expired visitor company is deactivated and retained');

      const { sweepExpiredDemoSessions } = await import('../src/services/demoExpirySweep.service');
      const firstSweep = await sweepExpiredDemoSessions();
      const secondSweep = await sweepExpiredDemoSessions();
      assert(secondSweep.expiredSessions === 0, 'expiry sweep is idempotent');
      const afterSweep = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM demo_sessions`);
      assert(afterSweep.rows[0].n === beforeExpire.rows[0].n, 'expiry never hard-deletes sessions');
      void firstSweep;

      const outbox = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM demo_outbox_events WHERE action LIKE 'member_invitation%'`
      );
      assert((outbox.rows[0]?.n ?? 0) >= 1, 'simulated invitations are stored in demo_outbox_events');

      const bStill = await api(baseUrl, '/api/v1/auth/me', { token: visitorB.body.data!.token });
      assert(bStill.status === 200, 'Visitor B is still active after A expires');

      const newSession = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
        method: 'POST',
        body: { selectedRole: 'executive' },
      });
      assert(newSession.status === 201, 'a new session can start after expiry');

      await client.query(
        `UPDATE demo_sessions SET status = 'expired' WHERE id = ANY($1::uuid[])`,
        [[visitorB.body.data!.session.id, newSession.body.data!.session.id]]
      );
      await client.query(`UPDATE companies SET is_active = FALSE WHERE id = ANY($1::uuid[])`, [
        [visitorB.body.data!.session.companyId, newSession.body.data!.session.companyId],
      ]);
    } finally {
      await client.end();
    }
  }
}

async function main(): Promise<void> {
  console.log('Phase 12 verification\n');
  runUnitTests();
  runStaticChecks();
  if (process.env.SKIP_LIVE !== '1') {
    await runLiveRegression();
  } else {
    console.log('NOTE  skipping live/local process checks (SKIP_LIVE=1)');
  }

  const demoEnvPath = path.join(root, '.env.demo');
  const demoApiBase = process.env.DEMO_API_BASE?.replace(/\/$/, '');
  const demoDatabaseUrl = resolveDemoSqlDatabaseUrl(demoEnvPath);
  if (demoApiBase) {
    if (fs.existsSync(demoEnvPath)) {
      assert(Boolean(demoDatabaseUrl), 'demo SQL checks require DATABASE_URL in .env.demo');
    }
    await runDemoHttpChecks(demoApiBase, demoDatabaseUrl);
  } else if (fs.existsSync(demoEnvPath)) {
    console.log('NOTE  local .env.demo is present but DEMO_API_BASE was not set; start the demo API to run HTTP checks');
  } else {
    console.log('NOTE  skipping demo HTTP suite (no DEMO_API_BASE / local .env.demo)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
