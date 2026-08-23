#!/usr/bin/env node
/**
 * Wipes advisor data (keeps packages, companies, roles, migrations) and seeds
 * the Android test account: developer@advisortrack.co.za (verified + Standard).
 *
 * Usage (from advisor_track_backend):
 *   npm run db:reset-tester
 */
require('dotenv').config();
const pg = require('pg');
const bcrypt = require('bcryptjs');

const TEST_EMAIL = 'developer@advisortrack.co.za';
const TEST_PASSWORD = 'AdvisorTrack@001!';

/**
 * Removes user-owned rows. Companies, roles, packages, and schema_migrations stay.
 */
const wipeUserData = async (client) => {
  await client.query('TRUNCATE TABLE users CASCADE');
  await client.query('TRUNCATE TABLE popia_audit_log CASCADE').catch(() => undefined);
};

/**
 * Inserts the verified, Standard, platform-admin tester under AdvisorTrack.
 */
const seedTester = async (client, passwordHash) => {
  const inserted = await client.query(
    `INSERT INTO users (
       first_name, last_name, email, password_hash, role,
       email_verified_at, is_platform_admin, company_id, company_role_id
     )
     SELECT
       'Developer',
       'Android',
       $1,
       $2,
       'Financial Advisor',
       NOW(),
       TRUE,
       c.id,
       r.id
     FROM companies c
     JOIN company_roles r ON r.company_id = c.id AND r.name = 'Company admin'
     WHERE c.slug = 'advisortrack'
     RETURNING id, email`,
    [TEST_EMAIL, passwordHash]
  );

  if (!inserted.rows[0]) {
    throw new Error('Could not insert tester — run migrations first (023_companies_roles.sql).');
  }

  const userId = inserted.rows[0].id;

  await client.query(
    `INSERT INTO user_subscriptions (user_id, package_id, status, current_period_end)
     SELECT $1, p.id, 'active', NOW() + INTERVAL '1 year'
     FROM subscription_packages p
     WHERE p.slug = 'pro'
     ON CONFLICT (user_id) DO UPDATE SET
       package_id = EXCLUDED.package_id,
       status = 'active',
       current_period_end = EXCLUDED.current_period_end,
       updated_at = NOW()`,
    [userId]
  );

  return inserted.rows[0];
};

const run = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');
    await wipeUserData(client);
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const user = await seedTester(client, passwordHash);
    await client.query('COMMIT');

    console.log('Database wiped (user data only).');
    console.log('Tester created:');
    console.log(`  id:       ${user.id}`);
    console.log(`  email:    ${TEST_EMAIL}`);
    console.log('  password: AdvisorTrack@001!');
    console.log('  verified: yes');
    console.log('  plan:     Advisor Standard (pro)');
    console.log('  access:   Company admin + platform admin');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error.message || error);
    process.exit(1);
  } finally {
    await client.end();
  }
};

run();
