#!/usr/bin/env node
/**
 * Creates the advisor_track database if it does not exist.
 * Connects to the default "postgres" database using DATABASE_URL credentials.
 *
 * Usage: npm run db:create
 */
require('./load-dotenv');
const pg = require('pg');

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '') || 'advisor_track';
  parsed.pathname = '/postgres';

  const adminUrl = parsed.toString();
  console.log(`Connecting to PostgreSQL at ${parsed.hostname}:${parsed.port || 5432}...`);

  const client = new pg.Client({ connectionString: adminUrl });

  try {
    await client.connect();

    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);

    if (exists.rowCount > 0) {
      console.log(`Database "${dbName}" already exists.`);
      return;
    }

    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Database "${dbName}" created successfully.`);
    console.log(`Next: run database/001_init.sql in pgAdmin Query Tool (or npm run db:init if psql is installed).`);
  } catch (error) {
    console.error('Failed to create database:', error.message);
    if (error.message.includes('password authentication failed')) {
      console.error('Check postgres username/password in DATABASE_URL.');
    }
    if (String(error.message).includes('@')) {
      console.error('If your password contains @, encode it as %40 in DATABASE_URL.');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
};

main();
