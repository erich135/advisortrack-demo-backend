/** Demo adapter: organisation live source against advisortrack_demo only. Never calls production. */
import { AppError } from '../../middleware/errorHandler';
import { RANK_LABELS, type HierarchyRank } from '../../features/customerHierarchy';
import {
  hasNoNextAction,
  isMissingDocuments,
  isStalledOpenCase,
} from '../../features/advisorAttention';
import { summariseManagementPipelineCases } from '../../services/managementPipeline.service';
import { managementPipelineService } from '../../services/managementPipeline.service';
import { managementProductionService } from '../../services/managementProduction.service';
import { organisationService } from '../../services/organisation.service';
import { organisationStructureService } from '../../services/organisationStructure.service';
import { cachedTtlLoad, liveCacheKey, liveScopeFingerprint, remember } from './cache';
import { LiveScopeMissError } from './errors';
import { ttlMsFor } from './limits';
import { resolveAssistantPeriod } from './period';
import { sanitizePipelineAggregate, sanitizeProductionTotals } from './sanitize';
import type {
  DirectoryPerson,
  DirectoryRegion,
  DirectoryTeam,
  LiveDirectorySource,
  PipelineAggregate,
  ToolExecutionContext,
} from './types';

type MemberDto = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  rank?: HierarchyRank;
  rankLabel?: string;
  team?: { id: string; name: string } | null;
  region?: { id: string; name: string } | null;
  accountStatus?: string;
  licenceStatus?: 'Licensed' | 'Unlicensed' | string | null;
  invitationStatus?: string | null;
  lastMobileActivityAt?: string | null;
  reportsToUserId?: string | null;
  company?: { id: string } | null;
};

function asDirectoryPerson(member: MemberDto, companyId: string, environment: 'production' | 'demo'): DirectoryPerson {
  const rank = member.rank;
  return {
    id: member.id,
    companyId,
    firstName: member.firstName,
    lastName: member.lastName,
    reportingRoleLabel: member.rankLabel || (rank ? RANK_LABELS[rank] : 'Unknown'),
    rank: rank ?? null,
    reportsToUserId: member.reportsToUserId ?? null,
    teamId: member.team?.id ?? null,
    teamName: member.team?.name ?? null,
    regionId: member.region?.id ?? null,
    regionName: member.region?.name ?? null,
    accountStatus: member.accountStatus === 'Inactive' ? 'Inactive' : 'Active',
    licenceStatus: member.licenceStatus === 'Licensed' ? 'Licensed' : member.licenceStatus === 'Unlicensed' ? 'Unlicensed' : null,
    invitationStatus: member.invitationStatus ?? null,
    lastMobileActivityAt: member.lastMobileActivityAt ?? null,
    email: environment === 'demo' ? member.email ?? null : null,
    phone: environment === 'demo' ? member.phone ?? null : null,
  };
}

function isScopeMiss(error: unknown): boolean {
  return error instanceof AppError && (error.statusCode === 403 || error.statusCode === 404);
}

async function directoryMembers(ctx: ToolExecutionContext): Promise<DirectoryPerson[]> {
  if (!ctx.assistant.capabilities.canViewUsers && !ctx.assistant.capabilities.canViewAdvisors) {
    return [];
  }
  if (!ctx.identity.companyId) return [];
  return remember(ctx, liveCacheKey(['org', 'people', 'directory', ctx.identity.userId, ctx.identity.companyId]), () => (
    cachedTtlLoad(liveCacheKey(['org', liveScopeFingerprint(ctx), 'people', 'directory']), ttlMsFor('people'), async () => {
      const members = (await organisationService.listMyMembers(ctx.identity.userId)) as MemberDto[];
      return members.map((member) => asDirectoryPerson(member, ctx.identity.companyId as string, ctx.environment));
    })
  ));
}

async function reportingMembers(ctx: ToolExecutionContext): Promise<DirectoryPerson[]> {
  if (!ctx.assistant.role.hasLeadershipPortalAccess || ctx.assistant.role.isPlatformStaff) {
    return [];
  }
  if (!ctx.identity.companyId) return [];
  return remember(ctx, liveCacheKey(['org', 'people', 'reporting', ctx.identity.userId, ctx.identity.companyId]), () => (
    cachedTtlLoad(liveCacheKey(['org', liveScopeFingerprint(ctx), 'people', 'reporting']), ttlMsFor('people'), async () => {
      const members = (await organisationService.listReportingMembers(ctx.identity.userId)) as MemberDto[];
      return members.map((member) => asDirectoryPerson(member, ctx.identity.companyId as string, ctx.environment));
    })
  ));
}

async function peopleFor(ctx: ToolExecutionContext, purpose: 'directory' | 'reporting' = 'directory'): Promise<DirectoryPerson[]> {
  return purpose === 'reporting' ? reportingMembers(ctx) : directoryMembers(ctx);
}

function assertReportingMemberIds(reportingIds: Set<string>, memberIds?: string[]): string[] | undefined {
  if (!memberIds?.length) return memberIds;
  if (memberIds.some((id) => !reportingIds.has(id))) {
    throw new LiveScopeMissError();
  }
  return memberIds;
}

export function createOrganisationLiveSource(): LiveDirectorySource {
  return {
    async listPeople(ctx: ToolExecutionContext, options?: { purpose?: 'directory' | 'reporting' }) {
      try {
        return await peopleFor(ctx, options?.purpose ?? 'directory');
      } catch (error) {
        if (error instanceof LiveScopeMissError) throw error;
        if (isScopeMiss(error)) return [];
        throw error;
      }
    },
    async getLicencePool(ctx: ToolExecutionContext) {
      if (!ctx.assistant.capabilities.canViewLicences || !ctx.identity.companyId) return null;
      try {
        return await organisationService.getLicencePool(ctx.identity.userId);
      } catch (error) {
        if (isScopeMiss(error)) return null;
        throw error;
      }
    },
    async listTeams(ctx: ToolExecutionContext) {
      if (!ctx.identity.companyId || !ctx.identity.canViewTeams) return [];
      try {
        const [teams, people] = await Promise.all([
          organisationStructureService.listTeams(ctx.identity.userId),
          reportingMembers(ctx),
        ]);
        return teams.map((team): DirectoryTeam => {
          const members = people.filter((person) => person.teamId === team.id);
          return {
            id: team.id,
            companyId: ctx.identity.companyId as string,
            name: team.name,
            regionName: team.regionName ?? null,
            leaderName: team.leaderName ?? null,
            memberIds: members.map((member) => member.id),
            advisorCount: members.filter((member) => member.rank === 'financial_advisor').length,
          };
        });
      } catch (error) {
        if (isScopeMiss(error)) return [];
        throw error;
      }
    },
    async listRegions(ctx: ToolExecutionContext) {
      if (!ctx.identity.companyId || !ctx.identity.canViewRegions) return [];
      try {
        const [regions, teams, people] = await Promise.all([
          organisationStructureService.listRegions(ctx.identity.userId),
          organisationStructureService.listTeams(ctx.identity.userId).catch(() => []),
          reportingMembers(ctx),
        ]);
        return regions.map((region): DirectoryRegion => {
          const members = people.filter((person) => person.regionId === region.id);
          return {
            id: region.id,
            companyId: ctx.identity.companyId as string,
            name: region.name,
            managerName: region.managerName ?? null,
            memberIds: members.map((member) => member.id),
            teamCount: teams.filter((team) => team.regionName === region.name || team.regionId === region.id).length,
            advisorCount: members.filter((member) => member.rank === 'financial_advisor').length,
          };
        });
      } catch (error) {
        if (isScopeMiss(error)) return [];
        throw error;
      }
    },
    async getProductionTotals(ctx, request) {
      if (!ctx.assistant.capabilities.canViewProduction) return null;
      const range = resolveAssistantPeriod(request.period, ctx.now);
      const key = liveCacheKey([
        'org',
        liveScopeFingerprint(ctx),
        'production',
        request.period,
        range.startDate,
        range.endDate,
        (request.memberIds ?? []).slice().sort().join(','),
      ]);
      return remember(ctx, key, () => cachedTtlLoad(key, ttlMsFor('production', request.period), async () => {
        try {
          const reportingIds = new Set((await reportingMembers(ctx)).map((person) => person.id));
          const memberIds = assertReportingMemberIds(reportingIds, request.memberIds);
          const summary = await managementProductionService.getRangeSummary(
            ctx.identity.userId,
            range.startDate,
            range.endDate,
            memberIds,
          );
          return sanitizeProductionTotals({
            issuedAmount: summary.issuedAmount,
            issuedCount: summary.issuedCount,
            nonIssuedAmount: summary.nonIssuedAmount,
            nonIssuedCount: summary.nonIssuedCount,
          }, { synthetic: ctx.dataIsSynthetic });
        } catch (error) {
          if (error instanceof LiveScopeMissError) throw error;
          if (isScopeMiss(error) && request.memberIds?.length) throw new LiveScopeMissError();
          if (isScopeMiss(error)) return null;
          throw error;
        }
      }));
    },
    async getPipelineAggregate(ctx, request): Promise<PipelineAggregate | null> {
      if (!ctx.assistant.capabilities.canViewPipeline) return null;
      const key = liveCacheKey([
        'org',
        liveScopeFingerprint(ctx),
        'pipeline',
        (request.memberIds ?? []).slice().sort().join(','),
      ]);
      return remember(ctx, key, () => cachedTtlLoad(key, ttlMsFor('pipeline'), async () => {
        try {
          const reportingIds = new Set((await reportingMembers(ctx)).map((person) => person.id));
          const memberIds = assertReportingMemberIds(reportingIds, request.memberIds);
          const advisorId = memberIds?.length === 1 ? memberIds[0] : undefined;
          const pipeline = await managementPipelineService.getPipeline(ctx.identity.userId, {
            advisorId,
          });
          const cases = advisorId || !memberIds?.length
            ? pipeline.cases
            : pipeline.cases.filter((row) => memberIds?.includes(row.advisor.userId));
          const summary = summariseManagementPipelineCases(cases);
          return sanitizePipelineAggregate({
            totalCases: summary.overviewCaseCount,
            openCases: summary.overviewActiveCaseCount,
            stageCounts: summary.stageCounts,
            pipelineValue: summary.estimatedCommissionCaseCount > 0 ? summary.totalEstimatedCommission : null,
            estimatedCommissionCaseCount: summary.estimatedCommissionCaseCount,
          }, { synthetic: ctx.dataIsSynthetic });
        } catch (error) {
          if (error instanceof LiveScopeMissError) throw error;
          if (isScopeMiss(error) && request.memberIds?.length) throw new LiveScopeMissError();
          if (isScopeMiss(error)) return null;
          throw error;
        }
      }));
    },
    async listAttentionInputs(ctx) {
      if (!ctx.assistant.capabilities.canViewPipeline && !ctx.assistant.capabilities.canViewAdvisors) {
        return [];
      }
      try {
        const pipeline = await managementPipelineService.getPipeline(ctx.identity.userId, {});
        const counts = new Map<string, { stalledCount: number; missingDocumentsCount: number; noNextActionCount: number }>();
        for (const clientCase of pipeline.cases) {
          const memberId = clientCase.advisor.userId;
          const current = counts.get(memberId) ?? { stalledCount: 0, missingDocumentsCount: 0, noNextActionCount: 0 };
          if (isStalledOpenCase(clientCase, ctx.now)) current.stalledCount += 1;
          if (isMissingDocuments(clientCase)) current.missingDocumentsCount += 1;
          if (hasNoNextAction(clientCase)) current.noNextActionCount += 1;
          counts.set(memberId, current);
        }
        return [...counts.entries()].map(([memberId, row]) => ({ memberId, ...row }));
      } catch (error) {
        if (isScopeMiss(error)) return [];
        throw error;
      }
    },
  };
}
