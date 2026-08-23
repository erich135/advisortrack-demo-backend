import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { checkDatabaseConnection, getDatabaseStatus } from './config/database';
import { env } from './config/env';
import { setupSwagger } from './config/swagger';
import { createStore } from './data/store';
import { errorHandler } from './middleware/errorHandler';
import { createApiRouter } from './routes';
import { ok } from './utils/response';

/**
 * Creates and configures the Express application.
 */
export const createApp = async () => {
  const app = express();
  const store = await createStore();

  app.use(
    helmet({
      contentSecurityPolicy: env.isDev ? false : undefined,
    })
  );
  app.use(
    cors({
      origin: env.isDev ? true : env.corsOrigins,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));

  setupSwagger(app);

  /**
   * GET /health — liveness check for deployments and local dev.
   */
  app.get('/health', async (_req: Request, res: Response) => {
    const dbStatus = env.databaseUrl
      ? await checkDatabaseConnection()
      : getDatabaseStatus();

    res.json(
      ok({
        status: 'ok',
        service: 'advisor-track-api',
        environment: env.nodeEnv,
        mode: env.appMode,
        timestamp: new Date().toISOString(),
        database: {
          connected: dbStatus.connected,
          message: dbStatus.message,
          ...(dbStatus.database ? { name: dbStatus.database } : {}),
          ...(dbStatus.user ? { user: dbStatus.user } : {}),
        },
      })
    );
  });

  app.use('/api/v1', createApiRouter(store));

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: { message: 'Route not found', code: 'NOT_FOUND' },
    });
  });

  app.use(errorHandler);

  return app;
};
