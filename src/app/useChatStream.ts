/**
 * Streaming lifecycle for one conversation: request, cancellation, bounded retry, and render
 * scheduling.
 *
 * Two invariants live here and nowhere else (TECHNICAL-DESIGN §3.1, §3.3). Deltas accumulate in a
 * ref and flush once per animation frame — per-token `setState` makes the composer stop accepting
 * input during a fast response. And every delta is matched against the conversation that asked
 * for it, so a late frame from an abandoned stream never lands in the chat the user switched to.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { streamChat, type WireMessage } from '@/adapter/transport';
import { classifyError, retryDelayMs, type ClassifiedError } from '@/core/errors';
import type { StreamErrorPayload } from '@/core/events';

/** `loading` is requested-but-no-token-yet; the pair maps onto DESIGN-SYSTEM §5's six states. */
export type ChatStreamStatus =
  'idle' | 'loading' | 'streaming' | 'complete' | 'interrupted' | 'failed';

export interface UseChatStreamOptions {
  readonly conversationId: string;
  /** Test seam: keeps jittered backoff out of the wall clock. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ChatStream {
  readonly status: ChatStreamStatus;
  /** Assistant text so far. Kept on stop and on failure alike — never discarded. */
  readonly text: string;
  readonly error: ClassifiedError | undefined;
  readonly send: (messages: readonly WireMessage[]) => Promise<void>;
  readonly stop: () => void;
}

interface StreamState {
  readonly status: ChatStreamStatus;
  readonly text: string;
  readonly error: ClassifiedError | undefined;
}

const IDLE: StreamState = { status: 'idle', text: '', error: undefined };

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** OpenRouter mirrors an HTTP status in a mid-stream error's code when it has one to mirror. */
function classifyStreamError(payload: StreamErrorPayload): ClassifiedError {
  return typeof payload.code === 'number'
    ? classifyError({
        kind: 'http',
        status: payload.code,
        code: payload.code,
        message: payload.message,
      })
    : classifyError({ kind: 'protocol', reason: payload.message, code: payload.code });
}

export function useChatStream(options: UseChatStreamOptions): ChatStream {
  const { conversationId, sleep = wait } = options;

  const [state, setState] = useState<StreamState>(IDLE);

  const conversationIdRef = useRef(conversationId);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef('');
  const frameRef = useRef<number | null>(null);
  const liveRef = useRef(true);

  const cancelFrame = useCallback(() => {
    if (frameRef.current === null) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const flush = useCallback(() => {
    frameRef.current = null;
    const pending = pendingRef.current;
    if (pending === '' || !liveRef.current) return;
    pendingRef.current = '';
    setState((prev) => ({ ...prev, status: 'streaming', text: prev.text + pending }));
  }, []);

  const schedule = useCallback(
    (text: string) => {
      pendingRef.current += text;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  /** Terminal transition. Drains the ref synchronously so the last tokens are never dropped. */
  const settle = useCallback(
    (status: ChatStreamStatus, error: ClassifiedError | undefined) => {
      cancelFrame();
      const pending = pendingRef.current;
      pendingRef.current = '';
      if (!liveRef.current) return;
      setState((prev) => ({ status, text: prev.text + pending, error }));
    },
    [cancelFrame],
  );

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      abortRef.current?.abort();
      cancelFrame();
    };
  }, [cancelFrame]);

  // Switching chats abandons the request outright: the connection is released and the buffered
  // tail is dropped rather than replayed into the conversation now on screen.
  useEffect(() => {
    conversationIdRef.current = conversationId;
    abortRef.current?.abort();
    abortRef.current = null;
    pendingRef.current = '';
    cancelFrame();
    setState(IDLE);
  }, [conversationId, cancelFrame]);

  const send = useCallback(
    async (messages: readonly WireMessage[]) => {
      const requestId = conversationIdRef.current;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      pendingRef.current = '';
      if (liveRef.current) setState({ status: 'loading', text: '', error: undefined });

      // Anything already rendered makes a retry a duplication rather than a second attempt, so the
      // automatic path is only open before the first token. After that it is the user's call.
      let received = false;

      for (let attempt = 0; ; attempt += 1) {
        let failure: ClassifiedError | undefined;

        for await (const event of streamChat({ messages, signal: controller.signal })) {
          if (conversationIdRef.current !== requestId || controller.signal.aborted) break;

          if (event.kind === 'delta') {
            if (event.text !== '') {
              received = true;
              schedule(event.text);
            }
            continue;
          }
          // One unreadable frame does not end a healthy stream.
          if (event.kind === 'malformed') continue;
          if (event.kind === 'done') break;

          failure = event.kind === 'error' ? classifyStreamError(event.error) : event.error;
          break;
        }

        if (conversationIdRef.current !== requestId) return;
        if (controller.signal.aborted || failure?.class === 'cancelled') {
          settle('interrupted', undefined);
          return;
        }
        // A body that ends without `[DONE]` is complete: the buffer flushed, nothing was lost.
        if (failure === undefined) {
          settle('complete', undefined);
          return;
        }

        if (failure.retryable && !received && attempt < failure.maxRetries) {
          await sleep(retryDelayMs(attempt + 1, Math.random(), failure));
          if (conversationIdRef.current !== requestId) return;
          if (controller.signal.aborted) {
            settle('interrupted', undefined);
            return;
          }
          continue;
        }

        settle('failed', failure);
        return;
      }
    },
    [schedule, settle, sleep],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    status: state.status,
    text: state.text,
    error: state.error,
    send,
    stop,
  };
}
