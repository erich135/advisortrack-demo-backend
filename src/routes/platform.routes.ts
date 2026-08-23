import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/platformAdmin';
import { blockDemoPlatformAdmin } from '../middleware/demoGuard';
import { AppError } from '../middleware/errorHandler';
import { PlatformSupportFilters } from '../repositories/platformSupport.repository';
import { platformSupportService } from '../services/platformSupport.service';
import { ok } from '../utils/response';
import { organisationService } from '../services/organisation.service';
import { platformSubscriptionsService } from '../services/platformSubscriptions.service';
import { platformInvoicesService } from '../services/platformInvoices.service';
import { platformCustomersService } from '../services/platformCustomers.service';
import { platformAuditService } from '../services/platformAudit.service';
import {
  adjustPurchasedLicencesSchema,
  companySubscriptionActionSchema,
  createCompanyMemberSchema,
  createCompanySchema,
  createInvoiceSchema,
  invoiceActionNoteSchema,
  markInvoicePaidSchema,
  updateCompanyMemberSchema,
  setPurchasedLicencesSchema,
  updateCompanySchema,
  updateCompanySubscriptionSchema,
  updateDraftInvoiceSchema,
  upsertBillingProfileSchema,
} from '../validators/schemas';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readOptionalString(value: unknown, name: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(400, `${name} must be a single string value`, 'VALIDATION_ERROR');
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new AppError(400, `${name} must be at most ${maxLength} characters`, 'VALIDATION_ERROR');
  }
  return normalized;
}

function readSupportFilters(query: Request['query']): PlatformSupportFilters {
  const companyId = readOptionalString(query.companyId, 'companyId', 36);
  const search = readOptionalString(query.search, 'search', 120);
  const inactiveDaysValue = readOptionalString(query.inactiveDays, 'inactiveDays', 3);

  if (companyId && !uuidPattern.test(companyId)) {
    throw new AppError(400, 'companyId must be a valid UUID', 'VALIDATION_ERROR');
  }

  let inactiveDays: number | undefined;
  if (inactiveDaysValue !== undefined) {
    if (!/^\d+$/.test(inactiveDaysValue)) {
      throw new AppError(400, 'inactiveDays must be a whole number', 'VALIDATION_ERROR');
    }
    inactiveDays = Number(inactiveDaysValue);
    if (inactiveDays < 1 || inactiveDays > 365) {
      throw new AppError(400, 'inactiveDays must be between 1 and 365', 'VALIDATION_ERROR');
    }
  }

  return { companyId, search, inactiveDays };
}

/**
 * AdvisorTrack staff APIs to inspect every company.
 * Not listed in Swagger — see docs/COMPANY-AND-PLATFORM-API.md.
 */
export const createPlatformRouter = () => {
  const router = Router();
  router.use(blockDemoPlatformAdmin, requireAuth, requireVerifiedEmail, requirePlatformAdmin);

  router.get('/permissions', (_req: Request, res: Response) => {
    res.json(ok(organisationService.listPermissionCatalogue()));
  });

  router.get('/support/health', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const filters = readSupportFilters(req.query);
      res.json(ok(await platformSupportService.getHealth(userId, filters)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/companies', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(ok(await organisationService.listAllCompanies()));
    } catch (error) {
      next(error);
    }
  });

  router.post('/companies', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createCompanySchema.parse(req.body);
      res.status(201).json(ok(await organisationService.createCompany(body)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/companies/:companyId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(ok(await organisationService.getCompanyOverview(String(req.params.companyId))));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/companies/:companyId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateCompanySchema.parse(req.body);
      res.json(ok(await organisationService.updateCompany(userId, String(req.params.companyId), body)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscriptions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await platformSubscriptionsService.list(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscriptions/:companyId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await platformSubscriptionsService.get(userId, String(req.params.companyId))));
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/subscriptions/:companyId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = updateCompanySubscriptionSchema.parse(req.body);
        res.json(
          ok(await platformSubscriptionsService.updateSubscription(userId, String(req.params.companyId), body))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    '/subscriptions/:companyId/licences',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = setPurchasedLicencesSchema.parse(req.body);
        res.json(
          ok(await platformSubscriptionsService.setPurchasedLicences(userId, String(req.params.companyId), body))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/subscriptions/:companyId/licences/add',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = adjustPurchasedLicencesSchema.parse(req.body);
        res.json(ok(await platformSubscriptionsService.addLicences(userId, String(req.params.companyId), body)));
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/subscriptions/:companyId/licences/reduce',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = adjustPurchasedLicencesSchema.parse(req.body);
        res.json(
          ok(await platformSubscriptionsService.reduceLicences(userId, String(req.params.companyId), body))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/subscriptions/:companyId/activate',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = companySubscriptionActionSchema.parse(req.body ?? {});
        res.json(
          ok(await platformSubscriptionsService.activate(userId, String(req.params.companyId), body.reason))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/subscriptions/:companyId/suspend',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = companySubscriptionActionSchema.parse(req.body ?? {});
        res.json(
          ok(await platformSubscriptionsService.suspend(userId, String(req.params.companyId), body.reason))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/subscriptions/:companyId/cancel',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = companySubscriptionActionSchema.parse(req.body ?? {});
        res.json(
          ok(await platformSubscriptionsService.cancel(userId, String(req.params.companyId), body.reason))
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get('/customers/:companyId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await platformCustomersService.get(userId, String(req.params.companyId))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/customers/:companyId/assignable-roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.listAssignableRoles(userId, String(req.params.companyId))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/customers/:companyId/licence-pool', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.getLicencePool(userId, String(req.params.companyId))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/customers/:companyId/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createCompanyMemberSchema.parse(req.body);
      res.status(201).json(
        ok(await organisationService.createMyMember(userId, body, { companyId: String(req.params.companyId) }))
      );
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/customers/:companyId/members/:memberId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        const body = updateCompanyMemberSchema.parse(req.body);
        res.json(
          ok(
            await organisationService.updateMyMember(userId, String(req.params.memberId), body, {
              companyId: String(req.params.companyId),
            })
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/customers/:companyId/members/:memberId/licence',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        res.json(
          ok(
            await organisationService.assignMemberLicence(
              userId,
              String(req.params.memberId),
              String(req.params.companyId)
            )
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.delete(
    '/customers/:companyId/members/:memberId/licence',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        res.json(
          ok(
            await organisationService.removeMemberLicence(
              userId,
              String(req.params.memberId),
              String(req.params.companyId)
            )
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/customers/:companyId/members/:memberId/resend-invitation',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { userId } = asAuthRequest(req);
        res.json(
          ok(
            await organisationService.resendMemberInvitation(
              userId,
              String(req.params.memberId),
              String(req.params.companyId)
            )
          )
        );
      } catch (error) {
        next(error);
      }
    }
  );

  router.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const companyId = readOptionalString(req.query.companyId, 'companyId', 36);
      const resourceType = readOptionalString(req.query.resourceType, 'resourceType', 32);
      if (companyId && !uuidPattern.test(companyId)) {
        throw new AppError(400, 'companyId must be a valid UUID', 'VALIDATION_ERROR');
      }
      res.json(ok(await platformAuditService.list(userId, { companyId, resourceType })));
    } catch (error) {
      next(error);
    }
  });

  router.get('/billing-profiles/:companyId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await platformInvoicesService.getBillingProfile(userId, String(req.params.companyId))));
    } catch (error) {
      next(error);
    }
  });

  router.put('/billing-profiles/:companyId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = upsertBillingProfileSchema.parse(req.body);
      res.json(ok(await platformInvoicesService.upsertBillingProfile(userId, String(req.params.companyId), body)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/invoices', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const companyId = readOptionalString(req.query.companyId, 'companyId', 36);
      if (companyId && !uuidPattern.test(companyId)) {
        throw new AppError(400, 'companyId must be a valid UUID', 'VALIDATION_ERROR');
      }
      res.json(ok(await platformInvoicesService.list(userId, companyId)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createInvoiceSchema.parse(req.body);
      res.status(201).json(ok(await platformInvoicesService.create(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/invoices/:invoiceId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await platformInvoicesService.get(userId, String(req.params.invoiceId))));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/invoices/:invoiceId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateDraftInvoiceSchema.parse(req.body);
      res.json(ok(await platformInvoicesService.updateDraft(userId, String(req.params.invoiceId), body)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/invoices/:invoiceId/pdf', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const pdf = await platformInvoicesService.generatePdf(userId, String(req.params.invoiceId));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
      res.send(pdf.buffer);
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices/:invoiceId/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await platformInvoicesService.send(userId, String(req.params.invoiceId))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices/:invoiceId/mark-paid', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = markInvoicePaidSchema.parse(req.body);
      res.json(
        ok(
          await platformInvoicesService.markPaid(
            userId,
            String(req.params.invoiceId),
            body.paymentDate,
            body.note
          )
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices/:invoiceId/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = invoiceActionNoteSchema.parse(req.body ?? {});
      res.json(ok(await platformInvoicesService.cancel(userId, String(req.params.invoiceId), body.note)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices/:invoiceId/void', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = invoiceActionNoteSchema.parse(req.body ?? {});
      res.json(ok(await platformInvoicesService.void(userId, String(req.params.invoiceId), body.note)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices/:invoiceId/duplicate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.status(201).json(ok(await platformInvoicesService.duplicate(userId, String(req.params.invoiceId))));
    } catch (error) {
      next(error);
    }
  });

  return router;
};
