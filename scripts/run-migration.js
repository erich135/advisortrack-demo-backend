#!/usr/bin/env node
/**
 * Runs a single SQL migration file against DATABASE_URL.
 * Usage: npm run db:migrate -- database/012_johan_pipeline.sql
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pg = require('pg');
const {
  ensureMigrationsTable,
  markMigrationApplied,
  resolveMigrationPath,
} = require('./migration-utils');

const migrationArg = process.argv[2] || 'database/003_migrate_financial_profile.sql';
const filename = path.basename(migrationArg);
const filePath = resolveMigrationPath(filename);

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, 'utf8');
  console.log(`Running migration: ${filename}`);

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    await client.query(sql);
    await markMigrationApplied(client, filename);
    console.log('Migration completed successfully.');
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
