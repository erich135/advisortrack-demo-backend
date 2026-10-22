import { alreadyOnRouteMessage, routeReachable, type AssistantContext, type AssistantLicencePool } from '../context';
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

function isAdvisorActivitiesRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return (
    context?.workspace === 'advisor' &&
    (routeId === 'advisor-activities' ||
      routeId === 'advisor-activity-detail' ||
      path === '/advisor/activities' ||
      path.startsWith('/advisor/activities/'))
  );
}

function isAdvisorPipelineRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return (
    context?.workspace === 'advisor' &&
    (routeId === 'advisor-pipeline' || path === '/advisor/pipeline')
  );
}

function isAdvisorCaseRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return (
    context?.workspace === 'advisor' &&
    (routeId === 'advisor-case-detail' || path.startsWith('/advisor/cases/'))
  );
}

function isAdvisorProductionRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return (
    context?.workspace === 'advisor' &&
    (routeId === 'advisor-production' || path === '/advisor/production')
  );
}

function isAdvisorPlanningRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return context?.workspace === 'advisor' && (routeId === 'advisor-planning' || path === '/advisor/planning');
}

function isAdvisorProfileRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return context?.workspace === 'advisor' && (routeId === 'advisor-profile' || path === '/advisor/profile');
}

function isAdvisorSettingsRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return context?.workspace === 'advisor' && (routeId === 'advisor-settings' || path === '/advisor/settings');
}

function isAdvisorSubscriptionRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return context?.workspace === 'advisor' && (routeId === 'advisor-subscription' || path === '/advisor/subscription');
}

function isAdvisorSetupRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return context?.workspace === 'advisor' && (routeId === 'advisor-setup' || path === '/advisor/setup');
}

function isAdvisorContactsRoute(context?: AssistantContext): boolean {
  const routeId = context?.route.routeId;
  const path = context?.route.path ?? '';
  return (
    context?.workspace === 'advisor' &&
    (routeId === 'advisor-contacts' ||
      routeId === 'advisor-contact-detail' ||
      path === '/advisor/contacts' ||
      path.startsWith('/advisor/contacts/'))
  );
}

export function unknownHelpAnswer(context?: AssistantContext): AssistantPublicAnswer {
  if (context?.workspace === 'advisor' && (context.route.routeId === 'advisor-home' || context.route.path === '/advisor')) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about your dashboard, monthly target, weekly activity, pipeline or upcoming activities?',
      sources: [],
    };
  }
  if (isAdvisorActivitiesRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about scheduling an activity, follow-ups, rescheduling, completing an activity, or recording an outcome?',
      sources: [],
    };
  }
  if (isAdvisorPipelineRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about a pipeline stage, FICA, documents, quotes, next actions, submitting to Production or reviews?',
      sources: [],
    };
  }
  if (isAdvisorCaseRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: "Are you asking about this case's stage, FICA, documents, quotes, next action, submitting to Production or scheduling a review?",
      sources: [],
    };
  }
  if (isAdvisorProductionRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about capturing production, application status, issued production, pending applications or editing an entry?',
      sources: [],
    };
  }
  if (isAdvisorPlanningRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about your monthly target, weekly activity targets, conversion ratios, or how progress is calculated?',
      sources: [],
    };
  }
  if (isAdvisorProfileRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about updating your profile, Financial Settings, commission split, or advisor type?',
      sources: [],
    };
  }
  if (isAdvisorSettingsRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about conversion ratios, average commission, tax override, or adaptive ratios?',
      sources: [],
    };
  }
  if (isAdvisorSubscriptionRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about your current plan, Live Preview, locked features, or how to upgrade in the mobile app?',
      sources: [],
    };
  }
  if (isAdvisorSetupRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about completing Setup, monthly nett goal, commission split, or conversion ratios?',
      sources: [],
    };
  }
  if (isAdvisorContactsRoute(context)) {
    return {
      answerId: 'unknown',
      intent: 'unknown',
      confidence: 0,
      mode: 'unknown',
      headline: "I couldn't confidently match that yet",
      body: 'Are you asking about adding or editing a contact, contact status, importing contacts, POPIA consent, Live Preview, activities or cases?',
      sources: [],
    };
  }
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

export function privacyRefuseAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'privacy:client-pii',
    intent: 'privacy',
    confidence: 1,
    mode: 'blocked',
    headline: 'I cannot share client personal details',
    body: 'I can talk about counts and workflow in your own book, but I will not list client names, phone numbers, emails, or ID numbers.',
    sources: [],
  };
}

export function financialAdviceRefuseAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'blocked:financial-advice',
    intent: 'blocked',
    confidence: 1,
    mode: 'blocked',
    headline: 'I cannot recommend a product',
    body: 'I can explain how to record quotes, choose an insurer in the case, and move the case through Implementation. I cannot tell you which product, insurer, or policy to recommend to a client.',
    sources: [{ cardId: 'PIPELINE.NO_ADVICE', title: 'Not financial advice' }],
  };
}

export function leadershipScopeRefuseAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'blocked:leadership-scope',
    intent: 'blocked',
    confidence: 1,
    mode: 'blocked',
    headline: 'That is outside your own book',
    body: 'In Advisor Workspace I can only talk about your own contacts, activities, pipeline, production, and targets. Team, region, and other-advisor reporting stays in leadership views.',
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
  if (!primary) return unknownHelpAnswer(context);

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
