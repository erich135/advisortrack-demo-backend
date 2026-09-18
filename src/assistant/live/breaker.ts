import { LIVE_LIMITS, type LiveService } from './limits';

type BreakerEntry = {
  failures: number;
  openUntil: number;
};

const states = new Map<string, BreakerEntry>();
let failureThreshold = LIVE_LIMITS.breakerFailures;
let cooldownMs = LIVE_LIMITS.breakerCooldownMs;
let nowFn = (): number => Date.now();

export function resetLiveBreaker(): void {
  states.clear();
  failureThreshold = LIVE_LIMITS.breakerFailures;
  cooldownMs = LIVE_LIMITS.breakerCooldownMs;
  nowFn = () => Date.now();
}

export function configureLiveBreakerForTests(input: {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}): void {
  if (input.failureThreshold != null) failureThreshold = input.failureThreshold;
  if (input.cooldownMs != null) cooldownMs = input.cooldownMs;
  if (input.now) nowFn = input.now;
}

function keyFor(service: LiveService, environment: string, companyId: string | null): string {
  return `${environment}|${companyId ?? 'none'}|${service}`;
}

export function liveBreakerOpen(
  service: LiveService,
  environment: string,
  companyId: string | null,
): boolean {
  const entry = states.get(keyFor(service, environment, companyId));
  if (!entry) return false;
  if (entry.openUntil <= nowFn()) {
    states.delete(keyFor(service, environment, companyId));
    return false;
  }
  return true;
}

export function liveBreakerSuccess(
  service: LiveService,
  environment: string,
  companyId: string | null,
): void {
  states.delete(keyFor(service, environment, companyId));
}

export function liveBreakerFailure(
  service: LiveService,
  environment: string,
  companyId: string | null,
): boolean {
  const key = keyFor(service, environment, companyId);
  const entry = states.get(key) ?? { failures: 0, openUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= failureThreshold) {
    entry.openUntil = nowFn() + cooldownMs;
  }
  states.set(key, entry);
  return entry.openUntil > nowFn();
}
