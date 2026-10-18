/** Display names for the corpus tickers (the Magnificent 7). */
export const COMPANY_NAMES: Readonly<Record<string, string>> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Alphabet', AMZN: 'Amazon', META: 'Meta', TSLA: 'Tesla',
};

export const companyLabel = (ticker: string) => `${COMPANY_NAMES[ticker] ?? ticker} (${ticker})`;
