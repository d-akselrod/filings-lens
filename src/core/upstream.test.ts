import { expect, test } from 'vitest';
import { isDailyQuota, UpstreamError } from './upstream';

test('isDailyQuota tells a used-up day from a per-minute limit, for Gemini and OpenRouter alike', () => {
  expect(isDailyQuota(new UpstreamError(429, 'quota', 'q', 81_478_000, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'))).toBe(true);
  expect(isDailyQuota(new UpstreamError(429, 'quota', 'q', undefined, 'free-models-per-day'))).toBe(true);
  expect(isDailyQuota(new UpstreamError(429, 'quota', 'q', 7_200_000))).toBe(true);
  expect(isDailyQuota(new UpstreamError(429, 'quota', 'q', 21_000, 'GenerateContentInputTokensPerModelPerMinute-FreeTier'))).toBe(false);
  expect(isDailyQuota(new UpstreamError(429, 'quota', 'q', 20_000, 'free-models-per-min'))).toBe(false);
  expect(isDailyQuota(new UpstreamError(429, 'quota', 'q'))).toBe(false);
});
