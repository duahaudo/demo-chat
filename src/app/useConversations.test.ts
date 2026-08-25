// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STORAGE_KEY, type StorageLike } from '@/adapter/storage';
import type { MessageV1 } from '@/core/storage/schema';

import { useConversations } from './useConversations';

const NOW = 1_700_000_000_000;
const clock = () => NOW;

function fakeStore(
  seed?: Record<string, string>,
): StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function storedDocument(store: StorageLike): { conversations: { id: string; title: string }[] } {
  return JSON.parse(store.getItem(STORAGE_KEY) ?? '{"conversations":[]}') as {
    conversations: { id: string; title: string }[];
  };
}

const message = (content: string, createdAt = NOW): MessageV1 => ({
  id: `m-${content}`,
  role: 'user',
  content,
  createdAt,
  status: 'complete',
});

const conversation = (id: string, title: string, updatedAt: number) => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  messages: [{ ...message(title, updatedAt), id: `m-${id}` }],
});

const documentWith = (...conversations: unknown[]) => JSON.stringify({ version: 1, conversations });

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(cleanup);

describe('useConversations — persistence', () => {
  it('restores a stored document, most recent first', () => {
    const store = fakeStore({
      [STORAGE_KEY]: documentWith(
        conversation('older', 'Backoff', NOW - 60_000),
        conversation('newer', 'Framing', NOW),
      ),
    });

    const { result } = renderHook(() => useConversations(clock, store));

    expect(result.current.list.map((c) => c.id)).toEqual(['newer', 'older']);
    expect(result.current.selectedId).toBe('newer');
  });

  it('persists on first message, not on creation', async () => {
    const store = fakeStore();
    const { result } = renderHook(() => useConversations(clock, store));

    expect(result.current.list).toHaveLength(1);
    expect(store.getItem(STORAGE_KEY)).toBeNull();

    act(() => result.current.create());
    expect(store.getItem(STORAGE_KEY)).toBeNull();

    const id = result.current.selectedId;
    act(() => result.current.append(id, message('Explain SSE')));

    await waitFor(() => expect(store.getItem(STORAGE_KEY)).not.toBeNull());
    expect(result.current.list).toHaveLength(2);
    expect(storedDocument(store).conversations).toHaveLength(1);
    expect(storedDocument(store).conversations[0]?.title).toBe('Explain SSE');
  });

  it('reports an unreadable document rather than repairing it', () => {
    const store = fakeStore({ [STORAGE_KEY]: '{ not json' });
    const { result } = renderHook(() => useConversations(clock, store));

    expect(result.current.problem).toContain('not valid JSON');
    expect(result.current.list).toHaveLength(1);
  });

  it('reports a full quota, keeping the conversation on screen', async () => {
    const store: StorageLike = {
      getItem: () => null,
      setItem: (key) => {
        // The probe passes; the document write is what fails.
        if (key === STORAGE_KEY) throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    const { result } = renderHook(() => useConversations(clock, store));

    const id = result.current.selectedId;
    act(() => result.current.append(id, message('Explain SSE')));

    await waitFor(() => expect(result.current.problem).toContain('local storage is full'));
    expect(result.current.selected?.messages).toHaveLength(1);
  });

  it('works with no storage at all', () => {
    const { result } = renderHook(() => useConversations(clock, null));

    act(() => result.current.append(result.current.selectedId, message('Explain SSE')));
    expect(result.current.selected?.messages).toHaveLength(1);
    expect(result.current.problem).toBeUndefined();
  });
});

describe('useConversations — the URL', () => {
  it('addresses the selected chat, and follows back and forward', async () => {
    const store = fakeStore({
      [STORAGE_KEY]: documentWith(
        conversation('first', 'Framing', NOW),
        conversation('second', 'Backoff', NOW - 60_000),
      ),
    });
    const { result } = renderHook(() => useConversations(clock, store));

    await waitFor(() => expect(window.location.hash).toBe('#/c/first'));

    act(() => result.current.select('second'));
    await waitFor(() => expect(window.location.hash).toBe('#/c/second'));

    act(() => window.history.back());
    await waitFor(() => expect(result.current.selectedId).toBe('first'));
  });

  it('opens the chat named by the URL on load', () => {
    window.history.replaceState(null, '', '#/c/second');
    const store = fakeStore({
      [STORAGE_KEY]: documentWith(
        conversation('first', 'Framing', NOW),
        conversation('second', 'Backoff', NOW - 60_000),
      ),
    });

    const { result } = renderHook(() => useConversations(clock, store));
    expect(result.current.selectedId).toBe('second');
  });

  it('falls back to the most recent chat when the URL names one that is gone', () => {
    window.history.replaceState(null, '', '#/c/deleted');
    const store = fakeStore({
      [STORAGE_KEY]: documentWith(conversation('first', 'Framing', NOW)),
    });

    const { result } = renderHook(() => useConversations(clock, store));
    expect(result.current.selectedId).toBe('first');
  });
});

describe('useConversations — rename and delete', () => {
  const seeded = () =>
    fakeStore({
      [STORAGE_KEY]: documentWith(
        conversation('first', 'Framing', NOW),
        conversation('second', 'Backoff', NOW - 60_000),
      ),
    });

  it('renames without reordering, since a rename is not activity', () => {
    const { result } = renderHook(() => useConversations(clock, seeded()));

    act(() => result.current.rename('second', '  Retry policy  '));
    expect(result.current.list.map((c) => c.title)).toEqual(['Framing', 'Retry policy']);

    act(() => result.current.rename('second', '   '));
    expect(result.current.list.map((c) => c.title)).toEqual(['Framing', 'Retry policy']);
  });

  it('deletes, selecting the next chat and writing the removal through', async () => {
    const store = seeded();
    const { result } = renderHook(() => useConversations(clock, store));

    act(() => result.current.remove('first'));

    expect(result.current.list.map((c) => c.id)).toEqual(['second']);
    expect(result.current.selectedId).toBe('second');
    await waitFor(() => expect(storedDocument(store).conversations).toHaveLength(1));
  });

  it('leaves a blank chat behind when the last one is deleted', async () => {
    const store = seeded();
    const { result } = renderHook(() => useConversations(clock, store));

    act(() => result.current.remove('first'));
    act(() => result.current.remove('second'));

    expect(result.current.list).toHaveLength(1);
    expect(result.current.list[0]?.title).toBe('New chat');
    await waitFor(() => expect(storedDocument(store).conversations).toHaveLength(0));
  });
});
