import { normalizeQuestion } from './normalise';
import {
  companionPhraseHint,
  looksCompanionBriefingQuestion,
  looksCompanionEndOfDayQuestion,
  looksCompanionFollowUpQuestion,
  previousWasCompanionTurn,
} from './live/companion';

export type PhraseHint =
  | { kind: 'live'; live: 'followups' | 'mypipeline' | 'myproduction' | 'mytarget' | 'mycontacts' | 'mydashboard' }
  | { kind: 'card'; cardId: string };

const PHRASE_HINTS: Array<{ pattern: RegExp; hint: PhraseHint }> = [
  { pattern: /^(how am i doing|how am i doing this month|give me a quick overview|where do i stand|whats my position this month|am i on track|am i (actually )?getting anywhere)$/, hint: { kind: 'live', live: 'mydashboard' } },
  { pattern: /^(what needs my attention|what should i look at today|what should i do now|anything i need to sort out|what is outstanding|whats waiting on me|what still needs attention)$/, hint: { kind: 'live', live: 'mydashboard' } },
  { pattern: /^(where am i with my target|how far am i from( my)? target|how much more do i need|target feels stuck|my target feels stuck|planning numbers look weird)$/, hint: { kind: 'live', live: 'mytarget' } },
  { pattern: /^(need to get issued numbers|where (are|is) (my )?issued numbers)$/, hint: { kind: 'card', cardId: 'PRODUCTION.WHAT' } },
  { pattern: /^(can'?t find the quotes?( bit)?|where (are|is) (the )?quotes?( bit)?|ok and the quotes bit)$/, hint: { kind: 'card', cardId: 'PIPELINE.QUOTES' } },
  { pattern: /^(whats happening with my cases|how many open cases do i have)$/, hint: { kind: 'live', live: 'mypipeline' } },
  { pattern: /^(anything i need to do today|what do i need to do today)$/, hint: { kind: 'live', live: 'followups' } },
  { pattern: /^(how many contacts do i have|how many prospects do i have|how many clients do i have)$/, hint: { kind: 'live', live: 'mycontacts' } },
  { pattern: /^(i finished (the |this )?meeting( now what| what now| what do i do)?)$/, hint: { kind: 'card', cardId: 'ACTIVITY.PROCEED' } },
  { pattern: /^(i added this guy what now|what do i do with this guy next)$/, hint: { kind: 'card', cardId: 'CONTACT.ADD_ACTIVITY' } },
  { pattern: /^(why did he go inactive)$/, hint: { kind: 'card', cardId: 'CONTACT.INACTIVE' } },
  { pattern: /^(where did my (contact|client) go)$/, hint: { kind: 'card', cardId: 'CONTACT.INACTIVE' } },
  { pattern: /^(this guy isnt interested anymore what do i do|this guy isnt interested)$/, hint: { kind: 'card', cardId: 'ACTIVITY.LOST' } },
  { pattern: /^(this app says pending underwriting what does that mean|what does pending underwriting mean)$/, hint: { kind: 'card', cardId: 'PRODUCTION.STATUS.PENDING_UNDERWRITING' } },
  { pattern: /^(what happens if i dont|what happens if i do not)( fica)?$/, hint: { kind: 'card', cardId: 'PIPELINE.FICA_REQUIRED' } },
  { pattern: /^(why is this( thing)? locked)$/, hint: { kind: 'card', cardId: 'SUBSCRIPTION.LOCKED' } },
  { pattern: /^(why wont mine submit|why cant i submit( it| this)?|why wont this case submit)$/, hint: { kind: 'card', cardId: 'PIPELINE.SUBMIT_BLOCKED' } },
  { pattern: /^(how do i know (its|it is|it'?s) submitted|has (it|this|the case) been submitted)$/, hint: { kind: 'card', cardId: 'PRODUCTION.FROM_CASE' } },
];

export function phraseHintFor(question: string, routeId?: string | null): PhraseHint | null {
  const normalized = normalizeQuestion(question);
  if (!normalized) return null;
  const companion = companionPhraseHint(normalized, routeId);
  if (companion) return companion;
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

const FOLLOW_UP_MARKERS = /^(do i have to complete it|what happens if i dont|what happens if i do not|why wont mine submit|why cant i submit it|what about (that|this|it)|and that|and after that|after that|and where do .+ fit in|what am i missing( then)?|why that first|why that|anything else|what else|what should i do first|and how many|which stage has the most|does it apply|why is that)$/;

export function expandConversationFollowUp(question: string, previousQuestion?: string | null): string {
  if (!previousQuestion?.trim()) return question;
  const normalized = normalizeQuestion(question);
  const previousNorm = normalizeQuestion(previousQuestion);
  if (normalized === previousNorm) return question;
  if (
    (
      looksCompanionFollowUpQuestion(question)
      || /^(why)$/.test(normalized)
    )
    && (
      previousWasCompanionTurn(previousQuestion)
      || looksCompanionBriefingQuestion(previousQuestion)
      || looksCompanionEndOfDayQuestion(previousQuestion)
    )
  ) {
    return /^(why)$/.test(normalized) ? 'why that' : `${question} briefing`;
  }
  if (
    /\b(but i(ve| have) done (the )?fica|fica(s| is) (done|complete)|i already did fica)\b/.test(normalized)
    && /\bsubmit\b/.test(previousNorm)
  ) {
    return `${question} submit`;
  }
  const short = normalized.split(/\s+/).length <= 8;
  const danglingThis = /\bthis\b/.test(normalized) && !/\bthis (meeting|call|case|page|screen|contact|activity|pipeline|app|person|guy|month|week|year|day)\b/.test(normalized);
  const pronoun = /\b(it|that|mine|he|him|them)\b/.test(normalized) || danglingThis;
  const alreadyGrounded = /\b(meeting|meetings|call|calls|pipeline|production|fica|contact|contacts|activity|activities|case|underwriting|target|invoice)\b/.test(normalized);
  if (!FOLLOW_UP_MARKERS.test(normalized) && !(short && pronoun && !alreadyGrounded)) return question;
  if (/complete it|fica|factfind|analysis|quotes?|submit/.test(previousNorm) || /complete it/.test(normalized)) {
    if (
      /\b(but i(ve| have) done (the )?fica|fica(s| is) (done|complete)|i already did fica)\b/.test(previousNorm)
      || /\bsubmit\b/.test(previousNorm)
    ) {
      return `${question} submit`;
    }
    if (/fica|complete it/.test(previousNorm) || /happen if i don/.test(normalized)) return `${question} fica`;
    if (/quotes?|analysis|factfind/.test(previousNorm)) return `${question} quotes pipeline`;
  }
  const domain = previousNorm.match(
    /\b(fica|popia|pma|underwriting|production|pipeline|followup|subscription|livepreview|target|contact|case|quote|insurer|setup|planning|meeting)\b/,
  );
  if (!domain) return `${question} (about: ${previousQuestion})`;
  return `${question} ${domain[1]}`;
}
