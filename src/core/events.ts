/**
 * Classification of one SSE frame into a stream event.
 *
 * Every judgement about what a frame means is made here, once, so the adapter and the hooks stay
 * free of protocol knowledge (TECHNICAL-DESIGN §2). Pure: no framework, no I/O, no clock.
 *
 * OpenRouter specifics this covers (all confirmed against the live API):
 * - `data: [DONE]` sentinel closes the stream.
 * - Mid-stream failures arrive under HTTP 200 as a top-level `error` field, alongside
 *   `finish_reason: "error"`.
 * - A malformed payload is reported, not thrown: the stream survives it.
 */

/** Why the model stopped. Passed through verbatim; the listed values are the common ones. */
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | (string & {});

/** An error carried inside the stream body, under HTTP 200. */
export interface StreamErrorPayload {
  /** Provider error code. Numeric where OpenRouter mirrors an HTTP status. */
  readonly code: number | string | undefined;
  readonly message: string;
}

export type StreamEvent =
  /** Text to append. `text` may be empty for role-only or usage-only chunks. */
  | { readonly kind: 'delta'; readonly text: string }
  /** The stream is over: either the `[DONE]` sentinel or a terminal `finish_reason`. */
  | { readonly kind: 'done'; readonly reason: 'sentinel' | FinishReason }
  /** The provider reported a failure inside the stream. */
  | { readonly kind: 'error'; readonly error: StreamErrorPayload }
  /** The payload could not be understood. The stream survives; surface and continue. */
  | { readonly kind: 'malformed'; readonly raw: string; readonly reason: string };

/** The sentinel OpenRouter sends as the last data frame. */
const DONE_SENTINEL = '[DONE]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read an error object in either OpenRouter shape: `{error: {...}}` or `{error: "message"}`. */
function readError(value: unknown): StreamErrorPayload {
  if (typeof value === 'string') return { code: undefined, message: value };

  if (isRecord(value)) {
    const code = value['code'];
    const message = value['message'];
    return {
      code: typeof code === 'number' || typeof code === 'string' ? code : undefined,
      message:
        typeof message === 'string' && message !== '' ? message : 'The provider reported an error.',
    };
  }

  return { code: undefined, message: 'The provider reported an error.' };
}

/**
 * Classify one frame's payload.
 *
 * Total: every frame produces exactly one event, and nothing throws — a payload this function
 * cannot read becomes `malformed` rather than an exception, because one bad frame must not end an
 * otherwise healthy stream (TECHNICAL-DESIGN §3.3).
 */
export function classifyEvent(raw: string): StreamEvent {
  if (raw.trim() === DONE_SENTINEL) return { kind: 'done', reason: 'sentinel' };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { kind: 'malformed', raw, reason: 'Payload is not valid JSON.' };
  }

  if (!isRecord(payload)) {
    return { kind: 'malformed', raw, reason: 'Payload is not a JSON object.' };
  }

  if ('error' in payload && payload['error'] !== null && payload['error'] !== undefined) {
    return { kind: 'error', error: readError(payload['error']) };
  }

  const choices = payload['choices'];
  if (!Array.isArray(choices)) {
    return { kind: 'malformed', raw, reason: 'Payload has no choices array.' };
  }

  // Only one choice is ever requested, so anything past the first is not this product's concern.
  const choice: unknown = choices[0];
  if (choice === undefined) return { kind: 'delta', text: '' }; // usage-only trailing chunk
  if (!isRecord(choice)) return { kind: 'malformed', raw, reason: 'Choice is not an object.' };

  const finishReason = choice['finish_reason'];

  if (finishReason === 'error') {
    const inChoice = choice['error'];
    return {
      kind: 'error',
      error:
        inChoice === null || inChoice === undefined
          ? { code: undefined, message: 'The provider ended the stream with an error.' }
          : readError(inChoice),
    };
  }

  const delta = choice['delta'];
  if (isRecord(delta)) {
    const content = delta['content'];
    if (typeof content === 'string' && content !== '') return { kind: 'delta', text: content };
  }

  if (typeof finishReason === 'string' && finishReason !== '') {
    return { kind: 'done', reason: finishReason };
  }

  // Valid, understood, and carries no text: a role-only opening chunk or a usage tail.
  return { kind: 'delta', text: '' };
}
