/**
 * Shared helpers for SQL migration runners.
 */
const fs = require('fs');
const path = require('path');

const DATABASE_DIR = path.join(__dirname, '..', 'database');

/**
 * Ensures the schema_migrations ledger table exists.
 */
const ensureMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

/**
 * Returns migration filenames already recorded in schema_migrations.
 */
const getAppliedMigrations = async (client) => {
  const result = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(result.rows.map((row) => row.filename));
};

/**
 * Records a migration filename as successfully applied.
 */
const markMigrationApplied = async (client, filename) => {
  await client.query(
    `INSERT INTO schema_migrations (filename)
     VALUES ($1)
     ON CONFLICT (filename) DO NOTHING`,
    [filename]
  );
};

/**
 * Lists .sql migration files in database/ sorted by filename (001, 002, …).
 */
const listMigrationFiles = ({ includeSeed = false } = {}) => {
  const files = fs
    .readdirSync(DATABASE_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (includeSeed) {
    return files;
  }

  return files.filter((name) => name !== '002_seed.sql');
};

/**
 * Resolves a migration path relative to the backend root.
 */
const resolveMigrationPath = (filename) => path.join(DATABASE_DIR, filename);

module.exports = {
  DATABASE_DIR,
  ensureMigrationsTable,
  getAppliedMigrations,
  markMigrationApplied,
  listMigrationFiles,
  resolveMigrationPath,
};
