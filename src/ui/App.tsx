import {
  Box,
  Button,
  Dialog,
  Drawer,
  Flex,
  Heading,
  IconButton,
  Portal,
  Stack,
  Text,
} from '@chakra-ui/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useChatStream } from '@/app/useChatStream';
import { useConversations } from '@/app/useConversations';
import type { ConversationV1, MessageV1 } from '@/core/storage/schema';

import { ChatListItem } from './ChatListItem';
import { Composer } from './Composer';
import { Transcript } from './Transcript';

export function App() {
  const { list, selected, selectedId, select, create, append, rename, remove, problem } =
    useConversations();
  const { status, text, error, send, stop } = useChatStream({ conversationId: selectedId });

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleting = list.find((conversation) => conversation.id === deletingId);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const lastSentRef = useRef<readonly { role: MessageV1['role']; content: string }[]>([]);

  // Relative timestamps go stale without one; a minute is as fine as they get.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const busy = status === 'loading' || status === 'streaming';

  // The field is disabled while streaming, so it loses focus; take it back once it settles, and on
  // every chat switch or new chat.
  useEffect(() => {
    if (!busy) composerRef.current?.focus();
  }, [busy, selectedId]);

  /**
   * A settled answer stays in the hook until something displaces it — a new message, a retry, a
   * chat switch — and is folded into the conversation at that moment. Nothing is discarded, and no
   * effect is needed to copy one piece of state into another.
   */
  const foldTail = useCallback((): MessageV1 | null => {
    if (text === '') return null;
    if (status !== 'complete' && status !== 'interrupted' && status !== 'failed') return null;
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      status,
    };
  }, [status, text]);

  const handleSend = useCallback(
    (content: string) => {
      const tail = foldTail();
      const user: MessageV1 = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: Date.now(),
        status: 'complete',
      };

      const history = [...(selected?.messages ?? []), ...(tail === null ? [] : [tail]), user];
      if (tail !== null) append(selectedId, tail);
      append(selectedId, user);

      lastSentRef.current = history.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      void send(lastSentRef.current);
    },
    [append, foldTail, selected, selectedId, send],
  );

  const handleRetry = useCallback(() => {
    const tail = foldTail();
    if (tail !== null) append(selectedId, tail);
    void send(lastSentRef.current);
  }, [append, foldTail, selectedId, send]);

  const handleSelect = useCallback(
    (id: string) => {
      const tail = foldTail();
      if (tail !== null) append(selectedId, tail);
      select(id);
    },
    [append, foldTail, select, selectedId],
  );

  const handleCreate = useCallback(() => {
    const tail = foldTail();
    if (tail !== null) append(selectedId, tail);
    create();
  }, [append, create, foldTail, selectedId]);

  const handleDelete = useCallback(() => {
    if (deletingId !== null) remove(deletingId);
    setDeletingId(null);
  }, [deletingId, remove]);

  const chatList = (
    <Stack gap="3">
      <Button onClick={handleCreate}>New chat</Button>
      <Stack as="ul" gap="1" listStyleType="none">
        {list.map((conversation) => (
          <Box as="li" key={conversation.id}>
            <ChatListItem
              href={`#/c/${conversation.id}`}
              title={conversation.title}
              preview={previewOf(conversation)}
              updatedAt={conversation.updatedAt}
              now={now}
              selected={conversation.id === selectedId}
              streaming={busy && conversation.id === selectedId}
              renaming={conversation.id === renamingId}
              actions={
                <Flex align="center" gap="1">
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label={`Rename ${conversation.title}`}
                    onClick={() => setRenamingId(conversation.id)}
                    {...revealOnHover}
                  >
                    <PencilIcon />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label={`Delete ${conversation.title}`}
                    onClick={() => setDeletingId(conversation.id)}
                    {...revealOnHover}
                  >
                    <TrashIcon />
                  </IconButton>
                </Flex>
              }
              onSelect={(event) => {
                event.preventDefault();
                handleSelect(conversation.id);
              }}
              onRename={(title) => {
                rename(conversation.id, title);
                setRenamingId(null);
              }}
              onRenameCancel={() => setRenamingId(null)}
            />
          </Box>
        ))}
      </Stack>
    </Stack>
  );

  return (
    <Flex height="100dvh" colorPalette="blue" bg="bg" color="fg">
      <Stack
        as="nav"
        aria-label="Chats"
        hideBelow="md"
        width="64"
        flexShrink="0"
        padding="3"
        gap="3"
        overflowY="auto"
        borderInlineEnd="sm"
        borderColor="border"
      >
        {chatList}
      </Stack>

      <Flex direction="column" flex="1" minWidth="0">
        <Flex as="header" align="center" gap="3" padding="3" borderBottom="sm" borderColor="border">
          <Box hideFrom="md">
            <Drawer.Root placement="start">
              <Drawer.Trigger asChild>
                <Button variant="outline" size="sm">
                  Chats
                </Button>
              </Drawer.Trigger>
              <Portal>
                <Drawer.Backdrop />
                <Drawer.Positioner>
                  <Drawer.Content>
                    <Drawer.Header>
                      <Drawer.Title>Chats</Drawer.Title>
                    </Drawer.Header>
                    <Drawer.Body>{chatList}</Drawer.Body>
                    <Drawer.Footer>
                      <Drawer.CloseTrigger asChild>
                        <Button variant="outline">Close</Button>
                      </Drawer.CloseTrigger>
                    </Drawer.Footer>
                  </Drawer.Content>
                </Drawer.Positioner>
              </Portal>
            </Drawer.Root>
          </Box>
          <Heading size="md" truncate>
            {selected?.title ?? 'Chat'}
          </Heading>
        </Flex>

        {problem === undefined ? null : (
          <Text role="alert" color="fg.error" fontSize="sm" paddingX="4" paddingTop="2">
            {problem}
          </Text>
        )}

        <Box flex="1" overflowY="auto" paddingX="4">
          <Box maxWidth="3xl" marginX="auto">
            <Transcript
              messages={selected?.messages ?? []}
              status={status}
              streamingText={text === '' ? undefined : text}
              error={error}
              onRetry={handleRetry}
            />
          </Box>
        </Box>

        <Box padding="4" borderTop="sm" borderColor="border">
          <Box maxWidth="3xl" marginX="auto">
            <Composer streaming={busy} onSend={handleSend} onStop={stop} inputRef={composerRef} />
          </Box>
        </Box>
      </Flex>

      <Dialog.Root
        role="alertdialog"
        open={deleting !== undefined}
        onOpenChange={(event) => {
          if (!event.open) setDeletingId(null);
        }}
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Header>
                <Dialog.Title>Delete chat?</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Text>
                  {deleting?.title} and everything in it will be deleted. This cannot be undone.
                </Text>
              </Dialog.Body>
              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="red" onClick={handleDelete}>
                  Delete
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Flex>
  );
}

const revealOnHover = {
  opacity: 0,
  _groupHover: { opacity: 1 },
  _focusVisible: { opacity: 1 },
} as const;

function PencilIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L20 8l-4-4L4 16z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

function previewOf(conversation: ConversationV1): string | undefined {
  return conversation.messages.at(-1)?.content;
}
