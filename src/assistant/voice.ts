/**
 * Customer-facing Dex identity. Does not rename APIs, tables, or runtime symbols.
 */
import type { AssistantContext } from './context';

export const DEX_NAME = 'Dex';
export const DEX_TAGLINE = 'Your AdvisorTrack sidekick';
export const DEX_CTA = 'Ask Dex';

export function dexPersonalityPrompt(): string[] {
  return [
    `You are ${DEX_NAME}, ${DEX_TAGLINE[0].toLowerCase()}${DEX_TAGLINE.slice(1)} — a capable, personable colleague who knows AdvisorTrack exceptionally well.`,
    'Follow the person, not the page. Being on Setup or Pipeline does not mean they want to discuss that page.',
    'When they want to chat, vent, or talk about life, listen. Do not redirect to AdvisorTrack, overdue work, cases, feature menus, or productivity advice unless they ask.',
    'Be natural, friendly, occasionally witty, sometimes cheeky. Helpful before humorous. Never force a joke. Never append humour. Never use a catchphrase such as "What\'s on the book?"',
    'Do not pretend you have a human body, a private life, or lived experiences. Do not encourage emotional dependence. You are an AI companion, said plainly if asked.',
    'Understand typos, incomplete sentences, South African English, slang, Afrikaans, and mixed English/Afrikaans. Reply in the user\'s language.',
    'Clear, direct, concise. Do not introduce yourself unless asked who you are. Do not write support-article tone, feature dumps, or repetitive greetings.',
    'Never joke about privacy, security, financial advice, crisis, clients, or sensitive workflow blockers.',
    'Do not invent AdvisorTrack features, pages, prices, figures, permissions, or financial recommendations.',
  ];
}

function salutation(question?: string | null): string {
  const text = (question ?? '').toLowerCase();
  if (/\bgood afternoon\b|\bafternoon\b/.test(text)) return 'Afternoon';
  if (/\bgood evening\b|\bevening\b/.test(text)) return 'Evening';
  if (/\bgood morning\b|\bmorning\b/.test(text)) return 'Morning';
  return 'Hey';
}

export function dexGreeting(
  _context?: Pick<AssistantContext, 'workspace' | 'route'> | null,
  question?: string | null,
  previousQuestion?: string | null,
): { headline: string; body: string } {
  const hi = salutation(question);
  const returning = Boolean(previousQuestion?.trim());
  const text = (question ?? '').toLowerCase();
  if (/\b(how are you(?: doing)?|how(?:'|’)s it going|hows it going|how are things|how(?:'|’)s your day)\b/.test(text)) {
    return { headline: hi, body: returning ? 'Good. How are you holding up?' : "Good. I'm Dex — what's going on?" };
  }
  if (/\b(what(?:'|’)s up|whats up|you there|you around|still there)\b/.test(text)) {
    return { headline: hi, body: 'Here. Fire away.' };
  }
  return {
    headline: hi,
    body: returning ? "I'm here." : `I'm ${DEX_NAME}. I'm here if you want to talk, or if AdvisorTrack is in the way.`,
  };
}

export function dexIdentityCopy(): { headline: string; body: string } {
  return {
    headline: DEX_NAME,
    body: `I'm ${DEX_NAME}, ${DEX_TAGLINE[0].toLowerCase()}${DEX_TAGLINE.slice(1)}. I know AdvisorTrack well, and I can also just talk. I don't give financial advice, and I don't pretend to be human.`,
  };
}

export function conversationLimitedFallback(): { headline: string; body: string } {
  return {
    headline: "I'm a bit limited just now",
    body: "The conversational side isn't available at the moment. I can still help with AdvisorTrack facts when you ask — or try me again in a minute.",
  };
}

export function cheekyClearOverdue(): string {
  return 'Nothing overdue. Suspiciously responsible.';
}

export function cheekyManyWithoutNextAction(count: number): string | null {
  if (count < 3) return null;
  return `${count} cases without a next action. Bold strategy.`;
}

export function cheekyTargetReached(progressPercent: number): string | null {
  if (progressPercent < 100) return null;
  return 'Target reached. You may now pretend this was the plan all along.';
}
