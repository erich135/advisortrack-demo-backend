import { resetLiveBreaker } from './breaker';
import { resetLiveSummaryCache } from './cache';

export function resetAssistantLiveRuntime(): void {
  resetLiveSummaryCache();
  resetLiveBreaker();
}
