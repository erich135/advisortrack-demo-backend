import { organisationService } from './organisation.service';
import { productionRepository } from '../repositories/production.repository';
import { AppError } from '../middleware/errorHandler';

export type ManagementProductionSummary = {
  period: string;
  advisorCount: number;
  issuedAmount: number;
  issuedCount: number;
  nonIssuedAmount: number;
  nonIssuedCount: number;
  advisors: Awaited<ReturnType<typeof productionRepository.getManagementMonthlySummary>>['advisors'];
};

export type ManagementProductionEntries = {
  period: string;
  issuedAmount: number;
  issuedCount: number;
  nonIssuedAmount: number;
  nonIssuedCount: number;
  entries: Awaited<ReturnType<typeof productionRepository.listManagementMonthlyEntries>>;
};

/** Management-only production aggregation using the server-derived user scope. */
export const managementProductionService = {
  async getMonthlySummary(userId: string, month: string): Promise<ManagementProductionSummary> {
    const scope = await organisationService.resolveManagementScope(userId);
    const summary = await productionRepository.getManagementMonthlySummary(scope.userIds, `${month}-01`);

    return {
      period: month,
      advisorCount: scope.userIds.length,
      ...summary.totals,
      advisors: summary.advisors,
    };
  },

  async getMonthlyEntries(userId: string, month: string): Promise<ManagementProductionEntries> {
    const scope = await organisationService.resolveManagementScope(userId);
    const monthStart = `${month}-01`;
    const [summary, entries] = await Promise.all([
      productionRepository.getManagementMonthlySummary(scope.userIds, monthStart),
      productionRepository.listManagementMonthlyEntries(scope.userIds, monthStart),
    ]);

    return {
      period: month,
      ...summary.totals,
      entries,
    };
  },

  async getRangeSummary(
    userId: string,
    startDate: string,
    endDate: string,
    memberIds?: string[],
  ): Promise<ManagementProductionSummary> {
    const scope = await organisationService.resolveManagementScope(userId);
    if (memberIds?.length && memberIds.some((id) => !scope.userIds.includes(id))) {
      throw new AppError(404, 'Member not found', 'NOT_FOUND');
    }
    const userIds = memberIds?.length ? memberIds : scope.userIds;
    const summary = await productionRepository.getManagementRangeSummary(userIds, startDate, endDate);
    return {
      period: `${startDate}:${endDate}`,
      advisorCount: userIds.length,
      ...summary.totals,
      advisors: summary.advisors,
    };
  },
};
