import {
  PlatformSupportAdvisorTelemetry,
  PlatformSupportFilters,
  platformSupportRepository,
} from '../repositories/platformSupport.repository';

export interface PlatformSupportCompanyTelemetry {
  companyId: string;
  companyName: string;
  isActive: boolean;
  advisorCount: number;
  activeAccountCount: number;
  activeSubscriptionCount: number;
  caseCount: number;
  openCaseCount: number;
  stageCounts: Record<string, number>;
}

export interface PlatformSupportHealth {
  filters: {
    companyFilterApplied: boolean;
    searchApplied: boolean;
    inactiveDays: number | null;
  };
  companies: PlatformSupportCompanyTelemetry[];
  advisors: PlatformSupportAdvisorTelemetry[];
}

const addStageCounts = (target: Record<string, number>, source: Record<string, number>) => {
  for (const [stage, count] of Object.entries(source)) {
    target[stage] = (target[stage] ?? 0) + count;
  }
};

/** Server-side aggregation for the privacy-safe Platform Support response. */
export const platformSupportService = {
  async getHealth(
    actorUserId: string,
    filters: PlatformSupportFilters,
  ): Promise<PlatformSupportHealth> {
    const advisors = await platformSupportRepository.listAdvisorTelemetry(filters);
    const companiesById = new Map<string, PlatformSupportCompanyTelemetry>();

    for (const advisor of advisors) {
      let company = companiesById.get(advisor.companyId);
      if (!company) {
        company = {
          companyId: advisor.companyId,
          companyName: advisor.companyName,
          isActive: advisor.companyIsActive,
          advisorCount: 0,
          activeAccountCount: 0,
          activeSubscriptionCount: 0,
          caseCount: 0,
          openCaseCount: 0,
          stageCounts: {},
        };
        companiesById.set(advisor.companyId, company);
      }

      company.advisorCount += 1;
      if (advisor.accountIsActive) company.activeAccountCount += 1;
      if (advisor.subscriptionStatus === 'active') company.activeSubscriptionCount += 1;
      company.caseCount += advisor.caseCount;
      company.openCaseCount += advisor.openCaseCount;
      addStageCounts(company.stageCounts, advisor.stageCounts);
    }

    const companies = [...companiesById.values()].sort((left, right) =>
      left.companyName.localeCompare(right.companyName),
    );
    const result: PlatformSupportHealth = {
      filters: {
        companyFilterApplied: Boolean(filters.companyId),
        searchApplied: Boolean(filters.search),
        inactiveDays: filters.inactiveDays ?? null,
      },
      companies,
      advisors,
    };

    await platformSupportRepository.recordSupportRead(actorUserId, {
      ...result.filters,
      companyCount: companies.length,
      advisorCount: advisors.length,
    });

    return result;
  },
};
