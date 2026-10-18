import { expect, test } from 'vitest';
import { readEnv } from './env';

test('defaults when only the key is set', () => {
  expect(readEnv({ GEMINI_API_KEY: ' k ' })).toEqual({
    geminiKey: 'k', allowedOrigins: [], ipSalt: '', upstash: null,
    limits: { visitorDailyRequests: 50, globalDailyAnswers: 200, globalDailyEmbeds: 800 },
  });
});

test('parses origins, limits and either Upstash variable naming', () => {
  const env = readEnv({
    ALLOWED_ORIGINS: 'https://a.app, https://b.app,', VISITOR_DAILY_REQUESTS: '20', GLOBAL_DAILY_ANSWERS: 'oops',
    KV_REST_API_URL: 'https://redis.example', KV_REST_API_TOKEN: 't', IP_HASH_SALT: 's',
  });
  expect(env.geminiKey).toBeNull();
  expect(env.allowedOrigins).toEqual(['https://a.app', 'https://b.app']);
  expect(env.limits).toEqual({ visitorDailyRequests: 20, globalDailyAnswers: 200, globalDailyEmbeds: 800 });
  expect(env.upstash).toEqual({ url: 'https://redis.example', token: 't' });
  expect(env.ipSalt).toBe('s');
});
