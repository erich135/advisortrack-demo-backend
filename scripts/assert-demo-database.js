/**
 * Fail-closed demo-backend database guard for Node scripts.
 * Keep in sync with src/config/databaseSafety.ts. Never logs passwords.
 */
const DEMO_DATABASE_NAME = 'advisortrack_demo';
const DEMO_USERS = new Set(['advisortrack_demo', 'advisortrack_demo_dev']);
const DEMO_HOSTS = new Set(['127.0.0.1', 'localhost']);
const FORBIDDEN_DATABASES = new Set(['advisor_track', 'advisortrack_local']);
const PRODUCTION_USERS = new Set(['advisortrack']);

const parseDatabaseUrl = (connectionString) => {
  if (!connectionString || !String(connectionString).trim()) return null;
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')).split('/')[0] || '';
    return {
      database,
      user: decodeURIComponent(url.username || ''),
      host: url.hostname,
      port: url.port || '5432',
    };
  } catch {
    return null;
  }
};

const describeTarget = (target) =>
  `${target.database} as ${target.user || '(unknown-user)'} @ ${target.host}:${target.port}`;

const assertDemoDatabaseUrl = (connectionString) => {
  if (!connectionString || !String(connectionString).trim()) {
    throw new Error(
      'FATAL demo isolation: DATABASE_URL is required for advisortrack_demo. Refusing to continue.'
    );
  }
  const target = parseDatabaseUrl(connectionString);
  if (!target?.database) {
    throw new Error('FATAL demo isolation: DATABASE_URL could not be parsed. Refusing to continue.');
  }
  if (FORBIDDEN_DATABASES.has(target.database)) {
    throw new Error(
      `FATAL demo isolation: this demo backend cannot use database "${target.database}" (configured ${describeTarget(target)}). Refusing to continue.`
    );
  }
  if (PRODUCTION_USERS.has(target.user)) {
    throw new Error(
      `FATAL demo isolation: this demo backend cannot use production database user "${target.user}". Refusing to continue.`
    );
  }
  if (target.database !== DEMO_DATABASE_NAME) {
    throw new Error(
      `FATAL demo isolation: must use database "${DEMO_DATABASE_NAME}" (configured ${describeTarget(target)}). Refusing to continue.`
    );
  }
  if (target.user && !DEMO_USERS.has(target.user)) {
    throw new Error(
      `FATAL demo isolation: must use a dedicated demo database user (configured ${describeTarget(target)}). Refusing to continue.`
    );
  }
  if (target.host && !DEMO_HOSTS.has(target.host)) {
    throw new Error(
      `FATAL demo isolation: must use a local PostgreSQL host (configured ${describeTarget(target)}). Refusing to continue.`
    );
  }
  return target;
};

const assertConnectedDemoDatabase = (database, user) => {
  const liveName = String(database || '').trim();
  if (FORBIDDEN_DATABASES.has(liveName)) {
    throw new Error(
      `FATAL demo isolation: connected database is "${liveName}". This demo backend cannot use production or production-development databases.`
    );
  }
  if (liveName !== DEMO_DATABASE_NAME) {
    throw new Error(
      `FATAL demo isolation: connected database is "${liveName || '(unknown)'}", expected "${DEMO_DATABASE_NAME}".`
    );
  }
  if (user && !DEMO_USERS.has(user)) {
    throw new Error(
      `FATAL demo isolation: connected as "${user}", expected a dedicated demo database user.`
    );
  }
};

module.exports = {
  DEMO_DATABASE_NAME,
  FORBIDDEN_DATABASES,
  parseDatabaseUrl,
  assertDemoDatabaseUrl,
  assertConnectedDemoDatabase,
};
