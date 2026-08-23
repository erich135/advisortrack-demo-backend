import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { DataStore } from '../data/store';
import {
  ActivityService,
  AuthService,
  ContactService,
  ProductionService,
} from '../services';
import { ok } from '../utils/response';
import { createActivitiesRouter } from './activities.routes';
import { createAuthRouter } from './auth.routes';
import { createContactsRouter } from './contacts.routes';
import { createProductionRouter } from './production.routes';
import { createDashboardRouter } from './dashboard.routes';
import { DashboardService } from '../services/dashboard.service';
import { ProfileService } from '../services/profile.service';
import { createProfileRouter } from './profile.routes';
import { CompletionService } from '../services/completion.service';
import { createCompletionRouter } from './completion.routes';
import { PlanningService } from '../services/planning.service';
import { createPlanningRouter } from './planning.routes';
import { createCasesRouter } from './cases.routes';
import { createSubscriptionRouter } from './subscription.routes';
import { createCompanyRouter } from './company.routes';
import { createPlatformRouter } from './platform.routes';
import { createManagementRouter } from './management.routes';
import { createDemoRouter } from './demo.routes';

/**
 * Builds the versioned API router with all resource endpoints.
 */
export const createApiRouter = (store: DataStore) => {
  const router = Router();

  /**
   * GET /api/v1 — API index (not a data endpoint; lists available routes).
   */
  router.get('/', (_req: Request, res: Response) => {
    res.json(
      ok({
        name: 'AdvisorTrack API',
        version: 'v1',
        documentation: '/api/docs',
        openApiSpec: '/api/docs.json',
        auth: {
          login: 'POST /api/v1/auth/login',
          note: 'Returns a JWT. Send as Authorization: Bearer <token> on protected routes.',
          tokenExpiresIn: env.jwtExpiresIn,
        },
        endpoints: {
          auth: [
            'POST /auth/login',
            'POST /auth/register',
            'POST /auth/forgot-password',
            'GET /auth/me',
            'POST /auth/logout',
          ],
          contacts: ['GET /contacts', 'GET /contacts/:id', 'POST /contacts', 'POST /contacts/import'],
          activities: ['GET /activities', 'POST /activities'],
          production: ['GET /production', 'GET /production/dashboard', 'GET /production/summary', 'POST /production'],
          management: [
            'GET /management/production/summary?month=YYYY-MM',
            'GET /management/production/entries?month=YYYY-MM',
            'GET /management/pipeline?advisorId=UUID&stage=PIPELINE_STAGE&status=CASE_STATUS&search=TERM',
            'GET /management/performance?period=last_week|last_month|year_to_date',
          ],
          dashboard: ['GET /dashboard'],
          planning: ['GET /planning/targets', 'GET /planning/settings', 'PATCH /planning/settings'],
          profile: [
            'GET /profile',
            'PATCH /profile',
            'GET /profile/financial',
            'PATCH /profile/financial',
            'POST /profile/setup/complete',
          ],
          setup: ['GET /setup/completion'],
          subscription: [
            'GET /subscription/packages',
            'GET /subscription/me',
            'POST /subscription/select',
          ],
          cases: [
            'GET /cases/contact/:contactId',
            'GET /cases/:id',
            'POST /cases',
            'PATCH /cases/:id',
            'POST /cases/:id/documents',
            'PATCH /cases/:id/documents/:documentId',
            'POST /cases/:id/schedule-review',
          ],
        },
      })
    );
  });

  const authService = new AuthService(store);
  const contactService = new ContactService(store);
  const activityService = new ActivityService(store);
  const productionService = new ProductionService(store);
  const dashboardService = new DashboardService(store);
  const profileService = new ProfileService();
  const completionService = new CompletionService(store, profileService);
  const planningService = new PlanningService();

  router.use('/auth', createAuthRouter(authService));
  router.use('/contacts', createContactsRouter(contactService));
  router.use('/activities', createActivitiesRouter(activityService));
  router.use('/production', createProductionRouter(productionService));
  router.use('/dashboard', createDashboardRouter(dashboardService));
  router.use('/profile', createProfileRouter(profileService));
  router.use('/setup/completion', createCompletionRouter(completionService));
  router.use('/planning', createPlanningRouter(planningService));
  router.use('/subscription', createSubscriptionRouter());
  router.use('/cases', createCasesRouter());
  router.use('/company', createCompanyRouter());
  router.use('/platform', createPlatformRouter());
  router.use('/management', createManagementRouter());
  router.use('/demo', createDemoRouter());

  return router;
};
