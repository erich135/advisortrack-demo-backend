/**
 * Pipeline types mirrored from Abel Backend. Do not author cards here.
 * Runtime model calls are server-side only. No assistant database tables.
 */

export const ASSISTANT_REPOSITORIES = [
  'advisor_track_backend',
  'Advisor-Track-Dashboard',
  'advisortrack-demo-backend',
  'advisortrack-demo-frontend',
] as const;

export type AssistantRepository = (typeof ASSISTANT_REPOSITORIES)[number];

export const CARD_KINDS = [
  'concept',
  'task',
  'troubleshoot',
  'policy',
  'route',
  'glossary',
  'blocked',
] as const;

export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_AUDIENCES = ['customer', 'staff', 'both'] as const;
export type CardAudience = (typeof CARD_AUDIENCES)[number];

export const CARD_ENVIRONMENTS = ['both', 'production', 'demo'] as const;
export type CardEnvironment = (typeof CARD_ENVIRONMENTS)[number];

export const ROUTE_CLASSIFICATIONS = ['customer', 'internal', 'demo'] as const;
export type RouteClassification = (typeof ROUTE_CLASSIFICATIONS)[number];

export const REQUIRED_FACT_KEYS = [
  'licencePool',
  'pendingLicenceRequests',
  'unlicensedMembers',
] as const;
export type RequiredFactKey = (typeof REQUIRED_FACT_KEYS)[number];

export type SourceFileRef = {
  repository: AssistantRepository;
  path: string;
};

export type KnowledgeStep = {
  label: string;
  routeId?: string;
};

export type KnowledgeCard = {
  id: string;
  kind: CardKind;
  title: string;
  aliases: string[];
  questionForms: string[];
  audience: CardAudience;
  environment: CardEnvironment;
  requiredCapabilities: string[];
  routes: string[];
  category: string;
  summary: string;
  steps: KnowledgeStep[];
  requiredFacts: RequiredFactKey[];
  preconditions: string[];
  blockedGuidance: string | null;
  businessRules: string[];
  sourceFiles: SourceFileRef[];
  lastVerifiedCommit: string;
  owner: string;
};

export type AssistantCategory = {
  id: string;
  label: string;
  environment: CardEnvironment;
  description: string;
};

/** Home-panel topic chips. Labels come from the category registry except Bulk Import, which is a route filter over People & Access cards. */
export type AssistantHomeTopic = {
  id: string;
  label: string;
  categoryId: string;
  environment: CardEnvironment;
  routeIds?: string[];
};

export type AssistantCapability = {
  key: string;
  helper: string;
  repositories: AssistantRepository[];
  description: string;
};

export type AssistantRoute = {
  routeId: string;
  path: string;
  label: string;
  environment: CardEnvironment;
  classification: RouteClassification;
  /** Capability required in the production portal. Null = any signed-in portal session. */
  productionCapability: string | null;
  /** Capability required in the demo portal when it differs. */
  demoCapability?: string | null;
  demoLabel?: string;
};

export type BusinessRule = {
  id: string;
  title: string;
  statement: string;
  sourceFiles: SourceFileRef[];
};

export type DangerFile = {
  repository: AssistantRepository;
  path: string;
  reason: string;
};

export type KnowledgeBase = {
  version: string;
  categories: AssistantCategory[];
  homeTopics: AssistantHomeTopic[];
  capabilities: AssistantCapability[];
  routes: AssistantRoute[];
  rules: BusinessRule[];
  dangerFiles: DangerFile[];
  cards: KnowledgeCard[];
};

export type FrontendKnowledgeCard = Pick<
  KnowledgeCard,
  | 'id'
  | 'kind'
  | 'title'
  | 'aliases'
  | 'questionForms'
  | 'audience'
  | 'environment'
  | 'requiredCapabilities'
  | 'routes'
  | 'category'
  | 'summary'
  | 'steps'
  | 'blockedGuidance'
  | 'requiredFacts'
>;

export type FrontendKnowledgeRoute = {
  routeId: string;
  path: string;
  label: string;
  environment: CardEnvironment;
  classification: RouteClassification;
  demoLabel?: string;
  classificationProduction: RouteClassification;
  classificationDemo: RouteClassification;
  productionCapability: string | null;
  demoCapability?: string | null;
};

export type FrontendKnowledgeBundle = {
  version: string;
  categories: AssistantCategory[];
  homeTopics: AssistantHomeTopic[];
  routes: FrontendKnowledgeRoute[];
  cards: FrontendKnowledgeCard[];
};

export type ValidationIssue = {
  code: string;
  message: string;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

export type CardFilter = {
  environment: 'production' | 'demo';
  audience: 'customer' | 'staff';
  /** When set, cards whose requiredCapabilities are unmet are hidden. */
  capabilities?: Record<string, boolean>;
};
