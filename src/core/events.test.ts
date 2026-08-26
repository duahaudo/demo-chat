import { describe, expect, it } from 'vitest';

import { classifyEvent } from './events';

const chunk = (delta: Record<string, unknown>, finishReason: unknown = null): string =>
  JSON.stringify({
    id: 'gen-1',
    model: 'openrouter/free',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });

describe('classifyEvent', () => {
  it('classifies a content delta', () => {
    expect(classifyEvent(chunk({ role: 'assistant', content: 'Hello' }))).toEqual({
      kind: 'delta',
      text: 'Hello',
    });
  });

  it('classifies the [DONE] sentinel, with or without surrounding space', () => {
    expect(classifyEvent('[DONE]')).toEqual({ kind: 'done', reason: 'sentinel' });
    expect(classifyEvent(' [DONE] ')).toEqual({ kind: 'done', reason: 'sentinel' });
  });

  it('classifies a terminal finish_reason as done', () => {
    expect(classifyEvent(chunk({}, 'stop'))).toEqual({ kind: 'done', reason: 'stop' });
    expect(classifyEvent(chunk({}, 'length'))).toEqual({ kind: 'done', reason: 'length' });
  });

  it('prefers the delta over finish_reason when a chunk carries both', () => {
    expect(classifyEvent(chunk({ content: 'tail' }, 'stop'))).toEqual({
      kind: 'delta',
      text: 'tail',
    });
  });

  it('classifies a top-level error delivered under HTTP 200', () => {
    const raw = JSON.stringify({ error: { code: 429, message: 'Rate limit exceeded' } });
    expect(classifyEvent(raw)).toEqual({
      kind: 'error',
      error: { code: 429, message: 'Rate limit exceeded' },
    });
  });

  it('classifies finish_reason "error" as an error, not a completion', () => {
    const raw = JSON.stringify({
      choices: [{ finish_reason: 'error', error: { code: 502, message: 'Upstream failed' } }],
    });
    expect(classifyEvent(raw)).toEqual({
      kind: 'error',
      error: { code: 502, message: 'Upstream failed' },
    });
  });

  it('classifies finish_reason "error" with no error object', () => {
    const event = classifyEvent(chunk({}, 'error'));
    expect(event.kind).toBe('error');
    expect(event).toMatchObject({ error: { code: undefined } });
  });

  it('reads an error given as a bare string', () => {
    expect(classifyEvent(JSON.stringify({ error: 'upstream exploded' }))).toEqual({
      kind: 'error',
      error: { code: undefined, message: 'upstream exploded' },
    });
  });

  it('falls back to a stated message when the error object carries none', () => {
    const event = classifyEvent(JSON.stringify({ error: { code: 'timeout' } }));
    expect(event).toMatchObject({ kind: 'error', error: { code: 'timeout' } });
    expect(event.kind === 'error' && event.error.message.length > 0).toBe(true);
  });

  it('ignores a null error field rather than reporting a failure', () => {
    expect(classifyEvent(JSON.stringify({ error: null, choices: [] }))).toEqual({
      kind: 'delta',
      text: '',
    });
  });

  it('classifies malformed JSON without throwing, so the stream survives', () => {
    const event = classifyEvent('{"choices":');
    expect(event).toMatchObject({ kind: 'malformed', raw: '{"choices":' });
  });

  it.each([
    ['a JSON array', '[1,2,3]'],
    ['a JSON scalar', '42'],
  ])('classifies %s as malformed', (_label, payload) => {
    expect(classifyEvent(payload)).toMatchObject({ kind: 'malformed', raw: payload });
  });

  it('classifies an object with no choices array as malformed', () => {
    expect(classifyEvent('{"foo":1}')).toMatchObject({ kind: 'malformed' });
  });

  it('classifies a non-object choice as malformed', () => {
    expect(classifyEvent('{"choices":["nope"]}')).toMatchObject({ kind: 'malformed' });
  });

  it('treats a usage-only trailing chunk as an empty delta', () => {
    const raw = JSON.stringify({ choices: [], usage: { total_tokens: 12 } });
    expect(classifyEvent(raw)).toEqual({ kind: 'delta', text: '' });
  });

  it('treats a role-only opening chunk as an empty delta', () => {
    expect(classifyEvent(chunk({ role: 'assistant', content: '' }))).toEqual({
      kind: 'delta',
      text: '',
    });
  });

  it('treats a chunk with neither delta nor finish_reason as an empty delta', () => {
    expect(classifyEvent('{"choices":[{"index":0}]}')).toEqual({ kind: 'delta', text: '' });
  });

  it('preserves whitespace-only content, which is real output', () => {
    expect(classifyEvent(chunk({ content: '  ' }))).toEqual({ kind: 'delta', text: '  ' });
  });
});
