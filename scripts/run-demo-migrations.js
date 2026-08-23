#!/usr/bin/env node
/**
 * Applies database/demo/*.sql to the current DATABASE_URL.
 * Refuses to run unless current_database() is advisortrack_demo.
 */
require('./load-dotenv');
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const {
  ensureMigrationsTable,
  getAppliedMigrations,
  markMigrationApplied,
} = require('./migration-utils');

const DEMO_DIR = path.join(__dirname, '..', 'database', 'demo');
const DEMO_DB = 'advisortrack_demo';

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const identity = await client.query(
      'SELECT current_database() AS db, current_user AS db_user'
    );
    const db = identity.rows[0].db;
    const dbUser = identity.rows[0].db_user;
    if (db !== DEMO_DB) {
      console.error(
        `Refusing demo migrations: connected to "${db}" as "${dbUser}", expected "${DEMO_DB}".`
      );
      process.exit(1);
    }

    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const files = fs
      .readdirSync(DEMO_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (files.length === 0) {
      console.log('No demo migrations found.');
      return;
    }

    for (const filename of files) {
      const recorded = `demo/${filename}`;
      if (applied.has(recorded)) {
        console.log(`SKIP  ${recorded} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(DEMO_DIR, filename), 'utf8');
      console.log(`RUN   ${recorded}`);
      await client.query(sql);
      await markMigrationApplied(client, recorded);
      console.log(`OK    ${recorded}`);
    }
  } finally {
    await client.end();
  }

  const { spawnSync } = require('child_process');
  console.log('RUN   northstar master seed');
  const seeded = spawnSync(process.execPath, [path.join(__dirname, 'run-northstar-seed.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
  if ((seeded.status ?? 1) !== 0) {
    process.exit(seeded.status ?? 1);
  }
};

main().catch((error) => {
  console.error('Demo migration runner failed:', error.message);
  process.exit(1);
});
