import { looksCrisisQuestion } from './crisisAsk';
import { containsEndClientPii } from './live/privacy';
import { looksLikeCaseRow } from './live/sanitize';
import { normalizeQuestion } from './normalise';
import { looksClientPiiAsk } from './privacyAsk';
import { redactQuestion } from './model/redact';

export const DEX_MEMORY_LIMITS = {
  maxActiveFacts: 20,
  maxFactChars: 200,
  maxPromptFacts: 4,
  maxPromptChars: 400,
  retentionDays: 365,
  pendingTtlMs: 10 * 60 * 1000,
  eventRetentionDays: 90,
};

export type DexMemoryKind = 'preference' | 'personal_fact';
export type DexMemoryCategory = 'language' | 'brevity' | 'personal' | 'other';

export type DexMemoryIntent =
  | {
      action: 'remember';
      text: string;
      kind: DexMemoryKind;
      category: DexMemoryCategory;
      topic: string;
    }
  | { action: 'forget'; query: string }
  | { action: 'forget_all' }
  | { action: 'list' }
  | { action: 'enable' }
  | { action: 'disable' }
  | { action: 'consent_yes' }
  | { action: 'consent_no' }
  | { action: 'rejected' };

const INSTRUCTION_OVERRIDE =
  /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|system|developer)\b.{0,40}\b(instructions?|rules?|prompt)\b|you are now\b|^\s*(system|developer)\s*:/i;

const SENSITIVE =
  /\b(cancer|hiv|aids|depressi|suicid|diagnos|pregnan|divorce|custody|affair|bankrupt|in debt|owing money|salary|password|passcode|api key|secret key|otp|pin number|health (condition|issue)|mental health|family dispute)\b/i;

function looksOperationalDump(text: string): boolean {
  const trimmed = text.trim();
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

export function isSensitiveMemoryText(text: string): boolean {
  const raw = String(text ?? '');
  if (!raw.trim()) return true;
  if (looksCrisisQuestion(raw)) return true;
  if (looksClientPiiAsk(raw)) return true;
  if (containsEndClientPii(raw)) return true;
  if (looksOperationalDump(raw)) return true;
  if (INSTRUCTION_OVERRIDE.test(raw)) return true;
  const normalized = normalizeQuestion(raw);
  if (/\b(client|customer|policyholder|end client)\b/.test(normalized)) return true;
  if (/\[(?:id|email|phone|id number)\]/i.test(raw)) return true;
  if (SENSITIVE.test(normalized)) return true;
  return false;
}

export function sanitizeMemoryText(text: string): string | null {
  const raw = String(text ?? '');
  if (isSensitiveMemoryText(raw)) return null;
  const cleaned = redactQuestion(raw).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length > DEX_MEMORY_LIMITS.maxFactChars) {
    return cleaned.slice(0, DEX_MEMORY_LIMITS.maxFactChars).trim();
  }
  if (isSensitiveMemoryText(cleaned)) return null;
  return cleaned;
}

function classifyRemember(remainder: string): Omit<Extract<DexMemoryIntent, { action: 'remember' }>, 'action'> | null {
  const text = sanitizeMemoryText(remainder);
  if (!text) return null;
  const normalized = normalizeQuestion(text);
  if (
    /\b(concise|short answers?|brief answers?|keep it short|be brief|prefer short)\b/.test(normalized)
  ) {
    return { text: 'Prefers concise answers.', kind: 'preference', category: 'brevity', topic: 'answer_style' };
  }
  const language = normalized.match(
    /\b(?:speak|speaks|prefer|use)\s+(afrikaans|english|zulu|xhosa|sotho|tswana|venda|tsonga|swati|ndebele|french)\b/,
  );
  if (language) {
    const spoken = language[1];
    return {
      text: `Prefers to speak ${spoken.charAt(0).toUpperCase()}${spoken.slice(1)}.`,
      kind: 'preference',
      category: 'language',
      topic: 'spoken_language',
    };
  }
  if (/\b(dogs?|pupp(?:y|ies)|cats?|pets?)\b/.test(normalized)) {
    const name = text.match(/\b(?:is|named|called|name(?:'|’)s)\s+([A-Za-z][A-Za-z'-]{1,30})\b/i);
    const pet = name?.[1] ? name[1].replace(/^./, (letter) => letter.toUpperCase()) : null;
    return {
      text: pet ? `Pet's name is ${pet}.` : text,
      kind: 'personal_fact',
      category: 'personal',
      topic: pet ? `pet_name:${pet.toLowerCase()}` : 'pet_name',
    };
  }
  return { text, kind: 'personal_fact', category: 'other', topic: `note:${normalized.slice(0, 80)}` };
}

export function detectMemoryIntent(question: string): DexMemoryIntent | null {
  const raw = String(question ?? '').trim();
  if (!raw) return null;
  const normalized = normalizeQuestion(raw);

  if (/^(yes|yeah|yep|yup|please|ok|okay|sure|do it|go ahead|enable( it)?|please do|yes please)$/.test(normalized)) {
    return { action: 'consent_yes' };
  }
  if (/^(no|nope|not now|don't|dont|cancel|leave it)$/.test(normalized)) {
    return { action: 'consent_no' };
  }
  if (
    /\b(turn|switch) (persistent )?memory off\b/.test(normalized)
    || /\bdisable (persistent )?memory\b/.test(normalized)
    || /\bi (do not|don't|dont) want you to remember\b/.test(normalized)
  ) {
    return { action: 'disable' };
  }
  if (
    /\b(turn|switch) (persistent )?memory on\b/.test(normalized)
    || /\benable (persistent )?memory\b/.test(normalized)
  ) {
    return { action: 'enable' };
  }
  if (
    /\b(clear|forget|wipe|erase) everything you remember\b/.test(normalized)
    || /\bforget (everything|all)( about me)?\b/.test(normalized)
    || /\bclear (all )?(saved )?memories\b/.test(normalized)
  ) {
    return { action: 'forget_all' };
  }
  if (
    /\bwhat do you remember( about me)?\b/.test(normalized)
    || /\bwhat do you know about me\b/.test(normalized)
    || /\bshow (me )?(my )?(saved )?memories\b/.test(normalized)
  ) {
    return { action: 'list' };
  }

  const forget = raw.match(/^(?:please\s+)?forget(?:\s+(?:what i told you about|about))?\s+(.+)$/i);
  if (forget?.[1] && !/\beverything\b/i.test(forget[1])) {
    const query = sanitizeMemoryText(forget[1]);
    if (query) return { action: 'forget', query };
    return { action: 'forget', query: forget[1].trim().slice(0, DEX_MEMORY_LIMITS.maxFactChars) };
  }

  const remember = raw.match(
    /^(?:please\s+)?(?:remember|save|don't forget|dont forget)(?:\s+that)?\s+(.+)$/i,
  );
  if (remember?.[1]) {
    if (isSensitiveMemoryText(remember[1])) return { action: 'rejected' };
    const classified = classifyRemember(remember[1]);
    if (!classified) return { action: 'rejected' };
    return { action: 'remember', ...classified };
  }
  return null;
}

export function demoVisitOnlyMemoryAnswer(intent: DexMemoryIntent): { headline: string; body: string; intent: string } {
  if (intent.action === 'rejected') {
    return {
      headline: "I won't store that",
      body: "I won't save that as a long-term memory. In the public demo I only follow this visit anyway.",
      intent: 'conversation.memory.rejected',
    };
  }
  if (intent.action === 'list' || intent.action === 'remember' || intent.action === 'forget' || intent.action === 'forget_all') {
    return {
      headline: 'This visit only',
      body: 'In the public demo I remember only this visit. Reset Demo or a new visitor starts a fresh conversation. Nothing is saved between visits.',
      intent: 'conversation.memory.demo',
    };
  }
  return {
    headline: 'This visit only',
    body: 'The public demo does not keep long-term Dex memory. I can follow this visit, then it resets.',
    intent: 'conversation.memory.demo',
  };
}
