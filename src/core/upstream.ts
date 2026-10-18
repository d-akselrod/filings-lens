export type UpstreamReason = 'quota' | 'auth' | 'bad_request' | 'server' | 'network';

/** An error from Google's Gemini API (answers) or OpenRouter (embeddings), normalized so callers treat both alike. */
export class UpstreamError extends Error {
  /** quotaId names the limit that was hit: "...RequestsPerDay..." from Gemini, "free-models-per-day" from OpenRouter. */
  constructor(readonly status: number, readonly reason: UpstreamReason, message: string, readonly retryAfterMs?: number, readonly quotaId?: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/** A daily cap ends the key's day; per-minute caps (requests or tokens) clear within about a minute. */
export function isDailyQuota(e: UpstreamError): boolean {
  return /per-?day/i.test(e.quotaId ?? '') || (e.retryAfterMs ?? 0) > 3_600_000;
}

export function reasonFor(status: number): UpstreamReason {
  if (status === 429) return 'quota';
  if (status === 401 || status === 402 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export function networkError(e: unknown): UpstreamError {
  return new UpstreamError(0, 'network', e instanceof Error ? e.message : String(e));
}
