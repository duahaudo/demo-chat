/**
 * Network edge of the streaming path: `fetch`, `AbortSignal`, byte decoding. No parsing of its own.
 * `TextDecoderStream` is stateful, so a multi-byte character split across reads is reassembled
 * here; core only ever sees decoded strings.
 */

import { classifyError, type ClassifiedError } from '@/core/errors';
import { classifyEvent, type StreamEvent } from '@/core/events';
import { createSseBuffer } from '@/core/sse';
import type { MessageRole } from '@/core/storage/schema';

const ENDPOINT = '/api/chat';

/** Deliberately narrower than a stored message. */
export interface WireMessage {
  readonly role: MessageRole;
  readonly content: string;
}

export interface StreamChatOptions {
  readonly messages: readonly WireMessage[];
  readonly signal: AbortSignal;
  /** BYOK. Forwarded as `Authorization`, never persisted and never logged. */
  readonly apiKey?: string | undefined;
}

/** `error` is the provider failing inside a live stream; `failed` is the transport around it. */
export type TransportEvent =
  StreamEvent | { readonly kind: 'failed'; readonly error: ClassifiedError };

/** `Retry-After` is either seconds or an HTTP date. Only the seconds form is worth honouring. */
function retryAfterSeconds(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
  // A body that is not JSON is not a problem here — the status already did the work.
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message !== '') return message;
    }
  }
  return undefined;
}

/**
 * Never throws — failures arrive as a `failed` event. A truncated stream (body ends with no
 * `[DONE]`) is not a failure: the buffer flushes and every delta already yielded stands.
 */
export async function* streamChat(options: StreamChatOptions): AsyncGenerator<TransportEvent> {
  const { messages, signal, apiKey } = options;

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey !== undefined && apiKey !== '' ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ messages }),
    });
  } catch (cause) {
    yield { kind: 'failed', error: classifyError({ kind: 'thrown', cause }) };
    return;
  }

  if (!response.ok) {
    yield {
      kind: 'failed',
      error: classifyError({
        kind: 'http',
        status: response.status,
        message: await readErrorMessage(response),
        retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')),
      }),
    };
    return;
  }

  if (response.body === null) {
    yield {
      kind: 'failed',
      error: classifyError({ kind: 'protocol', reason: 'The response carried no body.' }),
    };
    return;
  }

  const buffer = createSseBuffer();
  // Explicit reader: `ReadableStream[Symbol.asyncIterator]` is still missing in Safari.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        // For a server that closed without its final delimiter.
        for (const frame of buffer.flush()) yield classifyEvent(frame);
        return;
      }

      for (const frame of buffer.push(value)) {
        const event = classifyEvent(frame);
        yield event;
        if (event.kind === 'done') return;
      }
    }
  } catch (cause) {
    // Includes the abort: `reader.read()` rejects when the signal fires mid-read, and classifies
    // as `cancelled` rather than a failure.
    yield { kind: 'failed', error: classifyError({ kind: 'thrown', cause }) };
  } finally {
    // Runs on every exit, including the caller abandoning the generator.
    await reader.cancel().catch(() => undefined);
  }
}
