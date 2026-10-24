/**
 * Conversational layer for Dex 2.0.
 * Product questions continue to live tools then retrieval. Chat, venting, and
 * smalltalk are a remainder for Groq — not knowledge-base retrieval.
 * Combined social + AdvisorTrack questions still strip the social prefix.
 */
import type { AssistantContext } from './context';
import { normalizeQuestion } from './retrieve';
import type { AssistantPublicAnswer } from './model/types';
import type { CardEnvironment } from './types';
import { DEX_NAME, conversationLimitedFallback, dexGreeting, dexIdentityCopy } from './voice';

export const CONVERSATION_INTENTS = [
  'greeting',
  'thanks',
  'identity',
  'capabilities',
  'acknowledgement',
  'goodbye',
  'frustration',
  'correction',
  'misunderstanding',
  'off_topic',
] as const;

export type ConversationIntent = (typeof CONVERSATION_INTENTS)[number];

export type ConversationDetection =
  | { kind: 'conversation'; intent: ConversationIntent }
  | { kind: 'continue'; remainder: string }
  | { kind: 'none' };

const DETERMINISTIC_SOCIAL: ReadonlySet<ConversationIntent> = new Set([
  'thanks',
  'identity',
  'acknowledgement',
  'goodbye',
  'correction',
  'misunderstanding',
]);

export function isDeterministicSocialIntent(intent: ConversationIntent): boolean {
  return DETERMINISTIC_SOCIAL.has(intent);
}

/** Remainder that should talk, not retrieve a help card. */
export function isChatRemainder(detection: ConversationDetection): boolean {
  if (detection.kind === 'continue') return false;
  if (detection.kind === 'none') return true;
  return !isDeterministicSocialIntent(detection.intent);
}

export type ConversationCategory = {
  id: string;
  label: string;
  environment: CardEnvironment;
};

const SOCIAL_PREFIX =
  /^(hi there|hello there|good morning|good afternoon|good evening|hello|hey there|hey|hi|morning|thanks that worked|perfect thank you|awesome thanks|okay thanks|ok thanks|thank you so much|thank you|thanks|cheers)\b[\s,!.:;?-]*/i;

const GREETING_FILLER =
  /^(how are you doing|how are you|hows it going|how's it going|how are things|how's your day|hows your day|how is your day|whats up|what's up|what is up|sup|you there|you around|still there|ready to work|are you ready)\b[\s,!.:;?-]*/i;

const VOCATIVE =
  /^(dex|there|assistant|buddy|mate|pal|legend|friend|man|dude|bro)\b[\s,!.:;?-]*/i;

type NegativeKind = 'frustration' | 'correction' | 'misunderstanding';

const NEGATIVE_PREFIXES: Array<{ kind: NegativeKind; pattern: RegExp }> = [
  {
    kind: 'misunderstanding',
    pattern: /^(you(?:['’]re|re| are) not listening|you are not listening|you(?:['’]re|re) not hearing me)\b[\s,!.:;?-]*/i,
  },
  {
    kind: 'correction',
    pattern: /^(no(?:,)?\s+)?(that was wrong|that(?:['’]s|s| is) wrong|that(?:['’]s|s) not (?:what i asked|what i wanted|right)|that is not what i asked)\b[\s,!.:;?-]*/i,
  },
  {
    kind: 'frustration',
    pattern: /^(this is (?:so |really |completely |totally |fucking |damn |bloody )?(?:useless|shit|crap|garbage)|this (?:isn['’]?t|is not) helping|you suck|you(?:['’]re|re| are) useless|you are useless|stupid bot|dumb bot|useless bot|what a (?:useless|stupid) bot|fuck this|fuck it|fuck you|screw this|this sucks)\b[\s,!.:;?-]*/i,
  },
  {
    kind: 'frustration',
    pattern: /^fuck(?:ing)?[\s,!.:;?-]+/i,
  },
];

const CORE_DOMAIN = [
  'advisortrack',
  'licence',
  'license',
  'seat',
  'user',
  'users',
  'invoice',
  'invoices',
  'subscription',
  'team',
  'teams',
  'region',
  'regions',
  'advisor',
  'adviser',
  'advisors',
  'advisers',
  'portal',
  'android',
  'bulk',
  'import',
  'pipeline',
  'production',
  'performance',
  'dashboard',
  'organisation',
  'organization',
  'admin',
  'invitation',
  'offboard',
  'activation',
  'reporting',
  'hierarchy',
  'permission',
  'permissions',
  'telemetry',
  'mobile activity',
  'contact',
  'contacts',
  'prospect',
  'client',
  'activity',
  'activities',
  'follow-up',
  'follow up',
  'followup',
  'case',
  'cases',
  'fica',
  'fact-find',
  'fact find',
  'fact-finding',
  'fact finding',
  'quote',
  'quotes',
  'recommendation',
  'implementation',
  'review',
  'issued',
  'underwriting',
  'pma',
  'medicals',
  'placed',
  'sales',
  'counter-offer',
  'counter offer',
  'target',
  'goal',
  'commission',
  'book of business',
  'weekly points',
  'planning',
  'nett goal',
  'conversion ratio',
  'commission split',
  'setup',
  'subscription',
  'working weeks',
  'financial settings',
  'customer',
  'person',
  'phone',
  'email',
  'popia',
  'consent',
  'rating',
  'priority',
  'live preview',
  'contact limit',
  'practice contact',
  'real contact',
  'inactive',
  'archived',
  'appointment',
  'meeting',
  'call',
  'reminder',
  'task',
  'schedule',
  'scheduled',
  'reschedule',
  'overdue',
  'attention',
  'due today',
  'complete',
  'completed',
  'proceed',
  'lost',
  'won',
  'closed',
  'deal',
  'opportunity',
  'application',
  'insurer',
  'next action',
  'next step',
  'servicing',
  'document',
  'documents',
  'fna',
  'simple goal',
  'profile',
  'settings',
  'points',
  'factfind',
  'livepreview',
  'conversionratio',
  'nextaction',
  'split',
  'deductions',
  'working weeks',
  'working days',
];

function isFillerOnly(text: string): boolean {
  return /^(how are you doing|how are you|hows it going|how are things|how's your day|hows your day|how is your day|whats up|what's up|you there|you around|ready to work)$/.test(
    normalizeQuestion(text),
  );
}

function stripLeadingVocatives(text: string): string {
  let remainder = text.trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const next = remainder.replace(VOCATIVE, '').replace(/^[\s,!.:;?-]+/, '').trim();
    if (next === remainder) break;
    remainder = next;
  }
  return remainder;
}

function isVocativeOnly(text: string): boolean {
  return !stripLeadingVocatives(text);
}

function isLaughOnly(text: string): boolean {
  return /^(haha+|ha ha|lol|heh|hehe)$/.test(normalizeQuestion(text));
}

function looksInventoryHelp(question?: string | null): boolean {
  return /^(what can you help me with|what can i ask you|what do you know|how can you help(?: me)?)$/.test(
    normalizeQuestion(question ?? ''),
  );
}

function hasDomainToken(normalized: string, categories: ConversationCategory[]): boolean {
  if (CORE_DOMAIN.some((term) => normalized.includes(term))) return true;
  return categories.some((category) => {
    const label = normalizeQuestion(category.label);
    return label.length > 3 && normalized.includes(label);
  });
}

export function hasProductSubstance(
  text: string,
  categories: ConversationCategory[] = [],
): boolean {
  const normalized = normalizeQuestion(text);
  if (!normalized || isFillerOnly(normalized)) return false;
  if (
    /\b(?:dont|do not|not even|cant|cannot|wont).{0,48}\b(?:look at|see|open|deal with|think about)\b.{0,24}\b(?:cases|pipeline|production|contacts|activities|work)\b/.test(normalized)
    || /\b(?:dont|do not|not).{0,24}\b(?:want to|wanna).{0,24}\b(?:look at|see|open)\b.{0,24}\b(?:cases|pipeline|work)\b/.test(normalized)
  ) {
    return false;
  }
  if (hasDomainToken(normalized, categories)) return true;
  if (/\b(how am i doing|what needs my attention|on track|livepreview|factfind|waiting on me|what now|now what|what should i do now|getting anywhere|enough of this case)\b/.test(normalized)) {
    return true;
  }
  if (/\b(whats on my plate|morning briefing|my briefing|whats happening today|happening with my work|what should i focus on|wrap up my day|done for today|how did today go|anything left for tomorrow|end of (the )?day|whats on the book)\b/.test(normalized)) {
    return true;
  }
  if (/\b(this guy|isnt interested|went cold|finished the meeting|supposed to do|this page|where did)\b/.test(normalized)) {
    return true;
  }
  if (/\bhow (?:is|are) (?!you\b)[a-z]+(?: [a-z]+)? doing\b/.test(normalized)) return true;
  if (
    /\b(?:this month|this week|last month|last week|year to date|ytd)\b/.test(normalized)
    && /\b(?:doing|issued|standing|progress|numbers)\b/.test(normalized)
  ) {
    return true;
  }
  return /\b(how do i|how can i|how do we|where (can|do|are|is|the hell|the heck)|why (cant|cannot|is|are|wont|won t)|add a |assign )\b/.test(
    normalized,
  );
}

function stripLeadingSocial(question: string): { remainder: string; stripped: boolean } {
  let remainder = question.trim();
  let stripped = false;
  for (let pass = 0; pass < 4; pass += 1) {
    const withoutPrefix = remainder.replace(SOCIAL_PREFIX, '');
    if (withoutPrefix === remainder) break;
    remainder = withoutPrefix.replace(/^[\s,!.:;?-]+/, '').trim();
    stripped = true;
  }
  const withoutVocative = stripLeadingVocatives(remainder);
  if (withoutVocative !== remainder) {
    remainder = withoutVocative;
    stripped = true;
  }
  const withoutFiller = remainder.replace(GREETING_FILLER, '').replace(/^[\s,!.:;?-]+/, '').trim();
  if (withoutFiller !== remainder) {
    remainder = withoutFiller;
    stripped = true;
  }
  remainder = stripLeadingVocatives(remainder);
  if (isVocativeOnly(remainder)) {
    remainder = '';
    stripped = true;
  }
  return { remainder, stripped };
}

function stripLeadingNegative(question: string): { remainder: string; kind: NegativeKind | null } {
  let remainder = question.trim();
  let kind: NegativeKind | null = null;
  for (let pass = 0; pass < 3; pass += 1) {
    let matched = false;
    for (const prefix of NEGATIVE_PREFIXES) {
      const next = remainder.replace(prefix.pattern, '');
      if (next === remainder) continue;
      remainder = next.replace(/^[\s,!.:;?-]+/, '').trim();
      kind = prefix.kind;
      matched = true;
      break;
    }
    if (!matched) break;
  }
  return { remainder, kind };
}

function negativeWholeIntent(normalized: string): ConversationIntent | null {
  if (!normalized) return null;
  if (/^(youre not listening|you are not listening|youre not hearing me)$/.test(normalized)) {
    return 'misunderstanding';
  }
  if (
    /^(that was wrong|thats wrong|that is wrong|no thats not what i asked|thats not what i asked|no that is not what i asked|thats not what i wanted|you got that wrong|thats not right|no thats not right)$/.test(
      normalized,
    )
  ) {
    return 'correction';
  }
  if (
    /^(you suck|this is (?:so |really |completely |totally |fucking |damn |bloody )?(?:useless|shit|crap|garbage)|this isnt helping|this is not helping|fuck this|fuck it|fuck you|fuck|youre useless|you are useless|stupid bot|dumb bot|useless bot|this sucks|screw this|what a (?:useless|stupid) bot|what the hell|what the heck|wtf+|this makes no sense|im lost|i am lost|where the hell is this|why isnt this working)$/.test(
      normalized,
    )
  ) {
    return 'frustration';
  }
  return null;
}

function wholeIntent(normalized: string): ConversationIntent | null {
  if (
    /^(who are you|what are you|what do you do|whats your name|what is your name|who is dex)$/.test(normalized)
  ) {
    return 'identity';
  }
  if (
    /^(what can you help me with|what can i ask you|what do you know|how can you help|how can you help me|can you help me|can you help|help|help me)$/.test(
      normalized,
    )
  ) {
    return 'capabilities';
  }
  if (
    /^(thanks|thank you|cheers|awesome thanks|perfect thank you|thanks that worked|ok thanks|okay thanks|thanks buddy|thanks mate|youre a legend|you are a legend)$/.test(
      normalized,
    )
  ) {
    return 'thanks';
  }
  if (/^(bye|goodbye|good bye|see you|see ya|later|bye bye)$/.test(normalized)) {
    return 'goodbye';
  }
  if (
    /^(hello|hi|hey|morning|good morning|good afternoon|good evening|hi there|hello there|hello how are you|hi how are you|hi how are you doing|morning dex|good morning dex|hi dex|hey dex|hello dex|hi dex buddy|hello dex buddy|hey mate|hey buddy|how are you|hows it going|how's it going|how's your day|hows your day|whats up|what's up|you there|ready to work)$/.test(
      normalized,
    )
  ) {
    return 'greeting';
  }
  if (/^(cool|great|awesome|perfect|nice|got it|okay|ok|haha+|ha ha|lol|heh|hehe)$/.test(normalized)) {
    return 'acknowledgement';
  }
  return null;
}

function looksOffTopic(text: string, categories: ConversationCategory[]): boolean {
  const normalized = normalizeQuestion(text);
  if (!normalized || isFillerOnly(normalized) || wholeIntent(normalized) || negativeWholeIntent(normalized)) {
    return false;
  }
  if (hasProductSubstance(normalized, categories)) return false;
  if (/^(what the hell|what the heck|wtf|this makes no sense|im lost|i am lost)\b/.test(normalized)) {
    return false;
  }
  if (
    /^(what|where|when|who|why|how|is|are|was|were|which|can you|could you|tell me|whats|explain)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  return /\b(capital of|weather|world cup|president of|stock price|recipe)\b/.test(normalized);
}

export function detectConversationIntent(
  question: string,
  categories: ConversationCategory[] = [],
): ConversationDetection {
  const trimmed = question.trim();
  if (!trimmed) return { kind: 'none' };

  const social = stripLeadingSocial(trimmed);
  const negative = stripLeadingNegative(social.remainder);
  const remainder = negative.remainder;

  if (remainder && hasProductSubstance(remainder, categories)) {
    return { kind: 'continue', remainder };
  }

  const whole = wholeIntent(normalizeQuestion(trimmed))
    || negativeWholeIntent(normalizeQuestion(trimmed))
    || (remainder ? negativeWholeIntent(normalizeQuestion(remainder)) : null)
    || (remainder ? wholeIntent(normalizeQuestion(remainder)) : null)
    || (negative.kind && !remainder ? negative.kind : null);
  if (whole) return { kind: 'conversation', intent: whole };

  if (isLaughOnly(trimmed) || (remainder && isLaughOnly(remainder))) {
    return { kind: 'conversation', intent: 'acknowledgement' };
  }

  if (social.stripped && !remainder) {
    const prefix = normalizeQuestion(trimmed);
    if (/^(thanks|thank you|cheers)/.test(prefix)) {
      return { kind: 'conversation', intent: 'thanks' };
    }
    return { kind: 'conversation', intent: 'greeting' };
  }

  if (remainder && looksOffTopic(remainder, categories)) {
    return { kind: 'conversation', intent: 'off_topic' };
  }
  if (!social.stripped && !negative.kind && looksOffTopic(trimmed, categories)) {
    return { kind: 'conversation', intent: 'off_topic' };
  }

  return { kind: 'none' };
}

export function visibleConversationAreas(
  categories: ConversationCategory[],
  environment: 'production' | 'demo',
): string[] {
  return categories
    .filter((category) => category.environment === 'both' || category.environment === environment)
    .filter((category) => category.id !== 'glossary')
    .map((category) => category.label);
}

function formatAreas(labels: string[]): string {
  if (labels.length === 0) return 'AdvisorTrack features';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function buildConversationResponse(
  intent: ConversationIntent,
  categories: ConversationCategory[],
  environment: 'production' | 'demo',
  context?: Pick<AssistantContext, 'workspace' | 'route'> | null,
  question?: string | null,
  previousQuestion?: string | null,
): AssistantPublicAnswer {
  const areas = formatAreas(visibleConversationAreas(categories, environment));
  const identity = dexIdentityCopy();
  const greeting = dexGreeting(context, question, previousQuestion);
  const copy: Record<ConversationIntent, { headline: string; body: string }> = {
    greeting,
    thanks: {
      headline: "You're welcome",
      body: "Anytime. If something else in AdvisorTrack is in the way, ask.",
    },
    identity,
    capabilities: looksInventoryHelp(question)
      ? {
          headline: 'What I can help with',
          body: `I know AdvisorTrack — ${areas}. I can also just talk. I don't give financial advice.`,
        }
      : {
          headline: 'Yes',
          body: 'I can talk, or help you use AdvisorTrack when you want that.',
        },
    acknowledgement: {
      headline: 'Got it',
      body: 'Good. Ask if you need the next step.',
    },
    goodbye: {
      headline: 'Later',
      body: `I'll be here. ${DEX_NAME} doesn't wander off.`,
    },
    frustration: {
      headline: 'Fair enough',
      body: "Fair. I'm listening — about work, or not.",
    },
    correction: {
      headline: 'Got it — try again',
      body: "Tell me what looked wrong and I'll try again.",
    },
    misunderstanding: {
      headline: 'Which part?',
      body: "Tell me which part I misunderstood and I'll correct it.",
    },
    off_topic: conversationLimitedFallback(),
  };
  const selected = copy[intent];
  return {
    answerId: `conversation:${intent}`,
    intent: `conversation.${intent}`,
    confidence: 1,
    mode: 'allowed',
    headline: selected.headline,
    body: selected.body,
    sources: [],
  };
}
