import { describe, expect, it } from 'vitest';

import { classifyError, isAbortError, retryDelayMs } from './errors';

const http = (status: number, extra: Record<string, unknown> = {}) =>
  classifyError({ kind: 'http', status, ...extra });

describe('classifyError — HTTP boundaries', () => {
  it.each([408, 429, 504])('classifies %i as transient and retryable', (status) => {
    const error = http(status);
    expect(error.class).toBe('transient');
    expect(error.retryable).toBe(true);
    expect(error.maxRetries).toBeGreaterThan(1);
  });

  it('classifies 500 as transient but retried once only', () => {
    const error = http(500);
    expect(error.class).toBe('transient');
    expect(error.retryable).toBe(true);
    expect(error.maxRetries).toBe(1);
  });

  it.each([502, 503])('treats %i like 500', (status) => {
    expect(http(status)).toMatchObject({ class: 'transient', maxRetries: 1 });
  });

  it.each([400, 404, 413, 422])('classifies %i as permanent', (status) => {
    const error = http(status);
    expect(error.class).toBe('permanent');
    expect(error.retryable).toBe(false);
    expect(error.maxRetries).toBe(0);
  });

  it.each([401, 403])('classifies %i as permanent and points at the key', (status) => {
    const error = http(status);
    expect(error.class).toBe('permanent');
    expect(error.summary).toMatch(/key/i);
  });

  it('classifies 402 as permanent and names the remedy', () => {
    expect(http(402)).toMatchObject({ class: 'permanent', retryable: false });
    expect(http(402).summary).toMatch(/credit/i);
  });

  it('classifies a success status reaching the error path as protocol', () => {
    expect(http(200)).toMatchObject({ class: 'protocol', retryable: false });
  });

  it('defaults the code to the status and keeps a provider code when given', () => {
    expect(http(429).code).toBe(429);
    expect(http(429, { code: 'rate_limited' }).code).toBe('rate_limited');
  });

  it('keeps a caller-supplied message over the default summary', () => {
    expect(http(429, { message: 'Free tier exhausted. Add your own key.' }).summary).toBe(
      'Free tier exhausted. Add your own key.',
    );
  });

  it('converts Retry-After seconds to milliseconds', () => {
    expect(http(429, { retryAfterSeconds: 2.5 }).retryAfterMs).toBe(2500);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'ignores an unusable Retry-After (%s)',
    (retryAfterSeconds) => {
      expect(http(429, { retryAfterSeconds }).retryAfterMs).toBeUndefined();
    },
  );
});

describe('classifyError — non-HTTP failures', () => {
  it('classifies a protocol failure and carries its reason through', () => {
    const error = classifyError({
      kind: 'protocol',
      reason: 'Payload is not valid JSON.',
      code: 'malformed',
    });
    expect(error).toMatchObject({
      class: 'protocol',
      retryable: false,
      code: 'malformed',
      summary: 'Payload is not valid JSON.',
    });
  });

  it('classifies an AbortError as cancelled, never as a failure', () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const error = classifyError({ kind: 'thrown', cause: abort });
    expect(error.class).toBe('cancelled');
    expect(error.retryable).toBe(false);
  });

  it('classifies a TimeoutError as cancelled too', () => {
    const timeout = new DOMException('Timed out.', 'TimeoutError');
    expect(classifyError({ kind: 'thrown', cause: timeout }).class).toBe('cancelled');
  });

  it('classifies a fetch TypeError as local', () => {
    const error = classifyError({ kind: 'thrown', cause: new TypeError('Failed to fetch') });
    expect(error).toMatchObject({ class: 'local', retryable: false });
    expect(error.summary).toMatch(/connection/i);
  });

  it.each([
    ['a string', 'boom'],
    ['null', null],
    ['a plain object', { name: 'Whatever' }],
  ])('classifies %s thrown value as local without throwing', (_label, cause) => {
    expect(classifyError({ kind: 'thrown', cause }).class).toBe('local');
  });
});

describe('isAbortError', () => {
  it.each([
    [new DOMException('x', 'AbortError'), true],
    [new DOMException('x', 'TimeoutError'), true],
    [new Error('AbortError'), false],
    ['AbortError', false],
    [null, false],
    [undefined, false],
  ])('reads %s', (value, expected) => {
    expect(isAbortError(value)).toBe(expected);
  });
});

describe('retryDelayMs', () => {
  it('grows exponentially from the base and stops at the cap', () => {
    const full = 1 - Number.EPSILON; // upper edge of the jitter window
    expect(retryDelayMs(1, full)).toBe(500);
    expect(retryDelayMs(2, full)).toBe(1000);
    expect(retryDelayMs(3, full)).toBe(2000);
    expect(retryDelayMs(9, full)).toBe(8000);
    expect(retryDelayMs(50, full)).toBe(8000);
  });

  it('applies full jitter, so the delay spans the whole window', () => {
    expect(retryDelayMs(3, 0)).toBe(0);
    expect(retryDelayMs(3, 0.5)).toBe(1000);
  });

  it('clamps randomness outside [0, 1) rather than producing a negative delay', () => {
    expect(retryDelayMs(2, -5)).toBe(0);
    expect(retryDelayMs(2, 5)).toBe(1000);
  });

  it('treats attempt 0 and fractional attempts as the first attempt', () => {
    expect(retryDelayMs(0, 1)).toBe(500);
    expect(retryDelayMs(1.9, 1)).toBe(500);
  });

  it('obeys a server-directed wait instead of jittering it', () => {
    const rateLimited = classifyError({ kind: 'http', status: 429, retryAfterSeconds: 30 });
    expect(retryDelayMs(1, 0, rateLimited)).toBe(30000);
    expect(retryDelayMs(4, 0.9, rateLimited)).toBe(30000);
  });

  it('falls back to backoff when the error carries no instruction', () => {
    const serverError = classifyError({ kind: 'http', status: 500 });
    expect(retryDelayMs(1, 0.5, serverError)).toBe(250);
  });

  it('honours a caller-supplied policy', () => {
    expect(retryDelayMs(3, 1, undefined, { baseMs: 100, capMs: 250 })).toBe(250);
  });
});
