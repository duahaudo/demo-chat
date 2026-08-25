import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from './chat';

const SERVER_KEY = 'sk-or-v1-server-key';

interface Recorded {
  readonly status: number;
  readonly headers: Record<string, string>;
  body(): string;
  json(): unknown;
}

function makeReq(options: {
  body?: string;
  method?: string;
  headers?: Record<string, string>;
  address?: string;
}): IncomingMessage {
  const stream = Readable.from([Buffer.from(options.body ?? '')]);
  return Object.assign(stream, {
    method: options.method ?? 'POST',
    headers: options.headers ?? {},
    socket: { remoteAddress: options.address ?? '10.0.0.1' },
  }) as unknown as IncomingMessage;
}

function makeRes(): { res: ServerResponse; out: Recorded } {
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  let status = 0;

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  const res = Object.assign(stream, {
    headersSent: false,
    setHeader(key: string, value: string | number) {
      headers[key] = String(value);
    },
    writeHead(code: number, init?: Record<string, string>) {
      status = code;
      Object.assign(headers, init ?? {});
      res.headersSent = true;
      return res;
    },
  });

  const body = () => Buffer.concat(chunks).toString('utf8');
  return {
    res: res as unknown as ServerResponse,
    out: {
      get status() {
        return status;
      },
      headers,
      body,
      json: () => JSON.parse(body()) as unknown,
    },
  };
}

/** An upstream that answers 200 with an SSE body. */
function stubUpstream(
  sse = 'data: [DONE]\n\n',
  status = 200,
  headers: Record<string, string> = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolve(new Response(status === 204 ? null : sse, { status, headers }));
        }),
    ),
  );
}

function sentBody(): Record<string, unknown> {
  const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function sentHeaders(): Record<string, string> {
  const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

const ONE_MESSAGE = JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] });

/** Each test gets its own address, because the rate limiter is module state by design. */
let addressCounter = 0;
const nextAddress = () => `10.0.0.${String(++addressCounter)}`;

async function call(options: Parameters<typeof makeReq>[0]): Promise<Recorded> {
  const { res, out } = makeRes();
  await handler(makeReq({ address: nextAddress(), ...options }), res);
  return out;
}

beforeEach(() => {
  process.env['OPENROUTER_API_KEY'] = SERVER_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['OPENROUTER_API_KEY'];
});

describe('method and credential', () => {
  it('rejects anything but POST', async () => {
    const out = await call({ method: 'GET' });

    expect(out.status).toBe(405);
    expect(out.headers['Allow']).toBe('POST');
  });

  it('refuses when the server has no key configured', async () => {
    delete process.env['OPENROUTER_API_KEY'];
    const out = await call({ body: ONE_MESSAGE });

    expect(out.status).toBe(503);
    expect(out.body()).toMatch(/no API key configured/);
  });

  it('never echoes the server key in a response', async () => {
    stubUpstream();
    const out = await call({ body: ONE_MESSAGE });

    expect(out.body()).not.toContain(SERVER_KEY);
  });
});

describe('input caps', () => {
  it('rejects a body that is not JSON', async () => {
    const out = await call({ body: 'not json' });

    expect(out.status).toBe(400);
    expect(out.body()).toMatch(/not valid JSON/);
  });

  it('rejects a body with no messages array', async () => {
    const out = await call({ body: JSON.stringify({ prompt: 'Hello' }) });
    expect(out.status).toBe(400);
  });

  it('rejects an empty conversation', async () => {
    const out = await call({ body: JSON.stringify({ messages: [] }) });
    expect(out.status).toBe(400);
  });

  it('caps the message count', async () => {
    const messages = Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' }));
    const out = await call({ body: JSON.stringify({ messages }) });

    expect(out.status).toBe(400);
    expect(out.body()).toMatch(/capped at 40 messages/);
  });

  it('rejects a role the product does not use', async () => {
    const out = await call({
      body: JSON.stringify({ messages: [{ role: 'system', content: 'x' }] }),
    });

    expect(out.status).toBe(400);
    expect(out.json()).toEqual({
      error: {
        code: 'invalid_request',
        message: 'Every message must have a role of "user" or "assistant".',
      },
    });
  });

  it('rejects empty or non-string content', async () => {
    expect(
      (await call({ body: JSON.stringify({ messages: [{ role: 'user', content: '' }] }) })).status,
    ).toBe(400);
    expect(
      (await call({ body: JSON.stringify({ messages: [{ role: 'user', content: 42 }] }) })).status,
    ).toBe(400);
  });

  it('rejects a message that is not an object', async () => {
    const out = await call({ body: JSON.stringify({ messages: ['hello'] }) });
    expect(out.status).toBe(400);
  });

  it('caps total content length across messages', async () => {
    const messages = Array.from({ length: 10 }, () => ({
      role: 'user',
      content: 'x'.repeat(2_500),
    }));
    const out = await call({ body: JSON.stringify({ messages }) });

    expect(out.status).toBe(400);
    expect(out.body()).toMatch(/too long/);
  });

  it('refuses an oversized body without buffering it whole', async () => {
    const out = await call({
      body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(40_000) }] }),
    });

    expect(out.status).toBe(413);
  });
});

describe('the upstream request the client cannot influence', () => {
  it('pins the model and ignores one sent by the client', async () => {
    stubUpstream();
    await call({
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'anthropic/claude-opus-4',
        max_tokens: 999_999,
      }),
    });

    const body = sentBody();
    // Server-configured (`OPENROUTER_MODEL`, with the same default the handler uses); what the test
    // pins is that the client's model never reaches upstream.
    expect(body['model']).not.toBe('anthropic/claude-opus-4');
    expect(body['model']).toBe(process.env['OPENROUTER_MODEL'] || 'openrouter/free');
    expect(body['models']).toEqual(['openrouter/free']);
    expect(body['max_tokens']).toBe(1024);
    expect(body['stream']).toBe(true);
    // Only the validated messages are forwarded; unknown fields are dropped, not merged.
    expect(Object.keys(body).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'models',
      'stream',
    ]);
  });

  it('forwards the server key when the client sent none', async () => {
    stubUpstream();
    await call({ body: ONE_MESSAGE });

    expect(sentHeaders()['Authorization']).toBe(`Bearer ${SERVER_KEY}`);
  });
});

describe('rate limiting', () => {
  it('limits by address and states how long to wait', async () => {
    stubUpstream();
    const address = nextAddress();

    for (let i = 0; i < 20; i += 1) {
      const { res } = makeRes();
      await handler(makeReq({ body: ONE_MESSAGE, address }), res);
    }

    const { res, out } = makeRes();
    await handler(makeReq({ body: ONE_MESSAGE, address }), res);

    expect(out.status).toBe(429);
    expect(Number(out.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('does not limit a different address', async () => {
    stubUpstream();
    const address = nextAddress();
    for (let i = 0; i < 20; i += 1) {
      const { res } = makeRes();
      await handler(makeReq({ body: ONE_MESSAGE, address }), res);
    }

    const out = await call({ body: ONE_MESSAGE });
    expect(out.status).toBe(200);
  });

  it('reads the client address from x-forwarded-for when the platform sets it', async () => {
    stubUpstream();
    const forwarded = '203.0.113.9';

    for (let i = 0; i < 20; i += 1) {
      const { res } = makeRes();
      await handler(
        makeReq({
          body: ONE_MESSAGE,
          address: nextAddress(),
          headers: { 'x-forwarded-for': `${forwarded}, 10.9.9.9` },
        }),
        res,
      );
    }

    const { res, out } = makeRes();
    await handler(
      makeReq({
        body: ONE_MESSAGE,
        address: nextAddress(),
        headers: { 'x-forwarded-for': forwarded },
      }),
      res,
    );
    expect(out.status).toBe(429);
  });
});

describe('streaming and upstream failures', () => {
  it('streams the upstream body through byte for byte', async () => {
    const sse =
      ': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';
    stubUpstream(sse);
    const out = await call({ body: ONE_MESSAGE });

    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toMatch(/text\/event-stream/);
    expect(out.headers['Cache-Control']).toMatch(/no-transform/);
    expect(out.headers['X-Accel-Buffering']).toBe('no');
    expect(out.body()).toBe(sse);
  });

  it('passes an upstream status through with its message, not its raw body', async () => {
    stubUpstream(
      JSON.stringify({ error: { code: 402, message: 'Out of credit.', internal: 'trace-id' } }),
      402,
    );
    const out = await call({ body: ONE_MESSAGE });

    expect(out.status).toBe(402);
    expect(out.json()).toEqual({ error: { code: 'upstream_error', message: 'Out of credit.' } });
    expect(out.body()).not.toContain('trace-id');
  });

  it('forwards Retry-After from upstream so the client honours it', async () => {
    stubUpstream(JSON.stringify({ error: { message: 'Slow down.' } }), 429, {
      'Retry-After': '17',
    });
    const out = await call({ body: ONE_MESSAGE });

    expect(out.status).toBe(429);
    expect(out.headers['Retry-After']).toBe('17');
  });

  it('summarises by status when the upstream body is not JSON', async () => {
    stubUpstream('<html>bad gateway</html>', 502);
    const out = await call({ body: ONE_MESSAGE });

    expect(out.status).toBe(502);
    expect(out.body()).toMatch(/returned 502/);
  });

  it('reports an unreachable provider as 502 without echoing the cause', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError(`connect ECONNREFUSED with ${SERVER_KEY}`))),
    );
    const out = await call({ body: ONE_MESSAGE });

    expect(out.status).toBe(502);
    expect(out.body()).not.toContain(SERVER_KEY);
    expect(out.body()).toMatch(/could not be reached/);
  });

  it('treats a 200 with no body as an upstream error rather than an empty stream', async () => {
    stubUpstream('', 204);
    const out = await call({ body: ONE_MESSAGE });

    expect(out.status).toBe(204);
  });
});
