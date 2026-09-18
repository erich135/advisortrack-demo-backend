import {
  alreadyOnRouteMessage,
  routeReachable,
  type AssistantContext,
  type AssistantLicencePool,
} from '../context';
import { publicFactSource } from '../live/classify';
import { ASSISTANT_PERIOD_LABELS } from '../live/period';
import { labelForRoute } from '../routes';
import type { AssistantRoute } from '../types';
import type { LiveToolFactGroup } from '../live/types';
import type { ServerKnowledgeCard } from '../serverBundle';
import type { AssistantModelDecision, AssistantPublicAnswer } from './types';

function isConcretePath(path: string): boolean {
  return !path.includes(':');
}

function formatPoolCount(value: number | null): string {
  return value == null ? 'Unlimited' : String(value);
}

function licenceFacts(pool: AssistantLicencePool): AssistantPublicAnswer['facts'] {
  return [
    { label: 'Purchased', value: formatPoolCount(pool.purchased), source: 'Company licence pool' },
    { label: 'Assigned', value: String(pool.assigned), source: 'Company licence pool' },
    { label: 'Available', value: formatPoolCount(pool.available), source: 'Company licence pool' },
  ];
}

export function navigateActionForRoute(
  routes: AssistantRoute[],
  routeId: string,
  context: AssistantContext,
) {
  const route = routes.find((item) => item.routeId === routeId);
  if (!route || !isConcretePath(route.path.split('?')[0] || route.path)) return undefined;
  if (!routeReachable(route, context)) return undefined;
  if (route.routeId === context.route.routeId) return undefined;
  return {
    type: 'navigate' as const,
    routeId: route.routeId,
    path: route.path.split('?')[0] || route.path,
    label: `Open ${labelForRoute(route, context.environment)}`,
  };
}

export function unknownHelpAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'unknown',
    intent: 'unknown',
    confidence: 0,
    mode: 'unknown',
    headline: "I don't have an article for that",
    body: "I only use AdvisorTrack help articles you are allowed to see. I don't guess. Try a topic below, or ask about a specific page such as Licences, Users & Access, or Invoices.",
    sources: [],
  };
}

export function disambiguationAnswer(cards: ServerKnowledgeCard[]): AssistantPublicAnswer {
  return {
    answerId: `disambiguate:${cards.map((card) => card.id).join(',')}`,
    intent: 'disambiguate',
    confidence: 0.5,
    mode: 'disambiguate',
    headline: 'Which of these did you mean?',
    body: 'A few help articles could match your question. Choose one — I will not guess.',
    clarifyingQuestion: 'Which of these did you mean?',
    disambiguation: cards.map((card) => ({
      cardId: card.id,
      label: card.questionForms[0] || card.title,
      title: card.title,
    })),
    sources: cards.map((card) => ({ cardId: card.id, title: card.title })),
  };
}

function formatFactValue(value: string | number | boolean | null): string {
  if (value == null) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export function answerFromGrounding(input: {
  cards: ServerKnowledgeCard[];
  tools: LiveToolFactGroup[];
  context: AssistantContext;
  routes: AssistantRoute[];
  decision: AssistantModelDecision;
  liveFacts?: AssistantPublicAnswer['facts'];
}): AssistantPublicAnswer {
  const { cards, tools, context, routes, decision } = input;
  const selectedTools = (decision.selectedToolIds ?? [])
    .map((id) => tools.find((tool) => tool.tool === id))
    .filter((tool): tool is LiveToolFactGroup => Boolean(tool));
  const toolFacts = selectedTools.flatMap((tool) =>
    Object.entries(tool.facts)
      .filter(([, value]) => value != null && value !== false)
      .map(([label, value]) => ({
        label,
        value: formatFactValue(value),
        source: publicFactSource(
          tool.tool,
          tool.period ? ASSISTANT_PERIOD_LABELS[tool.period] : undefined,
        ),
      })),
  );
  const fromCards = cards.length
    ? answerFromCards(cards, context, routes, decision)
    : undefined;
  const steps = decision.steps?.length
    ? decision.steps.map((step) => {
      if (step.routeId && step.routeId === context.route.routeId) {
        const route = routes.find((item) => item.routeId === step.routeId);
        if (route) return { label: alreadyOnRouteMessage(route, context.environment) };
      }
      return { label: step.label };
    })
    : fromCards?.steps;
  const headline = decision.headline?.trim()
    || fromCards?.headline
    || selectedTools[0]?.facts.displayName
    || selectedTools[0]?.tool
    || 'AdvisorTrack';
  const body = decision.body?.trim()
    || fromCards?.body
    || '';
  const sources = [
    ...(fromCards?.sources ?? []),
    ...selectedTools.map((tool) => ({ cardId: tool.tool, title: tool.tool.replace(/_/g, ' ') })),
  ].filter((source, index, list) => list.findIndex((item) => item.cardId === source.cardId) === index);

  return {
    answerId: [
      ...cards.map((card) => card.id),
      ...selectedTools.map((tool) => tool.tool),
    ].join('+') || 'composed',
    intent: decision.intent || fromCards?.intent || selectedTools[0]?.tool || 'composed',
    confidence: 0.85,
    mode: 'allowed',
    headline: typeof headline === 'string' ? headline : String(headline),
    body,
    facts: input.liveFacts?.length ? input.liveFacts : (toolFacts.length ? toolFacts : fromCards?.facts),
    steps,
    actions: fromCards?.actions,
    sources,
    caveats: fromCards?.caveats,
  };
}

export function answerFromCards(
  cards: ServerKnowledgeCard[],
  context: AssistantContext,
  routes: AssistantRoute[],
  decision?: Pick<AssistantModelDecision, 'headline' | 'body' | 'intent'>,
): AssistantPublicAnswer {
  const primary = cards[0];
  if (!primary) return unknownHelpAnswer();

  const steps = cards.flatMap((card) =>
    card.steps.map((step) => {
      if (step.routeId && step.routeId === context.route.routeId) {
        const route = routes.find((item) => item.routeId === step.routeId);
        if (route) return { label: alreadyOnRouteMessage(route, context.environment) };
      }
      return { label: step.label };
    }),
  );

  const actions = cards
    .flatMap((card) => card.steps.map((step) => step.routeId).filter((id): id is string => Boolean(id)))
    .map((routeId) => navigateActionForRoute(routes, routeId, context))
    .filter((action): action is NonNullable<typeof action> => Boolean(action))
    .filter((action, index, list) => list.findIndex((item) => item.routeId === action.routeId) === index);

  const needsPool = cards.some((card) => card.requiredFacts?.includes('licencePool'));
  const facts = needsPool && context.facts?.licencePool ? licenceFacts(context.facts.licencePool) : undefined;

  return {
    answerId: cards.map((card) => card.id).join('+'),
    intent: decision?.intent || primary.id,
    confidence: cards.length > 1 ? 0.8 : 1,
    mode: 'allowed',
    headline: decision?.headline?.trim() || (cards.length > 1 ? 'Recommended plan' : primary.title),
    body: decision?.body?.trim() || cards.map((card) => card.summary).join(' '),
    facts,
    steps: steps.length ? steps : undefined,
    actions: actions.length ? actions : undefined,
    sources: cards.map((card) => ({ cardId: card.id, title: card.title })),
  };
}

export function clarifyAnswer(question: string, selected: ServerKnowledgeCard[]): AssistantPublicAnswer {
  return {
    answerId: `clarify:${selected.map((card) => card.id).join(',') || 'none'}`,
    intent: 'clarify',
    confidence: 0.4,
    mode: 'clarify',
    headline: 'I need one more detail',
    body: 'I can help from AdvisorTrack articles you are allowed to see, but I need a little more information.',
    clarifyingQuestion: question,
    sources: selected.map((card) => ({ cardId: card.id, title: card.title })),
  };
}
