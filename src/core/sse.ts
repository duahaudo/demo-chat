/**
 * Incremental Server-Sent Events framing.
 *
 * Network reads do not align with protocol frames, so this buffer emits only frames it has seen
 * in full (TECHNICAL-DESIGN §3.3). It never fabricates a boundary: a chunk that ends mid-frame
 * yields nothing and its bytes are held until the delimiter actually arrives.
 *
 * Pure: no framework, no I/O, no clock. Byte decoding is the adapter's concern — this module
 * consumes already-decoded strings, so a multi-byte character split across reads is reassembled
 * upstream by `TextDecoderStream` before it gets here.
 */

export interface SseBuffer {
  /**
   * Feed one decoded chunk. Returns the payload of every frame completed by this chunk, in
   * arrival order — empty when the chunk ended mid-frame.
   */
  push(chunk: string): string[];
  /**
   * End of stream. Emits a frame still held in the buffer, for servers that close without the
   * final blank-line delimiter. Returns `[]` when the buffer is empty. Idempotent.
   */
  flush(): string[];
}

interface Scan {
  readonly lines: string[];
  readonly rest: string;
}

/**
 * Split off complete lines, leaving the incomplete tail in `rest`. A line terminator is `\r\n`,
 * `\n` or a lone `\r` (WHATWG event-stream parsing).
 *
 * A `\r` at the very end of a chunk is ambiguous — the next read may start with `\n`, which would
 * make it one line break rather than two. Unless `atEnd` is set, it stays in `rest`.
 */
function scanLines(buffer: string, atEnd: boolean): Scan {
  const lines: string[] = [];
  let start = 0;
  let i = 0;

  while (i < buffer.length) {
    const char = buffer[i];

    if (char === '\n') {
      lines.push(buffer.slice(start, i));
      i += 1;
      start = i;
      continue;
    }

    if (char === '\r') {
      if (i === buffer.length - 1 && !atEnd) break; // hold: might be the first half of \r\n
      lines.push(buffer.slice(start, i));
      i += buffer[i + 1] === '\n' ? 2 : 1;
      start = i;
      continue;
    }

    i += 1;
  }

  return { lines, rest: buffer.slice(start) };
}

export function createSseBuffer(): SseBuffer {
  /** Bytes seen but not yet terminated by a line break. */
  let rest = '';
  /** `data:` values of the frame currently being assembled. */
  let data: string[] = [];

  /** Dispatch the assembled frame, if it holds anything, and reset. A no-op when it is empty. */
  function dispatch(out: string[]): void {
    if (data.length > 0) out.push(data.join('\n')); // the spec joins repeated `data:` fields
    data = [];
  }

  function consume(line: string, out: string[]): void {
    if (line === '') {
      dispatch(out);
      return;
    }

    // Comment lines (OpenRouter's `: OPENROUTER PROCESSING` keepalive) and fields other than
    // `data` — `event`, `id`, `retry`, anything unknown — are dropped by design: OpenRouter
    // carries everything this product needs in the data payload.
    const colon = line.indexOf(':');
    if (colon === 0) return;
    if ((colon === -1 ? line : line.slice(0, colon)) !== 'data') return;

    const value = colon === -1 ? '' : line.slice(colon + 1);
    data.push(value.startsWith(' ') ? value.slice(1) : value); // one leading space, per the spec
  }

  return {
    push(chunk) {
      const out: string[] = [];
      const scan = scanLines(rest + chunk, false);
      rest = scan.rest;
      for (const line of scan.lines) consume(line, out);
      return out;
    },

    flush() {
      const out: string[] = [];

      if (rest !== '') {
        const scan = scanLines(rest, true); // a held `\r` is now unambiguously a terminator
        rest = '';
        for (const line of scan.lines) consume(line, out);
        if (scan.rest !== '') consume(scan.rest, out); // final line, unterminated
      }

      dispatch(out);
      return out;
    },
  };
}
