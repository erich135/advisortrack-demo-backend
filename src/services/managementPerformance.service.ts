import { AppError } from '../middleware/errorHandler';
import {
  comparisonRankFor,
  HierarchyRank,
  RANK_LABELS,
  rankFromRoleName,
  resolveHierarchyRank,
} from '../features/customerHierarchy';
import {
  DEFAULT_PERFORMANCE_PERIOD,
  isPerformancePeriod,
  PerformancePeriod,
  resolvePerformancePeriod,
} from '../features/performancePeriod';
import {
  buildDownlineIndex,
  pickTopAndWorst,
  RankedUnit,
  sumDownlineIssued,
} from '../features/performanceRanking';
import { managementPerformanceRepository } from '../repositories/managementPerformance.repository';
import { organisationService } from './organisation.service';

export type ManagementPerformer = {
  userId: string;
  name: string;
  role: string;
  issuedAmount: number;
};

export type ManagementPerformanceResponse = {
  period: PerformancePeriod;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  comparisonRole: string | null;
  scopeKind: 'organisation' | 'region' | 'team';
  topPerformer: ManagementPerformer | null;
  worstPerformer: ManagementPerformer | null;
  emptyReason: 'no_subordinates' | 'no_issued_cases' | 'single_subordinate' | 'tied' | null;
  emptyMessage: string | null;
};

const EMPTY_MESSAGES: Record<NonNullable<ManagementPerformanceResponse['emptyReason']>, string> = {
  no_subordinates: 'No issued cases for selected period',
  no_issued_cases: 'No issued cases for selected period',
  single_subordinate: 'Not enough people to compare',
  tied: 'Issued totals are tied for the selected period',
};

const unitName = (firstName: string, lastName: string): string =>
  `${firstName} ${lastName}`.trim() || 'Unnamed';

const toPerformer = (unit: RankedUnit | null): ManagementPerformer | null =>
  unit
    ? {
        userId: unit.userId,
        name: unit.name,
        role: unit.role,
        issuedAmount: unit.issuedAmount,
      }
    : null;

/**
 * Leadership Top / Worst Performer from issued production in the caller's scope.
 */
export const managementPerformanceService = {
  async getPerformance(
    userId: string,
    periodInput?: string
  ): Promise<ManagementPerformanceResponse> {
    if (periodInput !== undefined && !isPerformancePeriod(periodInput)) {
      throw new AppError(400, 'period must be last_week, last_month, or year_to_date', 'VALIDATION_ERROR');
    }

    const period = periodInput ?? DEFAULT_PERFORMANCE_PERIOD;
    const range = resolvePerformancePeriod(period);
    const scope = await organisationService.resolveManagementScope(userId);
    const comparisonRank = comparisonRankFor(scope.rank);

    if (!comparisonRank) {
      throw new AppError(403, 'This portal is for leadership roles', 'FORBIDDEN');
    }

    const members = await organisationService.listScopedMemberRecords(userId);
    const comparisonUnits = members.filter((member) => {
      if (member.id === userId) return false;
      const rank = resolveHierarchyRank({
        isPlatformAdmin: member.isPlatformAdmin,
        roleName: member.roleName,
        permissions: member.permissions,
      });
      return rank === comparisonRank;
    });

    const issuedByUserId = await managementPerformanceRepository.sumIssuedByUser(
      scope.userIds,
      range.startDate,
      range.endDate
    );
    const downline = buildDownlineIndex(
      members.map((member) => ({ id: member.id, reportsToUserId: member.reportsToUserId }))
    );

    const units: RankedUnit[] = comparisonUnits.map((member) => ({
      userId: member.id,
      name: unitName(member.firstName, member.lastName),
      role: rankFromRoleName(member.roleName)
        ? RANK_LABELS[rankFromRoleName(member.roleName) as HierarchyRank]
        : member.roleName || RANK_LABELS[comparisonRank],
      issuedAmount: sumDownlineIssued(member.id, issuedByUserId, downline),
    }));

    const picked = pickTopAndWorst(units);
    let emptyMessage: string | null = null;
    if (picked.emptyReason === 'no_subordinates') {
      emptyMessage = `No ${RANK_LABELS[comparisonRank]}s to compare`;
    } else if (picked.emptyReason) {
      emptyMessage = EMPTY_MESSAGES[picked.emptyReason];
    }

    return {
      period: range.period,
      periodLabel: range.label,
      periodStart: range.startDate,
      periodEnd: range.endDate,
      timezone: range.timezone,
      comparisonRole: RANK_LABELS[comparisonRank],
      scopeKind: scope.kind,
      topPerformer: toPerformer(picked.top),
      worstPerformer: toPerformer(picked.worst),
      emptyReason: picked.emptyReason,
      emptyMessage,
    };
  },
};
