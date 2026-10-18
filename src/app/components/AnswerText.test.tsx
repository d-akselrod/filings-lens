// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { SentenceCheck } from '../../core/citations';
import { AnswerText } from './AnswerText';

const check = (text: string, o: Partial<SentenceCheck> = {}): SentenceCheck => ({
  text, citations: [], invalidCitations: [], missingCitation: false, unsupportedNumbers: [], ...o,
});

test('citations become chips, unsupported numbers are flagged, uncited sentences are marked', async () => {
  const user = userEvent.setup();
  const onCite = vi.fn();
  const { container } = render(
    <AnswerText
      text="Revenue was $70 billion [1]. Margins expanded. Costs fell [2"
      checks={[
        check('Revenue was $70 billion [1].', { citations: [1], unsupportedNumbers: ['$70 billion'] }),
        check('Margins expanded.', { missingCitation: true }),
      ]}
      streaming
      onCite={onCite}
    />,
  );
  const chip = screen.getByRole('button', { name: 'Source 1' });
  expect(chip).toHaveTextContent(/^1$/);
  await user.click(chip);
  expect(onCite).toHaveBeenCalledWith(1);

  const flag = container.querySelector('mark[data-flag]');
  expect(flag).toHaveTextContent('$70 billion');
  expect(flag).toHaveAttribute('title', 'Not found in cited passage');
  const uncited = container.querySelectorAll('[data-uncited]');
  expect(uncited).toHaveLength(1);
  expect(uncited[0]).toHaveAttribute('title', 'This sentence has no citation');

  expect(container.textContent).toContain('Costs fell [2');
  expect(container.querySelector('[data-caret]')).not.toBeNull();
});

test('a grouped citation gives one chip per source, and a finished answer has no caret', () => {
  const { container } = render(
    <AnswerText text="Both cite export rules [2, 3]." checks={[check('Both cite export rules [2, 3].', { citations: [2, 3] })]} streaming={false} onCite={() => {}} />,
  );
  expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Source 2', 'Source 3']);
  expect(container.querySelector('[data-caret]')).toBeNull();
  expect(container.querySelector('mark[data-flag]')).toBeNull();
});
