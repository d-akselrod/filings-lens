/** The Magnificent 7. `edgarName` must appear in EDGAR's registrant name (a guard against a wrong CIK). */
export const COMPANIES: ReadonlyArray<{ ticker: string; name: string; edgarName: string; cik: string }> = [
  { ticker: 'AAPL', name: 'Apple', edgarName: 'APPLE', cik: '0000320193' },
  { ticker: 'MSFT', name: 'Microsoft', edgarName: 'MICROSOFT', cik: '0000789019' },
  { ticker: 'NVDA', name: 'NVIDIA', edgarName: 'NVIDIA', cik: '0001045810' },
  { ticker: 'GOOGL', name: 'Alphabet', edgarName: 'ALPHABET', cik: '0001652044' },
  { ticker: 'AMZN', name: 'Amazon', edgarName: 'AMAZON', cik: '0001018724' },
  { ticker: 'META', name: 'Meta', edgarName: 'META PLATFORMS', cik: '0001326801' },
  { ticker: 'TSLA', name: 'Tesla', edgarName: 'TESLA', cik: '0001318605' },
];
