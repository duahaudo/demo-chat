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

/** One dispatched SSE frame. Comments are kept as a distinct kind rather than dropped. */
export type Frame =
  /** A frame carrying one or more `data:` fields, joined with `\n` as the spec requires. */
  | { readonly kind: 'data'; readonly data: string }
  /** A comment line (`: keepalive`). OpenRouter sends `: OPENROUTER PROCESSING`. */
  | { readonly kind: 'comment'; readonly text: string };

export interface SseBuffer {
  /**
   * Feed one decoded chunk. Returns every frame completed by this chunk, in arrival order —
   * empty when the chunk ended mid-frame.
   */
  push(chunk: string): Frame[];
  /**
   * End of stream. Emits a frame still held in the buffer, for servers that close without the
   * final blank-line delimiter. Returns `[]` when the buffer is empty. Idempotent.
   */
  flush(): Frame[];
}

/** A line terminator is `\r\n`, `\n` or a lone `\r` (WHATWG event-stream parsing). */
interface Scan {
  readonly lines: string[];
  readonly rest: string;
}

/**
 * Split off complete lines, leaving the incomplete tail in `rest`.
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

/** Strip the field name and, per the spec, a single leading space from the value. */
function fieldValue(line: string, colon: number): string {
  const raw = line.slice(colon + 1);
  return raw.startsWith(' ') ? raw.slice(1) : raw;
}

export function createSseBuffer(): SseBuffer {
  /** Bytes seen but not yet terminated by a line break. */
  let rest = '';
  /** Comment frames of the frame currently being assembled, in arrival order. */
  let comments: string[] = [];
  /** `data:` values of the frame currently being assembled. */
  let data: string[] = [];
  /** Whether the current frame has seen any line at all, so a lone delimiter dispatches nothing. */
  let started = false;

  /** Dispatch the assembled frame, if it holds anything, and reset. */
  function dispatch(out: Frame[]): void {
    for (const text of comments) out.push({ kind: 'comment', text });
    if (data.length > 0) out.push({ kind: 'data', data: data.join('\n') });
    comments = [];
    data = [];
    started = false;
  }

  function consume(line: string, out: Frame[]): void {
    if (line === '') {
      if (started) dispatch(out);
      return;
    }

    started = true;
    const colon = line.indexOf(':');

    if (colon === 0) {
      comments.push(fieldValue(line, 0));
      return;
    }

    // Fields other than `data` (`event`, `id`, `retry`, anything unknown) are ignored by design:
    // OpenRouter carries everything this product needs in the data payload.
    const name = colon === -1 ? line : line.slice(0, colon);
    if (name === 'data') data.push(colon === -1 ? '' : fieldValue(line, colon));
  }

  return {
    push(chunk) {
      if (chunk === '') return [];

      const out: Frame[] = [];
      const scan = scanLines(rest + chunk, false);
      rest = scan.rest;
      for (const line of scan.lines) consume(line, out);
      return out;
    },

    flush() {
      const out: Frame[] = [];

      if (rest !== '') {
        const scan = scanLines(rest, true); // a held `\r` is now unambiguously a terminator
        rest = '';
        for (const line of scan.lines) consume(line, out);
        if (scan.rest !== '') consume(scan.rest, out); // final line, unterminated
      }

      if (started) dispatch(out);
      return out;
    },
  };
}
