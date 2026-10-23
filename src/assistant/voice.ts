/**
 * Customer-facing Dex identity. Does not rename APIs, tables, or runtime symbols.
 */
import type { AssistantContext } from './context';
import { nodeForRoute } from './productMap';

export const DEX_NAME = 'Dex';
export const DEX_TAGLINE = 'Your AdvisorTrack sidekick';
export const DEX_CTA = 'Ask Dex';

export function dexPersonalityPrompt(): string[] {
  return [
    `You are ${DEX_NAME}, ${DEX_TAGLINE[0].toLowerCase()}${DEX_TAGLINE.slice(1)} — an exceptionally competent colleague who knows AdvisorTrack.`,
    'Be 80% useful, 15% natural and conversational, and 5% occasionally cheeky. Helpful before humorous.',
    'Clear, direct, concise. Friendly without excessive enthusiasm. Do not introduce yourself unless asked who you are.',
    'Do not write robotic explanations, repetitive introductions, excessive apologies, or unnecessary feature lists.',
    'Humour is rare and only when supplied live facts support it (nothing overdue, several cases without a next action, or target reached). Never joke about privacy, security, financial advice, errors, clients, or sensitive workflow blockers. Never invent a joke. Never append humour to every answer.',
    'Do not invent personal familiarity, productivity judgements, or current-case values that were not supplied.',
  ];
}

function salutation(question?: string | null): string {
  const text = (question ?? '').toLowerCase();
  if (/\bgood afternoon\b|\bafternoon\b/.test(text)) return 'Afternoon';
  if (/\bgood evening\b|\bevening\b/.test(text)) return 'Evening';
  if (/\bgood morning\b|\bmorning\b/.test(text)) return 'Morning';
  return 'Hi';
}

function casualAskKind(question?: string | null): 'wellbeing' | 'presence' | 'ready' | null {
  const text = (question ?? '').toLowerCase();
  if (
    /\b(how are you(?: doing)?|how(?:'|’)s it going|hows it going|how are things|how(?:'|’)s your day|hows your day|how is your day)\b/.test(
      text,
    )
  ) {
    return 'wellbeing';
  }
  if (/\b(what(?:'|’)s up|whats up|what is up|\byou there\b|\byou around\b|still there)\b/.test(text)) {
    return 'presence';
  }
  if (/\b(ready to work|are you ready)\b/.test(text)) return 'ready';
  return null;
}

function casualCloser(
  context?: Pick<AssistantContext, 'workspace' | 'route'> | null,
): string {
  if (context?.workspace === 'advisor') {
    const node = nodeForRoute(context.workspace, context.route.routeId);
    if (node?.id === 'pipeline') return "What's waiting on you?";
    return "What's on the book?";
  }
  return 'What do you need?';
}

export function dexGreeting(
  context?: Pick<AssistantContext, 'workspace' | 'route'> | null,
  question?: string | null,
  previousQuestion?: string | null,
): { headline: string; body: string } {
  const hi = salutation(question);
  const returning = Boolean(previousQuestion?.trim());
  const node = context ? nodeForRoute(context.workspace, context.route.routeId) : null;
  const casual = casualAskKind(question);
  if (casual) {
    const closer = casualCloser(context);
    if (casual === 'wellbeing') return { headline: hi, body: `Good. ${closer}` };
    if (casual === 'presence') return { headline: hi, body: `Here. ${closer}` };
    return { headline: hi, body: `Ready. ${closer}` };
  }
  if (context?.workspace === 'advisor' && node?.id === 'pipeline') {
    return {
      headline: hi,
      body: `You're on Pipeline. If a case is stuck, ask me why it won't move, or what's waiting on you.`,
    };
  }
  if (context?.workspace === 'advisor' && (node?.id === 'home' || !node)) {
    return {
      headline: hi,
      body: returning ? `What's on the book?` : `I'm ${DEX_NAME}. What's on the book?`,
    };
  }
  if (context?.workspace === 'advisor' && node?.id === 'production') {
    return {
      headline: hi,
      body: `You're on My Production — issued work, underwriting, or a capture. What do you need?`,
    };
  }
  if (context?.workspace === 'advisor') {
    return {
      headline: hi,
      body: `You're on ${node?.label ?? 'this page'}. What do you need?`,
    };
  }
  if (context?.workspace === 'organisation' || context?.workspace === 'management') {
    return {
      headline: hi,
      body: returning
        ? `People, licences, pipeline, or production — where do you want to start?`
        : `I'm ${DEX_NAME}. People, licences, pipeline, or production — where do you want to start?`,
    };
  }
  return {
    headline: hi,
    body: returning
      ? `What do you need?`
      : `I'm ${DEX_NAME}, ${DEX_TAGLINE[0].toLowerCase()}${DEX_TAGLINE.slice(1)}. What do you need?`,
  };
}

export function dexIdentityCopy(): { headline: string; body: string } {
  return {
    headline: DEX_NAME,
    body: `I'm ${DEX_NAME}, ${DEX_TAGLINE[0].toLowerCase()}${DEX_TAGLINE.slice(1)}. I help you use AdvisorTrack — your book, pipeline, production, and the portal pages you can see. I don't give financial advice.`,
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
