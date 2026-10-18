import { expect, test } from 'vitest';
import { buildUserPrompt, MAX_PASSAGES, SYSTEM_INSTRUCTION, type PromptPassage } from './prompt';

const passages: PromptPassage[] = [
  { n: 1, ticker: 'NVDA', fiscalYear: 2025, item: '1A', itemTitle: 'Risk Factors', text: 'Export controls restrict sales to China.' },
  { n: 2, ticker: 'NVDA', fiscalYear: 2024, item: '7', itemTitle: "Management's Discussion and Analysis", text: 'Data center revenue grew.' },
];

test('builds the exact passage layout', () => {
  expect(buildUserPrompt('How does NVIDIA describe export risk?', passages)).toBe(
    'Passages:\n' +
    '[1] NVDA 10-K FY2025 — Item 1A Risk Factors\nExport controls restrict sales to China.\n\n' +
    "[2] NVDA 10-K FY2024 — Item 7 Management's Discussion and Analysis\nData center revenue grew.\n\n" +
    'Question: How does NVIDIA describe export risk?');
});

test('adds the previous question as context only when given', () => {
  expect(buildUserPrompt('And in 2024?', passages.slice(0, 1), 'How does NVIDIA describe export risk?')).toBe(
    'Previous question (context only): How does NVIDIA describe export risk?\n\n' +
    'Passages:\n[1] NVDA 10-K FY2025 — Item 1A Risk Factors\nExport controls restrict sales to China.\n\n' +
    'Question: And in 2024?');
});

test('rejects more than 10 passages or a question over 500 characters', () => {
  const many = Array.from({ length: MAX_PASSAGES + 1 }, (_, i) => ({ ...passages[0]!, n: i + 1 }));
  expect(() => buildUserPrompt('q', many)).toThrow(RangeError);
  expect(() => buildUserPrompt('x'.repeat(501), passages)).toThrow(RangeError);
  expect(() => buildUserPrompt('x'.repeat(500), passages)).not.toThrow();
});

test('the system instruction pins the refusal sentence and the no-advice rule', () => {
  expect(SYSTEM_INSTRUCTION).toContain('"The provided filings don\'t answer this."');
  expect(SYSTEM_INSTRUCTION).toContain('Never give investment advice');
});
