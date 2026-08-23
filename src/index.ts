import { createApp } from './app';
import {
  checkDatabaseConnection,
  closeDatabase,
  getDatabaseStatus,
  logDatabaseStatus,
} from './config/database';
import { assertConnectedDatabaseForMode } from './config/databaseSafety';
import { env } from './config/env';
import { isPiiEncryptionEnabled } from './utils/piiCrypto';
import { sweepExpiredDemoSessions } from './services/demoExpirySweep.service';

/**
 * Bootstraps the HTTP server and logs database connectivity.
 */
const start = async () => {
  const dbStatus = await checkDatabaseConnection();
  logDatabaseStatus(dbStatus);

  try {
    assertConnectedDatabaseForMode(
      env.appMode,
      env.configuredDatabase,
      dbStatus.database,
      dbStatus.user
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (env.isDemoMode && !dbStatus.connected) {
    console.error(
      'FATAL demo isolation: demo mode cannot start without a connected advisortrack_demo database. No in-memory fallback.'
    );
    process.exit(1);
  }

  const app = await createApp();

  const listenHost = env.isDemoMode ? '127.0.0.1' : '0.0.0.0';
  const server = app.listen(env.port, listenHost, () => {
    console.log(`AdvisorTrack API running on http://${listenHost}:${env.port}`);
    console.log(`Health check: http://localhost:${env.port}/health`);
    console.log(`API base URL: http://localhost:${env.port}/api/v1`);
    console.log(`Swagger docs: http://localhost:${env.port}/api/docs`);

    const latestDb = getDatabaseStatus();
    console.log(`[mode] AdvisorTrack ${env.appMode}${env.isDemoMode ? ' — public demo isolation enabled' : ''}`);
    if (latestDb.connected) {
      console.log('[database] Persistence: auth, profile, contacts, production, dashboard → PostgreSQL');
      if (!isPiiEncryptionEnabled()) {
        console.warn(
          '[security] PII_ENCRYPTION_KEY not set — contact email/phone stored as plaintext. Run: npm run db:generate-pii-key'
        );
      } else {
        console.log('[security] Contact PII encryption enabled (AES-256-GCM)');
      }
    } else {
      console.log('[database] Data source: in-memory (PostgreSQL unavailable or not configured)');
    }
  });

  if (env.isDemoMode) {
    const sweepMs = env.demoExpirySweepMinutes * 60 * 1000;
    const runSweep = () => {
      sweepExpiredDemoSessions().catch((error) => {
        console.error('[demo] expiry sweep failed', error instanceof Error ? error.message : error);
      });
    };
    runSweep();
    const sweepTimer = setInterval(runSweep, sweepMs);
    sweepTimer.unref?.();
  }

  const shutdown = async () => {
    console.log('\nShutting down...');
    server.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
