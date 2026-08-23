/**
 * Phase 11 verification: demo entry, roles, anonymous sessions.
 * Run from Abel Backend: npm run test:phase11
 *
 * Optional:
 *   DEMO_API_BASE=http://127.0.0.1:3001 SKIP_LIVE=1 npm run test:phase11
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import pg from 'pg';
import {
  isRejectedDemoRole,
  parseDemoPublicRole,
} from '../src/features/demoRoles';

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

function runUnitTests(): void {
  assert(parseDemoPublicRole('executive') === 'executive', 'parses Executive');
  assert(parseDemoPublicRole('Regional Manager') === 'regional_manager', 'parses Regional Manager');
  assert(parseDemoPublicRole('team-leader') === 'team_leader', 'parses Team Leader');
  assert(parseDemoPublicRole('financial_advisor') === null, 'does not parse Financial Advisor as a public role');
  assert(isRejectedDemoRole('Financial Advisor'), 'rejects Financial Advisor');
  assert(isRejectedDemoRole('Founder/Admin'), 'rejects Founder/Admin');
  assert(isRejectedDemoRole('App Admin'), 'rejects App Admin');
  assert(isRejectedDemoRole('platform_admin'), 'rejects platform admin');
}

function runStaticChecks(): void {
  const srcDir = path.join(root, 'src');
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (/\.(ts|js)$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };
  const deleteHits = walk(srcDir).filter((file) =>
    /DELETE\s+FROM\s+demo_(sessions|company_personas|workspace_templates)\b/i.test(
      fs.readFileSync(file, 'utf8')
    )
  );
  assert(deleteHits.length === 0, 'no demo hard-delete path in backend src');

  assert(
    fs.existsSync(path.join(root, 'database/demo/002_demo_personas.sql')),
    'demo-only persona migration exists'
  );
  assert(
    !fs.existsSync(path.join(root, 'database/029_demo_personas.sql')),
    'persona mapping is not a production 029 migration'
  );
  const demoSql = fs.readFileSync(path.join(root, 'database/demo/002_demo_personas.sql'), 'utf8');
  assert(demoSql.includes('demo_company_personas'), 'demo_company_personas table is defined');
  assert(demoSql.includes('northstar.demo.invalid'), 'master fixture uses fictional demo identities');
  assert(!/advisortrack\.co\.za/.test(demoSql), 'master fixture does not use production emails');

  const service = fs.readFileSync(path.join(root, 'src/services/demoSession.service.ts'), 'utf8');
  assert(service.includes('cloneFromActiveTemplate'), 'entry provisions by cloning the template');
  assert(service.includes('demoSessionId'), 'JWT is bound to the demo session id');
  assert(service.includes('hashDemoSessionToken'), 'opaque token is hashed');
  assert(!service.includes('req.body.companyId'), 'session service does not take a client companyId');

  const routes = fs.readFileSync(path.join(root, 'src/routes/demo.routes.ts'), 'utf8');
  assert(routes.includes("req.body?.selectedRole"), 'enter uses selectedRole only');
  assert(!routes.includes('companyId'), 'demo routes do not accept companyId as a security input');

  const productionMigrations = fs
    .readdirSync(path.join(root, 'database'))
    .filter((name) => /^\d{3}_/.test(name));
  for (const name of ['024_trial_14_days.sql', '025_regions_and_teams.sql', '026_company_subscriptions.sql', '027_internal_invoicing.sql', '028_invoice_delivery_metadata.sql']) {
    assert(productionMigrations.includes(name), `${name} remains in the production chain`);
  }

  if (!fs.existsSync(frontendRoot)) {
    console.log('NOTE  frontend project not on this host; skipping UI static checks');
    return;
  }
  const main = fs.readFileSync(path.join(frontendRoot, 'src/main.tsx'), 'utf8');
  assert(main.includes('DemoEntryPage'), 'demo mode shows role-selection instead of login');
  assert(main.includes('LoginPage'), 'live mode still has the normal login page');
  assert(main.includes('isPublicDemo'), 'entry screen is gated by demo mode');
  assert(main.includes("pathname === '/login'"), 'manual /login in demo redirects to the entry flow');

  const login = fs.readFileSync(path.join(frontendRoot, 'src/pages/LoginPage.tsx'), 'utf8');
  assert(login.includes('Sign in with your AdvisorTrack account'), 'live login copy is unchanged');

  const entry = fs.readFileSync(path.join(frontendRoot, 'src/pages/DemoEntryPage.tsx'), 'utf8');
  assert(entry.includes('Executive'), 'role-selection includes Executive');
  assert(entry.includes('Regional Manager'), 'role-selection includes Regional Manager');
  assert(entry.includes('Team Leader'), 'role-selection includes Team Leader');
  assert(!/Financial Advisor/.test(entry), 'role-selection does not offer Financial Advisor');
  assert(!/Founder\/Admin|App Admin|Platform Admin/.test(entry), 'role-selection does not offer internal roles');

  const layout = fs.readFileSync(path.join(frontendRoot, 'src/components/Layout.tsx'), 'utf8');
  assert(layout.includes('AdvisorTrack Demo'), 'portal shows a demo indicator');
  assert(layout.includes('Viewing as'), 'portal shows the current demo persona');
  assert(layout.includes('switchDemoPersona'), 'portal can switch demo roles');
  assert(!/Financial Advisor/.test(layout), 'role switcher does not include Financial Advisor');
}

async function runLiveRegression(): Promise<void> {
  require('dotenv').config({ path: path.join(root, '.env') });
  const { createApp } = await import('../src/app');
  const { env } = await import('../src/config/env');
  assert(env.appMode === 'live', 'test process remains in live mode');
  assert(!env.isDemoMode, 'live mode is unaffected when ADVISORTRACK_MODE is not demo');

  const app = await createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const liveHealth = await fetch(`${base}/health`);
  const liveBody = (await liveHealth.json()) as { data?: { mode?: string } };
  assert(liveBody.data?.mode === 'live', 'live health reports mode=live');
  const livePlatform = await fetch(`${base}/api/v1/platform/companies`);
  assert(livePlatform.status === 401, 'live /platform still requires auth rather than demo-block');
  const liveEnter = await fetch(`${base}/api/v1/demo/enter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedRole: 'executive' }),
  });
  assert(liveEnter.status === 404, 'live mode does not expose public demo entry');
  server.close();
}

type Member = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role?: { name?: string | null } | null;
};

type EnterData = {
  token: string;
  session: {
    id: string;
    companyId: string | null;
    selectedRole: string | null;
    status: string;
  };
  user: {
    id: string;
    email: string;
    organisation?: { id?: string } | null;
  };
};

async function runDemoHttpChecks(baseUrl: string, databaseUrl?: string): Promise<void> {
  const plantedCompanyId = '00000000-0000-4000-8000-000000000099';
  const execEnter = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'executive', companyId: plantedCompanyId },
  });
  assert(execEnter.status === 201, 'anonymous session creation succeeds for Executive');
  const exec = execEnter.body.data;
  assert(Boolean(exec?.token && exec.token.split('.').length === 3), 'demo auth returns a signed JWT');
  assert(exec?.session.status === 'active', 'created session is active');
  assert(exec?.session.selectedRole === 'executive', 'selected role is stored on the demo session');
  assert(Boolean(exec?.session.companyId), 'session company is derived server-side');
  assert(exec?.session.companyId !== plantedCompanyId, 'arbitrary client companyId cannot establish workspace');
  const jwt = decodeJwt(exec!.token);
  assert(jwt.demoSessionId === exec!.session.id, 'JWT is bound to the demo session id');
  assert(jwt.userId === exec!.user.id, 'JWT user is the mapped Executive persona');

  const hashed = crypto.createHash('sha256').update(exec!.token, 'utf8').digest('hex');
  if (databaseUrl) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const row = await client.query<{ token_hash: string; company_id: string }>(
        `SELECT token_hash, company_id FROM demo_sessions WHERE id = $1`,
        [exec!.session.id]
      );
      assert(row.rows[0]?.token_hash.length === 64, 'opaque session token is stored as a hash');
      assert(row.rows[0]?.token_hash !== exec!.token, 'raw JWT/token is not stored in token_hash');
      assert(row.rows[0]?.token_hash !== hashed, 'JWT is not used as the stored opaque token');
      assert(row.rows[0]?.company_id === exec!.session.companyId, 'stored company matches the server session');
    } finally {
      await client.end();
    }
  }

  const me = await api<{
    organisation?: { company?: { id?: string } };
    id: string;
  }>(baseUrl, '/api/v1/auth/me', { token: exec!.token });
  assert(me.status === 200, 'session resolves server-side via /auth/me');
  assert(
    me.body.data?.organisation?.company?.id === exec!.session.companyId,
    'authenticated company comes from the demo session'
  );

  const members = await api<Member[]>(baseUrl, '/api/v1/company/members', { token: exec!.token });
  assert(members.status === 200, 'Executive can list organisation members');
  const execMembers = members.body.data ?? [];
  assert(execMembers.length >= 4, 'minimal fixture includes exec, RM, TL and FA');
  const persona = execMembers.find((row) => row.id === exec!.user.id);
  assert(persona?.role?.name === 'Executive', 'mapped Executive persona belongs to the session company');
  const advisor =
    execMembers.find((row) => row.firstName === 'Maya' && row.lastName === 'Brooks') ??
    execMembers.find((row) => row.role?.name === 'Financial Advisor');
  assert(Boolean(advisor), 'fixture includes a Financial Advisor under the team (not a public demo role)');

  const marker = `Chen-${Date.now().toString(36)}`;
  const updated = await api<Member>(baseUrl, `/api/v1/company/members/${advisor!.id}`, {
    method: 'PATCH',
    token: exec!.token,
    body: { lastName: marker },
  });
  assert(updated.status === 200, 'Executive can change fixture data before switching');

  const rmEnter = await api<EnterData>(baseUrl, '/api/v1/demo/switch-role', {
    method: 'POST',
    token: exec!.token,
    body: { selectedRole: 'regional_manager' },
  });
  assert(rmEnter.status === 200, 'Executive → Regional Manager switching works');
  assert(rmEnter.body.data?.session.companyId === exec!.session.companyId, 'RM switch retains the same company');
  assert(rmEnter.body.data?.session.selectedRole === 'regional_manager', 'switch stores Regional Manager on the session');
  assert(rmEnter.body.data?.user.id !== exec!.user.id, 'switch authenticates the mapped RM persona');

  const tlEnter = await api<EnterData>(baseUrl, '/api/v1/demo/switch-role', {
    method: 'POST',
    token: rmEnter.body.data!.token,
    body: { selectedRole: 'team_leader' },
  });
  assert(tlEnter.status === 200, 'Regional Manager → Team Leader switching works');
  assert(tlEnter.body.data?.session.companyId === exec!.session.companyId, 'TL switch retains the same company');
  const tlMembers = await api<Member[]>(baseUrl, '/api/v1/company/members', {
    token: tlEnter.body.data!.token,
  });
  const visibleAdvisor = (tlMembers.body.data ?? []).find((row) => row.id === advisor!.id);
  assert(Boolean(visibleAdvisor), 'Team Leader still sees the Advisor in the same workspace');
  assert(visibleAdvisor?.lastName === marker, 'changes made before switching remain visible in the new role scope');

  const rmDirect = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'regional_manager' },
  });
  assert(rmDirect.status === 201, 'Regional Manager selection works on entry');
  const tlDirect = await api<EnterData>(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'team_leader' },
  });
  assert(tlDirect.status === 201, 'Team Leader selection works on entry');
  assert(
    rmDirect.body.data?.session.companyId !== exec!.session.companyId &&
      tlDirect.body.data?.session.companyId !== exec!.session.companyId &&
      rmDirect.body.data?.session.companyId !== tlDirect.body.data?.session.companyId,
    'each visitor receives an isolated company'
  );

  const visitorA = rmDirect.body.data!;
  const visitorB = tlDirect.body.data!;
  const aMe = await api<{ company?: { id?: string } }>(baseUrl, '/api/v1/company/me', {
    token: visitorA.token,
  });
  const bMe = await api<{ company?: { id?: string } }>(baseUrl, '/api/v1/company/me', {
    token: visitorB.token,
  });
  assert(aMe.body.data?.company?.id === visitorA.session.companyId, 'Visitor A company is the session company');
  assert(bMe.body.data?.company?.id === visitorB.session.companyId, 'Visitor B company is the session company');
  assert(aMe.body.data?.company?.id !== bMe.body.data?.company?.id, 'Visitor A cannot share Visitor B company');
  const aSeesB = await api(baseUrl, `/api/v1/company/members/${visitorB.user.id}`, {
    token: visitorA.token,
  });
  assert(aSeesB.status === 404 || aSeesB.status === 403, 'Visitor A cannot access a Visitor B persona');
  const bSeesA = await api(baseUrl, `/api/v1/company/members/${visitorA.user.id}`, {
    token: visitorB.token,
  });
  assert(bSeesA.status === 404 || bSeesA.status === 403, 'Visitor B cannot access a Visitor A persona');

  const fa = await api(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'financial_advisor' },
  });
  assert(fa.status === 403 && fa.body.error?.code === 'DEMO_ROLE_FORBIDDEN', 'Financial Advisor selection is rejected');
  const founder = await api(baseUrl, '/api/v1/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'founder/admin' },
  });
  assert(
    founder.status === 403 && founder.body.error?.code === 'DEMO_ROLE_FORBIDDEN',
    'platform/internal role selection is rejected'
  );

  const platform = await api(baseUrl, '/api/v1/platform/companies', { token: exec!.token });
  assert(platform.status === 403 && platform.body.error?.code === 'DEMO_PLATFORM_FORBIDDEN', '/platform/* remains blocked');
  const register = await api(baseUrl, '/api/v1/auth/register', {
    method: 'POST',
    body: {
      firstName: 'Demo',
      lastName: 'Visitor',
      email: 'visitor@example.test',
      password: 'not-used-in-demo-1',
    },
  });
  assert(register.status === 403 && register.body.error?.code === 'DEMO_REGISTER_DISABLED', 'registration remains blocked');
  const login = await api(baseUrl, '/api/v1/auth/login', {
    method: 'POST',
    body: { email: 'admin@advisortrack.co.za', password: 'password' },
  });
  assert(login.status === 403 && login.body.error?.code === 'DEMO_LOGIN_DISABLED', 'password login remains blocked in demo');
  const pay = await api(baseUrl, '/api/v1/subscription/revenuecat/sync', {
    method: 'POST',
    token: tlDirect.body.data!.token,
    body: { productId: 'pro' },
  });
  assert(pay.status === 403 && pay.body.error?.code === 'DEMO_SIDE_EFFECT_BLOCKED', 'external payment writes remain blocked');

  const invalid = await api(baseUrl, '/api/v1/auth/me', { token: 'not-a-jwt' });
  assert(invalid.status === 401, 'invalid session returns the visitor to unauthenticated entry');

  if (databaseUrl) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`UPDATE demo_sessions SET status = 'expired' WHERE id = $1`, [rmDirect.body.data!.session.id]);
      const expired = await api(baseUrl, '/api/v1/auth/me', { token: rmDirect.body.data!.token });
      assert(expired.status === 401, 'expired session cannot be reused');
      await client.query(`UPDATE demo_sessions SET status = 'archived' WHERE id = $1`, [tlDirect.body.data!.session.id]);
      const archived = await api(baseUrl, '/api/v1/auth/me', { token: tlDirect.body.data!.token });
      assert(archived.status === 401, 'archived session cannot be reused');

      const before = await client.query(`SELECT COUNT(*)::int AS n FROM demo_sessions`);
      await client.query(
        `UPDATE demo_sessions SET status = 'expired' WHERE id = ANY($1::uuid[])`,
        [[exec!.session.id, rmDirect.body.data!.session.id, tlDirect.body.data!.session.id]]
      );
      await client.query(
        `UPDATE companies SET is_active = FALSE
         WHERE id = ANY($1::uuid[])`,
        [[exec!.session.companyId, rmDirect.body.data!.session.companyId, tlDirect.body.data!.session.companyId]]
      );
      const after = await client.query(`SELECT COUNT(*)::int AS n FROM demo_sessions`);
      assert(after.rows[0].n === before.rows[0].n, 'test cleanup archives/expires sessions rather than deleting them');
    } finally {
      await client.end();
    }
  }
}

async function main(): Promise<void> {
  console.log('Phase 11 verification\n');
  runUnitTests();
  runStaticChecks();
  if (process.env.SKIP_LIVE !== '1') {
    await runLiveRegression();
  } else {
    console.log('NOTE  skipping live/local process checks (SKIP_LIVE=1)');
  }

  const demoEnvPath = path.join(root, '.env.demo');
  const demoApiBase = process.env.DEMO_API_BASE?.replace(/\/$/, '');
  const demoDatabaseUrl = readEnvValue(demoEnvPath, 'DATABASE_URL');
  if (demoApiBase) {
    await runDemoHttpChecks(demoApiBase, demoDatabaseUrl);
  } else if (fs.existsSync(demoEnvPath)) {
    console.log('NOTE  local .env.demo is present but DEMO_API_BASE was not set; start the demo API to run HTTP checks');
  } else {
    console.log('NOTE  skipping demo HTTP suite (no DEMO_API_BASE / local .env.demo)');
  }

  if (process.env.ADVISORTRACK_ENV_FILE && process.env.SKIP_LIVE === '1') {
    const { sendMail } = await import('../src/services/emailService');
    const mail = await sendMail({
      to: 'nobody@example.test',
      subject: 'should not send',
      text: 'no',
      html: '<p>no</p>',
      category: 'Invoice',
    });
    assert(mail.ok === false, 'external email remains blocked');
    assert((mail.error || '').includes('public demo does not send email'), 'demo email block message is explicit');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
