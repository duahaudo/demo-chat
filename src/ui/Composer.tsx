import { Button, Flex, Stack, Text, Textarea } from '@chakra-ui/react';
import { useId, useState, type KeyboardEvent, type RefObject } from 'react';

export interface ComposerProps {
  readonly streaming: boolean;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function Composer({ streaming, onSend, onStop, inputRef }: ComposerProps) {
  const [value, setValue] = useState('');
  const hintId = useId();
  const empty = value.trim() === '';

  const submit = () => {
    if (streaming || empty) return;
    setValue('');
    onSend(value.trim());
  };

  const onFieldKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    submit();
  };

  // Escape lives on the wrapper: while streaming the field is disabled and takes no keys.
  const onWrapperKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !streaming) return;
    event.preventDefault();
    onStop();
  };

  return (
    <Stack gap="2" onKeyDown={onWrapperKeyDown}>
      <Flex gap="3" align="flex-start">
        <Textarea
          ref={inputRef}
          autoresize
          maxHeight="40"
          value={value}
          disabled={streaming}
          aria-label="Message"
          aria-describedby={hintId}
          placeholder="Send a message"
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={onFieldKeyDown}
        />
        {streaming ? (
          <Button colorPalette="gray" onClick={onStop} aria-describedby={hintId}>
            Stop
          </Button>
        ) : (
          <Button onClick={submit} disabled={empty} aria-describedby={hintId}>
            Send
          </Button>
        )}
      </Flex>
      <Text id={hintId} fontSize="xs" color="fg.muted">
        {hint(streaming, empty)}
      </Text>
    </Stack>
  );
}

/** A disabled control always states why (DESIGN-SYSTEM §5), so the hint tracks what is disabled. */
function hint(streaming: boolean, empty: boolean): string {
  if (streaming) return 'The response is streaming. Press Escape or Stop to interrupt it.';
  if (empty) return 'Type a message to send. Enter sends, Shift+Enter adds a line.';
  return 'Enter sends. Shift+Enter adds a line.';
}
