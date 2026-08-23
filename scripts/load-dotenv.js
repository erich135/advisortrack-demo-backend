/**
 * Loads env from ADVISORTRACK_ENV_FILE when set, otherwise .env in the process cwd.
 * Does not override variables already present in the process environment.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envFile = process.env.ADVISORTRACK_ENV_FILE
  ? path.resolve(process.env.ADVISORTRACK_ENV_FILE)
  : path.resolve(process.cwd(), '.env');

if (process.env.ADVISORTRACK_ENV_FILE && !fs.existsSync(envFile)) {
  console.error(`ADVISORTRACK_ENV_FILE does not exist: ${envFile}`);
  process.exit(1);
}

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: Boolean(process.env.ADVISORTRACK_ENV_FILE) });
} else {
  dotenv.config();
}
