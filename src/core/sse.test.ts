import { describe, expect, it } from 'vitest';

import { createSseBuffer } from './sse';

/**
 * Deterministic split points. `Math.random` is banned in core and would make a failure
 * unreproducible anyway, so an LCG stands in: same seed, same splits, every run.
 */
function splitter(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Feed a whole stream through the buffer in the given chunks, ending with a flush. */
function drain(chunks: readonly string[]): string[] {
  const buffer = createSseBuffer();
  const frames: string[] = [];
  for (const chunk of chunks) frames.push(...buffer.push(chunk));
  frames.push(...buffer.flush());
  return frames;
}

function byBytes(stream: string): string[] {
  return [...stream];
}

function byRandomSplits(stream: string, seed: number): string[] {
  const next = splitter(seed);
  const chunks: string[] = [];
  let index = 0;
  while (index < stream.length) {
    const size = 1 + Math.floor(next() * 7);
    chunks.push(stream.slice(index, index + size));
    index += size;
  }
  return chunks;
}

const STREAM =
  ': OPENROUTER PROCESSING\n\n' +
  'data: {"choices":[{"delta":{"content":"He"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n' +
  'data: [DONE]\n\n';

const EXPECTED: string[] = [
  '{"choices":[{"delta":{"content":"He"}}]}',
  '{"choices":[{"delta":{"content":"llo"}}]}',
  '[DONE]',
];

describe('createSseBuffer', () => {
  it('emits frames from a stream delivered in one chunk', () => {
    expect(drain([STREAM])).toEqual(EXPECTED);
  });

  it('emits the same frames when fed one byte at a time', () => {
    expect(drain(byBytes(STREAM))).toEqual(EXPECTED);
  });

  it.each([1, 2, 3, 12345, 99999])(
    'emits the same frames at random split points (seed %i)',
    (seed) => {
      expect(drain(byRandomSplits(STREAM, seed))).toEqual(EXPECTED);
    },
  );

  it('never fabricates a boundary: an unterminated frame yields nothing', () => {
    const buffer = createSseBuffer();
    expect(buffer.push('data: {"choices":')).toEqual([]);
    expect(buffer.push('[{"delta":{"content":"x"}}]}')).toEqual([]);
    expect(buffer.push('\n')).toEqual([]);
    expect(buffer.push('\n')).toEqual(['{"choices":[{"delta":{"content":"x"}}]}']);
  });

  it('treats a carriage return split across reads as one line break', () => {
    const buffer = createSseBuffer();
    expect(buffer.push('data: hi\r')).toEqual([]); // ambiguous: \r or the start of \r\n
    expect(buffer.push('\n\r\n')).toEqual(['hi']);
    expect(buffer.flush()).toEqual([]);
  });

  it('accepts a lone carriage return as a terminator', () => {
    expect(drain(['data: hi\r\rdata: there\r\r'])).toEqual(['hi', 'there']);
  });

  it('flushes a stream that ends without its final delimiter', () => {
    expect(drain(['data: {"choices":[]}'])).toEqual(['{"choices":[]}']);
  });

  it('flushes a stream whose last line is terminated but not delimited', () => {
    expect(drain(['data: [DONE]\n'])).toEqual(['[DONE]']);
  });

  it('is idempotent on flush and safe to over-flush', () => {
    const buffer = createSseBuffer();
    buffer.push('data: tail');
    expect(buffer.flush()).toEqual(['tail']);
    expect(buffer.flush()).toEqual([]);
  });

  it('joins multiple data fields in one frame with a newline', () => {
    expect(drain(['data: one\ndata: two\n\n'])).toEqual(['one\ntwo']);
  });

  it('drops comment lines and never merges them into data', () => {
    expect(drain([': keepalive\ndata: payload\n\n'])).toEqual(['payload']);
  });

  it('strips exactly one leading space from a field value', () => {
    expect(drain(['data:  padded\n\n'])).toEqual([' padded']);
    expect(drain(['data:tight\n\n'])).toEqual(['tight']);
  });

  it('reads a data field with no colon as an empty value', () => {
    expect(drain(['data\n\n'])).toEqual(['']);
  });

  it('ignores fields the product does not use', () => {
    expect(drain(['event: message\nid: 7\nretry: 1000\ndata: kept\n\n'])).toEqual(['kept']);
  });

  it('dispatches nothing for blank lines between frames', () => {
    expect(drain(['\n\n\ndata: x\n\n\n\n'])).toEqual(['x']);
  });

  it('ignores an empty chunk', () => {
    const buffer = createSseBuffer();
    expect(buffer.push('')).toEqual([]);
    expect(buffer.push('data: x\n\n')).toEqual(['x']);
  });

  it('preserves a payload containing a blank line inside its JSON string', () => {
    expect(drain(['data: {"text":"line one\\n\\nline two"}\n\n'])).toEqual([
      '{"text":"line one\\n\\nline two"}',
    ]);
  });
});
