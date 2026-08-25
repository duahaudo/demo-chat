// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { streamChat } = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock('@/adapter/transport', () => ({ streamChat }));

const { App } = await import('./App');
const { renderUi } = await import('./test-utils');

afterEach(cleanup);
beforeEach(() => {
  streamChat.mockReset();
  // Conversations outlive a render now: else each test inherits the previous one's chats.
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

const field = () => screen.getByRole('textbox', { name: 'Message' });

interface Options {
  readonly messages: readonly { role: string; content: string }[];
  readonly signal: AbortSignal;
}

describe('App — the keyboard path', () => {
  it('composes, sends, streams and stops, keeping what had already arrived', async () => {
    const sent: unknown[] = [];
    let release: (() => void) | undefined;
    streamChat.mockImplementation(async function* (options: Options) {
      sent.push(options.messages);
      yield { kind: 'delta', text: 'Hel' };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (options.signal.aborted) return;
      yield { kind: 'delta', text: 'lo' };
      yield { kind: 'done' };
    });

    const { container } = renderUi(<App />);
    expect(screen.getByText('Start a conversation')).toBeTruthy();

    fireEvent.change(field(), { target: { value: 'Explain SSE' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    // The message shows up in the transcript, the chat row's preview and its title at once.
    await screen.findAllByText('Explain SSE');
    await waitFor(() => expect(container.textContent).toContain('Hel'));

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    release?.();

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Stopped.'));
    expect(container.textContent).toContain('Hel');
    expect(container.textContent).not.toContain('Hello');

    // The interrupted answer is kept, and the next request carries it as context.
    fireEvent.change(field(), { target: { value: 'Carry on' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual([
      { role: 'user', content: 'Explain SSE' },
      { role: 'assistant', content: 'Hel' },
      { role: 'user', content: 'Carry on' },
    ]);
  });

  it('creates a chat, focuses the composer, and switches back to the previous one', async () => {
    streamChat.mockImplementation(async function* () {
      await Promise.resolve();
      yield { kind: 'done' };
    });

    renderUi(<App />);
    expect(screen.getAllByRole('link')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));

    const rows = screen.getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(field());

    fireEvent.click(rows[1]!);

    await waitFor(() =>
      expect(screen.getAllByRole('link')[1]?.getAttribute('aria-current')).toBe('page'),
    );
    expect(document.activeElement).toBe(field());
  });
});

describe('App — chat management', () => {
  const send = (content: string) => {
    fireEvent.change(field(), { target: { value: content } });
    fireEvent.keyDown(field(), { key: 'Enter' });
  };

  beforeEach(() => {
    streamChat.mockImplementation(async function* () {
      await Promise.resolve();
      yield { kind: 'done' };
    });
  });

  it('renames a chat inline', async () => {
    renderUi(<App />);
    send('Explain SSE');
    await screen.findByRole('link', { name: /Explain SSE/ });

    fireEvent.click(screen.getByRole('button', { name: 'Rename Explain SSE' }));
    const title = screen.getByRole('textbox', { name: 'Chat title' });
    fireEvent.change(title, { target: { value: 'Framing' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    await screen.findByRole('link', { name: /Framing/ });
    expect(screen.queryByRole('textbox', { name: 'Chat title' })).toBeNull();
  });

  it('deletes only after the confirmation is accepted', async () => {
    renderUi(<App />);
    send('Explain SSE');
    await screen.findByRole('link', { name: /Explain SSE/ });

    fireEvent.click(screen.getByRole('button', { name: 'Delete Explain SSE' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('link', { name: /Explain SSE/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Explain SSE' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: /Explain SSE/ })).toBeNull());
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Start a conversation')).toBeTruthy();
  });

  it('keeps conversations across a reload, and addresses each by URL', async () => {
    const first = renderUi(<App />);
    send('Explain SSE');
    await screen.findByRole('link', { name: /Explain SSE/ });
    const url = window.location.hash;
    expect(url).toMatch(/^#\/c\/.+/);

    first.unmount();
    renderUi(<App />);

    await screen.findByRole('link', { name: /Explain SSE/ });
    expect(screen.getByRole('heading', { name: 'Explain SSE' })).toBeTruthy();
    expect(window.location.hash).toBe(url);
  });
});
