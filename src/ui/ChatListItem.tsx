import { Box, Circle, Flex, Input, Link, Stack, Text, VisuallyHidden } from '@chakra-ui/react';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';

import { relativeTime } from './relativeTime';

export interface ChatListItemProps {
  readonly href: string;
  readonly title: string;
  readonly preview: string | undefined;
  readonly updatedAt: number;
  readonly now: number;
  readonly selected?: boolean;
  readonly streaming?: boolean;
  readonly renaming?: boolean;
  readonly onSelect?: (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly onRename?: (title: string) => void;
  readonly onRenameCancel?: () => void;
}

export function ChatListItem(props: ChatListItemProps) {
  const {
    href,
    title,
    preview,
    updatedAt,
    now,
    selected = false,
    streaming = false,
    renaming = false,
    onSelect,
    onRename,
    onRenameCancel,
  } = props;

  // An input inside an anchor is neither valid nor operable, so renaming replaces the row.
  if (renaming) {
    return <RenameField title={title} onRename={onRename} onCancel={onRenameCancel} />;
  }

  return (
    <Link
      href={href}
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
      display="flex"
      alignItems="stretch"
      gap="2"
      paddingInlineEnd="3"
      paddingY="2"
      borderRadius="md"
      width="full"
      bg={selected ? 'bg.muted' : 'transparent'}
      _hover={{ bg: 'bg.muted', textDecoration: 'none' }}
    >
      <Box
        width="1"
        borderRadius="full"
        bg={selected ? 'colorPalette.solid' : 'transparent'}
        aria-hidden="true"
      />
      <Stack gap="0" flex="1" minWidth="0">
        <Flex align="center" gap="2" minWidth="0">
          {streaming ? (
            <>
              <Circle size="2" bg="colorPalette.solid" flexShrink="0" aria-hidden="true" />
              {/* R5: the dot is the visual signal, this is the one screen readers get. */}
              <VisuallyHidden>Streaming</VisuallyHidden>
            </>
          ) : null}
          <Text truncate fontWeight="medium">
            {title}
          </Text>
        </Flex>
        {preview !== undefined && preview !== '' ? (
          <Text truncate fontSize="sm" color="fg.muted">
            {preview}
          </Text>
        ) : null}
        <Text fontSize="xs" color="fg.muted">
          {relativeTime(updatedAt, now)}
        </Text>
      </Stack>
    </Link>
  );
}

interface RenameFieldProps {
  readonly title: string;
  readonly onRename?: ((title: string) => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
}

function RenameField({ title, onRename, onCancel }: RenameFieldProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.select();
  }, []);

  const commit = (value: string) => {
    const next = value.trim();
    onRename?.(next === '' ? title : next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(event.currentTarget.value);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
    }
  };

  return (
    <Input
      ref={ref}
      size="sm"
      defaultValue={title}
      aria-label="Chat title"
      onKeyDown={onKeyDown}
      onBlur={(event) => commit(event.currentTarget.value)}
    />
  );
}
