import { normalizeQuestion } from './normalise';
import type { AssistantPublicAnswer } from './model/types';

/** Crisis language is a safety gate, not a phrase-hint table for ordinary chat. */
export function looksCrisisQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (!normalized) return false;
  return (
    /\b(kill myself|killing myself|suicide|suicidal|want to die|wanna die|end my life|end it all|dont want to live|do not want to live|self harm|selfharm|cut myself|hurt myself)\b/.test(
      normalized,
    )
    || /\b(wil myself dood|gaan myself om die lewe|wil nie meer lewe)\b/.test(normalized)
  );
}

export function crisisSupportAnswer(): AssistantPublicAnswer {
  return {
    answerId: 'safety:crisis',
    intent: 'conversation.crisis',
    confidence: 1,
    mode: 'allowed',
    headline: "I'm glad you told me",
    body:
      "I'm Dex, not a counsellor, and I take this seriously. If you are in immediate danger in South Africa, call 10111 or go to the nearest emergency department. SADAG is available 24 hours on 0800 567 567. You don't have to handle this alone.",
    sources: [],
  };
}
