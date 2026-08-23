import { AppError } from '../middleware/errorHandler';
import { organisationRepository } from '../repositories/organisation.repository';
import { organisationService } from './organisation.service';
import { platformInvoicesService } from './platformInvoices.service';
import { platformSubscriptionsService } from './platformSubscriptions.service';

const requireInternalAdmin = async (actorUserId: string): Promise<void> => {
  const membership = await organisationRepository.findMembership(actorUserId);
  if (!membership?.is_platform_admin) {
    throw new AppError(403, 'Platform admin access required', 'FORBIDDEN');
  }
};

/**
 * Connected internal customer account: company + subscription + users + invoices.
 */
export const platformCustomersService = {
  async get(actorUserId: string, companyId: string) {
    await requireInternalAdmin(actorUserId);
    const overview = await organisationService.getCompanyOverview(companyId);
    if (overview.company.isPlatform) {
      throw new AppError(400, 'The AdvisorTrack platform company is not a customer account', 'NOT_A_CUSTOMER');
    }
    const [subscription, invoices, members] = await Promise.all([
      platformSubscriptionsService.get(actorUserId, companyId),
      platformInvoicesService.listForCompany(companyId),
      organisationService.listCustomerMembers(actorUserId, companyId),
    ]);
    return {
      company: overview.company,
      members,
      roles: overview.roles,
      subscription,
      invoices,
      tabs: ['overview', 'users', 'subscription', 'licences', 'invoices'] as const,
    };
  },
};
