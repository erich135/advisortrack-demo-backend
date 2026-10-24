import { demoVisitOnlyMemoryAnswer, detectMemoryIntent } from './memoryIntent';
import type { AssistantPublicAnswer } from './model/types';

/**
 * Public demo: no persistent Dex memory. Never import a memory repository or
 * production database from this module.
 */
export async function tryRelationshipMemoryAnswer(input: {
  question: string;
}): Promise<AssistantPublicAnswer | null> {
  const intent = detectMemoryIntent(input.question);
  if (!intent) return null;
  if (intent.action === 'consent_yes' || intent.action === 'consent_no') return null;
  const demo = demoVisitOnlyMemoryAnswer(intent);
  return {
    answerId: `memory:${demo.intent}`,
    intent: demo.intent,
    confidence: 1,
    mode: 'allowed',
    headline: demo.headline,
    body: demo.body,
    sources: [],
  };
}

export async function relationshipFactsForPrompt(): Promise<string[]> {
  return [];
}
