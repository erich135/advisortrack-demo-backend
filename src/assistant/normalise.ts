/**
 * Retrieval-only query normalisation. Stored product copy is never rewritten.
 */

const STOP = new Set([
  'a', 'an', 'and', 'are', 'about', 'any', 'can', 'could', 'did', 'do', 'does', 'for', 'from',
  'how', 'hows', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'our', 'please', 'should', 'that',
  'the', 'this', 'to', 'we', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'who', 'whos',
  'why', 'whys', 'with', 'would', 'you', 'your',
]);

/** Product-domain tokens eligible for bounded edit-distance correction. */
export const PRODUCT_VOCAB = [
  'production', 'pipeline', 'follow', 'followup', 'followups', 'underwriting', 'recommendation',
  'implementation', 'subscription', 'conversion', 'contacts', 'contact', 'activities',
  'activity', 'factfind', 'factfinding', 'fica', 'popia', 'pma', 'licence', 'license',
  'organisation', 'organization', 'preview', 'medicals', 'prospect', 'prospects',
  'client', 'clients', 'inactive', 'target', 'targets', 'commission', 'planning',
  'profile', 'settings', 'setup', 'ratios', 'ratio', 'underwrite', 'issued',
  'quotes', 'quote', 'insurer', 'document', 'documents', 'review', 'reviews',
  'overdue', 'meeting', 'meetings', 'call', 'calls', 'goal', 'nett',
] as const;

const PHRASES: Array<[RegExp, string]> = [
  [/\bfollow[\s-]*ups?\b/g, 'followup'],
  [/\bfact[\s-]*find(?:ing|s)?\b/g, 'factfind'],
  [/\bunder[\s-]*writ(?:e|ing|ten)?\b/g, 'underwriting'],
  [/\blive[\s-]*preview\b/g, 'livepreview'],
  [/\bconversion[\s-]*ratios?\b/g, 'conversionratio'],
  [/\bnext[\s-]*actions?\b/g, 'nextaction'],
  [/\bbook[\s-]*of[\s-]*business\b/g, 'bookofbusiness'],
];

export function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    let diag = previous[0];
    previous[0] = i + 1;
    for (let j = 0; j < right.length; j += 1) {
      const nextDiag = previous[j + 1];
      const cost = left[i] === right[j] ? 0 : 1;
      previous[j + 1] = Math.min(previous[j + 1] + 1, previous[j] + 1, diag + cost);
      diag = nextDiag;
    }
  }
  return previous[right.length];
}

function applyPhrases(value: string): string {
  let next = value;
  for (const [pattern, replacement] of PHRASES) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function applySpelling(value: string): string {
  return value
    .replace(/organisations?/g, 'organization')
    .replace(/organizations?/g, 'organization')
    .replace(/licences?/g, 'license')
    .replace(/licenses?/g, 'license')
    .replace(/programmes?/g, 'program')
    .replace(/\bnett\b/g, 'nett')
    .replace(/\bnet (goal|income|target)\b/g, 'nett $1');
}

export function correctProductToken(token: string): string {
  if (token.length < 4) return token;
  if ((PRODUCT_VOCAB as readonly string[]).includes(token)) return token;
  const budget = token.length < 8 ? 1 : 2;
  const candidates: string[] = [];
  let bestDistance = budget + 1;
  for (const vocab of PRODUCT_VOCAB) {
    if (vocab[0] !== token[0]) continue;
    if (token.length >= 4 && vocab.slice(0, 3) !== token.slice(0, 3)) continue;
    if (Math.abs(vocab.length - token.length) > 2) continue;
    const distance = levenshtein(token, vocab);
    if (distance > budget || distance === 0) continue;
    if (distance < bestDistance) {
      candidates.length = 0;
      candidates.push(vocab);
      bestDistance = distance;
    } else if (distance === bestDistance) {
      candidates.push(vocab);
    }
  }
  if (candidates.length === 0) return token;
  if (candidates.length === 1) return candidates[0];
  const closestGap = Math.min(...candidates.map((item) => Math.abs(item.length - token.length)));
  const closest = candidates.filter((item) => Math.abs(item.length - token.length) === closestGap);
  if (closest.length === 1) return closest[0];
  const shortest = closest.reduce((left, right) => (left.length <= right.length ? left : right));
  if (closest.every((item) => item.startsWith(shortest))) {
    return closest.reduce((left, right) => (left.length >= right.length ? left : right));
  }
  return token;
}

export function normalizeQuestion(value: string): string {
  let text = value
    .toLowerCase()
    .replace(/['’]/g, '');
  text = applySpelling(text);
  text = applyPhrases(text);
  text = text.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!text) return '';
  const corrected = text.split(/\s+/).map(correctProductToken).join(' ');
  return applyPhrases(corrected).replace(/\s+/g, ' ').trim();
}

export function questionTokens(value: string): string[] {
  return normalizeQuestion(value).split(/\s+/).filter((token) => token.length > 1 && !STOP.has(token));
}

export function isStopToken(token: string): boolean {
  return STOP.has(token);
}
