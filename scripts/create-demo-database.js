#!/usr/bin/env node
/**
 * Creates PostgreSQL role advisortrack_demo and database advisortrack_demo.
 * Uses the current .env only to reach the server (host/port/admin user).
 * Writes .env.demo and does not print secrets.
 *
 * Usage: node scripts/create-demo-database.js
 */
require('./load-dotenv');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const DEMO_DB = 'advisortrack_demo';
const DEMO_USER = 'advisortrack_demo';
const FORBIDDEN = new Set(['advisor_track', 'advisortrack_local']);

const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;
const quoteLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

const encodePwd = (password) => encodeURIComponent(password);

const main = async () => {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    console.error('DATABASE_URL is not set. Need a local/admin connection to create the demo database.');
    process.exit(1);
  }

  const parsed = new URL(adminUrl);
  const adminDb = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (FORBIDDEN.has(adminDb) && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    console.error('Refusing to use a remote production DATABASE_URL to create the demo database from this script.');
    process.exit(1);
  }

  parsed.pathname = '/postgres';
  const client = new pg.Client({ connectionString: parsed.toString() });
  const envDemoPath = path.resolve(process.cwd(), '.env.demo');
  const password = process.env.DEMO_DB_PASSWORD || crypto.randomBytes(24).toString('base64url');

  await client.connect();
  try {
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [DEMO_USER]);
    if (role.rowCount === 0) {
      await client.query(
        `CREATE ROLE ${quoteIdent(DEMO_USER)} LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`
      );
      console.log(`Created role ${DEMO_USER} (login only, no superuser).`);
    } else {
      console.log(`Role ${DEMO_USER} already exists. Password not rotated.`);
    }

    const db = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DEMO_DB]);
    if (db.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdent(DEMO_DB)}`);
      console.log(`Created database ${DEMO_DB}.`);
    } else {
      console.log(`Database ${DEMO_DB} already exists.`);
    }
  } finally {
    await client.end();
  }

  const demoAdminUrl = new URL(adminUrl);
  demoAdminUrl.pathname = `/${DEMO_DB}`;
  const demoAdmin = new pg.Client({ connectionString: demoAdminUrl.toString() });
  await demoAdmin.connect();
  try {
    await demoAdmin.query(`GRANT ALL ON SCHEMA public TO ${quoteIdent(DEMO_USER)}`);
    await demoAdmin.query(`ALTER SCHEMA public OWNER TO ${quoteIdent(DEMO_USER)}`);
  } finally {
    await demoAdmin.end();
  }

  const ownerClient = new pg.Client({ connectionString: parsed.toString() });
  await ownerClient.connect();
  try {
    await ownerClient.query(
      `ALTER DATABASE ${quoteIdent(DEMO_DB)} OWNER TO ${quoteIdent(DEMO_USER)}`
    );
    await ownerClient.query(`REVOKE ALL ON DATABASE ${quoteIdent(DEMO_DB)} FROM PUBLIC`);
    await ownerClient.query(
      `GRANT CONNECT, TEMPORARY ON DATABASE ${quoteIdent(DEMO_DB)} TO ${quoteIdent(DEMO_USER)}`
    );
    for (const name of ['advisor_track', 'advisortrack_local', 'postgres']) {
      try {
        await ownerClient.query(
          `REVOKE CONNECT ON DATABASE ${quoteIdent(name)} FROM ${quoteIdent(DEMO_USER)}`
        );
      } catch {
        // Database may not exist on this host.
      }
    }
  } finally {
    await ownerClient.end();
  }

  if (!fs.existsSync(envDemoPath)) {
    const jwtSecret = crypto.randomBytes(32).toString('base64url');
    const piiKey = crypto.randomBytes(32).toString('base64');
    const demoUrl = `postgresql://${DEMO_USER}:${encodePwd(password)}@${parsed.hostname}:${parsed.port || '5432'}/${DEMO_DB}`;
    const contents = [
      'ADVISORTRACK_MODE=demo',
      'NODE_ENV=development',
      'PORT=3001',
      `JWT_SECRET=${jwtSecret}`,
      'JWT_EXPIRES_IN=12h',
      'CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://demo.advisortrack.co.za',
      `DATABASE_URL=${demoUrl}`,
      `PII_ENCRYPTION_KEY=${piiKey}`,
      'POPIA_NOTICE_VERSION=2026-06',
      'MAILTRAP_API_TOKEN=',
      'MAIL_FROM_EMAIL=hello@advisortrack.co.za',
      'MAIL_FROM_NAME=AdvisorTrack',
      'APP_DEEP_LINK_SCHEME=advisortrack',
      '',
    ].join('\n');
    fs.writeFileSync(envDemoPath, contents, { encoding: 'utf8', mode: 0o600 });
    console.log('Wrote .env.demo (secrets not printed).');
  } else {
    console.log('.env.demo already exists and was not overwritten.');
  }

  console.log('Next: ADVISORTRACK_ENV_FILE=.env.demo npm run db:migrate:all');
  console.log('Then: ADVISORTRACK_ENV_FILE=.env.demo npm run db:migrate:demo');
};

main().catch((error) => {
  console.error('Failed to create demo database:', error.message);
  process.exit(1);
});
