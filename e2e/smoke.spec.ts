import { expect, test, type Page } from '@playwright/test';
import { COPY } from '../src/app/copy';

const SAMPLE = 'How does NVIDIA describe export-control risk related to China?';
const ANSWER_SSE = 'data: {"type":"delta","text":"NVIDIA says export rules require licenses [1]."}\n\ndata: {"type":"done"}\n\n';

/** base64 float16 little-endian of a 768-dim vector with every component 1/sqrt(768) (0x2C9F ≈ 0.0361). */
const UNIT_VECTOR_B64 = Buffer.from(new Uint16Array(768).fill(0x2c9f).buffer).toString('base64');

/**
 * The API is mocked. A one-question sample file is injected so the smoke test doesn't depend on which sample
 * questions are published; everything else is the real built app and the real data.
 */
async function mock(page: Page, builtInKey: 'available' | 'restricted') {
  const calls = { embed: 0, answer: 0 };
  await page.route('**/api/status', r => r.fulfill({ json: { region: builtInKey === 'restricted' ? 'restricted' : 'ok', builtInKey } }));
  await page.route('**/api/embed', r => {
    calls.embed++;
    return r.fulfill({ json: { vector: UNIT_VECTOR_B64 } });
  });
  await page.route('**/api/answer', r => {
    calls.answer++;
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: ANSWER_SSE });
  });
  await page.context().route('**/data/manifest.json', async r => {
    const manifest = await (await r.fetch()).json();
    return r.fulfill({ json: { ...manifest, samples: { file: 'v/samples.e2e.json', count: 1 } } });
  });
  await page.context().route('**/data/v/samples.e2e.json', r =>
    r.fulfill({ json: { schemaVersion: 1, samples: [{ question: SAMPLE, vector: UNIT_VECTOR_B64 }] } }));
  return calls;
}

test('the app loads the filings data and reports the passage count', async ({ page }) => {
  await mock(page, 'available');
  await page.goto('/');
  await expect(page.getByText(/Postgres · [\d,]+ passages/)).toBeVisible({ timeout: 60_000 });
});

test('a sample question shows sources and a cited answer; changing a setting re-searches without an API call', async ({ page }) => {
  const calls = await mock(page, 'available');
  await page.goto('/');
  await page.getByRole('button', { name: SAMPLE }).click({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Source 1' })).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole('article').count()).toBeGreaterThanOrEqual(5);
  expect(calls).toEqual({ embed: 0, answer: 1 });

  await page.getByRole('radio', { name: 'Euclidean' }).click();
  await expect(page.getByText('Settings changed since this answer.')).toBeVisible();
  expect(calls.answer).toBe(1);
});

test('a restricted visitor sees the region notice and typed questions run keyword-only without embedding', async ({ page }) => {
  const calls = await mock(page, 'restricted');
  await page.goto('/');
  await expect(page.getByText(COPY.restricted)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('textbox', { name: 'Question' }).fill('How does Apple describe supply chain risk?');
  await page.keyboard.press('Enter');
  await expect(page.getByText(COPY.keywordOnly)).toBeVisible({ timeout: 30_000 });
  expect(calls.embed).toBe(0);
  expect(calls.answer).toBe(0);
});
