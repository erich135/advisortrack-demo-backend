import { LiveUnavailableError } from './errors';
import type { LiveService } from './limits';

export async function withLiveTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  service: LiveService,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new LiveUnavailableError('timeout', service));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
