import { AppError } from '../middleware/errorHandler';
import { DEMO_ACTION_SIMULATED_MESSAGE } from '../features/demoMessages';
import { organisationService } from './organisation.service';
import { organisationRepository } from '../repositories/organisation.repository';
import { invoiceRepository } from '../repositories/invoice.repository';
import { platformAuditService } from './platformAudit.service';
import { platformInvoicesService } from './platformInvoices.service';
import { platformSubscriptionsService } from './platformSubscriptions.service';
import { demoOutboxService } from './demoOutbox.service';
import { env } from '../config/env';

type CustomerRank = 'executive' | 'regional_manager' | 'team_leader';

const requireRank = async (userId: string, allowed: CustomerRank[]) => {
  const org = await organisationService.getMyOrganisation(userId);
  const rank = org.hierarchy?.rank;
  if (!rank || !allowed.includes(rank as CustomerRank)) {
    throw new AppError(403, 'You do not have access to this page', 'FORBIDDEN');
  }
  return { org, companyId: org.company.id, rank: rank as CustomerRank };
};

const snapshotRefFor = (invoice: { invoice_number: string; updated_at: Date }) =>
  `${invoice.invoice_number}@${invoice.updated_at.toISOString()}`;

/**
 * Customer-facing company portal: session-scoped subscription, invoices, and audit.
 * Never accepts a client companyId. Platform administration stays on /platform.
 */
export const companyCustomerPortalService = {
  async getSubscription(userId: string) {
    const { companyId } = await requireRank(userId, ['executive']);
    return platformSubscriptionsService.publicView(companyId);
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
    const { companyId } = await requireRank(userId, ['executive']);
    return platformInvoicesService.customerList(companyId);
  },

  async getInvoice(userId: string, invoiceId: string) {
    const { companyId } = await requireRank(userId, ['executive']);
    return platformInvoicesService.customerGet(companyId, invoiceId);
  },

  async invoicePdf(userId: string, invoiceId: string) {
    const { companyId } = await requireRank(userId, ['executive']);
    return platformInvoicesService.customerPdf(companyId, invoiceId);
  },

  async simulateInvoiceSend(userId: string, invoiceId: string) {
    const { companyId } = await requireRank(userId, ['executive']);
    const invoice = await invoiceRepository.findInvoice(invoiceId);
    if (!invoice || invoice.company_id !== companyId) {
      throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
    }
    if (invoice.status === 'cancelled' || invoice.status === 'voided') {
      throw new AppError(409, 'Cancelled or voided invoices cannot be sent', 'INVALID_STATUS_TRANSITION');
    }

    const recipient = invoice.snapshot_billing_email;
    const snapshotRef = snapshotRefFor(invoice);
    await demoOutboxService.record({
      companyId,
      actorUserId: userId,
      action: 'invoice_send',
      recipient,
      payload: { invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, kind: 'simulate' },
    });

    await invoiceRepository.insertDeliveryEvent({
      invoiceId: invoice.id,
      status: 'sent',
      recipientEmail: recipient,
      actorUserId: userId,
      providerMessageId: env.isDemoMode ? 'demo-outbox' : null,
      snapshotRef,
    });

    if (invoice.status === 'draft') {
      await invoiceRepository.applyStatus({
        invoiceId: invoice.id,
        fromStatus: 'draft',
        toStatus: 'sent',
        actorUserId: userId,
        note: env.isDemoMode ? 'Demo send simulated' : 'Sent',
      });
    }

    await organisationRepository.recordAuditEvent(userId, 'invoice_sent', 'invoice', {
      companyId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      recipientEmail: recipient,
      snapshotRef,
      previousValue: invoice.status,
      newValue: invoice.status === 'draft' ? 'sent' : invoice.status,
      demoSimulated: env.isDemoMode,
    });

    const detail = await platformInvoicesService.customerGet(companyId, invoice.id);
    return {
      ...detail,
      demoSimulated: true as const,
      message: DEMO_ACTION_SIMULATED_MESSAGE,
    };
  },
};
