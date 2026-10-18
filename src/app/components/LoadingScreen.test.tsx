// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { COPY } from '@/copy';
import { LoadingScreen } from './LoadingScreen';

test('names each loading phase, with megabytes while downloading', () => {
  const view = render(<LoadingScreen progress={{ phase: 'download', loadedBytes: 1e6, totalBytes: 8e6 }} failed={false} />);
  expect(screen.getByText('Downloading filings data — 1.0 / 8.0 MB')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  const labels: Array<[Parameters<typeof LoadingScreen>[0]['progress']['phase'], string]> = [
    ['manifest', 'Fetching manifest'], ['database', 'Building the database (PGlite)'],
    ['keyword-index', 'Indexing keywords (BM25)'], ['vectors', 'Loading vectors'],
  ];
  for (const [phase, label] of labels) {
    view.rerender(<LoadingScreen progress={{ phase }} failed={false} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

test('a failed load says so and offers a reload', () => {
  render(<LoadingScreen progress={{ phase: 'download', loadedBytes: 0, totalBytes: 8e6 }} failed />);
  expect(screen.getByText(COPY.loadFailed)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
});
