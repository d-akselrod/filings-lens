// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { useKeys } from '@/state/keys';
import { ByokDialog } from './ByokDialog';

const realActions = { setByok: useKeys.getState().setByok, clearByok: useKeys.getState().clearByok };
beforeEach(() => {
  useKeys.setState({ ...realActions, byokKey: null, remember: false });
});

test('shows the exact copy and links to Google AI Studio', () => {
  render(<ByokDialog open onOpenChange={() => {}} />);
  expect(screen.getByRole('heading', { name: 'Use your own Gemini key' })).toBeInTheDocument();
  expect(screen.getByText(/Your key stays in this browser and is sent only to Google\. We never see it\. Get a free key at/))
    .toHaveTextContent('Your key stays in this browser and is sent only to Google. We never see it. Get a free key at Google AI Studio.');
  expect(screen.getByRole('link', { name: 'Google AI Studio' })).toHaveAttribute('href', 'https://aistudio.google.com/apikey');
  expect(screen.getByLabelText('Gemini API key')).toHaveAttribute('type', 'password');
  expect(screen.queryByRole('button', { name: 'Remove key' })).toBeNull();
});

test('Save stays disabled until the key has 20 characters; with remember checked it calls setByok(key, true)', async () => {
  const user = userEvent.setup();
  const setByok = vi.fn();
  const onOpenChange = vi.fn();
  useKeys.setState({ setByok });
  render(<ByokDialog open onOpenChange={onOpenChange} />);
  const save = screen.getByRole('button', { name: 'Save key' });
  await user.type(screen.getByLabelText('Gemini API key'), '  AIza-short');
  expect(save).toBeDisabled();
  await user.type(screen.getByLabelText('Gemini API key'), '0123456789  ');
  await user.click(screen.getByRole('checkbox', { name: 'Remember on this device' }));
  await user.click(save);
  expect(setByok).toHaveBeenCalledWith('AIza-short0123456789', true);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('Remove key appears when a key is set and clears it', async () => {
  const user = userEvent.setup();
  const clearByok = vi.fn();
  useKeys.setState({ byokKey: 'AIza-existing-key-000000', remember: true, clearByok });
  render(<ByokDialog open onOpenChange={() => {}} />);
  expect(screen.getByRole('checkbox', { name: 'Remember on this device' })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Remove key' }));
  expect(clearByok).toHaveBeenCalledOnce();
});
