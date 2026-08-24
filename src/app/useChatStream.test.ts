// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useChatStream, type UseChatStreamOptions } from './useChatStream';

const encoder = new TextEncoder();
const MESSAGES = [{ role: 'user', content: 'Hi' }] as const;

/** Backoff without the wall clock. Delay length is core's business and is asserted there. */
const instantly = (): Promise<void> => Promise.resolve();

interface LiveStream {
  push: (text: string) => void;
  close: () => void;
  /** The signal the hook handed to `fetch` — the only way to observe that it aborted. */
  signal: AbortSignal;
}

/** A body the test drives frame by frame, and that errors when the hook aborts, as a socket does. */
function serveLive(): { started: Promise<LiveStream> } {
  let announce!: (live: LiveStream) => void;
  const started = new Promise<LiveStream>((resolve) => {
    announce = resolve;
  });

  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => {
            if (closed) return;
            closed = true;
            controller.error(new DOMException('The operation was aborted.', 'AbortError'));
          });
          announce({
            signal,
            push: (text) => {
              if (!closed) controller.enqueue(encoder.encode(text));
            },
            close: () => {
              closed = true;
              controller.close();
            },
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }),
  );

  return { started };
}

/** Serve a whole stream at once, optionally split byte by byte. */
function serve(stream: string, perByte = false): void {
  const chunks = perByte
    ? [...encoder.encode(stream)].map((b) => Uint8Array.of(b))
    : [encoder.encode(stream)];

  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk);
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    ),
  );
}

/** Fails the first `times` requests with `status`, then serves `stream`. */
function serveAfterFailures(times: number, status: number, stream: string): void {
  let seen = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      if (seen++ < times) return Promise.resolve(new Response('upstream', { status }));
      return Promise.resolve(new Response(stream, { status: 200 }));
    }),
  );
}

const delta = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

const HELLO = `: OPENROUTER PROCESSING\n\n${delta('He')}${delta('llo')}data: [DONE]\n\n`;

function render(options: Partial<UseChatStreamOptions> = {}) {
  return renderHook((props: UseChatStreamOptions) => useChatStream(props), {
    initialProps: { conversationId: 'a', sleep: instantly, ...options },
  });
}

/** React routes updates through act's queue while this flag is set; one test needs it off. */
function withoutActQueue(off: boolean): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = !off;
}

afterEach(() => {
  cleanup();
  withoutActQueue(false);
  vi.unstubAllGlobals();
});

describe('useChatStream — completion', () => {
  it('accumulates deltas and completes at the sentinel', async () => {
    serve(HELLO);
    const { result } = render();

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.text).toBe('Hello');
    expect(result.current.status).toBe('complete');
    expect(result.current.error).toBeUndefined();
  });

  it('reaches the same text when the body arrives one byte at a time', async () => {
    serve(HELLO, true);
    const { result } = render();

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.text).toBe('Hello');
  });

  it('treats a body that ends without the sentinel as complete, keeping the last frame', async () => {
    serve(delta('partial').trimEnd());
    const { result } = render();

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.text).toBe('partial');
    expect(result.current.status).toBe('complete');
  });

  it('survives a malformed frame mid-stream', async () => {
    serve(`data: {not json\n\n${delta('ok')}data: [DONE]\n\n`);
    const { result } = render();

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.text).toBe('ok');
    expect(result.current.status).toBe('complete');
  });

  it('renders once per frame rather than once per token', async () => {
    // Each token arrives in its own task, spaced wider than a frame is long, so React's own
    // batching cannot account for the difference: without the ref and the animation frame this is
    // one render per token, and the composer stops accepting input while the answer arrives.
    //
    // Deliberately outside `act`: act collapses every update inside its scope into a single
    // flush, which is the exact quantity under measurement.
    withoutActQueue(true);
    const { started } = serveLive();

    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useChatStream({ conversationId: 'a', sleep: instantly });
    });

    const TOKENS = 40;
    const sent = result.current.send(MESSAGES);
    const live = await started;
    for (let i = 0; i < TOKENS; i += 1) {
      live.push(delta('x'));
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    live.push('data: [DONE]\n\n');
    await sent;

    await waitFor(() => expect(result.current.text).toHaveLength(TOKENS));
    expect(renders).toBeLessThan(TOKENS / 2);
  });
});

describe('useChatStream — interruption', () => {
  it('stops mid-delta, keeps the partial text and releases the connection', async () => {
    const { started } = serveLive();
    const { result } = render();

    let sent!: Promise<void>;
    await act(async () => {
      sent = result.current.send(MESSAGES);
      const live = await started;
      live.push(delta('par'));
    });

    await waitFor(() => expect(result.current.text).toBe('par'));

    await act(async () => {
      result.current.stop();
      await sent;
    });

    expect(result.current.status).toBe('interrupted');
    expect(result.current.text).toBe('par');
    expect((await started).signal.aborted).toBe(true);
  });

  it('aborts the request on unmount and writes nothing afterwards', async () => {
    const { started } = serveLive();
    const { result, unmount } = render();

    await act(async () => {
      void result.current.send(MESSAGES);
      const live = await started;
      live.push(delta('par'));
    });

    const live = await started;
    unmount();

    expect(live.signal.aborted).toBe(true);
  });
});

describe('useChatStream — conversation-id guard', () => {
  it('drops every delta from the abandoned chat when the conversation changes mid-stream', async () => {
    const { started } = serveLive();
    const { result, rerender } = renderHook((props: UseChatStreamOptions) => useChatStream(props), {
      initialProps: { conversationId: 'a', sleep: instantly },
    });

    let sent!: Promise<void>;
    await act(async () => {
      sent = result.current.send(MESSAGES);
      const live = await started;
      live.push(delta('for-a'));
    });
    await waitFor(() => expect(result.current.text).toBe('for-a'));

    act(() => {
      rerender({ conversationId: 'b', sleep: instantly });
    });

    // Frames the abandoned request had already buffered, arriving after the switch.
    const live = await started;
    await act(async () => {
      live.push(delta('late'));
      live.push('data: [DONE]\n\n');
      await sent;
    });

    expect(live.signal.aborted).toBe(true);
    expect(result.current.text).toBe('');
    expect(result.current.status).toBe('idle');
  });
});

describe('useChatStream — failure', () => {
  it('surfaces a mid-stream error under HTTP 200 and keeps what arrived before it', async () => {
    serve(
      `${delta('Hel')}data: ${JSON.stringify({ error: { code: 429, message: 'Rate limited upstream.' } })}\n\n`,
    );
    const { result } = render();

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.text).toBe('Hel');
    expect(result.current.error?.class).toBe('transient');
    expect(result.current.error?.retryable).toBe(true);
  });

  it('retries a transient failure with backoff and then succeeds', async () => {
    serveAfterFailures(2, 429, HELLO);
    const sleep = vi.fn(instantly);
    const { result } = render({ sleep });

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.status).toBe('complete');
    expect(result.current.text).toBe('Hello');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up once the retry ceiling for the class is reached', async () => {
    // A 500 is retried once — a provider that answers broken twice is not having a blip.
    serveAfterFailures(5, 500, HELLO);
    const { result } = render();

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.status).toBe('failed');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent failure', async () => {
    serveAfterFailures(5, 401, HELLO);
    const { result } = render();

    await act(async () => {
      await result.current.send(MESSAGES);
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error?.class).toBe('permanent');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
