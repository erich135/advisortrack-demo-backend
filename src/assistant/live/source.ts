import type { AssistantLicencePool } from '../context';
import { resolveAssistantPeriod, type AssistantPeriod } from './period';
import { LiveScopeMissError } from './errors';
import type {
  DirectoryPerson,
  DirectoryRegion,
  DirectoryTeam,
  LiveDirectorySource,
  PipelineAggregate,
  ProductionTotals,
  ToolExecutionContext,
} from './types';

export type FixturePerson = DirectoryPerson & {
  visibleTo: string[];
  /** When omitted, reporting visibility matches `visibleTo`. */
  reportingVisibleTo?: string[];
};

export type FixtureTeam = DirectoryTeam & {
  visibleTo: string[];
};

export type FixtureRegion = DirectoryRegion & {
  visibleTo: string[];
};

export type FixturePeriodTotals = Record<AssistantPeriod, ProductionTotals>;

export type FixtureService = 'people' | 'licences' | 'production' | 'pipeline' | 'teams' | 'regions';

export function createFixtureLiveSource(input: {
  people: FixturePerson[];
  pools?: Record<string, AssistantLicencePool | null>;
  teams?: FixtureTeam[];
  regions?: FixtureRegion[];
  production?: Record<string, FixturePeriodTotals>;
  pipeline?: Record<string, PipelineAggregate>;
  attention?: Record<string, { stalledCount: number; missingDocumentsCount: number; noNextActionCount: number }>;
  unavailable?: Array<FixtureService>;
  delayMs?: Partial<Record<FixtureService, number>>;
  hang?: FixtureService[];
}): LiveDirectorySource {
  const inCompany = <T extends { companyId: string; visibleTo: string[] }>(
    rows: T[] | undefined,
    ctx: ToolExecutionContext,
  ): T[] => {
    const companyId = ctx.identity.companyId;
    if (!companyId || !rows) return [];
    return rows.filter((row) => row.companyId === companyId && row.visibleTo.includes(ctx.identity.userId));
  };

  const reportingPeople = (ctx: ToolExecutionContext): FixturePerson[] => {
    const companyId = ctx.identity.companyId;
    if (!companyId) return [];
    return input.people.filter((row) => {
      if (row.companyId !== companyId) return false;
      const reporting = row.reportingVisibleTo ?? row.visibleTo;
      return reporting.includes(ctx.identity.userId);
    });
  };

  const assertReportingMembers = (ctx: ToolExecutionContext, memberIds?: string[]): string[] => {
    const allowed = new Set(reportingPeople(ctx).map((person) => person.id));
    if (!memberIds?.length) return [...allowed];
    if (memberIds.some((id) => !allowed.has(id))) {
      throw new LiveScopeMissError();
    }
    return memberIds;
  };

  const sumProduction = (memberIds: string[], period: AssistantPeriod): ProductionTotals => {
    const empty: ProductionTotals = { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 };
    return memberIds.reduce((totals, id) => {
      const row = input.production?.[id]?.[period];
      if (!row) return totals;
      return {
        issuedAmount: totals.issuedAmount + row.issuedAmount,
        issuedCount: totals.issuedCount + row.issuedCount,
        nonIssuedAmount: totals.nonIssuedAmount + row.nonIssuedAmount,
        nonIssuedCount: totals.nonIssuedCount + row.nonIssuedCount,
      };
    }, empty);
  };

  const sumPipeline = (memberIds: string[]): PipelineAggregate => {
    const stageCounts: Record<string, number> = {};
    let totalCases = 0;
    let openCases = 0;
    let pipelineValue = 0;
    let estimatedCommissionCaseCount = 0;
    let hasValue = false;
    for (const id of memberIds) {
      const row = input.pipeline?.[id];
      if (!row) continue;
      totalCases += row.totalCases;
      openCases += row.openCases;
      if (row.pipelineValue != null) {
        pipelineValue += row.pipelineValue;
        hasValue = true;
      }
      estimatedCommissionCaseCount += row.estimatedCommissionCaseCount;
      for (const [stage, count] of Object.entries(row.stageCounts)) {
        stageCounts[stage] = (stageCounts[stage] ?? 0) + count;
      }
    }
    return {
      totalCases,
      openCases,
      stageCounts,
      pipelineValue: hasValue ? pipelineValue : null,
      estimatedCommissionCaseCount,
    };
  };

  const wait = async (service: FixtureService): Promise<void> => {
    if (input.hang?.includes(service)) {
      await new Promise(() => undefined);
    }
    const delay = input.delayMs?.[service];
    if (delay && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  };

  return {
    async listPeople(ctx: ToolExecutionContext, options?: { purpose?: 'directory' | 'reporting' }) {
      await wait('people');
      if (input.unavailable?.includes('people')) throw new Error('people_unavailable');
      if (options?.purpose === 'reporting') return reportingPeople(ctx);
      return inCompany(input.people, ctx);
    },
    async getLicencePool(ctx: ToolExecutionContext) {
      await wait('licences');
      if (input.unavailable?.includes('licences')) throw new Error('licences_unavailable');
      const companyId = ctx.identity.companyId;
      if (!companyId) return null;
      return input.pools?.[companyId] ?? null;
    },
    async listTeams(ctx: ToolExecutionContext) {
      await wait('teams');
      if (input.unavailable?.includes('teams')) throw new Error('teams_unavailable');
      return inCompany(input.teams, ctx);
    },
    async listRegions(ctx: ToolExecutionContext) {
      await wait('regions');
      if (input.unavailable?.includes('regions')) throw new Error('regions_unavailable');
      return inCompany(input.regions, ctx);
    },
    async getProductionTotals(ctx, request) {
      await wait('production');
      if (input.unavailable?.includes('production')) throw new Error('production_unavailable');
      resolveAssistantPeriod(request.period, ctx.now);
      const memberIds = assertReportingMembers(ctx, request.memberIds);
      return sumProduction(memberIds, request.period);
    },
    async getPipelineAggregate(ctx, request) {
      await wait('pipeline');
      if (input.unavailable?.includes('pipeline')) throw new Error('pipeline_unavailable');
      const memberIds = assertReportingMembers(ctx, request.memberIds);
      return sumPipeline(memberIds);
    },
    async listAttentionInputs(ctx) {
      const allowed = new Set(reportingPeople(ctx).map((person) => person.id));
      return Object.entries(input.attention ?? {})
        .filter(([id]) => allowed.has(id))
        .map(([memberId, counts]) => ({ memberId, ...counts }));
    },
  };
}
