// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { mockMatchMedia } from '../test-utils';
import { AppShell } from './AppShell';

const slots = {
  header: <div>HEADER</div>, left: <div>LEFT</div>, main: <div>MAIN</div>, right: <div>RIGHT</div>, footer: <div>FOOTER</div>,
};

test('wide screens show all three columns without drawer buttons', () => {
  mockMatchMedia(q => q === '(min-width: 1024px)');
  render(<AppShell {...slots} />);
  for (const text of ['HEADER', 'LEFT', 'MAIN', 'RIGHT', 'FOOTER']) expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tune search' })).toBeNull();
});

test('narrow screens show the main column and open the side panels as drawers', async () => {
  mockMatchMedia(() => false);
  render(<AppShell {...slots} />);
  expect(screen.getByText('MAIN')).toBeInTheDocument();
  expect(screen.queryByText('LEFT')).toBeNull();
  expect(screen.queryByText('RIGHT')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Sources' }));
  expect(within(screen.getByRole('dialog')).getByText('RIGHT')).toBeInTheDocument();
});

test('drawer button labels can be customised', () => {
  mockMatchMedia(() => false);
  render(<AppShell {...slots} leftLabel="Filters" rightLabel="Evidence" />);
  expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Evidence' })).toBeInTheDocument();
});
