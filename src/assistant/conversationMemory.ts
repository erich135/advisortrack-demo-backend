import { redactQuestion } from './model/redact';
import { containsEndClientPii } from './live/privacy';
import { looksLikeCaseRow } from './live/sanitize';
import type { AssistantEnvironment, TrustedAssistantIdentity } from './context';

/** Short-term Dex session memory. Not persisted. Never a database table. */
export const CONVERSATION_MEMORY_LIMITS = {
  maxExchanges: 6,
  maxMessages: 12,
  maxTurnChars: 400,
  ttlMs: 30 * 60 * 1000,
};

export type ConversationTurn = {
  role: 'user' | 'assistant';
  text: string;
};

type ConversationIdentity = Pick<TrustedAssistantIdentity, 'userId' | 'companyId'> & {
  conversationScope?: string | null;
};

type MemoryEntry = {
  turns: ConversationTurn[];
  expiresAt: number;
};

const sessions = new Map<string, MemoryEntry>();

const INSTRUCTION_OVERRIDE =
  /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|system|developer)\b.{0,40}\b(instructions?|rules?|prompt)\b|you are now\b|^\s*(system|developer)\s*:/i;

function trustedScope(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9:_-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Personal-memory boundary. Demo visitors are keyed by the server-validated
 * JWT demo session, never by Maya's cloned userId. Production advisers are
 * keyed by authenticated user + company. Client-supplied ids never enter here.
 */
export function conversationMemoryKey(
  environment: AssistantEnvironment,
  identity: ConversationIdentity,
): string | null {
  if (environment === 'demo') {
    const scope = trustedScope(identity.conversationScope);
    if (!scope) return null;
    return `demo:session:${scope}`;
  }
  const userId = identity.userId?.trim();
  if (!userId) return null;
  return `production:user:${userId}:company:${identity.companyId ?? 'none'}`;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(key);
  }
}

export function resetAssistantConversationMemory(): void {
  sessions.clear();
}

export function clearAssistantConversation(input: {
  environment: AssistantEnvironment;
  identity?: ConversationIdentity;
  conversationScope?: string | null;
}): void {
  const key = conversationMemoryKey(input.environment, {
    userId: input.identity?.userId ?? '',
    companyId: input.identity?.companyId ?? null,
    conversationScope: input.conversationScope ?? input.identity?.conversationScope ?? null,
  });
  if (key) sessions.delete(key);
}

function looksLikeOperationalDump(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (looksLikeCaseRow(parsed)) return true;
      if (Array.isArray(parsed) && parsed.some((item) => looksLikeCaseRow(item))) return true;
    } catch {
      /* not JSON */
    }
  }
  return /\b(contactName|clientName|caseId|case_id|policyNumber|idNumber)\b/.test(text);
}

function sanitizeTurnText(role: ConversationTurn['role'], raw: string): string | null {
  let text = redactQuestion(String(raw ?? '')).slice(0, CONVERSATION_MEMORY_LIMITS.maxTurnChars);
  if (!text.trim()) return null;
  if (looksLikeOperationalDump(text)) return null;
  if (containsEndClientPii(text)) {
    text = text
      .replace(/\b\d{13}\b/g, '[id]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
    if (containsEndClientPii(text)) return null;
  }
  if (role === 'assistant' && INSTRUCTION_OVERRIDE.test(text)) return '[removed]';
  return text;
}

export function sanitizeConversationTurns(turns: ConversationTurn[] | null | undefined): ConversationTurn[] {
  if (!Array.isArray(turns) || !turns.length) return [];
  const cleaned: ConversationTurn[] = [];
  for (const turn of turns.slice(-CONVERSATION_MEMORY_LIMITS.maxMessages)) {
    if (turn?.role !== 'user' && turn?.role !== 'assistant') continue;
    const text = sanitizeTurnText(turn.role, String(turn.text ?? ''));
    if (!text) continue;
    cleaned.push({ role: turn.role, text });
  }
  return cleaned.slice(-CONVERSATION_MEMORY_LIMITS.maxMessages);
}

function storedTurns(key: string | null, now: number): ConversationTurn[] {
  if (!key) return [];
  const stored = sessions.get(key);
  if (!stored || stored.expiresAt <= now || !stored.turns.length) return [];
  return sanitizeConversationTurns(stored.turns);
}

export function readAssistantConversation(input: {
  environment: AssistantEnvironment;
  identity: ConversationIdentity;
  now?: number;
}): ConversationTurn[] {
  const now = input.now ?? Date.now();
  pruneExpired(now);
  return storedTurns(conversationMemoryKey(input.environment, input.identity), now);
}

export function peekAssistantConversation(input: {
  environment: AssistantEnvironment;
  identity: ConversationIdentity;
  now?: number;
}): ConversationTurn[] {
  return readAssistantConversation(input);
}

/**
 * Resolve untrusted client history against the backend-owned session.
 * Empty or omitted history never clears memory. resetConversation is explicit.
 * Client history cannot select another visitor's or adviser's store.
 */
export function resolveConversationHistory(input: {
  environment: AssistantEnvironment;
  identity: ConversationIdentity;
  clientHistory?: ConversationTurn[] | null;
  previousQuestion?: string | null;
  resetConversation?: boolean;
  now?: number;
}): ConversationTurn[] {
  const now = input.now ?? Date.now();
  pruneExpired(now);
  const key = conversationMemoryKey(input.environment, input.identity);
  if (input.resetConversation) {
    if (key) sessions.delete(key);
    return [];
  }
  if (Array.isArray(input.clientHistory) && input.clientHistory.length > 0) {
    return sanitizeConversationTurns(input.clientHistory);
  }
  const stored = storedTurns(key, now);
  if (stored.length) return stored;
  const previous = input.previousQuestion?.trim();
  if (previous) {
    return sanitizeConversationTurns([{ role: 'user', text: previous }]);
  }
  return [];
}

export function rememberAssistantTurn(input: {
  environment: AssistantEnvironment;
  identity: ConversationIdentity;
  history: ConversationTurn[];
  userText: string;
  assistantText: string;
  skipUserText?: boolean;
  now?: number;
}): ConversationTurn[] {
  const now = input.now ?? Date.now();
  pruneExpired(now);
  const next = sanitizeConversationTurns([
    ...input.history,
    ...(input.skipUserText ? [] : [{ role: 'user' as const, text: input.userText }]),
    { role: 'assistant', text: input.assistantText },
  ]);
  const key = conversationMemoryKey(input.environment, input.identity);
  if (!key) return next;
  sessions.set(key, {
    turns: next,
    expiresAt: now + CONVERSATION_MEMORY_LIMITS.ttlMs,
  });
  return next;
}

export function lastUserQuestion(history: ConversationTurn[], fallback?: string | null): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === 'user' && history[index].text.trim()) return history[index].text;
  }
  return fallback?.trim() || null;
}

export function conversationMemoryHasText(input: {
  environment: AssistantEnvironment;
  identity: ConversationIdentity;
  pattern: RegExp;
  now?: number;
}): boolean {
  const turns = readAssistantConversation(input);
  return turns.some((turn) => input.pattern.test(turn.text));
}
