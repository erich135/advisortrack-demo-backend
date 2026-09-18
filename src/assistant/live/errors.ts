import type { LiveService } from './limits';

export class LiveUnavailableError extends Error {
  constructor(
    readonly reason: 'timeout' | 'circuit_open' | 'budget' | 'failed',
    readonly service: LiveService,
  ) {
    super(`live_${reason}:${service}`);
    this.name = 'LiveUnavailableError';
  }
}

export function isLiveUnavailable(error: unknown): error is LiveUnavailableError {
  return error instanceof LiveUnavailableError;
}

/** Out-of-scope requested members must not collapse to empty/zero totals. */
export class LiveScopeMissError extends Error {
  readonly code = 'not_found_in_scope';
  constructor() {
    super('not_found_in_scope');
    this.name = 'LiveScopeMissError';
  }
}

export function isLiveScopeMiss(error: unknown): error is LiveScopeMissError {
  return error instanceof LiveScopeMissError
    || (error instanceof Error && error.message === 'not_found_in_scope');
}
