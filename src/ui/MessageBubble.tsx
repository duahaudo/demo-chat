import { Box, Span, Text, VisuallyHidden } from '@chakra-ui/react';

import type { MessageRole } from '@/core/storage/schema';

export interface MessageBubbleProps {
  readonly role: MessageRole;
  readonly content: string;
  /** The streaming caret. Static: a blink would animate streaming text (DESIGN-SYSTEM R6). */
  readonly caret?: boolean;
}

const SPEAKER: Record<MessageRole, string> = { user: 'You said', assistant: 'Assistant said' };

export function MessageBubble({ role, content, caret = false }: MessageBubbleProps) {
  const user = role === 'user';

  return (
    <Box
      alignSelf={user ? 'flex-end' : 'flex-start'}
      maxWidth="75%"
      paddingX="4"
      paddingY="3"
      borderRadius="lg"
      bg={user ? 'colorPalette.solid' : 'bg.subtle'}
      color={user ? 'colorPalette.contrast' : 'fg'}
      border={user ? undefined : 'sm'}
      borderColor={user ? undefined : 'border'}
    >
      <VisuallyHidden>{SPEAKER[role]}</VisuallyHidden>
      <Text whiteSpace="pre-wrap" wordBreak="break-word">
        {content}
        {caret ? (
          <Span aria-hidden="true" data-testid="caret">
            ▍
          </Span>
        ) : null}
      </Text>
    </Box>
  );
}
