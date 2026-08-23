#!/usr/bin/env node
/**
 * Runs all SQL migrations in database/ order, tracking progress in schema_migrations.
 * Skips files already applied. On failure, logs and continues (use --strict to stop).
 *
 * Usage:
 *   npm run db:migrate:all
 *   npm run db:migrate:all -- --strict
 *   npm run db:migrate:all -- --with-seed
 *   npm run db:migrate:all -- --from 011_practice_contacts_intro.sql
 */
require('./load-dotenv');
const fs = require('fs');
const pg = require('pg');
const {
  ensureMigrationsTable,
  getAppliedMigrations,
  markMigrationApplied,
  listMigrationFiles,
  resolveMigrationPath,
} = require('./migration-utils');

/**
 * Returns true when PostgreSQL reports objects that are already present.
 */
const isAlreadyAppliedError = (message) => {
  const lower = message.toLowerCase();
  return (
    lower.includes('already exists') ||
    lower.includes('duplicate key') ||
    lower.includes('duplicate object')
  );
};

/**
 * Parses CLI flags passed after `npm run db:migrate:all --`.
 */
const parseArgs = (argv) => {
  const options = {
    strict: false,
    withSeed: false,
    from: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--with-seed') {
      options.withSeed = true;
    } else if (arg === '--from') {
      options.from = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return options;
};

/**
 * Prints a short end-of-run summary for deploy logs.
 */
const printSummary = (results) => {
  const applied = results.filter((row) => row.status === 'applied');
  const skipped = results.filter((row) => row.status === 'skipped');
  const failed = results.filter((row) => row.status === 'failed');

  console.log('\n--- Migration summary ---');
  console.log(`Applied : ${applied.length}`);
  console.log(`Skipped : ${skipped.length} (already recorded)`);
  console.log(`Failed  : ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed migrations:');
    for (const row of failed) {
      console.log(`  - ${row.filename}: ${row.error}`);
    }
  }
};

const main = async () => {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const options = parseArgs(process.argv.slice(2));
  let files = listMigrationFiles({ includeSeed: options.withSeed });

  if (options.from) {
    const fromIndex = files.indexOf(options.from);
    if (fromIndex === -1) {
      console.error(`--from file not found in database/: ${options.from}`);
      process.exit(1);
    }
    files = files.slice(fromIndex);
    console.log(`Starting from ${options.from} (${files.length} file(s) remaining).`);
  }

  if (files.length === 0) {
    console.log('No migration files to run.');
    return;
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const results = [];

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    console.log(`Found ${files.length} migration file(s).`);
    if (!options.withSeed) {
      console.log('Skipping 002_seed.sql (dev demo data). Pass --with-seed to include it.');
    }

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`SKIP  ${filename} (already applied)`);
        results.push({ filename, status: 'skipped' });
        continue;
      }

      const filePath = resolveMigrationPath(filename);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`RUN   ${filename}`);
      try {
        await client.query(sql);
        await markMigrationApplied(client, filename);
        console.log(`OK    ${filename}`);
        results.push({ filename, status: 'applied' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isAlreadyAppliedError(message)) {
          await markMigrationApplied(client, filename);
          console.log(`OK    ${filename} (schema already present — recorded as applied)`);
          results.push({ filename, status: 'applied', note: 'already present' });
          continue;
        }

        console.error(`FAIL  ${filename}: ${message}`);
        results.push({ filename, status: 'failed', error: message });

        if (options.strict) {
          console.error('Stopping because --strict was set.');
          break;
        }

        console.log('Continuing to next migration…');
      }
    }

    printSummary(results);

    const failedCount = results.filter((row) => row.status === 'failed').length;
    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('Migration runner failed:', error.message);
  process.exit(1);
});
