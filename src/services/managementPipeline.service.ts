import { AppError } from '../middleware/errorHandler';
import {
  ManagementPipelineCase,
  ManagementPipelineFilters,
  managementPipelineRepository,
} from '../repositories/managementPipeline.repository';
import { organisationService } from './organisation.service';

export interface ManagementPipelineResponse {
  advisorCount: number;
  caseCount: number;
  overviewCaseCount: number;
  overviewActiveCaseCount: number;
  stageCounts: Record<string, number>;
  totalEstimatedCommission: number;
  estimatedCommissionCaseCount: number;
  cases: ManagementPipelineCase[];
}

const summarise = (cases: ManagementPipelineCase[]) => {
  const advisorIds = new Set<string>();
  const stageCounts: Record<string, number> = {};
  let totalEstimatedCommission = 0;
  let estimatedCommissionCaseCount = 0;
  let overviewActiveCaseCount = 0;

  for (const clientCase of cases) {
    advisorIds.add(clientCase.advisor.userId);
    stageCounts[clientCase.currentStage] = (stageCounts[clientCase.currentStage] ?? 0) + 1;
    if (clientCase.status === 'open') overviewActiveCaseCount += 1;
    if (clientCase.estimatedCommission !== null) {
      totalEstimatedCommission += clientCase.estimatedCommission;
      estimatedCommissionCaseCount += 1;
    }
  }

  return {
    advisorCount: advisorIds.size,
    overviewCaseCount: cases.length,
    overviewActiveCaseCount,
    stageCounts,
    totalEstimatedCommission,
    estimatedCommissionCaseCount,
  };
};

/** Management-scoped pipeline service with server-derived advisor access. */
export const managementPipelineService = {
  async getPipeline(
    userId: string,
    filters: ManagementPipelineFilters
  ): Promise<ManagementPipelineResponse> {
    const scope = await organisationService.resolveManagementScope(userId);

    if (filters.advisorId && !scope.userIds.includes(filters.advisorId)) {
      throw new AppError(404, 'Advisor not found', 'NOT_FOUND');
    }

    const overviewCases = await managementPipelineRepository.listCases(scope.userIds, {
      advisorId: filters.advisorId,
      status: filters.status,
      search: filters.search,
    });
    const overview = summarise(overviewCases);
    const cases = filters.stage
      ? overviewCases.filter((clientCase) => clientCase.currentStage === filters.stage)
      : overviewCases;

    return {
      ...overview,
      caseCount: cases.length,
      cases,
    };
  },
};
