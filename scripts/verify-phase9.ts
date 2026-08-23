/**
 * Phase 9 completion gate: identity, migrations 024–028, and no hard-delete of portal records.
 * Does not duplicate Phases 3–8 behavioural coverage. Run: npm run test:phase9
 */
import fs from 'fs';
import path from 'path';
import { checkDatabaseConnection, closeDatabase, getPool, isDatabaseActive } from '../src/config/database';
import { sendMail, setTestMailer } from '../src/services/emailService';

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

const REQUIRED_MIGRATIONS = [
  '024_trial_14_days.sql',
  '025_regions_and_teams.sql',
  '026_company_subscriptions.sql',
  '027_internal_invoicing.sql',
  '028_invoice_delivery_metadata.sql',
] as const;

const ANDROID_CORE_TABLES = ['users', 'companies', 'user_subscriptions', 'production_entries', 'contacts'];
const PORTAL_HISTORY_TABLES = [
  'invoices',
  'invoice_delivery_events',
  'invoice_status_events',
  'popia_audit_log',
  'regions',
  'teams',
  'company_subscriptions',
  'company_billing_profiles',
];

function resolveFrontendRoot(): string | null {
  const candidates = [
    process.env.ADVISORTRACK_FRONTEND_ROOT,
    path.resolve(__dirname, '../../../_Old-And-Other-Apps/AdvisorTrack/AdvisorTrack Frontend'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }
  return null;
}

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, acc);
    } else if (/\.(ts|js)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

async function runStaticChecks(): Promise<void> {
  const databaseDir = path.resolve(__dirname, '../database');
  const srcDir = path.resolve(__dirname, '../src');

  for (const filename of REQUIRED_MIGRATIONS) {
    const full = path.join(databaseDir, filename);
    assert(fs.existsSync(full), `migration file present: ${filename}`);
  }

  const recovered024 = fs.readFileSync(path.join(databaseDir, '024_trial_14_days.sql'), 'utf8');
  assert(recovered024.includes('trial_days'), '024 recovered file contains trial_days update');
  assert(!/DROP TABLE/i.test(recovered024), '024 does not drop tables');

  for (const filename of REQUIRED_MIGRATIONS) {
    const sql = fs.readFileSync(path.join(databaseDir, filename), 'utf8');
    for (const table of ANDROID_CORE_TABLES) {
      const drop = new RegExp(`DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?\\s+${table}\\b`, 'i');
      const dropCol = new RegExp(`ALTER\\s+TABLE\\s+${table}\\b[\\s\\S]{0,200}DROP\\s+COLUMN`, 'i');
      const rename = new RegExp(`ALTER\\s+TABLE\\s+${table}\\b[\\s\\S]{0,80}RENAME`, 'i');
      assert(!drop.test(sql), `${filename} does not drop Android table ${table}`);
      assert(!dropCol.test(sql), `${filename} does not drop columns on Android table ${table}`);
      assert(!rename.test(sql), `${filename} does not rename Android table ${table}`);
    }
  }

  const hardDelete = new RegExp(
    `DELETE\\s+FROM\\s+(${PORTAL_HISTORY_TABLES.join('|')})\\b`,
    'i'
  );
  const sourceHits = listSourceFiles(srcDir).filter((file) => hardDelete.test(fs.readFileSync(file, 'utf8')));
  assert(
    sourceHits.length === 0,
    sourceHits.length === 0
      ? 'backend src does not hard-delete invoices, audit, regions, teams or subscriptions'
      : `hard-delete found in ${sourceHits.map((file) => path.relative(srcDir, file)).join(', ')}`
  );

  const frontendRoot = resolveFrontendRoot();
  assert(Boolean(frontendRoot), 'AdvisorTrack Frontend project located');
  if (frontendRoot) {
    const pkg = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8')) as {
      description?: string;
    };
    assert(
      (pkg.description ?? '').includes('AdvisorTrack Management Portal'),
      'frontend package.json description is AdvisorTrack Management Portal'
    );
    assert(
      !(pkg.description ?? '').toLowerCase().includes('internal creation-team'),
      'frontend package.json is not described as an internal creation-team tool'
    );

    const indexHtml = fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8');
    assert(
      indexHtml.includes('<title>AdvisorTrack Management Portal</title>'),
      'browser title is AdvisorTrack Management Portal'
    );

    const login = fs.readFileSync(path.join(frontendRoot, 'src/pages/LoginPage.tsx'), 'utf8');
    assert(login.includes('Sign in with your AdvisorTrack account'), 'login copy is customer-facing');
    assert(!/internal (creation-team )?tool/i.test(login), 'login does not call itself an internal tool');
    assert(login.includes('Advisor Track (Pty) Ltd'), 'login copyright is present');

    const notFound = path.join(frontendRoot, 'src/pages/NotFoundPage.tsx');
    assert(fs.existsSync(notFound), '404 page is present');
  }
}

async function runRuntimeChecks(): Promise<void> {
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
    (unconfigured.error ?? '').includes('MAILTRAP_API_TOKEN') &&
      (unconfigured.error ?? '').includes('No message was sent') &&
      (unconfigured.error ?? '').includes('No external delivery'),
    'missing-token failure message is understandable'
  );

  const db = await checkDatabaseConnection();
  if (!db.connected || !isDatabaseActive()) {
    throw new Error(`Database not connected: ${db.message}`);
  }

  const pool = getPool();
  const applied = await pool.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations WHERE filename = ANY($1::text[])`,
    [REQUIRED_MIGRATIONS]
  );
  const appliedSet = new Set(applied.rows.map((row) => row.filename));
  for (const filename of REQUIRED_MIGRATIONS) {
    assert(appliedSet.has(filename), `schema_migrations records ${filename}`);
  }

  const deliveryCols = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'invoice_delivery_events'
       AND column_name = ANY($1::text[])`,
    [['provider_message_id', 'snapshot_ref']]
  );
  assert(deliveryCols.rows.length === 2, 'migration 028 columns exist on invoice_delivery_events');

  const seq = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'invoice_number_seq'
     ) AS exists`
  );
  assert(seq.rows[0]?.exists === true, 'invoice_number_seq exists for INV100000+ numbering');
}

async function main(): Promise<void> {
  console.log('Phase 9 completion gate\n');
  await runStaticChecks();
  await runRuntimeChecks();
  console.log(`\n${passed} passed, ${failed} failed`);
  await closeDatabase();
  if (failed > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await closeDatabase().catch(() => undefined);
  process.exit(1);
});
