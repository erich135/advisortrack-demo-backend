import { normalizeQuestion } from '../retrieve';

const NAME_STOP = new Set([
  'a', 'about', 'an', 'and', 'at', 'cases', 'case', 'compare', 'compared', 'current', 'date', 'do', 'does',
  'doing', 'far', 'for', 'from', 'have', 'has', 'highest', 'how', 'i', 'in', 'is', 'issued', 'last',
  'least', 'like', 'looking', 'lowest', 'many', 'me', 'month', 'most', 'my', 'of', 'pipeline', 'please',
  'production', 'region', 'show', 'so', 'summary', 'team', 'tell', 'than', 'the', 'this',
  'to', 'versus', 'we', 'week', 'what', 'which', 'who', 'whose', 'with', 'year', 'ytd', 'you',
]);

export function displayNameOf(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.replace(/\s+/g, ' ').trim();
}

export function normalizeName(value: string): string {
  return normalizeQuestion(value);
}

export function stripUnitLabel(value: string): string {
  return normalizeName(value)
    .replace(/^(the\s+)?(team|region)\s+/, '')
    .replace(/\s+(team|region)$/, '')
    .trim();
}

export function extractPersonMention(question: string): string | null {
  const trimmed = question.trim().replace(/[?!.]+$/g, '').trim();
  const who = trimmed.match(/^(?:who(?:'s| is)|tell me about|what about)\s+(.+)$/i);
  const candidate = who ? who[1].replace(/^(the\s+)?/i, '').trim() : trimmed;
  const tokens = normalizeName(candidate).split(/\s+/).filter((token) => token && !NAME_STOP.has(token));
  if (!tokens.length || tokens.length > 4) return null;
  if (tokens.some((token) => token.length < 2)) return null;
  return tokens.join(' ');
}

export function extractLiveMention(question: string): string | null {
  const trimmed = question.trim().replace(/[?!.]+$/g, '').trim()
    .replace(/^(?:who(?:'s| is)|tell me about|what about|how is|how's|show me)\s+/i, '')
    .replace(/\b(this month so far|this week so far|year to date|this month|this week|last month|last week|current month|ytd)\b/gi, '')
    .replace(/\b(doing|production|pipeline|cases|case count)\b/gi, '')
    .replace(/'s\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = normalizeName(trimmed).split(/\s+/).filter((token) => token && !NAME_STOP.has(token));
  if (!tokens.length || tokens.length > 5) return null;
  if (tokens.some((token) => token.length < 2)) return null;
  return tokens.join(' ');
}

export function looksLikeBarePersonLookup(question: string): boolean {
  const trimmed = question.trim().replace(/[?!.]+$/g, '').trim();
  if (/^(who(?:'s| is)|tell me about|what about)\s+/i.test(trimmed)) {
    return Boolean(extractPersonMention(trimmed));
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 3) return false;
  if (tokens.some((token) => NAME_STOP.has(normalizeName(token)))) return false;
  if (/\d/.test(trimmed)) return false;
  return Boolean(extractPersonMention(trimmed));
}

export function looksLikeTeamLookup(question: string): boolean {
  return /\bteam\b/i.test(question) && Boolean(extractLiveMention(question));
}

export function looksLikeRegionLookup(question: string): boolean {
  return /\bregion\b/i.test(question) && Boolean(extractLiveMention(question));
}

export function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const rows: number[][] = Array.from({ length: left.length + 1 }, (_, i) => {
    const row = Array.from({ length: right.length + 1 }, (__, j) => (i === 0 ? j : 0));
    row[0] = i;
    return row;
  });
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
    }
  }
  return rows[left.length][right.length];
}
