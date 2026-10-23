/**
 * Server-built trusted fact pack for model composition.
 * The model receives facts, not permission to browse arbitrary data.
 */
import type { AssistantContext } from './context';
import type { HighLevelIntent } from './intent';
import type { LiveToolFactGroup, RegisteredDerivationOutput } from './live/types';
import { navigationPhrase, productMapFor, trustedMapFacts, workflowInvariants, type AssistantViewport } from './productMap';
import type { ServerKnowledgeCard } from './serverBundle';

export type TrustedFactPack = {
  workspace: AssistantContext['workspace'];
  routeId: string | null;
  path: string;
  intent: HighLevelIntent;
  viewport: AssistantViewport;
  productMapFacts: string[];
  invariants: string[];
  kbFacts: Array<{ id: string; title: string; summary: string; steps: string[] }>;
  pageFact: string | null;
  liveFacts: LiveToolFactGroup[];
  derivations: RegisteredDerivationOutput[];
  navigationHint: string | null;
};

export function buildFactPack(input: {
  context: AssistantContext;
  intent: HighLevelIntent;
  cards: ServerKnowledgeCard[];
  live?: LiveToolFactGroup[];
  derivations?: RegisteredDerivationOutput[];
  viewport?: AssistantViewport;
}): TrustedFactPack {
  const viewport = input.viewport ?? input.context.viewport ?? 'unknown';
  const map = productMapFor(input.context.workspace);
  const pageNode = map.nodes.find((node) => node.routeIds.includes(input.context.route.routeId ?? ''));
  const subjectNode = input.intent.subject
    ? map.nodes.find((node) => node.id === input.intent.subject)
    : pageNode;
  return {
    workspace: input.context.workspace,
    routeId: input.context.route.routeId,
    path: input.context.route.path,
    intent: input.intent,
    viewport,
    productMapFacts: trustedMapFacts(input.context.workspace, input.context.route.routeId),
    invariants: workflowInvariants(input.context.workspace, input.context.capabilities),
    kbFacts: input.cards.slice(0, 6).map((card) => ({
      id: card.id,
      title: card.title,
      summary: card.summary,
      steps: card.steps.map((step) => step.label),
    })),
    pageFact: pageNode ? `${pageNode.label}: ${pageNode.summary}` : null,
    liveFacts: input.live ?? [],
    derivations: input.derivations ?? [],
    navigationHint: subjectNode
      ? navigationPhrase(
        subjectNode.label,
        viewport,
        Boolean(input.context.route.routeId && subjectNode.routeIds.includes(input.context.route.routeId)),
      )
      : null,
  };
}
