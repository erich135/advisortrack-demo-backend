/**
 * Phase 10 verification: public demo isolation foundation.
 * Run from Abel Backend: npm run test:phase10
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import pg from 'pg';
import {
  assertConfiguredDatabaseForMode,
  DEMO_DATABASE_NAME,
  DEMO_DATABASE_LOCAL_USER,
  DEMO_DATABASE_USER,
  isAllowedDemoDatabaseUser,
  parseDatabaseUrl,
} from '../src/config/databaseSafety';

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

function expectThrow(fn: () => unknown, needle: string, message: string): void {
  try {
    fn();
    assert(false, `${message} (no throw)`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert(text.includes(needle), message);
  }
}

const root = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(
  __dirname,
  '../../../_Old-And-Other-Apps/AdvisorTrack/AdvisorTrack Frontend'
);

function bootEnv(extra: NodeJS.ProcessEnv): { status: number | null; output: string } {
  const result = spawnSync('npx', ['tsx', 'scripts/boot-env.ts'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, ...extra },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  };
}

function runUnitTests(): void {
  const parsed = parseDatabaseUrl('postgresql://advisortrack:secret@127.0.0.1:5432/advisor_track');
  assert(parsed?.database === 'advisor_track', 'parses production database name without exposing password');
  assert(parsed?.user === 'advisortrack', 'parses production database user');

  expectThrow(
    () =>
      assertConfiguredDatabaseForMode(
        'demo',
        'postgresql://advisortrack:secret@127.0.0.1:5432/advisor_track'
      ),
    'advisortrack_demo',
    'demo mode rejects advisor_track'
  );
  expectThrow(
    () =>
      assertConfiguredDatabaseForMode(
        'demo',
        'postgresql://advisortrack_dev:secret@localhost:5432/advisortrack_local'
      ),
    'advisortrack_demo',
    'demo mode rejects advisortrack_local'
  );
  expectThrow(
    () => assertConfiguredDatabaseForMode('demo', undefined),
    'requires DATABASE_URL',
    'demo mode refuses missing DATABASE_URL'
  );
  expectThrow(
    () =>
      assertConfiguredDatabaseForMode(
        'live',
        `postgresql://${DEMO_DATABASE_USER}:secret@127.0.0.1:5432/${DEMO_DATABASE_NAME}`
      ),
    'demo database',
    'live mode rejects advisortrack_demo'
  );

  const okDemo = assertConfiguredDatabaseForMode(
    'demo',
    `postgresql://${DEMO_DATABASE_USER}:secret@127.0.0.1:5432/${DEMO_DATABASE_NAME}`
  );
  assert(okDemo.database === DEMO_DATABASE_NAME, 'demo mode accepts advisortrack_demo');

  const okLocalDemo = assertConfiguredDatabaseForMode(
    'demo',
    `postgresql://${DEMO_DATABASE_LOCAL_USER}:secret@127.0.0.1:5432/${DEMO_DATABASE_NAME}`
  );
  assert(okLocalDemo.user === DEMO_DATABASE_LOCAL_USER, 'demo mode accepts local advisortrack_demo_dev');

  expectThrow(
    () =>
      assertConfiguredDatabaseForMode(
        'demo',
        `postgresql://${DEMO_DATABASE_USER}:secret@100.52.251.213:5432/${DEMO_DATABASE_NAME}`
      ),
    'local PostgreSQL host',
    'demo mode rejects a remote AWS PostgreSQL host'
  );
  expectThrow(
    () =>
      assertConfiguredDatabaseForMode(
        'demo',
        `postgresql://advisortrack_dev:secret@127.0.0.1:5432/${DEMO_DATABASE_NAME}`
      ),
    'database user',
    'demo mode rejects advisortrack_dev'
  );

  const okLive = assertConfiguredDatabaseForMode(
    'live',
    'postgresql://advisortrack_dev:secret@localhost:5432/advisortrack_local'
  );
  assert(okLive.database === 'advisortrack_local', 'live mode accepts advisortrack_local');

  expectThrow(
    () =>
      assertConfiguredDatabaseForMode(
        'live',
        `postgresql://${DEMO_DATABASE_LOCAL_USER}:secret@127.0.0.1:5432/${DEMO_DATABASE_NAME}`
      ),
    'demo database',
    'live mode rejects advisortrack_demo with the local demo user'
  );
}

function runBootGuardTests(): void {
  const rejectProd = bootEnv({
    ADVISORTRACK_MODE: 'demo',
    DATABASE_URL: 'postgresql://advisortrack:not-a-secret@127.0.0.1:5432/advisor_track',
    JWT_SECRET: 'phase10-demo-guard-secret',
  });
  assert(rejectProd.status !== 0, 'demo startup process exits when pointed at advisor_track');
  assert(
    rejectProd.output.includes('FATAL demo isolation'),
    'demo startup logs an obvious isolation failure for production DB'
  );

  const rejectLocal = bootEnv({
    ADVISORTRACK_MODE: 'demo',
    DATABASE_URL: 'postgresql://advisortrack_dev:not-a-secret@localhost:5432/advisortrack_local',
    JWT_SECRET: 'phase10-demo-guard-secret',
  });
  assert(rejectLocal.status !== 0, 'demo startup process exits when pointed at advisortrack_local');

  const rejectLiveDemo = bootEnv({
    ADVISORTRACK_MODE: 'live',
    DATABASE_URL: `postgresql://${DEMO_DATABASE_USER}:not-a-secret@127.0.0.1:5432/${DEMO_DATABASE_NAME}`,
    JWT_SECRET: 'phase10-demo-guard-secret',
  });
  assert(rejectLiveDemo.status !== 0, 'live startup process exits when pointed at advisortrack_demo');
}

function runStaticIsolationChecks(): void {
  const srcDir = path.join(root, 'src');
  const walk = (dir: string, acc: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, acc);
      else if (/\.(ts|js)$/.test(entry.name)) acc.push(full);
    }
    return acc;
  };
  const hits = walk(srcDir).filter((file) =>
    /DELETE\s+FROM\s+demo_sessions\b/i.test(fs.readFileSync(file, 'utf8'))
  );
  assert(hits.length === 0, 'no demo_sessions hard-delete path in backend src');

  const nginxDemo = fs.readFileSync(
    path.join(root, 'deploy/nginx-demo.advisortrack.co.za.conf'),
    'utf8'
  );
  assert(nginxDemo.includes('server_name demo.advisortrack.co.za'), 'demo nginx config uses demo hostname');
  assert(nginxDemo.includes('127.0.0.1:3001'), 'demo nginx proxies to loopback 3001');
  assert(!/server_name\s+api\.advisortrack\.co\.za/.test(nginxDemo), 'demo nginx does not serve the production API hostname');
  assert(!nginxDemo.includes('127.0.0.1:3000'), 'demo nginx does not proxy to the production API port');

  const nginxApi = fs.readFileSync(path.join(root, 'deploy/nginx-api.advisortrack.co.za.conf'), 'utf8');
  assert(nginxApi.includes('server_name api.advisortrack.co.za'), 'production API nginx hostname unchanged in repo');
  assert(nginxApi.includes('127.0.0.1:3000'), 'production API still proxies to 3000 in repo config');

  const eco = fs.readFileSync(path.join(root, 'deploy/ecosystem.config.cjs'), 'utf8');
  assert(eco.includes("name: 'advisortrack-api'"), 'production PM2 process name unchanged');
  assert(!eco.includes('advisortrack-demo-api'), 'production PM2 file does not start the demo process');

  const ecoDemo = fs.readFileSync(path.join(root, 'deploy/ecosystem-demo.config.cjs'), 'utf8');
  assert(ecoDemo.includes("name: 'advisortrack-demo-api'"), 'demo PM2 process is advisortrack-demo-api');
  assert(ecoDemo.includes('ADVISORTRACK_MODE: \'demo\''), 'demo PM2 sets ADVISORTRACK_MODE=demo');

  const authServiceSrc = fs.readFileSync(path.join(srcDir, 'services/index.ts'), 'utf8');
  assert(
    authServiceSrc.includes('assertDemoSelfServeRegistrationAllowed'),
    'self-serve register is gated in AuthService for demo mode'
  );
  const subRoutes = fs.readFileSync(path.join(srcDir, 'routes/subscription.routes.ts'), 'utf8');
  assert(subRoutes.includes("assertDemoExternalWriteAllowed('payment/subscription select')"), 'demo blocks subscription select');
  assert(subRoutes.includes("assertDemoExternalWriteAllowed('payment/grace simulation')"), 'demo blocks payment grace simulation');

  const frontendEnv = fs.readFileSync(path.join(frontendRoot, '.env.demo'), 'utf8');
  assert(frontendEnv.includes('VITE_API_BASE_URL=/api/v1'), 'demo frontend calls same-origin /api/v1');
  assert(!/api\.advisortrack\.co\.za/.test(frontendEnv), 'demo frontend env does not point at production API');
  assert(frontendEnv.includes('VITE_ADVISORTRACK_MODE=demo'), 'demo frontend mode is explicit');

  const apiClientSrc = fs.readFileSync(path.join(frontendRoot, 'src/api/apiClient.ts'), 'utf8');
  assert(apiClientSrc.includes("isDemoBuild"), 'demo frontend uses an explicit demo API base branch');
  assert(
    apiClientSrc.includes("must not call an absolute API URL"),
    'demo frontend refuses absolute (cross-origin) API URLs'
  );
}

async function runDatabaseAndHttpTests(): Promise<void> {
  require('dotenv').config({ path: path.join(root, '.env') });
  const liveUrl = process.env.DATABASE_URL;
  if (!liveUrl) {
    throw new Error('Local .env DATABASE_URL is required for isolation comparison');
  }
  const liveParsed = parseDatabaseUrl(liveUrl);
  assert(liveParsed?.database !== DEMO_DATABASE_NAME, 'local live DATABASE_URL is not advisortrack_demo');

  const live = new pg.Client({ connectionString: liveUrl });
  await live.connect();
  let liveUsersBefore = 0;
  try {
    const count = await live.query('SELECT COUNT(*)::int AS n FROM users');
    liveUsersBefore = count.rows[0].n;
    assert(liveParsed?.database === 'advisortrack_local' || liveParsed?.database === 'advisor_track', 'live test DB is the local/production-style database');
  } finally {
    await live.end();
  }

  const demoEnvPath = path.join(root, '.env.demo');
  if (!fs.existsSync(demoEnvPath)) {
    console.log(
      'NOTE  local .env.demo is absent (this machine cannot CREATE ROLE). Demo database checks continue on the AWS host.'
    );
    const { createApp } = await import('../src/app');
    const { env } = await import('../src/config/env');
    assert(env.appMode === 'live', 'test process remains in live mode');
    assert(!env.isDemoMode, 'live mode is unaffected when ADVISORTRACK_MODE is not demo');
    const app = await createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const liveHealth = await fetch(`http://127.0.0.1:${port}/health`);
    const liveBody = (await liveHealth.json()) as { data?: { mode?: string } };
    assert(liveBody.data?.mode === 'live', 'live health reports mode=live');
    const livePlatform = await fetch(`http://127.0.0.1:${port}/api/v1/platform/companies`);
    assert(livePlatform.status === 401, 'live /platform still requires auth rather than demo-block');
    server.close();
    const liveAfter = new pg.Client({ connectionString: liveUrl });
    await liveAfter.connect();
    try {
      const count = await liveAfter.query('SELECT COUNT(*)::int AS n FROM users');
      assert(count.rows[0].n === liveUsersBefore, 'live/local user count unchanged by demo setup');
    } finally {
      await liveAfter.end();
    }
    return;
  }
  const demoEnv = fs.readFileSync(demoEnvPath, 'utf8');
  assert(!demoEnv.includes('MAILTRAP_API_TOKEN=' + 'mt_'), 'demo env does not appear to copy a Mailtrap token');
  const demoUrlMatch = demoEnv.match(/^DATABASE_URL=(.+)$/m);
  const demoUrl = demoUrlMatch?.[1]?.trim();
  assert(Boolean(demoUrl), 'demo DATABASE_URL is present');
  const demoParsed = parseDatabaseUrl(demoUrl);
  assert(demoParsed?.database === DEMO_DATABASE_NAME, 'demo config resolves to advisortrack_demo');
  assert(
    Boolean(demoParsed?.user && isAllowedDemoDatabaseUser(demoParsed.user)),
    'demo config uses a dedicated demo database user'
  );
  assert(
    demoParsed?.host === '127.0.0.1' || demoParsed?.host === 'localhost',
    'demo config uses a local PostgreSQL host'
  );

  const demo = new pg.Client({ connectionString: demoUrl });
  await demo.connect();
  try {
    const identity = await demo.query('SELECT current_database() AS db, current_user AS db_user');
    assert(identity.rows[0].db === DEMO_DATABASE_NAME, 'demo DB connection succeeds as advisortrack_demo database');
    assert(
      isAllowedDemoDatabaseUser(identity.rows[0].db_user),
      'demo DB connection succeeds as a dedicated demo user'
    );

    const migrations = await demo.query(
      `SELECT filename FROM schema_migrations WHERE filename = ANY($1::text[])`,
      [[
        '024_trial_14_days.sql',
        '025_regions_and_teams.sql',
        '026_company_subscriptions.sql',
        '027_internal_invoicing.sql',
        '028_invoice_delivery_metadata.sql',
        'demo/001_demo_sessions.sql',
        'demo/002_demo_personas.sql',
        'demo/003_demo_outbox_and_date_plan.sql',
      ]]
    );
    const applied = new Set(migrations.rows.map((row: { filename: string }) => row.filename));
    for (const filename of [
      '024_trial_14_days.sql',
      '025_regions_and_teams.sql',
      '026_company_subscriptions.sql',
      '027_internal_invoicing.sql',
      '028_invoice_delivery_metadata.sql',
      'demo/001_demo_sessions.sql',
      'demo/002_demo_personas.sql',
      'demo/003_demo_outbox_and_date_plan.sql',
    ]) {
      assert(applied.has(filename), `demo schema includes ${filename}`);
    }

    const companies = await demo.query('SELECT name, slug, is_platform FROM companies');
    const customerLike = companies.rows.filter((row: { is_platform: boolean }) => !row.is_platform);
    assert(customerLike.some((row: { name: string }) => row.name === 'Northstar Advisory'), 'demo database includes Northstar Advisory');
    const templates = await demo.query(
      `SELECT status, seed_version FROM demo_workspace_templates WHERE status = 'active'`
    );
    assert(
      templates.rows.some((row: { seed_version: number }) => row.seed_version >= 12),
      'active Phase 12 Northstar master template is present'
    );

    const sessions = await demo.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'demo_sessions'
         AND column_name = ANY($1::text[])`,
      [['token_hash', 'company_id', 'created_at', 'expires_at', 'status', 'selected_role']]
    );
    assert(sessions.rows.length === 6, 'demo_sessions stores token, company, timestamps, status and role');
  } finally {
    await demo.end();
  }

  const liveAfter = new pg.Client({ connectionString: liveUrl });
  await liveAfter.connect();
  try {
    const count = await liveAfter.query('SELECT COUNT(*)::int AS n FROM users');
    assert(count.rows[0].n === liveUsersBefore, 'live/local user count unchanged by demo setup');
    const demoName = await liveAfter.query('SELECT current_database() AS db');
    assert(demoName.rows[0].db !== DEMO_DATABASE_NAME, 'live connection is still not advisortrack_demo');
  } finally {
    await liveAfter.end();
  }

  const { createApp } = await import('../src/app');
  const { env } = await import('../src/config/env');
  assert(env.appMode === 'live', 'test process remains in live mode');
  assert(!env.isDemoMode, 'live mode is unaffected when ADVISORTRACK_MODE is not demo');

  const app = await createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const liveHealth = await fetch(`http://127.0.0.1:${port}/health`);
  const liveBody = (await liveHealth.json()) as { data?: { mode?: string } };
  assert(liveBody.data?.mode === 'live', 'live health reports mode=live');
  const livePlatform = await fetch(`http://127.0.0.1:${port}/api/v1/platform/companies`);
  assert(livePlatform.status === 401, 'live /platform still requires auth rather than demo-block');
  server.close();

  const demoBoot = bootEnv({
    ADVISORTRACK_ENV_FILE: path.join(root, '.env.demo'),
    ADVISORTRACK_MODE: 'demo',
    PORT: '3011',
  });
  assert(demoBoot.status === 0, 'demo env boots when pointed at advisortrack_demo');
  assert(demoBoot.output.includes('BOOTED mode=demo'), 'demo boot reports mode=demo');
}

async function runDemoHttpAndSideEffects(): Promise<void> {
  const demoEnvPath = path.join(root, '.env.demo');
  if (!fs.existsSync(demoEnvPath)) {
    console.log('NOTE  skipping local demo HTTP/side-effect process (no local .env.demo)');
    return;
  }
  const child = spawnSync(
    'npx',
    ['tsx', 'scripts/verify-phase10-demo-http.ts'],
    {
      cwd: root,
      encoding: 'utf8',
      shell: true,
      timeout: 60000,
      env: {
        ...process.env,
        ADVISORTRACK_ENV_FILE: demoEnvPath,
        ADVISORTRACK_MODE: 'demo',
        PORT: '3012',
      },
    }
  );
  const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
  assert(child.status === 0, 'demo HTTP child process completed');
  assert(output.includes('DEMO_HTTP_OK'), 'demo HTTP checks passed');
  if (child.status !== 0 || !output.includes('DEMO_HTTP_OK')) {
    console.error(output);
  }
}

async function main(): Promise<void> {
  console.log('Phase 10 verification\n');
  runUnitTests();
  runStaticIsolationChecks();
  runBootGuardTests();
  await runDatabaseAndHttpTests();
  await runDemoHttpAndSideEffects();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
