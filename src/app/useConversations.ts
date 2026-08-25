/**
 * Chat list state: which conversations exist, which one is open, what is in them.
 *
 * In memory only. Phase 5 replaces the store behind this same surface with the `localStorage`
 * driver and a router, at which point "persisted on first message, not on creation" becomes a
 * real rule rather than a shape the data already has.
 */

import { useCallback, useMemo, useState } from 'react';

import type { ConversationV1, MessageV1 } from '@/core/storage/schema';

const UNTITLED = 'New chat';
const TITLE_LIMIT = 48;

export interface Conversations {
  /** Ordered by last activity, most recent first. */
  readonly list: readonly ConversationV1[];
  readonly selected: ConversationV1 | undefined;
  readonly selectedId: string;
  readonly select: (id: string) => void;
  readonly create: () => void;
  readonly append: (id: string, message: MessageV1) => void;
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

export function useConversations(now: () => number = Date.now): Conversations {
  const [state, setState] = useState<State>(() => {
    const firstConversation = newBlankConversation(now());
    return { list: [firstConversation], selectedId: firstConversation.id };
  });

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
      return { ...prev, list: [...list].sort((a, b) => b.updatedAt - a.updatedAt) };
    });
  }, []);

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
  };
}
