// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useSettings } from '@/state/settings';
import { Composer } from './Composer';

beforeEach(() => useSettings.getState().reset());

const box = () => screen.getByRole('textbox', { name: 'Question' });
const send = () => screen.getByRole('button', { name: 'Ask' });

test('a 600-character paste is cut at 500, and the counter shows past 400 (Review Focus #5)', async () => {
  const user = userEvent.setup();
  render(<Composer onSubmit={() => {}} hasTurns={false} busy={false} />);
  await user.click(box());
  await user.paste('x'.repeat(400));
  expect(screen.queryByText('400/500')).toBeNull();
  await user.type(box(), 'y');
  expect(screen.getByText('401/500')).toBeInTheDocument();
  await user.paste('z'.repeat(199));
  expect(box()).toHaveValue(`${'x'.repeat(400)}y${'z'.repeat(99)}`);
  await user.clear(box());
  await user.paste('q'.repeat(600));
  expect((box() as HTMLTextAreaElement).value).toHaveLength(500);
});

test('whitespace-only text cannot be submitted', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} hasTurns={false} busy={false} />);
  expect(send()).toBeDisabled();
  await user.type(box(), '   ');
  expect(send()).toBeDisabled();
  await user.type(box(), '{Enter}');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('Enter submits the trimmed question; Shift+Enter adds a new line', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  render(<Composer onSubmit={onSubmit} hasTurns={false} busy={false} />);
  expect(box()).toHaveAttribute('placeholder', 'Ask about the 10-K filings…');
  await user.type(box(), '  How did revenue change?{Shift>}{Enter}{/Shift}');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(box()).toHaveValue('  How did revenue change?\n');
  await user.type(box(), '{Enter}');
  expect(onSubmit).toHaveBeenCalledWith('How did revenue change?', false);
  expect(box()).toHaveValue('');
});

test('with earlier turns, Follow-up is on by default and can be turned off; busy disables Ask', async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn();
  const view = render(<Composer onSubmit={onSubmit} hasTurns busy={false} />);
  expect(box()).toHaveAttribute('placeholder', 'Ask a follow-up…');
  const followUp = screen.getByRole('button', { name: 'Follow-up' });
  expect(followUp).toHaveAttribute('aria-pressed', 'true');
  await user.type(box(), 'And in 2024?{Enter}');
  expect(onSubmit).toHaveBeenLastCalledWith('And in 2024?', true);
  await user.click(followUp);
  await user.type(box(), 'Separate question{Enter}');
  expect(onSubmit).toHaveBeenLastCalledWith('Separate question', false);
  view.rerender(<Composer onSubmit={onSubmit} hasTurns busy />);
  await user.type(box(), 'Q');
  expect(send()).toBeDisabled();
});

test('active filters show as removable tokens', async () => {
  const user = userEvent.setup();
  useSettings.getState().toggleFilter('tickers', 'NVDA');
  useSettings.getState().toggleFilter('fiscalYears', 2025);
  useSettings.getState().toggleFilter('items', '1A');
  render(<Composer onSubmit={() => {}} hasTurns={false} busy={false} />);
  expect(screen.getByRole('button', { name: 'Remove filter FY25' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove filter Item 1A' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove filter NVDA' }));
  expect(useSettings.getState().settings.filters.tickers).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Remove filter NVDA' })).toBeNull();
});
