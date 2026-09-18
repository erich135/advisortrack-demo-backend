/**
 * A6.1 / A7.2.1 deterministic conversational layer.
 * Pipeline mirror of Abel Backend. Canonical cards live in Abel; this repo consumes knowledge-bundle.json.
 * Runs before A5 retrieval. Pure smalltalk, frustration, and corrections never call a model provider.
 * Combined social or frustration + AdvisorTrack questions continue to live tools then A5/A6.
 */
import { normalizeQuestion } from './retrieve';
import type { AssistantPublicAnswer } from './model/types';
import type { CardEnvironment } from './types';

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

export type ConversationCategory = {
  id: string;
  label: string;
  environment: CardEnvironment;
};

const SOCIAL_PREFIX =
  /^(hi there|hello there|good morning|good afternoon|good evening|hello|hey there|hey|hi|morning|thanks that worked|perfect thank you|awesome thanks|okay thanks|ok thanks|thank you so much|thank you|thanks|cheers)\b[\s,!.:;?-]*/i;

const GREETING_FILLER =
  /^(how are you doing|how are you|hows it going|how's it going|how are things)\b[\s,!.:;?-]*/i;

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
];

function isFillerOnly(text: string): boolean {
  return /^(how are you doing|how are you|hows it going|how are things)$/.test(normalizeQuestion(text));
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
  if (hasDomainToken(normalized, categories)) return true;
  return /\b(how do i|how can i|how do we|where (can|do|are|is)|why (cant|cannot|is|are)|add a |assign )\b/.test(
    normalized,
  );
}

function stripLeadingSocial(question: string): { remainder: string; stripped: boolean } {
  let remainder = question.trim();
  let stripped = false;
  const withoutPrefix = remainder.replace(SOCIAL_PREFIX, '');
  if (withoutPrefix !== remainder) {
    remainder = withoutPrefix;
    stripped = true;
  }
  remainder = remainder.replace(GREETING_FILLER, '').replace(/^[\s,!.:;?-]+/, '').trim();
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
    /^(you suck|this is (?:so |really |completely |totally |fucking |damn |bloody )?(?:useless|shit|crap|garbage)|this isnt helping|this is not helping|fuck this|fuck it|fuck you|fuck|youre useless|you are useless|stupid bot|dumb bot|useless bot|this sucks|screw this|what a (?:useless|stupid) bot)$/.test(
      normalized,
    )
  ) {
    return 'frustration';
  }
  return null;
}

function wholeIntent(normalized: string): ConversationIntent | null {
  if (
    /^(who are you|what are you|what do you do|whats your name|what is your name)$/.test(normalized)
  ) {
    return 'identity';
  }
  if (
    /^(what can you help me with|what can i ask you|what do you know|how can you help|how can you help me|help|help me)$/.test(
      normalized,
    )
  ) {
    return 'capabilities';
  }
  if (
    /^(thanks|thank you|cheers|awesome thanks|perfect thank you|thanks that worked|ok thanks|okay thanks)$/.test(
      normalized,
    )
  ) {
    return 'thanks';
  }
  if (/^(bye|goodbye|good bye|see you|see ya|later|bye bye)$/.test(normalized)) {
    return 'goodbye';
  }
  if (
    /^(hello|hi|hey|morning|good morning|good afternoon|good evening|hi there|hello there|hello how are you|hi how are you|hi how are you doing)$/.test(
      normalized,
    )
  ) {
    return 'greeting';
  }
  if (/^(cool|great|awesome|perfect|nice|got it|okay|ok)$/.test(normalized)) {
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
    || (negative.kind && !remainder ? negative.kind : null);
  if (whole) return { kind: 'conversation', intent: whole };

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
): AssistantPublicAnswer {
  const areas = formatAreas(visibleConversationAreas(categories, environment));
  const copy: Record<ConversationIntent, { headline: string; body: string }> = {
    greeting: {
      headline: 'Hi',
      body: "Hi! I'm doing well. How can I help you with AdvisorTrack today?",
    },
    thanks: {
      headline: "You're welcome",
      body: "You're welcome. Let me know if you need anything else in AdvisorTrack.",
    },
    identity: {
      headline: 'AdvisorTrack Assistant',
      body: "I'm the AdvisorTrack Assistant. I can help you use AdvisorTrack, explain features and permissions, and help you find information available in your AdvisorTrack account.",
    },
    capabilities: {
      headline: 'What I can help with',
      body: `I can help you use the AdvisorTrack Management Portal. Ask me about ${areas}.`,
    },
    acknowledgement: {
      headline: 'Got it',
      body: 'Glad that helps. Ask if you need anything else in AdvisorTrack.',
    },
    goodbye: {
      headline: 'Goodbye',
      body: "Goodbye. I'll be here when you need help with AdvisorTrack.",
    },
    frustration: {
      headline: 'Fair enough',
      body: "Fair enough. Tell me what went wrong, or ask me an AdvisorTrack question and I'll help you sort it out.",
    },
    correction: {
      headline: 'Thanks for flagging it',
      body: "Thanks for flagging it. Tell me what looked wrong and I'll try again.",
    },
    misunderstanding: {
      headline: 'Which part?',
      body: "Tell me which part I misunderstood and I'll correct it.",
    },
    off_topic: {
      headline: "I'm here for AdvisorTrack",
      body: `I'm here to help with AdvisorTrack. You can ask me about ${areas}.`,
    },
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
