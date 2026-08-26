import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamChat, type TransportEvent } from './transport';

const encoder = new TextEncoder();

/** A body that delivers `chunks` and then closes. */
function closingBody(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

/**
 * A body that delivers `chunks` and then stays open until the signal fires — which is how a real
 * cancellation reaches the reader.
 */
function hangingBody(
  chunks: readonly Uint8Array[],
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      signal.addEventListener('abort', () => {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'));
      });
    },
  });
}

function stubFetch(build: (init: RequestInit) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => Promise.resolve(build(init))),
  );
}

/** Serve a whole SSE stream, split into chunks by the given strategy. */
function serve(stream: string, split: (s: string) => Uint8Array[]): void {
  stubFetch(() => new Response(closingBody(split(stream)), { status: 200 }));
}

const asOneChunk = (s: string): Uint8Array[] => [encoder.encode(s)];
const asBytes = (s: string): Uint8Array[] => [...encoder.encode(s)].map((b) => Uint8Array.of(b));

async function collect(signal = new AbortController().signal): Promise<TransportEvent[]> {
  const events: TransportEvent[] = [];
  for await (const event of streamChat({ messages: [{ role: 'user', content: 'Hi' }], signal })) {
    events.push(event);
  }
  return events;
}

const HELLO =
  ': OPENROUTER PROCESSING\n\n' +
  'data: {"choices":[{"delta":{"content":"He"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n' +
  'data: [DONE]\n\n';

const text = (events: readonly TransportEvent[]): string =>
  events
    .filter((e): e is { kind: 'delta'; text: string } => e.kind === 'delta')
    .map((e) => e.text)
    .join('');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamChat — happy path', () => {
  it('yields deltas and stops at the sentinel', async () => {
    serve(HELLO, asOneChunk);
    const events = await collect();

    expect(text(events)).toBe('Hello');
    expect(events.at(-1)).toEqual({ kind: 'done', reason: 'sentinel' });
  });

  it('yields the same deltas when the body arrives one byte at a time', async () => {
    serve(HELLO, asBytes);
    expect(text(await collect())).toBe('Hello');
  });

  it('reassembles a multi-byte character split across reads', async () => {
    // The whole reason the decoder lives in this layer: the four bytes of an emoji, and the two
    // of an accented character, land in different network reads.
    const stream = 'data: {"choices":[{"delta":{"content":"café 😀"}}]}\n\ndata: [DONE]\n\n';
    serve(stream, asBytes);

    expect(text(await collect())).toBe('café 😀');
  });

  it('treats a CRLF delimiter split across reads as one boundary', async () => {
    const stream =
      'data: {"choices":[{"delta":{"content":"a"}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"b"}}]}\r\n\r\n';
    // Every \r and its \n land in separate reads, so a naive parser sees four line breaks.
    serve(stream, (s) => [...s].map((c) => encoder.encode(c)));
    const events = await collect();

    expect(text(events)).toBe('ab');
    expect(events.filter((e) => e.kind === 'delta')).toHaveLength(2);
  });

  it('stops reading once the stream reports done, ignoring anything after it', async () => {
    const stream = HELLO + 'data: {"choices":[{"delta":{"content":"late"}}]}\n\n';
    serve(stream, asOneChunk);

    expect(text(await collect())).toBe('Hello');
  });
});

describe('streamChat — adverse streams', () => {
  it('flushes a truncated stream instead of losing its last frame', async () => {
    const stream = 'data: {"choices":[{"delta":{"content":"partial"}}]}';
    serve(stream, asOneChunk);
    const events = await collect();

    expect(text(events)).toBe('partial');
    expect(events.some((e) => e.kind === 'failed')).toBe(false);
  });

  it('surfaces a mid-stream error delivered under HTTP 200 and keeps what came before', async () => {
    const stream =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"error":{"code":429,"message":"Rate limited upstream."}}\n\n';
    serve(stream, asOneChunk);
    const events = await collect();

    expect(text(events)).toBe('Hel');
    expect(events.at(-1)).toEqual({
      kind: 'error',
      error: { code: 429, message: 'Rate limited upstream.' },
    });
  });

  it('reports a malformed payload without ending the stream', async () => {
    const stream =
      'data: {not json\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    serve(stream, asOneChunk);
    const events = await collect();

    expect(events[0]?.kind).toBe('malformed');
    expect(text(events)).toBe('ok');
  });
});

describe('streamChat — cancellation', () => {
  it('classifies an abort mid-delta as cancelled and keeps the partial text', async () => {
    const controller = new AbortController();
    stubFetch(
      () =>
        new Response(
          hangingBody(
            [encoder.encode('data: {"choices":[{"delta":{"content":"par"}}]}\n\n')],
            controller.signal,
          ),
          {
            status: 200,
          },
        ),
    );

    const events: TransportEvent[] = [];
    for await (const event of streamChat({
      messages: [{ role: 'user', content: 'Hi' }],
      signal: controller.signal,
    })) {
      events.push(event);
      if (event.kind === 'delta' && event.text !== '') controller.abort();
    }

    expect(text(events)).toBe('par');
    const last = events.at(-1);
    expect(last?.kind).toBe('failed');
    if (last?.kind === 'failed') {
      expect(last.error.class).toBe('cancelled');
      expect(last.error.retryable).toBe(false);
    }
  });
});

describe('streamChat — transport failures', () => {
  it('classifies a non-OK status, carrying the proxy message and Retry-After through', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'rate_limited', message: 'Too many requests.' } }),
          {
            status: 429,
            headers: { 'Retry-After': '30', 'Content-Type': 'application/json' },
          },
        ),
    );

    const events = await collect();
    expect(events).toHaveLength(1);
    const only = events[0];
    expect(only?.kind).toBe('failed');
    if (only?.kind === 'failed') {
      expect(only.error.class).toBe('transient');
      expect(only.error.summary).toBe('Too many requests.');
      expect(only.error.retryAfterMs).toBe(30_000);
    }
  });

  it('falls back to the status when the error body is not readable', async () => {
    stubFetch(() => new Response('<html>gateway</html>', { status: 502 }));

    const events = await collect();
    const only = events[0];
    expect(only?.kind).toBe('failed');
    if (only?.kind === 'failed') {
      expect(only.error.class).toBe('transient');
      expect(only.error.maxRetries).toBe(1);
    }
  });

  it('classifies a permanent status without retrying', async () => {
    stubFetch(
      () => new Response(JSON.stringify({ error: { message: 'Key rejected.' } }), { status: 401 }),
    );

    const events = await collect();
    const only = events[0];
    expect(only?.kind).toBe('failed');
    if (only?.kind === 'failed') expect(only.error.class).toBe('permanent');
  });

  it('classifies a request that never left the browser as local', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const events = await collect();
    const only = events[0];
    expect(only?.kind).toBe('failed');
    if (only?.kind === 'failed') expect(only.error.class).toBe('local');
  });

  it('reports a response with no body as a protocol failure', async () => {
    stubFetch(() => new Response(null, { status: 204 }));

    const events = await collect();
    const only = events[0];
    expect(only?.kind).toBe('failed');
    if (only?.kind === 'failed') expect(only.error.class).toBe('protocol');
  });
});

describe('streamChat — request shape', () => {
  it('posts the messages to the proxy and never sends an Authorization header', async () => {
    serve(HELLO, asOneChunk);
    await collect();

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call?.[0]).toBe('/api/chat');
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });
});
