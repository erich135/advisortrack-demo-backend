import type { AssistantContext, AssistantEnvironment, AssistantLicencePool, TrustedAssistantIdentity } from '../context';
import type { CardEnvironment } from '../types';
import type { DataClass } from './classify';
import type { AssistantPeriod } from './period';

export type EntityKind = 'person' | 'team' | 'region' | 'company' | 'invoice';
export type EntityRef = string;

export type EntityMatchTier = 'exact_full_name' | 'unique_surname' | 'unique_given_name' | 'fuzzy';

export type ToolDomain = 'people' | 'licensing' | 'reporting';
export type ToolAudience = 'portal_management' | 'portal_org_admin' | 'platform_staff' | 'mobile_advisor';
export type ToolAuditClass = 'none' | 'read_summary' | 'read_person' | 'sensitive_read';
export type ToolScopeResolver = 'management_reporting' | 'administrative' | 'self';
export type LivePeoplePurpose = 'directory' | 'reporting';

export type DirectoryPerson = {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  reportingRoleLabel: string;
  rank?: string | null;
  reportsToUserId?: string | null;
  teamId?: string | null;
  teamName: string | null;
  regionId?: string | null;
  regionName: string | null;
  accountStatus: 'Active' | 'Inactive';
  licenceStatus: 'Licensed' | 'Unlicensed' | null;
  invitationStatus: string | null;
  lastMobileActivityAt: string | null;
  email?: string | null;
  phone?: string | null;
};

export type DirectoryTeam = {
  id: string;
  companyId: string;
  name: string;
  regionName: string | null;
  leaderName: string | null;
  memberIds: string[];
  advisorCount: number;
};

export type DirectoryRegion = {
  id: string;
  companyId: string;
  name: string;
  managerName: string | null;
  memberIds: string[];
  teamCount: number;
  advisorCount: number;
};

export type ProductionTotals = {
  issuedAmount: number;
  issuedCount: number;
  nonIssuedAmount: number;
  nonIssuedCount: number;
};

export type PipelineAggregate = {
  totalCases: number;
  openCases: number;
  stageCounts: Record<string, number>;
  pipelineValue: number | null;
  estimatedCommissionCaseCount: number;
};

export type StoredEntity = {
  kind: EntityKind;
  internalId: string;
  companyId: string;
};

export type TurnRefTable = {
  turnId: string;
  entries: Map<EntityRef, StoredEntity>;
};

export type ResolvedLiveScope = {
  resolver: ToolScopeResolver | 'platform_minimised';
  reportingResolver: 'management_reporting' | 'self' | 'none';
  directoryResolver: 'administrative' | 'management_reporting' | 'self' | 'none';
  scopeKind: AssistantContext['role']['scopeKind'];
  companyId: string | null;
};

export type ToolExecutionContext = {
  turnId: string;
  environment: AssistantEnvironment;
  /** Demo seeded data is synthetic; production privacy redaction does not apply. */
  dataIsSynthetic: boolean;
  identity: TrustedAssistantIdentity;
  assistant: AssistantContext;
  scope: ResolvedLiveScope;
  refs: TurnRefTable;
  now: Date;
  deadlineAt: number;
  memo: Map<string, Promise<unknown>>;
  maxFetches: number;
  stats: {
    fetches: number;
    cacheHits: number;
    cacheMisses: number;
    timeouts: number;
    circuitOpen: number;
    toolMs: number;
  };
};

export type PersonSummaryProjection = {
  displayName: string;
  reportingRoleLabel: string;
  teamName: string | null;
  regionName: string | null;
  accountStatus: 'Active' | 'Inactive';
  licenceStatus: 'Licensed' | 'Unlicensed' | null;
  invitationStatus: string | null;
  lastMobileActivity: string | null;
  email: string | null;
  phone: string | null;
};

export type LicenceSummaryProjection = {
  purchased: number | null;
  assigned: number;
  available: number | null;
};

export type AdvisorSummaryProjection = {
  person: PersonSummaryProjection;
  periodLabel: string;
  production: ProductionTotals | null;
  openPipelineCases: number | null;
  pipelineValue: number | null;
};

export type ProductionSummaryProjection = {
  subjectName: string;
  periodLabel: string;
  production: ProductionTotals;
};

export type PipelineSummaryProjection = {
  subjectName: string;
  totalCases: number;
  openCases: number;
  stageCounts: Array<{ label: string; count: number }>;
  pipelineValue: number | null;
};

export type TeamSummaryProjection = {
  name: string;
  leaderName: string | null;
  regionName: string | null;
  advisorCount: number;
  periodLabel: string;
  production: ProductionTotals | null;
  openPipelineCases: number | null;
  pipelineValue: number | null;
};

export type RegionSummaryProjection = {
  name: string;
  managerName: string | null;
  teamCount: number;
  advisorCount: number;
  periodLabel: string;
  production: ProductionTotals | null;
  openPipelineCases: number | null;
  pipelineValue: number | null;
};

export type LiveDirectorySource = {
  listPeople(
    ctx: ToolExecutionContext,
    options?: { purpose?: LivePeoplePurpose },
  ): Promise<DirectoryPerson[]>;
  getLicencePool(ctx: ToolExecutionContext): Promise<AssistantLicencePool | null>;
  listTeams?(ctx: ToolExecutionContext): Promise<DirectoryTeam[]>;
  listRegions?(ctx: ToolExecutionContext): Promise<DirectoryRegion[]>;
  getProductionTotals?(
    ctx: ToolExecutionContext,
    input: { period: AssistantPeriod; memberIds?: string[] },
  ): Promise<ProductionTotals | null>;
  getPipelineAggregate?(
    ctx: ToolExecutionContext,
    input: { memberIds?: string[] },
  ): Promise<PipelineAggregate | null>;
  listAttentionInputs?(
    ctx: ToolExecutionContext,
  ): Promise<Array<{
    memberId: string;
    stalledCount: number;
    missingDocumentsCount: number;
    noNextActionCount: number;
  }>>;
};

export type ProvenanceItem =
  | { kind: 'tool'; toolId: string; version: number; entityRef?: EntityRef; period?: AssistantPeriod }
  | { kind: 'derivation'; derivationId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'rule'; ruleId: string };

export type FactTrace = {
  field: string;
  toolId: string;
  version: number;
  entityRef?: EntityRef;
  period?: AssistantPeriod;
  dataClass: DataClass;
  derivationId?: string;
};

export type AnswerProvenance = {
  turnId: string;
  origin: 'deterministic' | 'model' | 'fallback';
  items: ProvenanceItem[];
  factTraces: FactTrace[];
  knowledgeCards: string[];
  businessRules: string[];
  modelCalled: boolean;
  toolsAttempted: string[];
  toolsUsed: string[];
  toolsUnavailable: string[];
  cacheHits: number;
  cacheMisses: number;
  toolTimeouts: number;
  circuitOpen: number;
    promptChars?: number;
    candidateCount?: number;
    toolProjectionCount?: number;
    validatorRejectionCode?: string;
    modelName?: string;
    modelLatencyMs?: number;
    inputUsage?: number;
    cachedInputUsage?: number;
    outputUsage?: number;
    reasoningUsage?: number;
    requestCostUsd?: number;
    providerHttpStatus?: number;
  };

export type LiveToolFactGroup = {
  tool: string;
  version: number;
  entity?: EntityRef;
  period?: AssistantPeriod;
  facts: Record<string, string | number | boolean | null>;
};

export type RegisteredDerivationOutput = {
  derivationId: string;
  facts: Record<string, string | number | boolean | null>;
};


export type AssistantToolDefinition = {
  id: string;
  version: number;
  title: string;
  domain: ToolDomain;
  audiences: ToolAudience[];
  environments: CardEnvironment[];
  requiredCapabilities: string[];
  scopeResolver: ToolScopeResolver;
  acceptsEntityKinds: EntityKind[];
  limits: { maxRows: number; timeoutMs: number };
  cache: { ttlSeconds: number; keyBy: Array<'company' | 'scope' | 'entity' | 'period'> };
  auditClass: ToolAuditClass;
};

export class ForgedEntityRefError extends Error {
  readonly code = 'forged_entity_ref';
  constructor(ref: string) {
    super(`forged_entity_ref:${ref}`);
    this.name = 'ForgedEntityRefError';
  }
}
