import { AppError } from '../middleware/errorHandler';
import { organisationService } from './organisation.service';
import { platformAuditService } from './platformAudit.service';
import { platformInvoicesService } from './platformInvoices.service';
import { platformSubscriptionsService } from './platformSubscriptions.service';
import { enterpriseContractService } from './enterpriseContract.service';
import { demoOutboxService } from './demoOutbox.service';
import { DEMO_ACTION_SIMULATED_MESSAGE } from '../features/demoMessages';

type CustomerRank = 'executive' | 'regional_manager' | 'team_leader';

const requireRank = async (userId: string, allowed: CustomerRank[]) => {
  const org = await organisationService.getMyOrganisation(userId);
  const rank = org.hierarchy?.rank;
  if (!rank || !allowed.includes(rank as CustomerRank)) {
    throw new AppError(403, 'You do not have access to this page', 'FORBIDDEN');
  }
  return { org, companyId: org.company.id, rank: rank as CustomerRank };
};

/**
 * Customer-facing company portal: session-scoped subscription, invoices, and audit.
 * Never accepts a client companyId. Platform administration stays on /platform.
 */
export const companyCustomerPortalService = {
  async getSubscription(userId: string) {
    const org = await organisationService.getMyOrganisation(userId);
    const rank = org.hierarchy?.rank;
    if (org.isPlatformAdmin) {
      // Session-scoped only. Staff cannot pick another companyId from this route.
    } else if (rank !== 'executive' && !org.isOrganisationAdmin) {
      throw new AppError(403, 'You do not have access to this page', 'FORBIDDEN');
    }
    const companyId = org.company.id;
    const [base, enterprise] = await Promise.all([
      platformSubscriptionsService.publicView(companyId),
      enterpriseContractService.getCustomerSummary(userId),
    ]);
    return {
      ...base,
      plan: {
        ...(base.plan ?? { slug: 'enterprise', priceCents: 0, currency: 'ZAR' }),
        name: enterprise.planName,
      },
      vatTreatment: {
        registered: false,
        ratePercent: 0,
        label: enterprise.vatLabel,
      },
      enterprise,
    };
  },

  async listAudit(userId: string) {
    const { companyId, rank } = await requireRank(userId, ['executive', 'regional_manager']);
    if (rank === 'executive') {
      return platformAuditService.listForCompany(companyId);
    }
    const scope = await organisationService.resolveManagementScope(userId);
    return platformAuditService.listForCompany(companyId, scope.userIds);
  },

  async listInvoices(userId: string) {
    const org = await organisationService.getMyOrganisation(userId);
    const rank = org.hierarchy?.rank;
    if (org.isPlatformAdmin) {
      // Session-scoped.
    } else if (rank !== 'executive' && !org.isOrganisationAdmin) {
      throw new AppError(403, 'You do not have access to this page', 'FORBIDDEN');
    }
    return platformInvoicesService.customerList(org.company.id);
  },

  async getInvoice(userId: string, invoiceId: string) {
    const org = await organisationService.getMyOrganisation(userId);
    const rank = org.hierarchy?.rank;
    if (org.isPlatformAdmin) {
      // Session-scoped.
    } else if (rank !== 'executive' && !org.isOrganisationAdmin) {
      throw new AppError(403, 'You do not have access to this page', 'FORBIDDEN');
    }
    return platformInvoicesService.customerGet(org.company.id, invoiceId);
  },

  async invoicePdf(userId: string, invoiceId: string) {
    const org = await organisationService.getMyOrganisation(userId);
    const rank = org.hierarchy?.rank;
    if (org.isPlatformAdmin) {
      // Session-scoped.
    } else if (rank !== 'executive' && !org.isOrganisationAdmin) {
      throw new AppError(403, 'You do not have access to this page', 'FORBIDDEN');
    }
    return platformInvoicesService.customerPdf(org.company.id, invoiceId);
  },

  async simulateInvoiceSend(userId: string, invoiceId: string) {
    const org = await organisationService.getMyOrganisation(userId);
    const rank = org.hierarchy?.rank;
    if (org.isPlatformAdmin) {
      // Session-scoped.
    } else if (rank !== 'executive' && !org.isOrganisationAdmin) {
      throw new AppError(403, 'You do not have access to this page', 'FORBIDDEN');
    }
    const detail = await platformInvoicesService.customerGet(org.company.id, invoiceId);
    const recipient =
      (detail as { snapshot?: { billingEmail?: string | null } }).snapshot?.billingEmail ??
      (detail as { billingEmail?: string | null }).billingEmail ??
      null;
    await demoOutboxService.record({
      companyId: org.company.id,
      actorUserId: userId,
      action: 'invoice_send',
      recipient,
      payload: {
        invoiceId,
        invoiceNumber: (detail as { invoiceNumber?: string }).invoiceNumber,
        kind: 'customer_simulate',
      },
    });
    return {
      ...detail,
      demoSimulated: true as const,
      message: DEMO_ACTION_SIMULATED_MESSAGE,
    };
  },
};
