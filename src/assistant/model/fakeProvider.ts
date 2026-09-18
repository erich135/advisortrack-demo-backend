import type { AssistantModelDecision, AssistantModelProvider } from './types';
import { asModelResult } from './provider';

/** Scripted provider for tests. Not a live vendor. */
export function createFakeProvider(
  completeFn: AssistantModelProvider['complete'] | AssistantModelDecision,
): AssistantModelProvider {
  if (typeof completeFn !== 'function') {
    const decision = completeFn;
    return {
      id: 'fake',
      async complete() {
        return asModelResult(decision);
      },
    };
  }
  return {
    id: 'fake',
    complete: completeFn,
  };
}
