import { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi';

/**
 * Mounts Swagger UI and the raw OpenAPI JSON spec on the Express app.
 */
export const setupSwagger = (app: Express): void => {
  app.get('/api/docs.json', (_req, res) => {
    res.json(openApiSpec);
  });

  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'AdvisorTrack API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    })
  );
};
