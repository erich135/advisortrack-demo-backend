import { AppError } from '../middleware/errorHandler';
import { PIPELINE_STAGES } from '../features/pipelineStages';
import {
  buildAttentionReasons,
  hasNoNextAction,
  isMissingDocuments,
  isOpenCase,
  isStalledOpenCase,
} from '../features/advisorAttention';
import { productionRepository } from '../repositories/production.repository';
import { managementPipelineRepository } from '../repositories/managementPipeline.repository';
import { organisationService } from './organisation.service';

const currentMonth = (): string => new Date().toISOString().slice(0, 7);

export const managementAdvisorSummaryService = {
  async getSummary(actorUserId: string, advisorId: string) {
    const scope = await organisationService.resolveManagementScope(actorUserId);
    if (!scope.userIds.includes(advisorId)) {
      throw new AppError(404, 'Advisor not found', 'NOT_FOUND');
    }

    const member = await organisationService.getMyMember(actorUserId, advisorId);
    const [cases, production] = await Promise.all([
      managementPipelineRepository.listCases(scope.userIds, { advisorId }),
      productionRepository.getManagementMonthlySummary([advisorId], `${currentMonth()}-01`),
    ]);

    const openCases = cases.filter(isOpenCase);
    const stalledOpenCases = openCases.filter((clientCase) => isStalledOpenCase(clientCase));
    const missingDocumentsCases = openCases.filter(isMissingDocuments);
    const noNextActionCases = openCases.filter(hasNoNextAction);

    const pipelineValueCases = openCases.filter((clientCase) => clientCase.estimatedCommission !== null);
    const pipelineValue = pipelineValueCases.reduce(
      (sum, clientCase) => sum + (clientCase.estimatedCommission ?? 0),
      0
    );

    const stageDistribution = PIPELINE_STAGES.map((stage) => {
      const stageCases = openCases.filter((clientCase) => clientCase.currentStage === stage);
      const commissionCases = stageCases.filter((clientCase) => clientCase.estimatedCommission !== null);
      return {
        stage,
        caseCount: stageCases.length,
        estimatedCommission: commissionCases.reduce(
          (sum, clientCase) => sum + (clientCase.estimatedCommission ?? 0),
          0
        ),
        estimatedCommissionCaseCount: commissionCases.length,
      };
    });

    const lastMobileActivityAt = member.lastMobileActivityAt ?? null;
    const attentionReasons = buildAttentionReasons({
      lastMobileActivityAt,
      stalledCount: stalledOpenCases.length,
      missingDocumentsCount: missingDocumentsCases.length,
      noNextActionCount: noNextActionCases.length,
    });

    return {
      advisorId,
      lastMobileActivityAt,
      activeCases: openCases.length,
      pipelineValue,
      estimatedCommissionCaseCount: pipelineValueCases.length,
      issuedThisMonth: {
        month: currentMonth(),
        amount: production.totals.issuedAmount,
        count: production.totals.issuedCount,
      },
      stalledOpenCases: stalledOpenCases.length,
      missingDocumentsCases: missingDocumentsCases.length,
      noNextActionCases: noNextActionCases.length,
      attentionReasons,
      health: attentionReasons.length > 0 ? 'needs_attention' : 'healthy',
      stageDistribution,
      cases: openCases,
    };
  },
};
