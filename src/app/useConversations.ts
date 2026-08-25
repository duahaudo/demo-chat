/**
 * Chat list state, persisted through the adapter's driver and addressed by the URL fragment
 * (TECHNICAL-DESIGN §3.1, ADR-0007).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { browserStorage, loadDocument, saveDocument, type StorageLike } from '@/adapter/storage';
import {
  CURRENT_VERSION,
  type ConversationV1,
  type MessageV1,
  type StoredDocument,
} from '@/core/storage/schema';

const UNTITLED = 'New chat';
const TITLE_LIMIT = 48;
const ROUTE = '#/c/';

export interface Conversations {
  /** Ordered by last activity, most recent first. */
  readonly list: readonly ConversationV1[];
  readonly selected: ConversationV1 | undefined;
  readonly selectedId: string;
  readonly select: (id: string) => void;
  readonly create: () => void;
  readonly append: (id: string, message: MessageV1) => void;
  readonly rename: (id: string, title: string) => void;
  readonly remove: (id: string) => void;
  /** Storage could not be read or written. Everything on screen still works. */
  readonly problem: string | undefined;
}

interface State {
  readonly list: readonly ConversationV1[];
  readonly selectedId: string;
}

function newBlankConversation(now: number): ConversationV1 {
  return {
    id: crypto.randomUUID(),
    title: UNTITLED,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

/** The first user message names the chat, until the user renames it themselves. */
function titleFrom(content: string): string {
  const line = content.trim().split('\n', 1)[0] ?? '';
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT).trimEnd()}…` : line;
}

function byRecent(a: ConversationV1, b: ConversationV1): number {
  return b.updatedAt - a.updatedAt;
}

/** Abandoned empty chats never reach storage (TECHNICAL-DESIGN §3.2). */
function filterOutEmptyConversation(list: readonly ConversationV1[]): StoredDocument {
  return {
    version: CURRENT_VERSION,
    conversations: list.filter((c) => c.messages.length > 0),
  };
}

function idFromHash(hash: string): string {
  return hash.startsWith(ROUTE) ? decodeURIComponent(hash.slice(ROUTE.length)) : '';
}

export function useConversations(
  now: () => number = Date.now,
  storage?: StorageLike | null,
): Conversations {
  const [store] = useState<StorageLike | null>(() =>
    storage === undefined ? browserStorage() : storage,
  );

  const [restored] = useState(() => (store === null ? undefined : loadDocument(store)));
  const [saveProblem, setSaveProblem] = useState<string | undefined>(undefined);

  const [state, setState] = useState<State>(() => {
    const stored = [...(restored?.doc.conversations ?? [])].sort(byRecent);
    const list = stored.length > 0 ? stored : [newBlankConversation(now())];
    const routed = idFromHash(window.location.hash);
    const selectedId = list.some((c) => c.id === routed) ? routed : (list[0]?.id ?? '');
    return { list, selectedId };
  });

  const mountedRef = useRef(false);

  // First sync replaces rather than pushes, so the first Back leaves the app.
  useEffect(() => {
    const target = `${ROUTE}${encodeURIComponent(state.selectedId)}`;
    if (idFromHash(window.location.hash) !== state.selectedId) {
      if (mountedRef.current) window.location.hash = target;
      else window.history.replaceState(null, '', target);
    }
    mountedRef.current = true;
  }, [state.selectedId]);

  useEffect(() => {
    const onHashChange = () => {
      const id = idFromHash(window.location.hash);
      setState((prev) =>
        id === prev.selectedId || !prev.list.some((c) => c.id === id)
          ? prev
          : { ...prev, selectedId: id },
      );
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Seeded from what was loaded: unchanged bytes are not rewritten, so a mount keeps the load
  // problem on screen and a new empty chat stays out of storage.
  const savedRef = useRef(JSON.stringify(filterOutEmptyConversation(state.list)));
  useEffect(() => {
    if (store === null) return;
    const doc = filterOutEmptyConversation(state.list);
    const serialized = JSON.stringify(doc);
    if (serialized === savedRef.current) return;
    savedRef.current = serialized;

    const outcome = saveDocument(store, doc);
    setSaveProblem(outcome.ok ? undefined : outcome.reason);
  }, [state.list, store]);

  const select = useCallback((id: string) => {
    setState((prev) => ({ ...prev, selectedId: id }));
  }, []);

  const create = useCallback(() => {
    setState((prev) => {
      const next = newBlankConversation(now());
      return { list: [next, ...prev.list], selectedId: next.id };
    });
  }, [now]);

  const append = useCallback((id: string, message: MessageV1) => {
    setState((prev) => {
      const list = prev.list.map((conversation) => {
        if (conversation.id !== id) return conversation;
        const named =
          conversation.title === UNTITLED && message.role === 'user'
            ? titleFrom(message.content)
            : conversation.title;
        return {
          ...conversation,
          title: named === '' ? conversation.title : named,
          updatedAt: message.createdAt,
          messages: [...conversation.messages, message],
        };
      });
      return { ...prev, list: [...list].sort(byRecent) };
    });
  }, []);

  /** A rename is not activity: the list keeps its order. */
  const rename = useCallback((id: string, title: string) => {
    const next = title.trim();
    if (next === '') return;
    setState((prev) => ({
      ...prev,
      list: prev.list.map((c) => (c.id === id ? { ...c, title: next } : c)),
    }));
  }, []);

  const remove = useCallback(
    (id: string) => {
      setState((prev) => {
        const list = prev.list.filter((c) => c.id !== id);
        if (list.length === 0) {
          const blank = newBlankConversation(now());
          return { list: [blank], selectedId: blank.id };
        }
        const selectedId = prev.selectedId === id ? (list[0]?.id ?? '') : prev.selectedId;
        return { list, selectedId };
      });
    },
    [now],
  );

  const selected = useMemo(
    () => state.list.find((c) => c.id === state.selectedId),
    [state.list, state.selectedId],
  );

  return {
    list: state.list,
    selected,
    selectedId: state.selectedId,
    select,
    create,
    append,
    rename,
    remove,
    problem: saveProblem ?? restored?.problem,
  };
}
