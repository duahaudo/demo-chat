// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { classifyError } from '@/core/errors';
import type { MessageV1 } from '@/core/storage/schema';

import { renderUi } from './test-utils';
import { Transcript } from './Transcript';

afterEach(cleanup);

const message = (overrides: Partial<MessageV1> = {}): MessageV1 => ({
  id: 'm1',
  role: 'assistant',
  content: 'A frame ends at a blank line.',
  createdAt: 1_700_000_000_000,
  status: 'complete',
  ...overrides,
});

const transcript = (overrides: Partial<Parameters<typeof Transcript>[0]> = {}) => (
  <Transcript
    messages={[]}
    status="idle"
    streamingText={undefined}
    error={undefined}
    onRetry={vi.fn()}
    {...overrides}
  />
);

describe('Transcript — the six states', () => {
  it('empty: invites the user', () => {
    renderUi(transcript());

    expect(screen.getByText('Start a conversation')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('loading: shows a spinner while the first token is outstanding', () => {
    renderUi(transcript({ status: 'loading', messages: [message({ role: 'user' })] }));

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('streaming: partial text sits in a polite live region, with a caret', () => {
    const { container } = renderUi(transcript({ status: 'streaming', streamingText: 'Par' }));

    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain('Par');
    expect(screen.getByTestId('caret')).toBeTruthy();
  });

  it('complete: no caret, no live region, and the copy action is revealed', () => {
    const { container } = renderUi(transcript({ status: 'complete', messages: [message()] }));

    expect(screen.queryByTestId('caret')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('interrupted: keeps the partial text and says it stopped', () => {
    renderUi(
      transcript({
        status: 'interrupted',
        messages: [message({ content: 'Half an ans', status: 'interrupted' })],
      }),
    );

    expect(screen.getByText('Half an ans')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Stopped.');
  });

  it('failed: keeps the partial text, states the failure assertively, and offers a retry', () => {
    const onRetry = vi.fn();
    const error = classifyError({ kind: 'http', status: 429 });
    renderUi(
      transcript({
        status: 'failed',
        error,
        onRetry,
        messages: [message({ content: 'Half an ans', status: 'failed' })],
      }),
    );

    expect(screen.getByText('Half an ans')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(error.summary);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
