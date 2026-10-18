import { Redis } from '@upstash/redis';

export interface CounterStore { incr(key: string, ttlSeconds: number): Promise<number> }
export type LimitKind = 'embed' | 'answer';
export interface LimitConfig { visitorDailyRequests: number; globalDailyAnswers: number; globalDailyEmbeds: number }

const TTL_SECONDS = 172_800;

/** Per-instance counters, for local development or when no Redis is configured. */
export function memoryStore(now: () => number = Date.now): CounterStore {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  return {
    async incr(key, ttlSeconds) {
      const current = counters.get(key);
      if (!current || current.expiresAt <= now()) {
        counters.set(key, { count: 1, expiresAt: now() + ttlSeconds * 1000 });
        return 1;
      }
      current.count++;
      return current.count;
    },
  };
}

/** Shared counters on Upstash Redis (free plan); the TTL is set when a key is created. */
export function upstashStore(url: string, token: string): CounterStore {
  const redis = new Redis({ url, token });
  return {
    async incr(key, ttlSeconds) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, ttlSeconds);
      return count;
    },
  };
}

/** A per-day hash of the IP, so raw addresses are never stored. */
export async function visitorId(ip: string, salt: string, day: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}|${day}`));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function checkLimits(store: CounterStore, visitor: string, kind: LimitKind, cfg: LimitConfig, now: Date):
  Promise<null | 'visitor_cap' | 'global_budget'> {
  const day = now.toISOString().slice(0, 10);
  if (await store.incr(`v:${day}:${visitor}`, TTL_SECONDS) > cfg.visitorDailyRequests) return 'visitor_cap';
  const budget = kind === 'answer' ? cfg.globalDailyAnswers : cfg.globalDailyEmbeds;
  if (await store.incr(`g:${kind}:${day}`, TTL_SECONDS) > budget) return 'global_budget';
  return null;
}
