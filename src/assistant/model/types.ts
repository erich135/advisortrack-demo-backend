import { z } from 'zod';

export const assistantModelOutcomes = ['answer', 'clarify', 'insufficient_context'] as const;
export type AssistantModelOutcome = (typeof assistantModelOutcomes)[number];

export const assistantModelDecisionSchema = z.object({
  outcome: z.enum(assistantModelOutcomes),
  selectedCardIds: z.array(z.string().min(1).max(80)).max(5),
  selectedToolIds: z.array(z.string().min(1).max(80)).max(8).optional(),
  selectedDerivationIds: z.array(z.string().min(1).max(80)).max(8).optional(),
  intent: z.string().max(120).optional(),
  extractedSlots: z
    .object({
      quantity: z.number().int().nonnegative().optional(),
      subjectRole: z.string().max(80).optional(),
      timeframe: z.string().max(80).optional(),
    })
    .optional(),
  headline: z.string().max(180).optional(),
  body: z.string().max(4000).optional(),
  clarifyingQuestion: z.string().max(240).optional(),
  steps: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        routeId: z.string().min(1).max(80).optional(),
      }),
    )
    .max(8)
    .optional(),
});

export type AssistantModelDecision = z.infer<typeof assistantModelDecisionSchema>;

export type AssistantModelCandidate = {
  id: string;
  title: string;
  summary: string;
  steps: { label: string; routeId?: string }[];
  rules: { id: string; statement: string }[];
  routeIds: string[];
};

export type AssistantModelInput = {
  system: string;
  user: string;
  schemaName: 'AssistantModelDecision';
  timeoutMs: number;
  affinity?: {
    environment: 'production' | 'demo';
    companyId?: string | null;
  };
};

export type AssistantModelUsage = {
  modelName: string;
  latencyMs: number;
  inputUsage?: number;
  cachedInputUsage?: number;
  outputUsage?: number;
  reasoningUsage?: number;
  requestCostUsd?: number;
  providerHttpStatus?: number;
};

export type AssistantModelResult = {
  rawText: string;
  decision: AssistantModelDecision;
  usage?: AssistantModelUsage;
};

export type AssistantModelProvider = {
  id: string;
  complete(input: AssistantModelInput): Promise<AssistantModelResult>;
};

export type AssistantPublicAnswer = {
  answerId: string;
  intent: string;
  confidence: number;
  mode: 'allowed' | 'blocked' | 'not_applicable' | 'unknown' | 'disambiguate' | 'clarify';
  headline: string;
  body: string;
  facts?: { label: string; value: string; source: string }[];
  steps?: { label: string; action?: { type: 'navigate'; routeId: string; path: string; label: string } }[];
  caveats?: string[];
  actions?: { type: 'navigate'; routeId: string; path: string; label: string }[];
  sources: { cardId: string; title: string }[];
  clarifyingQuestion?: string;
  disambiguation?: { cardId: string; label: string; title: string }[];
  escalation?: { label: string; kind: 'support' | 'org_admin' };
};

export type AssistantAskOrigin = 'deterministic' | 'model' | 'fallback';

export type AssistantAskResult = {
  answer: AssistantPublicAnswer;
  origin: AssistantAskOrigin;
  modelAttempted: boolean;
  provenance?: import('../live/types').AnswerProvenance;
};
