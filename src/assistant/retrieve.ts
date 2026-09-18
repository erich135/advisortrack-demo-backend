/**
 * AdvisorTrack Assistant A5 Option A — deterministic retrieval.
 * No model, semantic index, or persistence. Match only against already-allowed cards.
 */
export type RetrievableCard = {
  id: string;
  title: string;
  aliases: string[];
  questionForms: string[];
  summary: string;
  routes: string[];
};

export type RetrievalHit<T extends RetrievableCard> = {
  card: T;
  score: number;
};

export type RankedCard<T extends RetrievableCard> = {
  card: T;
  score: number;
  exactForm: boolean;
};

export type RetrievalResult<T extends RetrievableCard> =
  | { kind: 'match'; card: T; score: number; exactForm: boolean }
  | { kind: 'disambiguate'; cards: Array<RetrievalHit<T>> }
  | { kind: 'unknown' };

const STOP = new Set([
  'a',
  'an',
  'and',
  'are',
  'about',
  'any',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'please',
  'should',
  'that',
  'the',
  'this',
  'to',
  'we',
  'what',
  'where',
  'why',
  'with',
  'would',
  'you',
  'your',
]);

const MATCH_MIN = 0.55;
const MATCH_LEAD = 0.12;
const DISAMBIGUATE_MIN = 0.38;
const DISAMBIGUATE_WINDOW = 0.18;
const DISAMBIGUATE_MAX = 4;
const ROUTE_BONUS = 0.08;

export function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/organisations?/g, 'organization')
    .replace(/licenses?/g, 'license')
    .replace(/licences?/g, 'license')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function questionTokens(value: string): string[] {
  return normalizeQuestion(value).split(/\s+/).filter((token) => token.length > 1 && !STOP.has(token));
}

function fieldScore(queryNorm: string, queryTokens: string[], field: string, weight: number): number {
  const fieldNorm = normalizeQuestion(field);
  if (!fieldNorm || !queryNorm) return 0;
  if (fieldNorm === queryNorm) return weight;
  if (queryNorm.length >= 12 && fieldNorm.includes(queryNorm)) return weight * 0.95;
  if (fieldNorm.length >= 12 && queryNorm.includes(fieldNorm)) return weight * 0.9;
  const fieldTokens = questionTokens(field);
  if (!queryTokens.length || !fieldTokens.length) return 0;
  const fieldSet = new Set(fieldTokens);
  let overlap = 0;
  for (const token of queryTokens) {
    if (fieldSet.has(token)) overlap += 1;
  }
  if (!overlap) return 0;
  const recall = overlap / queryTokens.length;
  const precision = overlap / fieldTokens.length;
  return weight * (0.7 * recall + 0.3 * precision);
}

export function scoreCard<T extends RetrievableCard>(
  question: string,
  card: T,
  currentRouteId: string | null,
): number {
  return scoreCardParts(question, card, currentRouteId).score;
}

function scoreCardParts<T extends RetrievableCard>(
  question: string,
  card: T,
  currentRouteId: string | null,
): { content: number; score: number; exactForm: boolean } {
  const queryNorm = normalizeQuestion(question);
  const queryTokens = questionTokens(question);
  if (!queryTokens.length) return { content: 0, score: 0, exactForm: false };

  let best = 0;
  let exactForm = false;
  for (const form of card.questionForms) {
    const formNorm = normalizeQuestion(form);
    if (formNorm && formNorm === queryNorm) exactForm = true;
    best = Math.max(best, fieldScore(queryNorm, queryTokens, form, 1));
  }
  for (const alias of card.aliases) {
    best = Math.max(best, fieldScore(queryNorm, queryTokens, alias, 0.86));
  }
  best = Math.max(best, fieldScore(queryNorm, queryTokens, card.title, 0.72));
  best = Math.max(best, fieldScore(queryNorm, queryTokens, card.summary, 0.28));
  const content = Math.min(1, best);
  const score =
    currentRouteId && card.routes.includes(currentRouteId)
      ? Math.min(1, content + ROUTE_BONUS)
      : content;
  return { content, score, exactForm };
}

export function rankCards<T extends RetrievableCard>(
  allowedCards: T[],
  question: string,
  currentRouteId: string | null = null,
): Array<RankedCard<T>> {
  return allowedCards
    .map((card) => {
      const parts = scoreCardParts(question, card, currentRouteId);
      return { card, score: parts.score, exactForm: parts.exactForm };
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id));
}

export function retrieveCards<T extends RetrievableCard>(
  allowedCards: T[],
  question: string,
  currentRouteId: string | null = null,
): RetrievalResult<T> {
  const queryTokens = questionTokens(question);
  if (!queryTokens.length) return { kind: 'unknown' };

  const ranked = rankCards(allowedCards, question, currentRouteId);

  if (!ranked.length) return { kind: 'unknown' };

  const top = ranked[0];
  const second = ranked[1];
  const exactUnique = top.exactForm && (!second || !second.exactForm);
  const unique =
    exactUnique ||
    (top.score >= MATCH_MIN && (!second || top.score - second.score >= MATCH_LEAD));

  if (unique) {
    return { kind: 'match', card: top.card, score: top.score, exactForm: top.exactForm };
  }

  const close = ranked
    .filter((hit) => hit.score >= DISAMBIGUATE_MIN && top.score - hit.score <= DISAMBIGUATE_WINDOW)
    .slice(0, DISAMBIGUATE_MAX);

  if (close.length >= 2) {
    return { kind: 'disambiguate', cards: close };
  }

  return { kind: 'unknown' };
}
