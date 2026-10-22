import { normalizeQuestion } from './normalise';

export type PhraseHint =
  | { kind: 'live'; live: 'followups' | 'mypipeline' | 'myproduction' | 'mytarget' | 'mycontacts' | 'mydashboard' }
  | { kind: 'card'; cardId: string };

const PHRASE_HINTS: Array<{ pattern: RegExp; hint: PhraseHint }> = [
  { pattern: /^(how am i doing|how am i doing this month|give me a quick overview|where do i stand|whats my position this month|am i on track)$/, hint: { kind: 'live', live: 'mydashboard' } },
  { pattern: /^(what needs my attention|what should i look at today|anything i need to sort out|what is outstanding|whats waiting on me|what still needs attention)$/, hint: { kind: 'live', live: 'mydashboard' } },
  { pattern: /^(where am i with my target|how far am i from( my)? target|how much more do i need)$/, hint: { kind: 'live', live: 'mytarget' } },
  { pattern: /^(whats happening with my cases|how many open cases do i have)$/, hint: { kind: 'live', live: 'mypipeline' } },
  { pattern: /^(anything i need to do today|what do i need to do today)$/, hint: { kind: 'live', live: 'followups' } },
  { pattern: /^(how many contacts do i have|how many prospects do i have|how many clients do i have)$/, hint: { kind: 'live', live: 'mycontacts' } },
  { pattern: /^(i finished (the |this )?meeting now what|i finished this meeting what now)$/, hint: { kind: 'card', cardId: 'ACTIVITY.PROCEED' } },
  { pattern: /^(i added this guy what now|what do i do with this guy next)$/, hint: { kind: 'card', cardId: 'CONTACT.ADD_ACTIVITY' } },
  { pattern: /^(why did he go inactive)$/, hint: { kind: 'card', cardId: 'CONTACT.INACTIVE' } },
  { pattern: /^(where did my contact go)$/, hint: { kind: 'card', cardId: 'CONTACT.LIVE_PREVIEW' } },
  { pattern: /^(this app says pending underwriting what does that mean|what does pending underwriting mean)$/, hint: { kind: 'card', cardId: 'PRODUCTION.STATUS.PENDING_UNDERWRITING' } },
  { pattern: /^(why is this( thing)? locked)$/, hint: { kind: 'card', cardId: 'SUBSCRIPTION.LOCKED' } },
  { pattern: /^(why wont mine submit|why cant i submit( it| this)?)$/, hint: { kind: 'card', cardId: 'PIPELINE.SUBMIT_BLOCKED' } },
];

export function phraseHintFor(question: string, routeId?: string | null): PhraseHint | null {
  const normalized = normalizeQuestion(question);
  if (!normalized) return null;
  if (normalized === 'what do i do next' || normalized === 'how do i move this along') {
    if (routeId === 'advisor-case-detail') return null;
    if (routeId === 'advisor-activities' || routeId === 'advisor-activity-detail') {
      return { kind: 'card', cardId: 'ACTIVITY.PROCEED' };
    }
    if (routeId === 'advisor-contacts' || routeId === 'advisor-contact-detail') {
      return { kind: 'card', cardId: 'CONTACT.ADD_ACTIVITY' };
    }
    if (routeId === 'advisor-pipeline') return { kind: 'live', live: 'mypipeline' };
  }
  if (normalized === 'why is this locked' || normalized === 'why is this thing locked') {
    if (routeId === 'advisor-contacts' || routeId === 'advisor-contact-detail') {
      return { kind: 'card', cardId: 'CONTACT.LIVE_PREVIEW' };
    }
    return { kind: 'card', cardId: 'SUBSCRIPTION.LOCKED' };
  }
  if (normalized === 'what does this mean' || normalized === 'what does pending mean') {
    if (routeId === 'advisor-production') return { kind: 'card', cardId: 'PRODUCTION.STATUS.PENDING_UNDERWRITING' };
  }
  for (const entry of PHRASE_HINTS) {
    if (entry.pattern.test(normalized)) return entry.hint;
  }
  return null;
}

const FOLLOW_UP_MARKERS = /^(do i have to complete it|why wont mine submit|why cant i submit it|what about (that|this|it)|and that|does it apply|why is that)$/;

export function expandConversationFollowUp(question: string, previousQuestion?: string | null): string {
  if (!previousQuestion?.trim()) return question;
  const normalized = normalizeQuestion(question);
  const short = normalized.split(/\s+/).length <= 8;
  const pronoun = /\b(it|this|that|mine|he|him|them)\b/.test(normalized);
  if (!FOLLOW_UP_MARKERS.test(normalized) && !(short && pronoun)) return question;
  const previousNorm = normalizeQuestion(previousQuestion);
  const domain = previousNorm.match(
    /\b(fica|popia|pma|underwriting|production|pipeline|followup|subscription|livepreview|target|contact|case|quote|insurer|setup|planning)\b/,
  );
  if (!domain) return `${question} (about: ${previousQuestion})`;
  return `${question} ${domain[1]}`;
}
