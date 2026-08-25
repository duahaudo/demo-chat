// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatListItem } from './ChatListItem';
import { renderUi } from './test-utils';

afterEach(cleanup);

const NOW = 1_700_000_000_000;

const row = (overrides: Partial<Parameters<typeof ChatListItem>[0]> = {}) => (
  <ChatListItem
    href="#/c/1"
    title="Streaming and cancellation"
    preview="How does an AbortController work?"
    updatedAt={NOW - 120_000}
    now={NOW}
    {...overrides}
  />
);

describe('ChatListItem', () => {
  it('is a link, because a chat is an addressable URL', () => {
    renderUi(row());
    const link = screen.getByRole('link', { name: /Streaming and cancellation/ });
    expect(link.getAttribute('href')).toBe('#/c/1');
    expect(link.getAttribute('aria-current')).toBeNull();
  });

  it('shows the preview and a relative timestamp', () => {
    renderUi(row());
    expect(screen.getByText('How does an AbortController work?')).toBeTruthy();
    expect(screen.getByText('2 minutes ago')).toBeTruthy();
  });

  it('marks the selected row as current, not by colour alone', () => {
    renderUi(row({ selected: true }));
    expect(screen.getByRole('link').getAttribute('aria-current')).toBe('page');
  });

  it('announces streaming in text, since the accent dot is only visual (R5)', () => {
    renderUi(row({ streaming: true }));
    expect(screen.getByText('Streaming')).toBeTruthy();
  });

  it('replaces the title with an editable field while renaming', () => {
    const onRename = vi.fn();
    renderUi(row({ renaming: true, onRename }));

    const field = screen.getByRole('textbox', { name: 'Chat title' });
    expect(screen.queryByRole('link')).toBeNull();

    fireEvent.change(field, { target: { value: '  Cancellation  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('Cancellation');
  });

  it('keeps the old title when renaming is cancelled or left blank', () => {
    const onRename = vi.fn();
    const onRenameCancel = vi.fn();
    renderUi(row({ renaming: true, onRename, onRenameCancel }));

    const field = screen.getByRole('textbox', { name: 'Chat title' });
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('Streaming and cancellation');

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onRenameCancel).toHaveBeenCalled();
  });
});
