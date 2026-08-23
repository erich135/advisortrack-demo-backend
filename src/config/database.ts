import pg from 'pg';
import { env } from './env';

const { Pool } = pg;

export interface DatabaseStatus {
  connected: boolean;
  message: string;
  database?: string;
  user?: string;
  host?: string;
  detail?: string;
}

let pool: pg.Pool | null = null;
let lastStatus: DatabaseStatus = {
  connected: false,
  message: 'Database not checked yet',
};

/**
 * Returns a safe label for logs (never includes credentials).
 */
const getConnectionLabel = (connectionString: string): string => {
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, '') || 'unknown';
    const host = url.hostname + (url.port ? `:${url.port}` : '');
    return `${db} @ ${host}`;
  } catch {
    return 'invalid DATABASE_URL format';
  }
};

/**
 * Warns when special characters in the password may break URL parsing.
 */
const warnIfMalformedDatabaseUrl = (connectionString: string): void => {
  const withoutScheme = connectionString.replace(/^postgresql:\/\//, '');
  const atCount = (withoutScheme.match(/@/g) ?? []).length;
  if (atCount > 1) {
    console.warn(
      '[database] DATABASE_URL may be malformed — encode @ in passwords as %40 (e.g. Abelcor%40001)'
    );
  }
};

/**
 * Returns the shared PostgreSQL pool (creates it on first use).
 */
export const getPool = (): pg.Pool => {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!pool) {
    pool = new Pool({
      connectionString: env.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
};

/**
 * Pings PostgreSQL and updates the cached connection status.
 */
export const checkDatabaseConnection = async (): Promise<DatabaseStatus> => {
  if (!env.databaseUrl) {
    lastStatus = {
      connected: false,
      message: 'DATABASE_URL not set — API is using in-memory data',
    };
    return lastStatus;
  }

  warnIfMalformedDatabaseUrl(env.databaseUrl);
  const label = getConnectionLabel(env.databaseUrl);

  try {
    const client = await getPool().connect();
    try {
      const result = await client.query<{ now: Date; db: string; db_user: string }>(
        'SELECT NOW() AS now, current_database() AS db, current_user AS db_user'
      );
      const row = result.rows[0];

      lastStatus = {
        connected: true,
        message: `Connected to PostgreSQL (${label})`,
        database: row?.db,
        user: row?.db_user,
        host: label.split(' @ ')[1],
      };
    } finally {
      client.release();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    lastStatus = {
      connected: false,
      message: `PostgreSQL connection failed (${label})`,
      detail,
    };
  }

  return lastStatus;
};

/**
 * Returns the most recent database connection status.
 */
export const getDatabaseStatus = (): DatabaseStatus => lastStatus;

/**
 * True when PostgreSQL is connected and should be used for persistence.
 */
export const isDatabaseActive = (): boolean =>
  Boolean(env.databaseUrl && lastStatus.connected);

/**
 * Closes the pool — used on graceful shutdown.
 */
export const closeDatabase = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

/**
 * Writes a clear database status line to the console on startup.
 */
export const logDatabaseStatus = (status: DatabaseStatus): void => {
  if (status.connected) {
    console.log(`[database] Connected — ${status.message}`);
    return;
  }

  console.warn(`[database] Not connected — ${status.message}`);
  if (status.detail) {
    console.warn(`[database] Reason: ${status.detail}`);
  }
};
