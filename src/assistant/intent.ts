/**
 * High-level intent — what the user is trying to accomplish.
 * Complements live tool classification; does not replace it.
 */
import { normalizeQuestion } from './normalise';
import type { AssistantContext } from './context';

export const HIGH_LEVEL_INTENTS = [
  'NAVIGATE',
  'HOW_TO',
  'EXPLAIN',
  'TROUBLESHOOT',
  'PRODUCT_OVERVIEW',
  'CURRENT_STATE',
  'LIVE_STATUS',
  'WHAT_NEXT',
  'COMPARE',
  'FRUSTRATION_HELP',
  'OUT_OF_SCOPE',
] as const;

export type HighLevelIntentKind = (typeof HIGH_LEVEL_INTENTS)[number];

export type HighLevelIntent = {
  kind: HighLevelIntentKind;
  subject: string | null;
  broad: boolean;
};

const SUBJECTS: Array<{ id: string; pattern: RegExp; weight: number }> = [
  { id: 'pipeline', pattern: /\b(pipeline|cases?|stages?|fica|quotes?|fact-?find|submit|documents?)\b/, weight: 8 },
  { id: 'production', pattern: /\b(production|underwriting|issued|pending|pma|medicals)\b/, weight: 8 },
  { id: 'activities', pattern: /\b(activit(?:y|ies)|follow-?ups?|calls?|meetings?|emails?|proceed|lost|outcome)\b/, weight: 7 },
  { id: 'planning', pattern: /\b(planning|targets?|goals?|conversion|weekly points)\b/, weight: 6 },
  { id: 'licences', pattern: /\b(licen[cs]es?|seats?)\b/, weight: 6 },
  { id: 'users', pattern: /\b(users?|invite|members?)\b/, weight: 6 },
  { id: 'profile', pattern: /\b(profile)\b/, weight: 5 },
  { id: 'settings', pattern: /\b(settings?)\b/, weight: 5 },
  { id: 'subscription', pattern: /\b(subscription|plan|live ?preview|locked)\b/, weight: 5 },
  { id: 'home', pattern: /\b(home|dashboard|progress|waiting on me|overdue)\b/, weight: 4 },
  { id: 'contacts', pattern: /\b(contacts?|prospects?|clients?|popia|this guy|this person)\b/, weight: 3 },
];

function subjectFromRoute(routeId: string | null): string | null {
  if (!routeId) return null;
  if (routeId.startsWith('advisor-case')) return 'pipeline';
  if (routeId.startsWith('advisor-contact')) return 'contacts';
  if (routeId.startsWith('advisor-activit')) return 'activities';
  if (routeId.startsWith('advisor-')) {
    return routeId.replace('advisor-', '').replace(/-detail$/, '') || null;
  }
  return null;
}

function subjectOf(normalized: string, routeId: string | null, useRouteFallback: boolean): string | null {
  let best: { id: string; weight: number } | null = null;
  for (const entry of SUBJECTS) {
    if (!entry.pattern.test(normalized)) continue;
    if (!best || entry.weight > best.weight) best = entry;
  }
  if (best) return best.id;
  return useRouteFallback ? subjectFromRoute(routeId) : null;
}

const WORKFLOW_ORDER = ['contacts', 'activities', 'pipeline', 'production', 'planning'] as const;

export function nextWorkflowSubject(subject: string | null): string {
  if (!subject) return 'contacts';
  const index = WORKFLOW_ORDER.indexOf(subject as (typeof WORKFLOW_ORDER)[number]);
  if (index === -1) return subject;
  return WORKFLOW_ORDER[Math.min(index + 1, WORKFLOW_ORDER.length - 1)];
}

export function subjectFamily(subject: string | null): string | null {
  if (!subject) return null;
  if (subject === 'contacts') return 'CONTACT';
  if (subject === 'activities') return 'ACTIVITY';
  if (subject === 'home') return 'HOME';
  return subject.replace(/-/g, '').toUpperCase();
}

export function questionHasProductSubject(question: string): boolean {
  return Boolean(subjectOf(normalizeQuestion(question), null, false));
}

const FRUSTRATION =
  /^(what the hell|what the heck|wtf+|this makes no sense|i('?m| am) lost|where the hell is this|why isn'?t this working|this is (so |really )?(confusing|broken|stupid|useless)|you suck|you('?re| are) useless|stupid bot|dumb bot|useless bot|fuck this|fuck it|this sucks|screw this|i don'?t get (this|it)|this page is confusing|help me with this page|i('?ve| have) had enough of (this|the) case|enough of this case)$/;

const PRODUCT_OVERVIEW =
  /\b(how do i use this app|how does (this app|advisortrack|the app) work|what is advisortrack( for)?|where do i start|start where|where do i begin|how does all of this work|walk me through (the app|advisortrack)|what am i supposed to do in (this|the) app|start me off|first thing i should do)\b/;

const NAVIGATE =
  /\b(how do i (see|find|open|get to|get into)|where (the hell |the heck )?(is|are|do i find|can i (see|find)|did)|take me to|show me (my )?|open (my |the )?)\b/;

const LIVE_STATUS =
  /\b(how many|how much|how far|how am i doing|what needs my attention|what should i (focus on|look at|do now)|anything overdue|issued this month|open cases|what'?s waiting on me|whats waiting on me|am i (actually )?getting anywhere)\b/;

const WHAT_NEXT =
  /\b(what (do i do|now|next)|whats next|what now|what should i do now|i finished|i already (logged|recorded|did)|i just (spoke|called|met)|this guy isn'?t interested|now what|then what|after the meeting|client went (cold|quiet|silent)|ghosted|isn'?t interested|move (it|this|the case) forward)\b/;

const TROUBLESHOOT =
  /\b(why (won'?t|can'?t|isn'?t|is this still)|why is this locked|not submitting|won'?t submit|why cant i submit)\b/;

const COMPARE = /\b(compar(e|ing)|versus|vs\.?|higher than|lower than)\b/;

const EXPLAIN = /\b(what (is|are|does)|what does .+ mean|explain|meaning of)\b/;

const HOW_TO = /\b(how do i|how can i|how do we|how to)\b/;

const CURRENT_STATE = /^(what is this|what('?s| is) (this|the) (page|screen)|how do i use this|what am i (looking at|supposed to do on this screen)|this page tho)$/;

const CONTINUE_NEXT = /^(and after that|after that|then what|and then( what)?|ok and then|okay and then|and then production or what)/;

const MISSING_THEN = /\b(what am i missing|what'?s left|what else do i need)\b/;

const FICA_DONE = /\b(but i(ve| have) done (the )?fica|fica(s| is) (done|complete)|i already did fica)\b/;

const NOT_WORKING = /\b(this (thing|page|screen|app) isn'?t working|isn'?t working)\b/;

const CASE_THROUGH = /\b((can'?t|cannot) get (my )?(case|this) through|get (my )?case through)\b/;

const ADDED_SOMEONE = /\b(i(ve| have) added (someone|a contact|them|this (guy|person)))\b/;

const WHY_FIRST = /\bwhy (that|those|the overdue) first\b/;

const TARGET_PROGRESS =
  /\b((my )?target feels stuck|target (is |feels )?stuck|planning numbers look weird|issued numbers|need to get issued)\b/;

const FIND_QUOTES = /\b(can'?t find the quotes?( bit)?|where (are|is) (the )?quotes?|quotes? bit)\b/;
const SUBMITTED_STATUS = /\bhow do i know (it'?s|its|it is) submitted\b/;

const DIFF_STAGES = /\b(difference between|what'?s the difference)\b/;

const OUT_OF_SCOPE =
  /\b(capital of|weather|world cup|president of|stock price|recipe|bitcoin price)\b/;

export function classifyHighLevelIntent(
  question: string,
  context: AssistantContext,
  previousQuestion?: string | null,
): HighLevelIntent {
  const normalized = normalizeQuestion(question);
  const pageAware = Boolean(context.route.routeId);
  const previousNorm = previousQuestion ? normalizeQuestion(previousQuestion) : '';
  const previousSubject = previousNorm ? subjectOf(previousNorm, null, false) : null;
  const mentioned = subjectOf(normalized, context.route.routeId, false);
  let subject = mentioned ?? (CONTINUE_NEXT.test(normalized) || MISSING_THEN.test(normalized) || WHY_FIRST.test(normalized) ? previousSubject : null);

  if (!normalized) {
    return { kind: 'OUT_OF_SCOPE', subject: null, broad: false };
  }
  if (OUT_OF_SCOPE.test(normalized) && !subject) {
    return { kind: 'OUT_OF_SCOPE', subject: null, broad: false };
  }
  if (/\b(i('?ve| have) had enough of (this|the) case|enough of this case)\b/.test(normalized)) {
    return { kind: 'FRUSTRATION_HELP', subject: 'pipeline', broad: false };
  }
  if (
    (FRUSTRATION.test(normalized) || (/^(what the hell|wtf|i'?m lost|this makes no sense)/.test(normalized) && !HOW_TO.test(normalized)))
    && !NAVIGATE.test(normalized)
  ) {
    return { kind: 'FRUSTRATION_HELP', subject: mentioned ?? subjectFromRoute(context.route.routeId), broad: false };
  }
  if (/\bam i (actually )?getting anywhere\b/.test(normalized)) {
    return { kind: 'LIVE_STATUS', subject: 'home', broad: false };
  }
  if (/\bwhat should i do now\b/.test(normalized)) {
    return { kind: 'LIVE_STATUS', subject: 'home', broad: false };
  }
  if (PRODUCT_OVERVIEW.test(normalized)) {
    return { kind: 'PRODUCT_OVERVIEW', subject: context.workspace === 'advisor' ? 'home' : subject, broad: true };
  }
  if (TARGET_PROGRESS.test(normalized) && /\b(issued|production)\b/.test(normalized)) {
    return { kind: 'HOW_TO', subject: 'production', broad: false };
  }
  if (TARGET_PROGRESS.test(normalized)) {
    return { kind: 'LIVE_STATUS', subject: 'planning', broad: false };
  }
  if (FIND_QUOTES.test(normalized)) {
    return { kind: 'HOW_TO', subject: 'pipeline', broad: false };
  }
  if (SUBMITTED_STATUS.test(normalized)) {
    return { kind: 'HOW_TO', subject: 'production', broad: false };
  }
  if (CONTINUE_NEXT.test(normalized)) {
    const from = previousSubject ?? mentioned ?? 'contacts';
    return { kind: 'WHAT_NEXT', subject: nextWorkflowSubject(from), broad: false };
  }
  if (ADDED_SOMEONE.test(normalized)) {
    return { kind: 'WHAT_NEXT', subject: 'contacts', broad: false };
  }
  if (FICA_DONE.test(normalized) || (MISSING_THEN.test(normalized) && /\bsubmit|case|fica\b/.test(previousNorm))) {
    return { kind: 'TROUBLESHOOT', subject: 'pipeline', broad: false };
  }
  if (MISSING_THEN.test(normalized)) {
    return { kind: 'TROUBLESHOOT', subject: previousSubject ?? mentioned ?? subjectFromRoute(context.route.routeId), broad: false };
  }
  if (WHY_FIRST.test(normalized)) {
    return { kind: 'LIVE_STATUS', subject: previousSubject ?? 'home', broad: false };
  }
  if (CASE_THROUGH.test(normalized) || NOT_WORKING.test(normalized)) {
    return { kind: 'TROUBLESHOOT', subject: mentioned ?? previousSubject ?? subjectFromRoute(context.route.routeId), broad: false };
  }
  if (CURRENT_STATE.test(normalized) && pageAware) {
    return { kind: 'CURRENT_STATE', subject: mentioned ?? subjectFromRoute(context.route.routeId), broad: false };
  }
  if (LIVE_STATUS.test(normalized)) {
    return { kind: 'LIVE_STATUS', subject, broad: false };
  }
  if (WHAT_NEXT.test(normalized)) {
    return { kind: 'WHAT_NEXT', subject: mentioned ?? previousSubject, broad: false };
  }
  if (COMPARE.test(normalized)) {
    return { kind: 'COMPARE', subject, broad: false };
  }
  if (TROUBLESHOOT.test(normalized)) {
    return { kind: 'TROUBLESHOOT', subject, broad: false };
  }
  if (NAVIGATE.test(normalized) && subject) {
    return { kind: 'NAVIGATE', subject, broad: false };
  }
  if (NAVIGATE.test(normalized) && !EXPLAIN.test(normalized)) {
    return { kind: 'NAVIGATE', subject, broad: false };
  }
  if (/happen if i don|do i have to complete it/.test(normalized) && (previousSubject === 'pipeline' || /fica|complete it/.test(previousNorm))) {
    return { kind: 'EXPLAIN', subject: 'pipeline', broad: false };
  }
  if ((EXPLAIN.test(normalized) || DIFF_STAGES.test(normalized)) && !HOW_TO.test(normalized)) {
    return { kind: 'EXPLAIN', subject: mentioned ?? previousSubject ?? 'pipeline', broad: false };
  }
  if (HOW_TO.test(normalized)) {
    return { kind: 'HOW_TO', subject, broad: !subject };
  }
  if (pageAware && /^(what is this|how do i use this|what does pending mean)$/.test(normalized)) {
    return { kind: 'CURRENT_STATE', subject: mentioned ?? subjectFromRoute(context.route.routeId), broad: false };
  }
  return { kind: 'HOW_TO', subject: mentioned, broad: !mentioned };
}

export function isBroadNotAmbiguous(intent: HighLevelIntent): boolean {
  return intent.broad || intent.kind === 'PRODUCT_OVERVIEW' || intent.kind === 'FRUSTRATION_HELP';
}

export function shouldPreferDirectAnswer(intent: HighLevelIntent): boolean {
  return (
    intent.kind === 'NAVIGATE' ||
    intent.kind === 'PRODUCT_OVERVIEW' ||
    intent.kind === 'HOW_TO' ||
    intent.kind === 'EXPLAIN' ||
    intent.kind === 'CURRENT_STATE' ||
    intent.kind === 'FRUSTRATION_HELP' ||
    intent.kind === 'WHAT_NEXT' ||
    intent.kind === 'TROUBLESHOOT' ||
    intent.kind === 'LIVE_STATUS'
  );
}
