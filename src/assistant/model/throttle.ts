const WINDOW_MS = 10 * 60 * 1000;

type Bucket = Map<string, number[]>;

const users = new Map<string, number[]>();
const ips = new Map<string, number[]>();
const demoGlobal: number[] = [];

export const ASSISTANT_ASK_LIMITS = {
  productionPerUser: 30,
  demoPerUser: 30,
  demoPerIp: 80,
  demoGlobal: 250,
  windowMs: WINDOW_MS,
};

function allowBucket(store: Bucket | number[], key: string | null, max: number, now: number): boolean {
  if (Array.isArray(store)) {
    const recent = store.filter((stamp) => now - stamp < WINDOW_MS);
    store.length = 0;
    store.push(...recent);
    if (recent.length >= max) return false;
    store.push(now);
    return true;
  }
  if (!key) return true;
  const recent = (store.get(key) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= max) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

export function allowAssistantAsk(
  userId: string,
  now = Date.now(),
  options?: { environment?: 'production' | 'demo'; ip?: string | null },
): boolean {
  const environment = options?.environment ?? 'production';
  if (environment === 'demo') {
    if (!allowBucket(users, `demo:${userId}`, ASSISTANT_ASK_LIMITS.demoPerUser, now)) return false;
    if (!allowBucket(ips, options?.ip ?? null, ASSISTANT_ASK_LIMITS.demoPerIp, now)) return false;
    if (!allowBucket(demoGlobal, null, ASSISTANT_ASK_LIMITS.demoGlobal, now)) return false;
    return true;
  }
  return allowBucket(users, userId, ASSISTANT_ASK_LIMITS.productionPerUser, now);
}

export function resetAssistantAskThrottle(): void {
  users.clear();
  ips.clear();
  demoGlobal.length = 0;
}
