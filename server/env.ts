import type { LimitConfig } from './limits.js';

export interface ServerEnv {
  geminiKey: string | null;
  allowedOrigins: string[];
  limits: LimitConfig;
  ipSalt: string;
  upstash: { url: string; token: string } | null;
}

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function readEnv(e: Record<string, string | undefined>): ServerEnv {
  // The Vercel Marketplace Upstash integration may expose the legacy KV_* names.
  const url = e.UPSTASH_REDIS_REST_URL ?? e.KV_REST_API_URL;
  const token = e.UPSTASH_REDIS_REST_TOKEN ?? e.KV_REST_API_TOKEN;
  return {
    geminiKey: e.GEMINI_API_KEY?.trim() || null,
    allowedOrigins: (e.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    limits: {
      visitorDailyRequests: positiveInt(e.VISITOR_DAILY_REQUESTS, 50),
      globalDailyAnswers: positiveInt(e.GLOBAL_DAILY_ANSWERS, 200),
      globalDailyEmbeds: positiveInt(e.GLOBAL_DAILY_EMBEDS, 800),
    },
    ipSalt: e.IP_HASH_SALT ?? '',
    upstash: url && token ? { url, token } : null,
  };
}
