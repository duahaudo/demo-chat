/**
 * OpenRouter proxy — a security boundary, not a passthrough (ADR-0003).
 *
 * Holds the credential (`OPENROUTER_API_KEY`, never `VITE_`-prefixed), pins the model, caps input
 * and output, rate limits by address, and streams the upstream body through without parsing it.
 * Exported as a plain `(req, res)` handler so Vercel and the Vite dev plugin mount the same module.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

const UPSTREAM_URL = 'https://openrouter.ai/api/v1/chat/completions';

// A routing endpoint rather than a pinned `:free` slug — free model ids rotate without notice.
// `models` is OpenRouter's own fallback list, tried in order. It must stay free-only: a key with a
// spend limit of 0 is refused up front ("Key limit exceeded") if any candidate can bill, which is
// why `openrouter/auto` is not in the list.
// `||`, not `??`: an env var present but empty is unset, and an empty model is a 400 upstream.
const MODEL = process.env['OPENROUTER_MODEL'] || 'openrouter/free';
const MODEL_FALLBACKS = ['openrouter/free'];

const MAX_TOKENS = 1024;
const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 40;
const MAX_TOTAL_CHARS = 24_000;

// OpenRouter's own free-tier ceiling is 20 RPM, so there is no point going above it.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_MAX_KEYS = 10_000;

// TODO(scale): in-memory Map, resets on cold start; move to a KV store if abuse appears.
const hits = new Map<string, number[]>();

interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `x-forwarded-for` is client-controllable in general, but Vercel overwrites it, so the leftmost
 * entry is the real client there. Spoofing it only widens the limit for the spoofer.
 */
function addressOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = header?.split(',')[0]?.trim();
  return first && first !== '' ? first : (req.socket.remoteAddress ?? 'unknown');
}

/** Sliding window. Returns the seconds to wait when the caller is over the limit. */
function rateLimit(address: string, now: number): { ok: true } | { ok: false; retryAfter: number } {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (hits.get(address) ?? []).filter((at) => at > cutoff);

  if (recent.length >= RATE_LIMIT_MAX) {
    const oldest = recent[0] ?? now;
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  // Crude eviction, but the limiter is a speed bump by design (ADR-0003).
  if (!hits.has(address) && hits.size >= RATE_LIMIT_MAX_KEYS) {
    const oldestKey = hits.keys().next().value;
    if (oldestKey !== undefined) hits.delete(oldestKey);
  }
  hits.set(address, recent);
  return { ok: true };
}

async function readBody(
  req: IncomingMessage,
): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      return {
        ok: false,
        status: 413,
        message: 'The request is too large. Shorten the conversation.',
      };
    }
    chunks.push(chunk);
  }

  return { ok: true, text: Buffer.concat(chunks).toString('utf8') };
}

/** `messages` is the only field the client may send; everything else is dropped, not merged. */
function readMessages(
  text: string,
): { ok: true; messages: ChatMessage[] } | { ok: false; status: number; message: string } {
  const reject = (message: string) => ({ ok: false as const, status: 400, message });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return reject('The request body is not valid JSON.');
  }

  if (!isRecord(payload)) return reject('The request body must be a JSON object.');

  const raw = payload['messages'];
  if (!Array.isArray(raw)) return reject('The request must carry a messages array.');
  if (raw.length === 0) return reject('The request must carry at least one message.');
  if (raw.length > MAX_MESSAGES) {
    return reject(
      `A conversation is capped at ${String(MAX_MESSAGES)} messages. Start a new chat.`,
    );
  }

  const messages: ChatMessage[] = [];
  let total = 0;

  for (const entry of raw) {
    if (!isRecord(entry)) return reject('Every message must be an object.');
    const { role, content } = entry;
    if (role !== 'user' && role !== 'assistant') {
      return reject('Every message must have a role of "user" or "assistant".');
    }
    if (typeof content !== 'string' || content === '') {
      return reject('Every message must have non-empty string content.');
    }
    total += content.length;
    if (total > MAX_TOTAL_CHARS) {
      return reject('The conversation is too long. Start a new chat.');
    }
    messages.push({ role, content });
  }

  return { ok: true, messages };
}

/**
 * A client-supplied key, forwarded verbatim and never persisted or logged (ADR-0003). The shape
 * check only rejects an obviously malformed header — validating the key is OpenRouter's job.
 */
function readClientKey(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || token.length < 8 || token.length > 512) return undefined;
  return token;
}

function sendJson(res: ServerResponse, status: number, code: string, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ error: { code, message } }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, 'method_not_allowed', 'Send the request as POST.');
    return;
  }

  const clientKey = readClientKey(req);
  const serverKey = process.env['OPENROUTER_API_KEY'];

  // BYOK skips the address rate limit only — it is the user's quota. Every other cap still applies.
  if (clientKey === undefined) {
    if (serverKey === undefined || serverKey === '') {
      sendJson(
        res,
        503,
        'no_credential',
        'The server has no API key configured. Add your own key in settings.',
      );
      return;
    }

    const limit = rateLimit(addressOf(req), Date.now());
    if (!limit.ok) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      sendJson(res, 429, 'rate_limited', 'Too many requests. Wait a moment, or use your own key.');
      return;
    }
  }

  const body = await readBody(req);
  if (!body.ok) {
    sendJson(res, body.status, 'invalid_request', body.message);
    return;
  }

  const parsed = readMessages(body.text);
  if (!parsed.ok) {
    sendJson(res, parsed.status, 'invalid_request', parsed.message);
    return;
  }

  // Releases the upstream connection when the browser goes away mid-stream.
  const abort = new AbortController();
  req.on('close', () => {
    abort.abort();
  });

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${clientKey ?? serverKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        models: MODEL_FALLBACKS,
        messages: parsed.messages,
        max_tokens: MAX_TOKENS,
        stream: true,
      }),
    });
  } catch {
    if (abort.signal.aborted) return;
    // The cause is swallowed, not echoed: it can carry the outbound request, Authorization included.
    sendJson(res, 502, 'upstream_unreachable', 'The provider could not be reached. Try again.');
    return;
  }

  if (!upstream.ok || upstream.body === null) {
    // Status passes through so the client classifies it as usual, but the body is re-serialised
    // rather than forwarded verbatim.
    const detail = await upstream.text().catch(() => '');
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter !== null) res.setHeader('Retry-After', retryAfter);
    sendJson(res, upstream.status, 'upstream_error', summariseUpstream(detail, upstream.status));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies that buffer would defeat streaming; nginx and Vercel both honour this.
    'X-Accel-Buffering': 'no',
  });

  try {
    // `pipeline` handles backpressure and tears both ends down on failure.
    await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>), res);
  } catch {
    // Headers are already out, so there is no status left to send. The client sees a truncated
    // stream, which core treats as a terminal flush.
    abort.abort();
    res.end();
  }
}

function summariseUpstream(detail: string, status: number): string {
  const fallback = `The provider returned ${String(status)}.`;

  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return fallback;
  }

  if (isRecord(parsed)) {
    const error = parsed['error'];
    if (typeof error === 'string' && error !== '') return error;
    if (isRecord(error) && typeof error['message'] === 'string' && error['message'] !== '') {
      return error['message'];
    }
  }
  return fallback;
}
