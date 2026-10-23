/**
 * Loads the canonical demo env file, then fail-closed isolation.
 * Prefers .env.demo unless ADVISORTRACK_ENV_FILE is set or DATABASE_URL is already in the process environment.
 * Does not print secrets.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { assertDemoDatabaseUrl } = require('./assert-demo-database');

const resolveEnvFile = () => {
  if (process.env.ADVISORTRACK_ENV_FILE) {
    return path.resolve(process.env.ADVISORTRACK_ENV_FILE);
  }
  const demoFile = path.resolve(process.cwd(), '.env.demo');
  if (!process.env.DATABASE_URL && fs.existsSync(demoFile)) {
    return demoFile;
  }
  return path.resolve(process.cwd(), '.env');
};

const envFile = resolveEnvFile();

if (process.env.ADVISORTRACK_ENV_FILE && !fs.existsSync(envFile)) {
  console.error(`ADVISORTRACK_ENV_FILE does not exist: ${envFile}`);
  process.exit(1);
}

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: Boolean(process.env.ADVISORTRACK_ENV_FILE) });
} else {
  dotenv.config();
}

try {
  assertDemoDatabaseUrl(process.env.DATABASE_URL);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
