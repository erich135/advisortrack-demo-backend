import { alreadyOnRouteMessage, routeReachable, type AssistantContext, type AssistantLicencePool } from '../context';
import { stripApiLeak } from './prompt';
import type { HighLevelIntent } from '../intent';
import { publicFactSource } from '../live/classify';
import { ASSISTANT_PERIOD_LABELS } from '../live/period';
import {
  cardFamily,
  navigationPhrase,
  nodeById,
  nodeForRoute,
  productMapFor,
} from '../productMap';
import { subjectFamily } from '../intent';
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
    headline: "I can help with AdvisorTrack",
    body: "Tell me what you're trying to do — Pipeline, a contact, production, or your target. I won't guess.",
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
  const labels = cards.map((card) => card.questionForms[0] || card.title);
  const question = labels.length === 2
    ? `Do you mean ${labels[0]}, or ${labels[1]}?`
    : 'Which of those did you mean?';
  return {
    answerId: `disambiguate:${cards.map((card) => card.id).join(',')}`,
    intent: 'disambiguate',
    confidence: 0.5,
    mode: 'disambiguate',
    headline: 'I need one more detail',
    body: question,
    clarifyingQuestion: question,
    disambiguation: cards.map((card) => ({
      cardId: card.id,
      label: card.questionForms[0] || card.title,
      title: card.title,
    })),
    sources: cards.map((card) => ({ cardId: card.id, title: card.title })),
  };
}

export function productOverviewAnswer(context: AssistantContext): AssistantPublicAnswer {
  const map = productMapFor(context.workspace);
  const start = context.workspace === 'advisor'
    ? 'If you are starting a new piece of business, Contacts is usually the best place to begin.'
    : 'Start from the pages you can see in the navigation for your role.';
  return {
    answerId: 'map:overview',
    intent: 'PRODUCT_OVERVIEW',
    confidence: 0.9,
    mode: 'allowed',
    headline: context.workspace === 'advisor' ? 'AdvisorTrack follows your advice workflow' : 'How AdvisorTrack is organised',
    body: `${map.overview.map((step, index) => `${index + 1}. ${step}`).join(' ')} ${start}`,
    sources: [],
  };
}

export function navigateAreaAnswer(context: AssistantContext, subject: string | null): AssistantPublicAnswer {
  const node = (subject ? nodeById(context.workspace, subject) : null)
    ?? nodeForRoute(context.workspace, context.route.routeId);
  if (!node) return productOverviewAnswer(context);
  const alreadyOn = Boolean(context.route.routeId && node.routeIds.includes(context.route.routeId));
  const opener = navigationPhrase(node.label, context.viewport ?? 'unknown', alreadyOn);
  return {
    answerId: `map:navigate:${node.id}`,
    intent: 'NAVIGATE',
    confidence: 0.92,
    mode: 'allowed',
    headline: node.label,
    body: `${opener} ${node.summary}`,
    sources: [],
  };
}

export function frustrationHelpAnswer(context: AssistantContext, subject?: string | null): AssistantPublicAnswer {
  const node = nodeForRoute(context.workspace, context.route.routeId);
  const onCase = Boolean(context.route.path?.startsWith('/advisor/cases/'));
  if (context.workspace === 'advisor' && (subject === 'pipeline' || node?.id === 'pipeline' || onCase)) {
    return {
      answerId: 'map:frustration:pipeline',
      intent: 'FRUSTRATION_HELP',
      confidence: 0.85,
      mode: 'allowed',
      headline: "Let's pick a next step",
      body: 'Fair. If this pipeline case is stuck, the practical blockers are estimated commission for submit, a next action, FICA as a warning, or recording Lost if you are done with it. Tell me which of those is in the way.',
      sources: [],
    };
  }
  if (context.workspace === 'advisor' && (node?.id === 'home' || !node)) {
    return {
      answerId: 'map:frustration:home',
      intent: 'FRUSTRATION_HELP',
      confidence: 0.85,
      mode: 'allowed',
      headline: 'Tell me the actual blocker',
      body: "Fair. Tell me what you're trying to do and I'll point you at the next step — a contact, a follow-up, a pipeline case, production, or your target.",
      sources: [],
    };
  }
  const area = node?.label ?? 'this page';
  return {
    answerId: `map:frustration:${node?.id ?? 'page'}`,
    intent: 'FRUSTRATION_HELP',
    confidence: 0.85,
    mode: 'allowed',
    headline: `Something on ${area} not making sense?`,
    body: `Tell me what is stuck on ${area} and I'll help with the next practical step.`,
    sources: [],
  };
}

export function explainAreaAnswer(context: AssistantContext, subject: string | null): AssistantPublicAnswer {
  const node = (subject ? nodeById(context.workspace, subject) : null)
    ?? nodeForRoute(context.workspace, context.route.routeId);
  if (!node) return productOverviewAnswer(context);
  return {
    answerId: `map:explain:${node.id}`,
    intent: 'EXPLAIN',
    confidence: 0.88,
    mode: 'allowed',
    headline: node.label,
    body: node.summary,
    sources: [],
  };
}

export function liveStatusHelpAnswer(context: AssistantContext): AssistantPublicAnswer {
  if (context.workspace === 'advisor') {
    return {
      answerId: 'map:live-status',
      intent: 'LIVE_STATUS',
      confidence: 0.84,
      mode: 'allowed',
      headline: 'Start with what is waiting',
      body: 'Home is the live picture: overdue work, cases without a next action, and remaining to target. Ask how many open cases you have if you want the figures.',
      sources: [],
    };
  }
  return {
    answerId: 'map:live-status',
    intent: 'LIVE_STATUS',
    confidence: 0.8,
    mode: 'allowed',
    headline: 'Use the current dashboard',
    body: 'Open Dashboard from the navigation for issued production in your authorised scope. Ask a specific count if you need a live figure.',
    sources: [],
  };
}

export function troubleshootAnswer(context: AssistantContext, subject: string | null): AssistantPublicAnswer {
  if (subject === 'subscription' || context.route.routeId === 'advisor-subscription') {
    return {
      answerId: 'map:troubleshoot:locked',
      intent: 'TROUBLESHOOT',
      confidence: 0.88,
      mode: 'allowed',
      headline: 'Why this can stay locked',
      body: 'Some AdvisorTrack features stay in Live Preview or locked on the current plan. Open Subscription to see what is included. Contacts, activities and your own pipeline remain available.',
      sources: [],
    };
  }
  if (
    subject === 'pipeline'
    || context.route.routeId === 'advisor-pipeline'
    || context.route.routeId === 'advisor-case-detail'
  ) {
    return {
      answerId: 'map:troubleshoot:case',
      intent: 'TROUBLESHOOT',
      confidence: 0.88,
      mode: 'allowed',
      headline: 'Why a case may stay open or not submit',
      body: 'A case stays on Pipeline until you move it through the six stages, submit implemented business to Production, or record Lost on the related activity. Submit requires estimated commission greater than 0 on a case you own. Incomplete FICA is a warning, not the submit check.',
      sources: [],
    };
  }
  const node = (subject ? nodeById(context.workspace, subject) : null)
    ?? nodeForRoute(context.workspace, context.route.routeId);
  return {
    answerId: `map:troubleshoot:${node?.id ?? 'page'}`,
    intent: 'TROUBLESHOOT',
    confidence: 0.82,
    mode: 'allowed',
    headline: node ? `Check ${node.label}` : 'Tell me what is stuck',
    body: node
      ? `${node.summary} Tell me which control or status is stuck and I will stay with that workflow.`
      : 'Tell me which screen or action is stuck. I can help with contacts, activities, pipeline, production or targets.',
    sources: [],
  };
}

export function whatNextAnswer(context: AssistantContext, subject: string | null): AssistantPublicAnswer {
  if (subject === 'contacts' || context.route.routeId?.startsWith('advisor-contact')) {
    return {
      answerId: 'map:what-next:contact',
      intent: 'WHAT_NEXT',
      confidence: 0.88,
      mode: 'allowed',
      headline: 'Schedule the next step',
      body: 'From the contact, add an activity or open a case. If they are no longer interested, record a Lost outcome on the activity rather than inventing a new status.',
      sources: [],
    };
  }
  if (subject === 'activities' || context.route.routeId?.startsWith('advisor-activit')) {
    return {
      answerId: 'map:what-next:activity',
      intent: 'WHAT_NEXT',
      confidence: 0.9,
      mode: 'allowed',
      headline: 'Do the activity, then record the outcome',
      body: 'Open Activities and log the call, meeting or follow-up. When you finish it, record Proceed, Lost or Complete. Proceed keeps the work moving, Lost can inactive the contact, and Complete closes the activity without that Lost outcome.',
      sources: [],
    };
  }
  if (context.route.routeId === 'advisor-case-detail' || subject === 'pipeline') {
    return {
      answerId: 'map:what-next:case',
      intent: 'WHAT_NEXT',
      confidence: 0.88,
      mode: 'allowed',
      headline: 'Work the case forward',
      body: 'Open Pipeline and work the case through the six advice stages. After Implementation you can submit it to Production. This is workflow guidance, not financial advice.',
      sources: [],
    };
  }
  if (subject === 'production') {
    return {
      answerId: 'map:what-next:production',
      intent: 'WHAT_NEXT',
      confidence: 0.88,
      mode: 'allowed',
      headline: 'Track it in Production',
      body: 'Submit implemented business to Production and follow it through underwriting until it is issued. Home and Planning then show how that issued work sits against your monthly target.',
      sources: [],
    };
  }
  return {
    answerId: 'map:what-next',
    intent: 'WHAT_NEXT',
    confidence: 0.85,
    mode: 'allowed',
    headline: 'Usual next step',
    body: 'Add or open the contact, schedule the follow-up, then work the case on Pipeline. If the person is no longer interested, record Lost on the activity.',
    sources: [],
  };
}

const API_LEAK = /\b(GET|POST|PATCH|PUT|DELETE)\s+\/|\/api\/v1\b/;

function customerSafeCards(cards: ServerKnowledgeCard[], intent?: HighLevelIntent): ServerKnowledgeCard[] {
  const safe = cards.filter((card) => !API_LEAK.test(card.summary));
  const family = subjectFamily(intent?.subject ?? null);
  if (!family) return safe.slice(0, 3);
  const focused = safe.filter((card) => cardFamily(card.id) === family);
  return (focused.length ? focused : safe).slice(0, 3);
}

export function submitStillBlockedAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'map:submit-still-blocked',
    intent: 'TROUBLESHOOT',
    confidence: 0.9,
    mode: 'allowed',
    headline: 'FICA is not the submit check',
    body: 'Completing FICA does not submit the case. You can submit after Implementation when estimated commission is greater than 0, and only on a case you own. Check the estimated commission on the case if submit still does nothing.',
    sources: [],
  };
}

export function synthesizeFromCards(
  cards: ServerKnowledgeCard[],
  context: AssistantContext,
  routes: AssistantRoute[],
  intent?: HighLevelIntent,
): AssistantPublicAnswer {
  if (intent?.kind === 'NAVIGATE') return navigateAreaAnswer(context, intent.subject);
  if (intent?.kind === 'PRODUCT_OVERVIEW') return productOverviewAnswer(context);
  if (intent?.kind === 'FRUSTRATION_HELP') return frustrationHelpAnswer(context, intent.subject);
  if (intent?.kind === 'WHAT_NEXT') return whatNextAnswer(context, intent.subject ?? null);
  if (intent?.kind === 'TROUBLESHOOT' && intent.subject === 'pipeline' && cards.some((card) => card.id.includes('SUBMIT'))) {
    return submitStillBlockedAnswer();
  }
  if (intent?.kind === 'TROUBLESHOOT') {
    const usable = customerSafeCards(cards, intent);
    if (!usable.length) return troubleshootAnswer(context, intent.subject ?? null);
    cards = usable;
  }
  if (intent?.kind === 'LIVE_STATUS' && !cards.length) return liveStatusHelpAnswer(context);
  if (intent?.kind === 'EXPLAIN' && !cards.length) return explainAreaAnswer(context, intent.subject ?? null);
  if (intent?.kind === 'HOW_TO' && !cards.length && intent.subject) {
    return navigateAreaAnswer(context, intent.subject);
  }
  if (intent?.kind === 'CURRENT_STATE') {
    const node = nodeForRoute(context.workspace, context.route.routeId);
    if (node) {
      return {
        answerId: `map:page:${node.id}`,
        intent: 'CURRENT_STATE',
        confidence: 0.9,
        mode: 'allowed',
        headline: node.label,
        body: node.summary,
        sources: cards.map((card) => ({ cardId: card.id, title: card.title })),
      };
    }
  }
  const usable = customerSafeCards(cards, intent);
  if (!usable.length) {
    if (intent?.kind === 'TROUBLESHOOT') return troubleshootAnswer(context, intent.subject ?? null);
    if (intent?.subject) return navigateAreaAnswer(context, intent.subject);
    return unknownHelpAnswer(context);
  }
  const composed = answerFromCards(usable, context, routes);
  return {
    ...composed,
    headline: usable.length > 1 ? (intent?.subject ? nodeById(context.workspace, intent.subject)?.label ?? composed.headline : composed.headline) : composed.headline,
    body: usable.map((card) => card.summary).join(' '),
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
    headline: stripApiLeak(decision?.headline?.trim() || primary.title),
    body: stripApiLeak(decision?.body?.trim() || cards.map((card) => card.summary).join(' ')),
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
