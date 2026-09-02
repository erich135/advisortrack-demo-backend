/**
 * Pipeline drilldown / last-mobile-activity / Northstar enrichment gate.
 * Run: npm run test:pipeline-drilldown
 *
 * Demo SQL always reads DATABASE_URL from .env.demo.
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { DEMO_DATABASE_NAME, parseDatabaseUrl } from '../src/config/databaseSafety';
import {
  buildAttentionReasons,
  isMissingDocuments,
  isStalledOpenCase,
} from '../src/features/advisorAttention';
import { recordMobileActivity } from '../src/middleware/mobileActivity';
import { countNorthstarPeople, NORTHSTAR_ASSIGNED_LICENCES, NORTHSTAR_SEAT_LIMIT } from '../src/features/demoNorthstar';
import { PIPELINE_STAGES } from '../src/features/pipelineStages';

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

function readEnvValue(filePath: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const line = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

async function runStaticChecks(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const migration = fs.readFileSync(path.join(root, 'database/029_last_mobile_activity.sql'), 'utf8');
  assert(migration.includes('ADD COLUMN IF NOT EXISTS last_mobile_activity_at TIMESTAMPTZ'), '029 adds nullable timestamptz');
  assert(!/ALTER\s+TABLE[\s\S]{0,80}last_login_at/i.test(migration), '029 does not alter last_login_at');
  assert(!/DROP COLUMN/i.test(migration), '029 does not drop columns');
  assert(!/RENAME\s+(COLUMN|TABLE)/i.test(migration), '029 does not rename');
  assert(!/ALTER COLUMN/i.test(migration), '029 does not alter existing columns');

  const userRepo = fs.readFileSync(path.join(root, 'src/repositories/user.repository.ts'), 'utf8');
  const columnsBlock = userRepo.slice(userRepo.indexOf('const USER_COLUMNS'), userRepo.indexOf('const mapUserRow'));
  assert(!columnsBlock.includes('last_mobile_activity_at'), 'Android USER_COLUMNS omits last_mobile_activity_at');

  const androidRoutes = [
    'src/routes/contacts.routes.ts',
    'src/routes/activities.routes.ts',
    'src/routes/cases.routes.ts',
    'src/routes/dashboard.routes.ts',
    'src/routes/production.routes.ts',
    'src/routes/profile.routes.ts',
    'src/routes/planning.routes.ts',
  ];
  for (const file of androidRoutes) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert(source.includes('androidResourceAuth'), `${file} uses androidResourceAuth`);
  }

  const portalRoutes = [
    'src/routes/management.routes.ts',
    'src/routes/company.routes.ts',
    'src/routes/platform.routes.ts',
    'src/routes/subscription.routes.ts',
    'src/routes/demo.routes.ts',
  ];
  for (const file of portalRoutes) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!source.includes('recordMobileActivity'), `${file} does not record mobile activity`);
    assert(!source.includes('androidResourceAuth'), `${file} is not on androidResourceAuth`);
  }

  const stalled = isStalledOpenCase(
    { status: 'open', lastUpdatedAt: new Date(Date.now() - 8 * 86400000).toISOString() },
    new Date()
  );
  const fresh = isStalledOpenCase(
    { status: 'open', lastUpdatedAt: new Date().toISOString() },
    new Date()
  );
  assert(stalled && !fresh, 'stalled rule is open + 7 days');

  const missing = isMissingDocuments({
    status: 'open',
    fica: { idReceived: false, residenceReceived: true, bankReceived: true, skipAcknowledged: false },
    documents: { totalCount: 0, receivedCount: 0 },
  });
  assert(missing, 'incomplete FICA without skip counts as missing documents');

  const nullMobile = buildAttentionReasons({
    lastMobileActivityAt: null,
    stalledCount: 0,
    missingDocumentsCount: 0,
    noNextActionCount: 0,
  });
  assert(nullMobile.length === 0, 'null mobile activity is not Needs Attention inactivity');

  const clone = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspaceClone.ts'), 'utf8');
  assert(clone.includes('TRIGGER USER'), 'date-plan updates bypass updated_at triggers');
  assert(clone.includes("entity_type === 'user_mobile'"), 'clone remaps last mobile activity');
  assert(clone.includes("entity_type === 'case_document'"), 'clone remaps case document timestamps');
  const workspace = fs.readFileSync(path.join(root, 'src/repositories/demoWorkspace.repository.ts'), 'utf8');
  assert(workspace.includes('${localPart}.${visitorKey}@${domain}'), 'clone still stores unique visitor-suffixed emails');
  let nextCalled = false;
  await recordMobileActivity(
    { userId: 'not-a-uuid', userEmail: 'nobody@example.test' } as never,
    {} as never,
    () => {
      nextCalled = true;
    }
  );
  assert(nextCalled, 'telemetry failure still calls next()');
}

async function runDemoSqlChecks(): Promise<void> {
  const root = path.resolve(__dirname, '..');
  const demoEnvPath = path.join(root, '.env.demo');
  const fromFile = readEnvValue(demoEnvPath, 'DATABASE_URL');
  if (!fromFile) {
    console.log('NOTE  skipping demo SQL enrichment (.env.demo DATABASE_URL missing)');
    return;
  }
  const target = parseDatabaseUrl(fromFile);
  assert(target?.database === DEMO_DATABASE_NAME, `demo SQL targets ${DEMO_DATABASE_NAME}`);
  if (target?.database !== DEMO_DATABASE_NAME) return;

  const client = new pg.Client({ connectionString: fromFile });
  await client.connect();
  try {
    const identity = await client.query<{ db: string }>(`SELECT current_database() AS db`);
    assert(identity.rows[0]?.db === DEMO_DATABASE_NAME, 'connected to advisortrack_demo');

    const column = await client.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'last_mobile_activity_at'`
    );
    assert(column.rows[0]?.is_nullable === 'YES', 'runtime column is nullable');
    assert(column.rows[0]?.column_default === null, 'runtime column has no default');

    const template = await client.query<{ company_id: string; seed_version: number }>(
      `SELECT company_id, seed_version
       FROM demo_workspace_templates
       WHERE status = 'active'
       LIMIT 1`
    );
    if (!template.rows[0]) {
      console.log('NOTE  no active Northstar template yet; seed before enrichment assertions');
      return;
    }
    assert(template.rows[0].seed_version >= 13, 'active template is Phase 13+');
    const companyId = template.rows[0].company_id;
    const people = countNorthstarPeople();

    const ranks = await client.query<{ name: string; n: number }>(
      `SELECT r.name, COUNT(*)::int AS n
       FROM users u
       INNER JOIN company_roles r ON r.id = u.company_role_id
       WHERE u.company_id = $1
       GROUP BY r.name`,
      [companyId]
    );
    const byRole = Object.fromEntries(ranks.rows.map((row) => [row.name, row.n]));
    assert(byRole.Executive === people.executives, '1 Executive retained');
    assert(byRole['Regional Manager'] === people.regionalManagers, '3 Regional Managers retained');
    assert(byRole['Team Leader'] === people.teamLeaders, '9 Team Leaders retained');
    assert(byRole['Financial Advisor'] === people.advisors, '45 Financial Advisors retained');

    const structure = await client.query<{ regions: number; teams: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM regions WHERE company_id = $1) AS regions,
         (SELECT COUNT(*)::int FROM teams WHERE company_id = $1) AS teams`,
      [companyId]
    );
    assert(structure.rows[0].regions === 3, '3 Regions retained');
    assert(structure.rows[0].teams === 9, '9 Teams retained');

    const cases = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM client_cases c
       INNER JOIN users u ON u.id = c.user_id
       WHERE u.company_id = $1`,
      [companyId]
    );
    assert(
      cases.rows[0].n >= 360 && cases.rows[0].n <= 450,
      `master cases are 360–450 (got ${cases.rows[0].n})`
    );

    const production = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM production_entries pe
       INNER JOIN users u ON u.id = pe.user_id
       WHERE u.company_id = $1`,
      [companyId]
    );
    assert(production.rows[0].n >= 300, `master production is 300+ (got ${production.rows[0].n})`);

    const licences = await client.query<{ assigned: number }>(
      `SELECT COUNT(*)::int AS assigned
       FROM users u
       INNER JOIN user_subscriptions us ON us.user_id = u.id
       INNER JOIN subscription_packages p ON p.id = us.package_id
       WHERE u.company_id = $1 AND us.status IN ('active','trialing') AND p.slug <> 'free'`,
      [companyId]
    );
    assert(licences.rows[0].assigned === NORTHSTAR_ASSIGNED_LICENCES, 'licensed seats remain 42');
    assert(NORTHSTAR_SEAT_LIMIT - NORTHSTAR_ASSIGNED_LICENCES === 8, 'available licences remain 8');

    const mobilePlans = await client.query<{ inactive: number; recent: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE bucket IN ('days_ago_3','days_ago_4','days_ago_5'))::int AS inactive,
         COUNT(*) FILTER (WHERE bucket IN ('hours_ago','yesterday','current_month'))::int AS recent
       FROM demo_seed_date_plan
       WHERE template_company_id = $1 AND entity_type = 'user_mobile'`,
      [companyId]
    );
    assert(mobilePlans.rows[0].inactive >= 3, `date-plan has 3+ inactive mobile buckets (got ${mobilePlans.rows[0].inactive})`);
    assert(mobilePlans.rows[0].recent >= 8, 'healthy/recent mobile advisors exist');

    const nullMobile = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM users u
       INNER JOIN company_roles r ON r.id = u.company_role_id
       WHERE u.company_id = $1
         AND r.name = 'Financial Advisor'
         AND NOT EXISTS (
           SELECT 1 FROM demo_seed_date_plan p
           WHERE p.template_company_id = $1
             AND p.entity_type = 'user_mobile'
             AND p.template_row_id = u.id
         )`,
      [companyId]
    );
    assert(nullMobile.rows[0].n >= 1, 'at least one FA has no mobile date-plan (null activity)');

    const stages = await client.query<{ n: number }>(
      `SELECT COUNT(DISTINCT c.current_stage)::int AS n
       FROM client_cases c
       INNER JOIN users u ON u.id = c.user_id
       WHERE u.company_id = $1`,
      [companyId]
    );
    assert(stages.rows[0].n === PIPELINE_STAGES.length, 'all canonical stages are represented');

    const stalledPlan = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM demo_seed_date_plan
       WHERE template_company_id = $1
         AND entity_type = 'case'
         AND bucket IN ('stale_7','stale_14')`,
      [companyId]
    );
    assert(stalledPlan.rows[0].n >= 1, 'stalled-case date-plan rows exist');

    const missingDocs = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM client_cases c
       INNER JOIN users u ON u.id = c.user_id
       WHERE u.company_id = $1
         AND c.status = 'open'
         AND (
           (NOT c.fica_skip_acknowledged AND (NOT c.fica_id_received OR NOT c.fica_residence_received OR NOT c.fica_bank_received))
           OR EXISTS (
             SELECT 1 FROM case_documents d
             WHERE d.case_id = c.id
             GROUP BY d.case_id
             HAVING COUNT(*) FILTER (WHERE d.received_at IS NOT NULL) < COUNT(*)
           )
         )`,
      [companyId]
    );
    assert(missingDocs.rows[0].n >= 1, 'missing-document open cases exist');

    const teamScope = await client.query<{ teams: number; min_fas: number; min_cases: number }>(
      `SELECT
         COUNT(*)::int AS teams,
         MIN(fas)::int AS min_fas,
         MIN(cases)::int AS min_cases
       FROM (
         SELECT
           t.id,
           COUNT(DISTINCT fa.id)::int AS fas,
           COUNT(c.id)::int AS cases
         FROM teams t
         INNER JOIN users tl ON tl.id = t.leader_user_id
         INNER JOIN users fa ON fa.reports_to_user_id = tl.id
         INNER JOIN company_roles r ON r.id = fa.company_role_id AND r.name = 'Financial Advisor'
         LEFT JOIN client_cases c ON c.user_id = fa.id
         WHERE t.company_id = $1
         GROUP BY t.id
       ) team_scope`,
      [companyId]
    );
    assert(teamScope.rows[0].teams === 9, 'TL scope covers all 9 teams');
    assert(teamScope.rows[0].min_fas === 5, 'each Team Leader has 5 Financial Advisors');
    assert((teamScope.rows[0].min_cases ?? 0) >= 25, 'each Team Leader scope has enough cases for Team Pipeline');

    const rmScope = await client.query<{ rms: number; min_fas: number; min_cases: number }>(
      `SELECT
         COUNT(*)::int AS rms,
         MIN(fas)::int AS min_fas,
         MIN(cases)::int AS min_cases
       FROM (
         SELECT
           rm.id,
           COUNT(DISTINCT fa.id)::int AS fas,
           COUNT(c.id)::int AS cases
         FROM users rm
         INNER JOIN company_roles rm_role ON rm_role.id = rm.company_role_id AND rm_role.name = 'Regional Manager'
         INNER JOIN users tl ON tl.reports_to_user_id = rm.id
         INNER JOIN users fa ON fa.reports_to_user_id = tl.id
         INNER JOIN company_roles fa_role ON fa_role.id = fa.company_role_id AND fa_role.name = 'Financial Advisor'
         LEFT JOIN client_cases c ON c.user_id = fa.id
         WHERE rm.company_id = $1
         GROUP BY rm.id
       ) rm_scope`,
      [companyId]
    );
    assert(rmScope.rows[0].rms === 3, 'RM scope covers all 3 Regional Managers');
    assert(rmScope.rows[0].min_fas === 15, 'each Regional Manager has 15 Financial Advisors');
    assert((rmScope.rows[0].min_cases ?? 0) >= 90, 'each Regional Manager scope is populated');
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  console.log('Demo pipeline drilldown / Northstar enrichment\n');
  await runStaticChecks();
  await runDemoSqlChecks();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
