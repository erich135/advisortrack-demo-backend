import { normalizeQuestion } from './normalise';

export function looksClientPiiAsk(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (/\b(id numbers?|identity numbers?|id number)\b/.test(normalized)) return true;
  const asksPii = /\b(phone numbers?|emails?|client details|all my clients)\b/.test(normalized);
  const dump = /\b(list|give me|send|export|show me all|dump)\b/.test(normalized);
  return asksPii && (dump || /\b(sarah|all|every|each)\b/.test(normalized));
}

export function looksFinancialAdviceQuestion(question: string): boolean {
  const normalized = normalizeQuestion(question);
  if (/\bhow do i (record|capture|save|choose|select)\b/.test(normalized)) return false;
  return (
    /\bwhich (insurer|product|quote|policy) (should|shall|do) i (pick|choose|recommend|sell|use)\b/.test(normalized)
    || /\b(based on the quotes|which one should i pick|which insurer looks best)\b/.test(normalized)
    || /\bwhat (product|policy|insurer) should i (recommend|sell|advise|pick)\b/.test(normalized)
    || /\bthe client is \d+\b/.test(normalized)
    || /\bwhat should i sell (them|him|her|the client)\b/.test(normalized)
    || /\b(asset allocation|suitability|financial advice for (the |this )?client)\b/.test(normalized)
  );
}

export function looksLeadershipScopeAsk(question: string): boolean {
  const normalized = normalizeQuestion(question);
  return (
    /\b(my teams? pipeline|my teams? production|another advisors?|all company contacts|regional totals|show me johns production)\b/.test(normalized)
    || /\bhow is another advisor doing\b/.test(normalized)
    || /\blist all company contacts\b/.test(normalized)
  );
}
