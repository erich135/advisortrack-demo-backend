import { Router, Request, Response, NextFunction } from 'express';
import { asAuthRequest, requireAuth, requireVerifiedEmail } from '../middleware/auth';
import { ok } from '../utils/response';
import { organisationService } from '../services/organisation.service';
import {
  createCompanyMemberSchema,
  createCompanyRegionSchema,
  createCompanyRoleSchema,
  createCompanyTeamSchema,
  confirmBulkUserImportSchema,
  previewBulkUserImportSchema,
  requestLicenceIncreaseSchema,
  updateCompanyMemberSchema,
  updateCompanyRegionSchema,
  updateCompanyRoleSchema,
  updateCompanyTeamSchema,
} from '../validators/schemas';
import { organisationStructureService } from '../services/organisationStructure.service';
import { companyCustomerPortalService } from '../services/companyCustomerPortal.service';
import { bulkUserImportService } from '../services/bulkUserImport.service';

/**
 * Company-scoped APIs for the signed-in advisor's organisation.
 * Not listed in Swagger — see docs/COMPANY-AND-PLATFORM-API.md.
 */
export const createCompanyRouter = () => {
  const router = Router();
  router.use(requireAuth, requireVerifiedEmail);

  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.getMyOrganisation(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/permissions', (_req: Request, res: Response) => {
    res.json(ok(organisationService.listPermissionCatalogue()));
  });

  router.get('/roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.listMyRoles(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createCompanyRoleSchema.parse(req.body);
      res.status(201).json(ok(await organisationService.createMyRole(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/roles/:roleId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateCompanyRoleSchema.parse(req.body);
      res.json(ok(await organisationService.updateMyRole(userId, String(req.params.roleId), body)));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/roles/:roleId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.deleteMyRole(userId, String(req.params.roleId))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/assignable-roles', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.listAssignableRoles(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.listMyMembers(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.getMyMember(userId, String(req.params.memberId))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/members', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createCompanyMemberSchema.parse(req.body);
      res.status(201).json(ok(await organisationService.createMyMember(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/members/import/preview', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = previewBulkUserImportSchema.parse(req.body);
      res.json(ok(await bulkUserImportService.preview(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/members/import/confirm', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = confirmBulkUserImportSchema.parse(req.body);
      res.status(201).json(ok(await bulkUserImportService.confirm(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/members/:memberId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateCompanyMemberSchema.parse(req.body);
      res.json(ok(await organisationService.updateMyMember(userId, String(req.params.memberId), body)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/members/:memberId/deactivate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.deactivateCompanyMember(userId, String(req.params.memberId))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/members/:memberId/licence', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.assignMemberLicence(userId, String(req.params.memberId))));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/members/:memberId/licence', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.removeMemberLicence(userId, String(req.params.memberId))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/licence-pool', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.getLicencePool(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/licence-requests', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.listLicenceIncreaseRequests(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/licence-requests', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = requestLicenceIncreaseSchema.parse(req.body);
      res.status(201).json(ok(await organisationService.requestLicenceIncrease(userId, body)));
    } catch (error) {
      next(error);
    }
  });

  router.post('/licence-requests/:requestId/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.cancelLicenceIncreaseRequest(userId, String(req.params.requestId))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/subscription', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await companyCustomerPortalService.getSubscription(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await companyCustomerPortalService.listAudit(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/invoices', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await companyCustomerPortalService.listInvoices(userId)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/invoices/:invoiceId/pdf', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const pdf = await companyCustomerPortalService.invoicePdf(userId, String(req.params.invoiceId));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
      res.send(pdf.buffer);
    } catch (error) {
      next(error);
    }
  });

  router.get('/invoices/:invoiceId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await companyCustomerPortalService.getInvoice(userId, String(req.params.invoiceId))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/invoices/:invoiceId/send', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await companyCustomerPortalService.simulateInvoiceSend(userId, String(req.params.invoiceId))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/members/:memberId/resend-invitation', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationService.resendMemberInvitation(userId, String(req.params.memberId))));
    } catch (error) {
      next(error);
    }
  });

  router.get('/regions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationStructureService.listRegions(userId, optionalCompanyId(req))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/regions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createCompanyRegionSchema.parse(req.body);
      res.status(201).json(ok(await organisationStructureService.createRegion(userId, body, optionalCompanyId(req))));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/regions/:regionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateCompanyRegionSchema.parse(req.body);
      res.json(
        ok(
          await organisationStructureService.updateRegion(
            userId,
            String(req.params.regionId),
            body,
            optionalCompanyId(req)
          )
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.get('/teams', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      res.json(ok(await organisationStructureService.listTeams(userId, optionalCompanyId(req))));
    } catch (error) {
      next(error);
    }
  });

  router.post('/teams', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = createCompanyTeamSchema.parse(req.body);
      res.status(201).json(ok(await organisationStructureService.createTeam(userId, body, optionalCompanyId(req))));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/teams/:teamId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = asAuthRequest(req);
      const body = updateCompanyTeamSchema.parse(req.body);
      res.json(
        ok(
          await organisationStructureService.updateTeam(
            userId,
            String(req.params.teamId),
            body,
            optionalCompanyId(req)
          )
        )
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
};

const optionalCompanyId = (req: Request): string | undefined => {
  const value = req.query.companyId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};
