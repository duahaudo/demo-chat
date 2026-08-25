/**
 * The six required states (DESIGN-SYSTEM §5) in one place: empty, loading, streaming, complete,
 * interrupted, failed. The states are the unit of work here, not the components.
 */

import { Box, Button, EmptyState, Span, Spinner, Stack, Text } from '@chakra-ui/react';
import { useState } from 'react';

import type { ChatStreamStatus } from '@/app/useChatStream';
import type { ClassifiedError } from '@/core/errors';
import type { MessageV1 } from '@/core/storage/schema';

import { MessageBubble } from './MessageBubble';

export interface TranscriptProps {
  readonly messages: readonly MessageV1[];
  readonly status: ChatStreamStatus;
  /** Assistant text not yet committed to `messages`; `undefined` once it has been. */
  readonly streamingText: string | undefined;
  readonly error: ClassifiedError | undefined;
  readonly onRetry: () => void;
}

export function Transcript(props: TranscriptProps) {
  const { messages, status, streamingText, error, onRetry } = props;
  const streaming = status === 'streaming';

  if (messages.length === 0 && status === 'idle') {
    return (
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Title>Start a conversation</EmptyState.Title>
          <EmptyState.Description>
            Ask anything. The reply streams in as it is written.
          </EmptyState.Description>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }

  return (
    <Stack gap="4" paddingY="4">
      {messages.map((message) => (
        <Stack key={message.id} gap="1" align={message.role === 'user' ? 'flex-end' : 'flex-start'}>
          <MessageBubble role={message.role} content={message.content} />
          {message.role === 'assistant' ? <CopyAction content={message.content} /> : null}
        </Stack>
      ))}

      {status === 'loading' ? (
        <Stack direction="row" align="center" gap="2" role="status">
          <Spinner size="sm" />
        </Stack>
      ) : null}

      {streamingText !== undefined && streamingText !== '' ? (
        <Stack gap="1" align="flex-start">
          {/* Live only while streaming (§8) — a settled transcript is not a live region. */}
          <Box aria-live={streaming ? 'polite' : undefined}>
            <MessageBubble role="assistant" content={streamingText} caret={streaming} />
          </Box>
          {status === 'complete' ? <CopyAction content={streamingText} /> : null}
        </Stack>
      ) : null}

      {status === 'interrupted' ? (
        <Text role="status" color="fg.muted">
          Stopped.
        </Text>
      ) : null}

      {status === 'failed' && error !== undefined ? (
        <Stack role="alert" gap="2" align="flex-start" maxWidth="full">
          {/* Providers put bare URLs in error text; unbroken, one scrolls the whole page. */}
          <Text color="fg.error" wordBreak="break-word">
            <Span aria-hidden="true">⚠ </Span>
            {error.summary}
          </Text>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}

/** The action the complete state reveals. */
function CopyAction({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      size="xs"
      variant="ghost"
      color="fg.muted"
      onClick={() => {
        void navigator.clipboard?.writeText(content).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}
