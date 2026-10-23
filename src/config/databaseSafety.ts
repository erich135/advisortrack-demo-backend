/**
 * Demo/live database isolation rules.
 * Pure functions so they can be tested without booting the HTTP server.
 */

export type AppMode = 'live' | 'demo';

export const DEMO_DATABASE_NAME = 'advisortrack_demo';
/** AWS / shared demo role name. */
export const DEMO_DATABASE_USER = 'advisortrack_demo';
/** Dedicated local development demo role. */
export const DEMO_DATABASE_LOCAL_USER = 'advisortrack_demo_dev';
export const DEMO_DATABASE_USERS = new Set([DEMO_DATABASE_USER, DEMO_DATABASE_LOCAL_USER]);

/** Demo PostgreSQL must be reached on loopback (local machine or same-host AWS demo). */
export const DEMO_ALLOWED_DATABASE_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Known production database name on the AdvisorTrack API host. */
export const PRODUCTION_DATABASE_NAMES = new Set(['advisor_track']);
export const PRODUCTION_DATABASE_USERS = new Set(['advisortrack']);

export const isAllowedDemoDatabaseUser = (user: string): boolean => DEMO_DATABASE_USERS.has(user);

export const DEMO_FORBIDDEN_DATABASE_NAMES = new Set([
  'advisor_track',
  'advisortrack_local',
]);
export const LIVE_FORBIDDEN_DATABASE_NAMES = new Set([DEMO_DATABASE_NAME]);

export type ParsedDatabaseTarget = {
  database: string;
  user: string;
  host: string;
  port: string;
};

/**
 * Parses DATABASE_URL into host/user/database without returning the password.
 */
export const parseDatabaseUrl = (connectionString: string | undefined): ParsedDatabaseTarget | null => {
  if (!connectionString?.trim()) return null;
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

const describeTarget = (target: ParsedDatabaseTarget): string =>
  `${target.database} as ${target.user || '(unknown-user)'} @ ${target.host}:${target.port}`;

/**
 * This repository is the demo backend. Production and local production-dev
 * databases are forbidden in every mode, including an accidental ADVISORTRACK_MODE=live.
 */
export const assertNotProductionDevelopmentDatabase = (target: ParsedDatabaseTarget): void => {
  if (DEMO_FORBIDDEN_DATABASE_NAMES.has(target.database) || PRODUCTION_DATABASE_NAMES.has(target.database)) {
    throw new Error(
      `FATAL demo isolation: this demo backend cannot use database "${target.database}" (configured ${describeTarget(target)}). Refusing to start.`
    );
  }
  if (PRODUCTION_DATABASE_USERS.has(target.user)) {
    throw new Error(
      `FATAL demo isolation: this demo backend cannot use production database user "${target.user}". Refusing to start.`
    );
  }
};

/**
 * Throws when demo/live mode is pointed at the wrong database.
 * Never includes the password in the error.
 */
export const assertConfiguredDatabaseForMode = (
  mode: AppMode,
  connectionString: string | undefined
): ParsedDatabaseTarget => {
  if (mode === 'demo') {
    if (!connectionString?.trim()) {
      throw new Error(
        'FATAL demo isolation: ADVISORTRACK_MODE=demo requires DATABASE_URL for advisortrack_demo. Refusing to start.'
      );
    }
    const target = parseDatabaseUrl(connectionString);
    if (!target?.database) {
      throw new Error(
        'FATAL demo isolation: DATABASE_URL could not be parsed. Refusing to start demo mode.'
      );
    }
    assertNotProductionDevelopmentDatabase(target);
    if (target.database !== DEMO_DATABASE_NAME) {
      throw new Error(
        `FATAL demo isolation: demo mode must use database "${DEMO_DATABASE_NAME}" (configured ${describeTarget(target)}). Refusing to start.`
      );
    }
    if (PRODUCTION_DATABASE_USERS.has(target.user)) {
      throw new Error(
        `FATAL demo isolation: demo mode cannot use production database user "${target.user}". Refusing to start.`
      );
    }
    if (target.user && !isAllowedDemoDatabaseUser(target.user)) {
      throw new Error(
        `FATAL demo isolation: demo mode must use database user "${DEMO_DATABASE_USER}" or "${DEMO_DATABASE_LOCAL_USER}" (configured ${describeTarget(target)}). Refusing to start.`
      );
    }
    if (target.host && !DEMO_ALLOWED_DATABASE_HOSTS.has(target.host)) {
      throw new Error(
        `FATAL demo isolation: demo mode must use a local PostgreSQL host (configured ${describeTarget(target)}). Refusing to start.`
      );
    }
    return target;
  }

  // This repository is the demo backend. ADVISORTRACK_MODE=live must still
  // use advisortrack_demo — never production or production-development DBs.
  if (!connectionString?.trim()) {
    throw new Error(
      'FATAL demo isolation: DATABASE_URL is required for advisortrack_demo. Refusing to start.'
    );
  }
  const target = parseDatabaseUrl(connectionString);
  if (!target?.database) {
    throw new Error(
      'FATAL demo isolation: DATABASE_URL could not be parsed. Refusing to start.'
    );
  }
  assertNotProductionDevelopmentDatabase(target);
  if (target.database !== DEMO_DATABASE_NAME) {
    throw new Error(
      `FATAL demo isolation: this demo backend must use database "${DEMO_DATABASE_NAME}" (configured ${describeTarget(target)}). Refusing to start.`
    );
  }
  if (target.user && !isAllowedDemoDatabaseUser(target.user)) {
    throw new Error(
      `FATAL demo isolation: this demo backend must use database user "${DEMO_DATABASE_USER}" or "${DEMO_DATABASE_LOCAL_USER}" (configured ${describeTarget(target)}). Refusing to start.`
    );
  }
  if (target.host && !DEMO_ALLOWED_DATABASE_HOSTS.has(target.host)) {
    throw new Error(
      `FATAL demo isolation: this demo backend must use a local PostgreSQL host (configured ${describeTarget(target)}). Refusing to start.`
    );
  }
  return target;
};

/**
 * Confirms the live PostgreSQL current_database() matches the configured mode.
 */
export const assertConnectedDatabaseForMode = (
  _mode: AppMode,
  configured: ParsedDatabaseTarget,
  connectedDatabase: string | undefined,
  connectedUser?: string
): void => {
  const liveName = (connectedDatabase ?? '').trim();
  if (DEMO_FORBIDDEN_DATABASE_NAMES.has(liveName) || PRODUCTION_DATABASE_NAMES.has(liveName)) {
    throw new Error(
      `FATAL demo isolation: connected database is "${liveName}". This demo backend cannot use production or production-development databases. Refusing to start.`
    );
  }
  if (liveName !== DEMO_DATABASE_NAME) {
    throw new Error(
      `FATAL demo isolation: connected database is "${liveName || '(unknown)'}", expected "${DEMO_DATABASE_NAME}". Refusing to start.`
    );
  }
  if (connectedUser && !isAllowedDemoDatabaseUser(connectedUser)) {
    throw new Error(
      `FATAL demo isolation: connected as "${connectedUser}", expected "${DEMO_DATABASE_USER}" or "${DEMO_DATABASE_LOCAL_USER}". Refusing to start.`
    );
  }
  if (configured.database && configured.database !== liveName) {
    throw new Error(
      `FATAL demo isolation: DATABASE_URL database "${configured.database}" does not match connected "${liveName}". Refusing to start.`
    );
  }
};
