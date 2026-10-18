import type { ClientErrorCode } from './api/client';

export const COPY = {
  footer: "Not financial advice. Questions are processed by free AI services (Google Gemini, and NVIDIA via OpenRouter) — don't enter personal information. Data: SEC EDGAR.",
  restricted: "Answers with our built-in key aren't available in your region (EEA, UK and Switzerland). You can still search, try the sample questions, run the scorecard, or use your own Gemini key.",
  exhausted: "Today's free answers are used up. Search still works — add your own free Gemini key to keep getting answers.",
  missing: 'Answers are temporarily unavailable. Search still works — or use your own Gemini key.',
  keywordOnly: 'No question embedding is available, so this search is keyword-only. Sample questions still use full hybrid search.',
  noMatches: 'No passages matched. Try removing some filters.',
  rerankerUnavailable: "These results aren't reranked: the reranker is still loading, or it couldn't run on this device.",
  interrupted: 'Answer interrupted.',
  noKey: 'Answers need a Gemini key. Search still works — or use your own Gemini key.',
  byokInvalid: 'Google rejected that key. Check it in Google AI Studio.',
  byokQuota: "Your key's free quota is used up for today.",
  network: 'Network error. Check your connection and try again.',
  upstreamError: "Google's API returned an error. Try again in a moment.",
  loadFailed: "Couldn't load the filings data. Reload the page to try again.",
  busy: 'The free AI tier is busy right now. Try again in a minute.',
  staleCorpus: 'The filings data was updated. Reload the page to ask about the new version.',
  searchFailed: 'Search failed on this device. Try again, or turn off reranking in Tune search.',
  stale: 'Settings changed since this answer.',
  emptyTitle: "Ask about the Magnificent 7's annual reports",
  emptyBody: 'Answers come only from the last three 10-K filings of Apple, Microsoft, NVIDIA, Alphabet, Amazon, Meta and Tesla. Every sentence cites its passages, and numbers that don’t appear in them are flagged.',
} as const;

/** The status line for an answer that failed or was skipped; a skip with no code means no passages matched. */
export function copyForCode(code: ClientErrorCode | undefined): string {
  switch (code) {
    case undefined: return COPY.noMatches;
    case 'restricted_region': return COPY.restricted;
    case 'visitor_cap':
    case 'global_budget':
    case 'upstream_quota': return COPY.exhausted;
    case 'missing_key': return COPY.missing;
    case 'no_key': return COPY.noKey;
    case 'byok_invalid': return COPY.byokInvalid;
    case 'byok_quota': return COPY.byokQuota;
    case 'upstream_busy': return COPY.busy;
    case 'stale_corpus': return COPY.staleCorpus;
    case 'search_failed': return COPY.searchFailed;
    case 'network': return COPY.network;
    default: return COPY.upstreamError;
  }
}
